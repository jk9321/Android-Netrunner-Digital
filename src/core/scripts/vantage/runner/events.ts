import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { shuffleInPlace } from '../../../rng';
import { addLog } from '../../../engine/log';
import { drawCards, findInstalledCorpCard, removeCard } from '../../../engine/helpers';
import { runnerTrashInstalledCorpCard, runBlocked, startRun } from '../../../engine/actions/run';
import { installedRunnerCards, trashInstalledRunnerCard, uninstallRunnerCard } from '../../../engine/damage';
import { takeBadPublicity } from '../../../engine/cardEffects';
import { CardScript, EffectContext } from '../../types';
import { gainCredits, installRunnerHostChoice } from '../../effects';
import { cards, cardsQuestion, choice, choiceQuestion, ChoiceQuestion, prompts, RunnerHostData } from '../../steps';
import { ids, keywords } from './helpers';

const runSource = (ctx: EffectContext) => ({ cardCode: ctx.card.cardCode, instanceId: ctx.card.instanceId });

const installedCorpCards = (state: GameState) => Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]);

/** "Remove this event from the game" once its run is over. */
function removeEventFromGame(state: GameState, card: CardInstance): void {
  if (!removeCard(state.runner.heap, card)) return;
  card.tokens = {};
  state.removedFromGame.push(card);
  addLog(state, 'runner', `${cardDef(card).title} was removed from the game.`);
}

/** Which of these servers a run event runs (asked under the event's 'run' step). */
function serverQuestion(ctx: EffectContext, title: string, serverIds: string[]): ChoiceQuestion {
  const options = serverIds.filter(id => !runBlocked(ctx.state, id)).map(id => ({ id, label: ctx.state.corp.servers[id].name }));
  return choiceQuestion('runner', `${title}: run which server?`, options);
}

// --- Identities -------------------------------------------------------------

// Chain Reaction: Play only if you made a successful run on HQ, R&D, and Archives this
// turn. Trash 2 installed Corp cards. The Corp trashes 1 installed Runner card.
const chainReactionCorpTrash = (ctx: EffectContext) => {
  const mine = installedRunnerCards(ctx.state);
  if (mine.length > 0) chainFlow.cards(ctx, 'corp', cardsQuestion('corp', 'Chain Reaction: trash 1 installed Runner card.', ids(mine), 1, 1));
};

const chainFlow = prompts({
  trash: cards((ctx, a) => {
    for (const id of a.ids) {
      const found = findInstalledCorpCard(ctx.state, id);
      if (found) runnerTrashInstalledCorpCard(ctx.state, found.card);
    }
    chainReactionCorpTrash(ctx);
  }),
  corp: cards(({ state }, a) => {
    const card = installedRunnerCards(state).find(c => c.instanceId === a.ids[0]);
    if (!card) return;
    trashInstalledRunnerCard(state, card);
    addLog(state, 'corp', `Corp trashed ${cardDef(card).title} (Chain Reaction).`);
  }),
});

export const chainReaction: CardScript = {
  canPlay: ({ state }) =>
    ['hq', 'rd', 'archives'].every(server => state.runsThisTurn.some(r => r.server === server && r.successful))
      ? null
      : 'Play only if you made a successful run on HQ, R&D and Archives this turn',
  onPlay: ctx => {
    const targets = installedCorpCards(ctx.state);
    if (targets.length === 0) {
      chainReactionCorpTrash(ctx);
      return;
    }
    const n = Math.min(2, targets.length);
    chainFlow.cards(ctx, 'trash', cardsQuestion('runner', 'Chain Reaction: trash 2 installed Corp cards.', ids(targets), n, n));
  },
  ...chainFlow.script,
};

// Take a Dive: Run HQ or R&D. If successful, and if a subroutine resolved during this run,
// give the Corp 1 bad publicity. Remove this event from the game.
const diveFlow = prompts({
  run: choice((ctx, a) => void startRun(ctx.state, a.optionId, { source: runSource(ctx), eventCode: ctx.card.cardCode })),
});

export const takeADive: CardScript = {
  onPlay: ctx => diveFlow.choice(ctx, 'run', serverQuestion(ctx, 'Take a Dive', ['hq', 'rd'])),
  ...diveFlow.script,
  onRunSuccessful: ({ state }) => {
    if (state.activeRun?.subroutineResolved) takeBadPublicity(state, 1);
  },
  onRunEnds: ({ state, card }) => removeEventFromGame(state, card),
};

