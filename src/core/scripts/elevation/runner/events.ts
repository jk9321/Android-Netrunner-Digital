import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { nextInt } from '../../../rng';
import { addLog } from '../../../engine/log';
import { findCardAnywhere, findInstalledCorpCard, illegal, removeCard } from '../../../engine/helpers';
import { endRun, SHRED_STEP, ShredData } from '../../../engine/runEnd';
import { getCardScript } from '../../index';
import { runnerTrashInstalledCorpCard, runBlocked, startRun } from '../../../engine/actions/run';
import { giveTags } from '../../../engine/damage';
import { corpTrashFromHQ, drawForEffect, removeTags } from '../../../engine/cardEffects';
import { CardScript, EffectContext } from '../../types';
import { gainCredits, installRunnerHostChoice, installableRunnerCards } from '../../effects';
import { cards, cardsQuestion, choice, ChoiceQuestion, choiceQuestion, prompts, RunnerHostData } from '../../steps';

const runSource = (ctx: EffectContext) => ({ cardCode: ctx.card.cardCode, instanceId: ctx.card.instanceId });

/** "Run any server": which server (asked even when every server is blocked, as before the typed steps). */
function anyServerQuestion(ctx: EffectContext, title: string): ChoiceQuestion {
  const options = Object.values(ctx.state.corp.servers).filter(s => !runBlocked(ctx.state, s.id)).map(s => ({ id: s.id, label: s.name }));
  return choiceQuestion('runner', `${title}: run which server?`, options);
}

// --- Identities -------------------------------------------------------------

// Charm Offensive: Run Archives. When that run ends, you may trash 1 rezzed copy
// of a card you accessed in Archives during that run.
const charmTargets = (state: GameState, titles: Set<string>) =>
  Object.values(state.corp.servers)
    .flatMap(s => [...s.ice, ...s.root])
    .filter(c => c.isRezzed && titles.has(cardDef(c).title) && !getCardScript(c.cardCode)?.runnerCannotTrash);

const charmFlow = prompts({
  trash: cards(({ state }, a) => {
    if (a.ids.length === 0) return;
    const found = findInstalledCorpCard(state, a.ids[0]);
    if (found) runnerTrashInstalledCorpCard(state, found.card);
  }),
});

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
    charmFlow.ask(ctx, 'trash', cardsQuestion('runner', 'Charm Offensive: you may trash 1 rezzed copy of a card you accessed in Archives.', targets.map(c => c.instanceId), 0, 1));
  },
  ...charmFlow.script,
};

// Scrounge (Double): As an additional cost to play this event, spend click.
// Install 1 program from your heap. You may add 1 program from your heap to the bottom of your stack.
const heapPrograms = (state: GameState) => state.runner.heap.filter(c => cardDef(c).type_code === 'program');

const askScroungeStack = (ctx: EffectContext) => {
  const programs = heapPrograms(ctx.state);
  if (programs.length === 0) return;
  scroungeFlow.ask(ctx, 'stack', cardsQuestion('runner', 'Scrounge: you may add 1 program from your heap to the bottom of your stack.', programs.map(c => c.instanceId), 0, 1));
};

const scroungeFlow = prompts({
  install: cards((ctx, a) => {
    if (scroungeFlow.installRunner(ctx, a.ids[0], 'host', 0, a.trashFirst)) askScroungeStack(ctx);
  }),
  host: choice<RunnerHostData>((ctx, a, _d, source) => {
    installRunnerHostChoice(ctx.state, source, a.raw);
    askScroungeStack(ctx);
  }),
  stack: cards(({ state }, a) => {
    if (a.ids.length === 0) return;
    const card = state.runner.heap.find(c => c.instanceId === a.ids[0]);
    if (!card) illegal('That program is no longer in your heap');
    removeCard(state.runner.heap, card);
    state.runner.stack.push(card);
    addLog(state, 'runner', `Runner added ${cardDef(card).title} to the bottom of their stack (Scrounge).`);
  }),
});

export const scrounge: CardScript = {
  extraClicks: 1,
  // The program installed may be Muse, whose search resolves before Scrounge's second sentence (rules 9.6.5a) and can
  // take a program from the heap: the "add to stack" list is the heap as it is when that question comes up
  liveCandidates: (state, source) => (source.step === 'stack' ? heapPrograms(state).map(c => c.instanceId) : undefined),
  onPlay: ctx => {
    const targets = installableRunnerCards(ctx.state, heapPrograms(ctx.state));
    if (targets.length === 0) return askScroungeStack(ctx);
    scroungeFlow.runnerInstall(ctx, 'install', { message: 'Scrounge: install 1 program from your heap.', candidateIds: targets.map(c => c.instanceId), min: 1, max: 1 });
  },
  ...scroungeFlow.script,
};

