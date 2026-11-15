import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { nextInt } from '../../../rng';
import { addLog } from '../../../engine/log';
import { findCardAnywhere, findInstalledCorpCard, removeCard } from '../../../engine/helpers';
import { endRun } from '../../../engine/runEnd';
import { getCardScript } from '../../index';
import { runnerTrashInstalledCorpCard, runBlocked, startRun } from '../../../engine/actions/run';
import { giveTags } from '../../../engine/damage';
import { corpTrashFromHQ, drawForEffect, removeTags } from '../../../engine/cardEffects';
import { CardScript, EffectContext } from '../../types';
import {
  askCards,
  askChoice,
  gainCredits,
  installRunnerChoice,
  installRunnerHostChoice,
  installableRunnerCards,
  askRunnerInstall,
} from '../../effects';

const runSource = (ctx: EffectContext) => ({ cardCode: ctx.card.cardCode, instanceId: ctx.card.instanceId });

/** Asks which server a "Run any server" event runs. */
function askAnyServer(ctx: EffectContext, title: string): void {
  const options = Object.values(ctx.state.corp.servers).filter(s => !runBlocked(ctx.state, s.id)).map(s => ({ id: s.id, label: s.name }));
  askChoice(ctx, 'runner', `${title}: run which server?`, options, 'run');
}

// --- Identities -------------------------------------------------------------

// Charm Offensive: Run Archives. When that run ends, you may trash 1 rezzed copy
// of a card you accessed in Archives during that run.
const charmTargets = (state: GameState, titles: Set<string>) =>
  Object.values(state.corp.servers)
    .flatMap(s => [...s.ice, ...s.root])
    .filter(c => c.isRezzed && titles.has(cardDef(c).title) && !getCardScript(c.cardCode)?.runnerCannotTrash);

export const charmOffensive: CardScript = {
  onPlay: ctx => startRun(ctx.state, 'archives', { source: runSource(ctx), eventCode: ctx.card.cardCode }),
  onRunEnds: (ctx, run) => {
    const titles = new Set(
      run.accessed.filter(a => a.inArchives).flatMap(a => {
        const card = findCardAnywhere(ctx.state, a.id);
        return card ? [cardDef(card).title] : [];
      })
    );
    const targets = charmTargets(ctx.state, titles);
    if (targets.length === 0) return;
    askCards(ctx, 'runner', 'Charm Offensive: you may trash 1 rezzed copy of a card you accessed in Archives.', targets.map(c => c.instanceId), 0, 1, 'trash');
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards' || answer.cardInstanceIds.length === 0) return;
    const found = findInstalledCorpCard(state, answer.cardInstanceIds[0]);
    if (found) runnerTrashInstalledCorpCard(state, found.card);
  },
};

// Scrounge (Double): As an additional cost to play this event, spend click.
// Install 1 program from your heap. You may add 1 program from your heap to the bottom of your stack.
const heapPrograms = (state: GameState) => state.runner.heap.filter(c => cardDef(c).type_code === 'program');

const askScroungeStack = (ctx: EffectContext) => {
  const programs = heapPrograms(ctx.state);
  if (programs.length === 0) return;
  askCards(ctx, 'runner', 'Scrounge: you may add 1 program from your heap to the bottom of your stack.', programs.map(c => c.instanceId), 0, 1, 'stack');
};

export const scrounge: CardScript = {
  extraClicks: 1,
  onPlay: ctx => {
    const targets = installableRunnerCards(ctx.state, heapPrograms(ctx.state));
    if (targets.length === 0) return askScroungeStack(ctx);
    askRunnerInstall(ctx, 'Scrounge: install 1 program from your heap.', targets.map(c => c.instanceId), 1, 1, 'install');
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'install' && answer.kind === 'effect_cards') {
      if (installRunnerChoice(ctx, answer.cardInstanceIds[0], 'host', 0, {}, answer.trashFirst)) askScroungeStack(ctx);
    } else if (source.step === 'host') {
      installRunnerHostChoice(state, source, answer);
      askScroungeStack(ctx);
    } else if (source.step === 'stack' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      const card = state.runner.heap.find(c => c.instanceId === answer.cardInstanceIds[0])!;
      removeCard(state.runner.heap, card);
      state.runner.stack.push(card);
      addLog(state, 'runner', `Runner added ${cardDef(card).title} to the bottom of their stack (Scrounge).`);
    }
  },
};

// Shred: Run any server. The first time the Corp would end that run, prevent the
// run from ending unless the Corp reveals and trashes X cards from HQ at random.
// X is equal to the number of cards in the root of the attacked server.
// (The engine asks the Corp in endTheRun(); the answer comes back here.)
export const shred: CardScript = {
  onPlay: ctx => askAnyServer(ctx, 'Shred'),
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (answer.kind !== 'effect_choice') return;
    if (source.step === 'run') {
      startRun(state, answer.optionId, { source: runSource(ctx), eventCode: ctx.card.cardCode, shred: true });
      return;
    }
    if (source.step !== 'shred' || answer.optionId !== 'trash') return;
    const x = Number(source.data?.x ?? 0);
    const pool = [...state.corp.hq];
    const ids: string[] = [];
    for (let i = 0; i < x && pool.length > 0; i++) ids.push(pool.splice(nextInt(state.rng, pool.length), 1)[0].instanceId);
    const trashed = corpTrashFromHQ(state, ids, true);
    addLog(state, 'corp', `Corp revealed and trashed ${trashed.map(c => cardDef(c).title).join(', ') || 'no cards'} from HQ (Shred).`);
    if (!state.activeRun) return;
    addLog(state, 'corp', 'The run was ended.');
    endRun(state);
  },
};