// Kompromat: Run a server protected by ice. When that run ends, if it was successful, give
// the Corp 1 bad publicity unless they derez 1 piece of ice protecting the attacked server.
// Remove this event from the game.
const iceProtected = (state: GameState) => Object.values(state.corp.servers).filter(s => s.ice.length > 0).map(s => s.id);

const kompromatFlow = prompts({
  run: choice((ctx, a) => void startRun(ctx.state, a.optionId, { source: runSource(ctx), eventCode: ctx.card.cardCode })),
  derez: choice<{ server: string }>(({ state }, a) => {
    const ice = findInstalledCorpCard(state, a.optionId)?.card;
    if (ice?.isRezzed) {
      ice.isRezzed = false;
      addLog(state, 'corp', `Corp derezzed ${cardDef(ice).title} (Kompromat).`);
    } else {
      takeBadPublicity(state, 1);
    }
  }),
});

export const kompromat: CardScript = {
  canPlay: ({ state }) => (iceProtected(state).length > 0 ? null : 'No server is protected by ice'),
  onPlay: ctx => kompromatFlow.choice(ctx, 'run', serverQuestion(ctx, 'Kompromat', iceProtected(ctx.state))),
  onRunEnds: (ctx, run) => {
    const { state, card } = ctx;
    removeEventFromGame(state, card);
    if (!run.isSuccessful) return;
    const rezzed = (state.corp.servers[run.server]?.ice ?? []).filter(c => c.isRezzed);
    if (rezzed.length === 0) {
      takeBadPublicity(state, 1);
      return;
    }
    kompromatFlow.choice(ctx, 'derez', choiceQuestion('corp', 'Kompromat: derez 1 piece of ice protecting the server, or take 1 bad publicity.', [
      ...rezzed.map(c => ({ id: c.instanceId, label: `Derez ${cardDef(c).title}` })),
      { id: 'bp', label: 'Take 1 bad publicity' },
    ]), { server: run.server });
  },
  ...kompromatFlow.script,
};

// Sell Out: As an additional cost to play this event, trash 1 installed resource.
// Gain 4 credits and draw 2 cards.
const sellOutFlow = prompts({
  trash: cards(({ state }, a) => {
    const resource = state.runner.rig.resources.find(c => c.instanceId === a.ids[0]);
    if (!resource) return;
    trashInstalledRunnerCard(state, resource);
    gainCredits(state, 'runner', 4);
    const drawn = drawCards(state, 'runner', 2);
    addLog(state, 'runner', `Runner trashed ${cardDef(resource).title}, gained 4 [credit] and drew ${drawn} card(s) (Sell Out).`);
  }),
});

export const sellOut: CardScript = {
  canPlay: ({ state }) => (state.runner.rig.resources.length > 0 ? null : 'Needs an installed resource to trash'),
  onPlay: ctx => sellOutFlow.cards(ctx, 'trash', cardsQuestion('runner', 'Sell Out: trash 1 installed resource.', ids(ctx.state.runner.rig.resources), 1, 1)),
  ...sellOutFlow.script,
};

// Tailgate: The play cost of this event is lowered by 1 credit for each piece of ice
// protecting HQ. Run HQ. If successful, access 2 additional cards when you breach HQ.
export const tailgate: CardScript = {
  playCostModifier: state => -state.corp.servers.hq.ice.length,
  liveValue: state => `Costs ${Math.max(0, 3 - state.corp.servers.hq.ice.length)}[credit] now`,
  onPlay: ctx => startRun(ctx.state, 'hq', { source: runSource(ctx), eventCode: ctx.card.cardCode }),
  onRunSuccessful: ({ state }) => {
    if (state.activeRun?.server === 'hq') state.activeRun.extraAccesses += 2;
  },
};

// Aircheck (Run - Stealth): Place 4 credits on this event. While this event is active, you
// can spend hosted credits, and you cannot lose or spend credits from your credit pool.
// Run HQ or R&D. When that run ends, if it was successful, you may run a remote server.
const AIRCHECK_SECOND = 'aircheck-second';