// Shred: Run any server. The first time the Corp would end that run, prevent the
// run from ending unless the Corp reveals and trashes X cards from HQ at random.
// X is equal to the number of cards in the root of the attacked server.
// (The engine asks the Corp in endTheRun(); the answer comes back here.)
const shredFlow = prompts({
  run: choice((ctx, a) => startRun(ctx.state, a.optionId, { source: runSource(ctx), eventCode: ctx.card.cardCode, shred: true })),
  // The engine asks the Corp this as the run would end (endTheRun)
  [SHRED_STEP]: choice<ShredData>(({ state }, a, data) => {
    if (a.optionId !== 'trash') return;
    const x = Number(data.x ?? 0);
    const pool = [...state.corp.hq];
    const ids: string[] = [];
    for (let i = 0; i < x && pool.length > 0; i++) ids.push(pool.splice(nextInt(state.rng, pool.length), 1)[0].instanceId);
    const trashed = corpTrashFromHQ(state, ids, true);
    addLog(state, 'corp', `Corp revealed and trashed ${trashed.map(c => cardDef(c).title).join(', ') || 'no cards'} from HQ (Shred).`);
    if (!state.activeRun) return;
    addLog(state, 'corp', 'The run was ended.');
    endRun(state);
  }),
});

export const shred: CardScript = {
  onPlay: ctx => shredFlow.ask(ctx, 'run', anyServerQuestion(ctx, 'Shred')),
  ...shredFlow.script,
};

// Clean Getaway: Run any server. If successful, gain 6 credits.
const cleanGetawayFlow = prompts({
  run: choice((ctx, a) => startRun(ctx.state, a.optionId, { source: runSource(ctx), eventCode: ctx.card.cardCode })),
});

export const cleanGetaway: CardScript = {
  onPlay: ctx => cleanGetawayFlow.ask(ctx, 'run', anyServerQuestion(ctx, 'Clean Getaway')),
  ...cleanGetawayFlow.script,
  onRunSuccessful: ({ state }) => {
    gainCredits(state, 'runner', 6);
    addLog(state, 'runner', 'Runner gained 6 [credit] (Clean Getaway).');
  },
};

// Lie Low (Double): As an additional cost to play this event, spend click.
// Resolve 1 of the following: Draw 4 cards. Remove up to 2 tags.
const lieLowFlow = prompts({
  choose: choice(({ state }, a) => {
    if (a.optionId === 'draw') drawForEffect(state, 'runner', 4, 'Lie Low');
    else addLog(state, 'runner', `Runner removed ${removeTags(state, 2)} tag(s) (Lie Low).`);
  }),
});

export const lieLow: CardScript = {
  extraClicks: 1,
  onPlay: ctx =>
    lieLowFlow.ask(
      ctx,
      'choose',
      choiceQuestion('runner', 'Lie Low: choose one.', [
        { id: 'draw', label: 'Draw 4 cards' },
        { id: 'tags', label: 'Remove up to 2 tags' },
      ]),
    ),
  ...lieLowFlow.script,
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
  illuminationFlow.runnerInstall(
    ctx,
    'install',
    { message: `Illumination: you may install a card from your grip, paying 1 credit less (${left} left).`, candidateIds: targets.map(c => c.instanceId), min: 0, max: 1 },
    { left },
  );
};

type IlluminationData = { left: number };

const illuminationFlow = prompts({
  install: cards<IlluminationData>((ctx, a, data) => {
    const left = Number(data.left ?? 0);
    if (a.ids.length === 0) return;
    if (illuminationFlow.installRunner(ctx, a.ids[0], 'host', 1, a.trashFirst, { left })) askIllumination(ctx, left - 1);
  }),
  host: choice<IlluminationData & RunnerHostData>((ctx, a, data, source) => {
    installRunnerHostChoice(ctx.state, source, a.raw);
    askIllumination(ctx, Number(data.left ?? 0) - 1);
  }),
});

export const illumination: CardScript = {
  onPlay: ctx => startRun(ctx.state, 'rd', { source: runSource(ctx), eventCode: ctx.card.cardCode }),
  onRunSuccessful: ctx => askIllumination(ctx, 3),
  ...illuminationFlow.script,
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