// Clean Getaway: Run any server. If successful, gain 6 credits.
export const cleanGetaway: CardScript = {
  onPlay: ctx => askAnyServer(ctx, 'Clean Getaway'),
  onPromptAnswer: (ctx, _source, answer) => {
    if (answer.kind === 'effect_choice') startRun(ctx.state, answer.optionId, { source: runSource(ctx), eventCode: ctx.card.cardCode });
  },
  onRunSuccessful: ({ state }) => {
    gainCredits(state, 'runner', 6);
    addLog(state, 'runner', 'Runner gained 6 [credit] (Clean Getaway).');
  },
};

// Lie Low (Double): As an additional cost to play this event, spend click.
// Resolve 1 of the following: Draw 4 cards. Remove up to 2 tags.
export const lieLow: CardScript = {
  extraClicks: 1,
  onPlay: ctx =>
    askChoice(ctx, 'runner', 'Lie Low: choose one.', [
      { id: 'draw', label: 'Draw 4 cards' },
      { id: 'tags', label: 'Remove up to 2 tags' },
    ], 'choose'),
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'draw') drawForEffect(state, 'runner', 4, 'Lie Low');
    else addLog(state, 'runner', `Runner removed ${removeTags(state, 2)} tag(s) (Lie Low).`);
  },
};

// Maintenance Access (Run, Double): As an additional cost to play this event,
// spend click. Run Archives. When you would approach Archives (after passing all
// ice), instead change the attacked server to HQ and approach HQ.
export const maintenanceAccess: CardScript = {
  extraClicks: 1,
  onPlay: ctx => startRun(ctx.state, 'archives', { source: runSource(ctx), eventCode: ctx.card.cardCode, redirectToHq: true }),
};

// Transfer of Wealth: Run HQ. If successful, take 1 tag and the Corp loses 3
// credits. Gain 2 credits for each credit lost this way.
const transferLoss = (state: GameState) => Math.min(3, state.corp.credits);

export const transferOfWealth: CardScript = {
  onPlay: ctx => startRun(ctx.state, 'hq', { source: runSource(ctx), eventCode: ctx.card.cardCode }),
  liveValue: state => `If successful now: Corp loses ${transferLoss(state)}, you gain ${2 * transferLoss(state)}[credit]`,
  onRunSuccessful: ({ state }) => {
    giveTags(state, 1);
    const lost = transferLoss(state);
    state.corp.credits -= lost;
    gainCredits(state, 'runner', 2 * lost);
    addLog(state, 'runner', `Corp lost ${lost} [credit]; Runner gained ${2 * lost} [credit] (Transfer of Wealth).`);
  },
};

// Illumination: Run R&D. If successful, install up to 3 cards from your grip
// (one at a time), paying 1 credit less for each.
const askIllumination = (ctx: EffectContext, left: number) => {
  const targets = installableRunnerCards(ctx.state, ctx.state.runner.grip, 1);
  if (left <= 0 || targets.length === 0) return;
  askRunnerInstall(ctx, `Illumination: you may install a card from your grip, paying 1 credit less (${left} left).`, targets.map(c => c.instanceId), 0, 1, 'install', { left });
};

export const illumination: CardScript = {
  onPlay: ctx => startRun(ctx.state, 'rd', { source: runSource(ctx), eventCode: ctx.card.cardCode }),
  onRunSuccessful: ctx => askIllumination(ctx, 3),
  onPromptAnswer: (ctx, source, answer) => {
    const left = Number(source.data?.left ?? 0);
    if (source.step === 'install' && answer.kind === 'effect_cards') {
      if (answer.cardInstanceIds.length === 0) return;
      if (installRunnerChoice(ctx, answer.cardInstanceIds[0], 'host', 1, { left }, answer.trashFirst)) askIllumination(ctx, left - 1);
    } else if (source.step === 'host') {
      installRunnerHostChoice(ctx.state, source, answer);
      askIllumination(ctx, left - 1);
    }
  },
};

// Ritual: Draw 1 card for each click you have remaining.
export const ritual: CardScript = {
  onPlay: ({ state }) => drawForEffect(state, 'runner', state.runner.clicks, 'Ritual'),
  // The play action's click is spent before Ritual resolves (8.6.7b, f), so one fewer remains
  // (the 9.12.2b example counts the clicks left after playing it)
  liveValue: state => `Play now: draw ${Math.max(0, state.runner.clicks - 1)}`,
};

// --- Hardware ---------------------------------------------------------------------

export const elevationRunnerEventsScripts: Record<string, CardScript> = {
  '35003': charmOffensive,
  '35004': scrounge,
  '35005': shred,
  '35014': cleanGetaway,
  '35015': lieLow,
  '35016': maintenanceAccess,
  '35017': transferOfWealth,
  '35025': illumination,
  '35026': ritual,
};