const aircheckRun = (ctx: EffectContext, serverId: string) =>
  startRun(ctx.state, serverId, { source: runSource(ctx), eventCode: ctx.card.cardCode, creditHosts: [ctx.card.instanceId], poolLocked: true });

const aircheckFlow = prompts({
  run: choice((ctx, a) => void aircheckRun(ctx, a.optionId)),
  remote: choice((ctx, a) => {
    if (a.optionId === 'no') {
      ctx.card.tokens = {};
      return;
    }
    aircheckRun(ctx, a.optionId);
  }),
});

export const aircheck: CardScript = {
  onPlay: ctx => {
    ctx.card.tokens = { credit: 4 };
    addLog(ctx.state, 'runner', 'Aircheck: 4 [credit] placed on it.');
    aircheckFlow.choice(ctx, 'run', serverQuestion(ctx, 'Aircheck', ['hq', 'rd']));
  },
  onRunEnds: (ctx, run) => {
    const { state, card } = ctx;
    const remotes = Object.values(state.corp.servers).filter(s => s.isRemote);
    if (!card.tokens[AIRCHECK_SECOND] && run.isSuccessful && remotes.length > 0) {
      card.tokens[AIRCHECK_SECOND] = 1;
      aircheckFlow.choice(ctx, 'remote', choiceQuestion('runner', 'Aircheck: you may run a remote server.', [...remotes.map(s => ({ id: s.id, label: s.name })), { id: 'no', label: 'No' }]));
      return;
    }
    // The event is done: its hosted credits go back to the bank
    card.tokens = {};
  },
  ...aircheckFlow.script,
};

// Beta Build: Search your stack for 1 non-virus program. Install it, ignoring all costs.
// Run any server. When that run ends, if that program has not been uninstalled, add it to
// the top of your stack.
const betaBuildRun = (ctx: EffectContext) => betaBuildFlow.choice(ctx, 'run', serverQuestion(ctx, 'Beta Build', Object.keys(ctx.state.corp.servers)));

const betaBuildFlow = prompts({
  install: cards((ctx, a) => {
    const { state, card } = ctx;
    const id = a.ids[0];
    card.hostedCardIds = [id];
    const installed = betaBuildFlow.installRunner(ctx, id, 'host', 99, a.trashFirst);
    shuffleInPlace(state.rng, state.runner.stack);
    if (installed || !state.pendingPrompts.length) betaBuildRun(ctx);
  }),
  host: choice<RunnerHostData>((ctx, a, _d, source) => {
    installRunnerHostChoice(ctx.state, source, a.raw);
    shuffleInPlace(ctx.state.rng, ctx.state.runner.stack);
    betaBuildRun(ctx);
  }),
  run: choice((ctx, a) => void startRun(ctx.state, a.optionId, { source: runSource(ctx), eventCode: ctx.card.cardCode })),
});

export const betaBuild: CardScript = {
  onPlay: ctx => {
    const { state } = ctx;
    const programs = state.runner.stack.filter(c => cardDef(c).type_code === 'program' && !/\bvirus\b/i.test(keywords(c)));
    if (programs.length === 0) {
      shuffleInPlace(state.rng, state.runner.stack);
      addLog(state, 'runner', 'Runner searched their stack but found no non-virus program (Beta Build).');
      betaBuildRun(ctx);
      return;
    }
    betaBuildFlow.runnerInstall(ctx, 'install', { message: 'Beta Build: install 1 non-virus program from your stack, ignoring all costs.', candidateIds: ids(programs), min: 1, max: 1 });
  },
  ...betaBuildFlow.script,
  onRunEnds: ({ state, card }) => {
    const program = state.runner.rig.programs.find(c => c.instanceId === card.hostedCardIds[0]);
    card.hostedCardIds = [];
    if (!program) return;
    // Back to the top of the stack (uninstalled: what it hosted is trashed)
    uninstallRunnerCard(state, program, 'stackTop');
    addLog(state, 'runner', `${cardDef(program).title} was added to the top of the stack (Beta Build).`);
  },
};

// --- Hardware ---------------------------------------------------------------

export const vantageRunnerEventsScripts: Record<string, CardScript> = {
  '36001': chainReaction,
  '36002': takeADive,
  '36010': kompromat,
  '36011': sellOut,
  '36012': tailgate,
  '36018': aircheck,
  '36019': betaBuild,
};
