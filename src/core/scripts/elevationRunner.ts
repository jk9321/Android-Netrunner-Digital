import { CardInstance } from '../types/card';
import { GameState } from '../types/state';
import { cardDef } from '../cards';
import { nextInt } from '../rng';
import { addLog } from '../engine/log';
import { findCardAnywhere, findInstalledCorpCard, removeCard, revealInHand } from '../engine/helpers';
import { endRun } from '../engine/runEnd';
import { getCardScript } from './index';
import { installedIce } from '../engine/cardEffects';
import { runnerInstallBlocker } from '../engine/actions/install';
import { accessOutsideRun, runnerTrashInstalledCorpCard, startRun, trashAccessedCard } from '../engine/actions/run';
import { dealDamage, giveTags, installedRunnerCards, trashInstalledRunnerCard } from '../engine/damage';
import {
  addCounters,
  corpTrashFromHQ,
  counters,
  derez,
  drawForEffect,
  flipIdentity,
  loadCredits,
  memoryLimit,
  removeCounters,
  removeTags,
  takeHostedCredits,
  useOncePerTurn,
} from '../engine/cardEffects';
import { addBreakerStrength, bypassIce, encounteredIce, isIcebreaker } from '../engine/ice';
import { CardScript, EffectContext } from './types';
import {
  askCards,
  askChoice,
  gainCredits,
  installRunnerChoice,
  installRunnerHostChoice,
  installableRunnerCards,
  askRunnerInstall,
  sabotage,
  resolveSabotage,
} from './effects';

/** Runner cards from Elevation. */

const isSelf = (ctx: EffectContext, card: CardInstance) => card.instanceId === ctx.card.instanceId;
const keywords = (card: CardInstance) => cardDef(card).keywords ?? '';
const isRunEvent = (card: CardInstance) => cardDef(card).type_code === 'event' && /\brun\b/i.test(keywords(card));
const onceKey = (card: CardInstance) => `once:${card.instanceId}`;
const runSource = (ctx: EffectContext) => ({ cardCode: ctx.card.cardCode, instanceId: ctx.card.instanceId });

/** True while the Runner is encountering ice and can still break (before subroutines fire). */
function inBreakWindow(state: GameState): boolean {
  const encounter = state.activeRun?.encounter;
  return Boolean(encounter && encounter.resolvingIndex === null && state.activeRun?.phase === 'encounter_ice' && !encounter.onEncounterPending);
}

/** Asks which server a "Run any server" event runs. */
function askAnyServer(ctx: EffectContext, title: string): void {
  const options = Object.values(ctx.state.corp.servers).map(s => ({ id: s.id, label: s.name }));
  askChoice(ctx, 'runner', `${title}: run which server?`, options, 'run');
}

// --- Identities -------------------------------------------------------------

// Ryō "Phoenix" Ōno: The first time each turn a run becomes successful after a
// subroutine resolved during that run, gain 1 credit and the Corp trashes 1 card from HQ.
const ryo: CardScript = {
  triggers: {
    successful_run: ctx => {
      const { state, card } = ctx;
      if (!state.activeRun?.subroutineResolved || !useOncePerTurn(state, onceKey(card))) return;
      gainCredits(state, 'runner', 1);
      addLog(state, 'runner', 'Runner gained 1 [credit] (Ryō "Phoenix" Ōno).');
      const hq = state.corp.hq;
      if (hq.length > 0) askCards(ctx, 'corp', 'Ryō "Phoenix" Ōno: trash 1 card from HQ.', hq.map(c => c.instanceId), 1, 1, 'trash');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    corpTrashFromHQ(state, answer.cardInstanceIds);
    addLog(state, 'corp', 'Corp trashed 1 card from HQ (Ryō "Phoenix" Ōno).');
  },
};

// Topan: Once per turn -> click: Install 1 card from your grip, paying 2 credits
// less. When you install that card, suffer 1 meat damage.
const topanTargets = (state: GameState) => installableRunnerCards(state, state.runner.grip, 2);
const topanDamage = (state: GameState) => dealDamage(state, 'meat', 1, false);
const topan: CardScript = {
  abilities: [
    {
      label: 'Install 1 card from your grip, paying 2 credits less, then suffer 1 meat damage.',
      clicks: 1,
      oncePerTurn: true,
      canUse: ({ state }) => (topanTargets(state).length > 0 ? null : 'Nothing in your grip can be installed'),
      resolve: ctx =>
        askRunnerInstall(ctx, 'Topan: install 1 card from your grip, paying 2 credits less.', topanTargets(ctx.state).map(c => c.instanceId), 1, 1, 'install'),
    },
  ],
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'install' && answer.kind === 'effect_cards') {
      if (installRunnerChoice(ctx, answer.cardInstanceIds[0], 'host', 2, {}, answer.trashFirst)) topanDamage(ctx.state);
    } else if (source.step === 'host' && installRunnerHostChoice(ctx.state, source, answer)) {
      topanDamage(ctx.state);
    }
  },
};

// Barry "Baz" Wong: Whenever the Corp rezzes a piece of ice, you may install 1
// resource or piece of hardware from your grip.
const bazTargets = (state: GameState) =>
  installableRunnerCards(state, state.runner.grip.filter(c => ['resource', 'hardware'].includes(cardDef(c).type_code)));
const baz: CardScript = {
  triggers: {
    rezzed: (ctx, e) => {
      if (cardDef(e.card).type_code !== 'ice') return;
      const targets = bazTargets(ctx.state);
      if (targets.length === 0) return;
      askCards(ctx, 'runner', 'Barry "Baz" Wong: you may install 1 resource or piece of hardware from your grip.', targets.map(c => c.instanceId), 0, 1, 'install');
    },
  },
  onPromptAnswer: (ctx, _source, answer) => {
    if (answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) installRunnerChoice(ctx, answer.cardInstanceIds[0], 'host');
  },
};

// MuslihaT: When your turn begins, look at the top card of your stack. If that
// card is an icebreaker or a run event, you may reveal it and add it to your grip.
const muslihat: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      const top = ctx.state.runner.stack[0];
      if (e.side !== 'runner' || !top || !(isIcebreaker(top) || isRunEvent(top))) return;
      askChoice(ctx, 'runner', `MuslihaT: the top card of your stack is ${cardDef(top).title}. Reveal it and add it to your grip?`, [
        { id: 'take', label: `Add ${cardDef(top).title} to your grip` },
        { id: 'leave', label: 'Leave it' },
      ], 'top', { cardId: top.instanceId });
    },
  },
  onPromptAnswer: ({ state }, source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId !== 'take') return;
    const card = state.runner.stack.find(c => c.instanceId === source.data?.cardId);
    if (!card) return;
    removeCard(state.runner.stack, card);
    state.runner.grip.push(card);
    revealInHand(state, 'runner', [card]);
    addLog(state, 'runner', `Runner revealed ${cardDef(card).title} and added it to their grip (MuslihaT).`);
  },
};

// Dewi Subrotoputri: Whenever you make a successful run, if your MU is full, you
// may flip this identity and gain 1 credit. Flip side: Whenever you make a
// successful run, if you have at least 1 unused MU, you may flip this identity and draw 1 card.
const dewi: CardScript = {
  triggers: {
    successful_run: ctx => {
      const { state, card } = ctx;
      const free = memoryLimit(state) - state.runner.memoryUnitsUsed;
      if (!card.flipped && free <= 0) {
        askChoice(ctx, 'runner', 'Dewi Subrotoputri: flip and gain 1 credit?', [
          { id: 'flip', label: 'Flip and gain 1 credit' },
          { id: 'no', label: 'Do not flip' },
        ], 'flip');
      } else if (card.flipped && free >= 1) {
        askChoice(ctx, 'runner', 'Dewi Subrotoputri: flip and draw 1 card?', [
          { id: 'flip', label: 'Flip and draw 1 card' },
          { id: 'no', label: 'Do not flip' },
        ], 'flip');
      }
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId !== 'flip') return;
    const wasFlipped = !!card.flipped;
    flipIdentity(state, 'runner');
    if (!wasFlipped) {
      gainCredits(state, 'runner', 1);
      addLog(state, 'runner', 'Runner gained 1 [credit] (Dewi Subrotoputri).');
    } else {
      drawForEffect(state, 'runner', 1, 'Dewi Subrotoputri');
    }
  },
};

/** Why a discarded program or piece of hardware can't be installed right now. */
function magdaleneBlocker(state: GameState, card: CardInstance): string {
  const ice = installedIce(state);
  if (getCardScript(card.cardCode)?.installsOnIce && ice.length === 0) return 'no installed ice to host it';
  return runnerInstallBlocker(state, card, getCardScript(card.cardCode)?.installsOnIce ? ice[0].instanceId : undefined) ?? 'not allowed';
}

// Magdalene Keino-Chemutai: Whenever you discard cards to reach your maximum hand
// size, you may install 1 program or piece of hardware from among those cards.
const magdalene: CardScript = {
  triggers: {
    discarded_to_hand_size: (ctx, e) => {
      if (e.side !== 'runner') return;
      const inHeap = e.cards.filter(c => ctx.state.runner.heap.includes(c) && ['program', 'hardware'].includes(cardDef(c).type_code));
      const targets = installableRunnerCards(ctx.state, inHeap);
      if (targets.length === 0) {
        // Installing still means paying the install cost (rules 1.16.6), so say why nothing could be installed
        for (const c of inHeap) addLog(ctx.state, 'runner', `Magdalene Keino-Chemutai: ${cardDef(c).title} cannot be installed (${magdaleneBlocker(ctx.state, c)}).`);
        return;
      }
      askRunnerInstall(ctx, 'Magdalene Keino-Chemutai: you may install 1 program or piece of hardware you discarded.', targets.map(c => c.instanceId), 0, 1, 'install');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'install' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      installRunnerChoice(ctx, answer.cardInstanceIds[0], 'host', 0, {}, answer.trashFirst);
    } else if (source.step === 'host') {
      installRunnerHostChoice(ctx.state, source, answer);
    }
  },
};

// --- Events -------------------------------------------------------------------

// Charm Offensive: Run Archives. When that run ends, you may trash 1 rezzed copy
// of a card you accessed in Archives during that run.
const charmTargets = (state: GameState, titles: Set<string>) =>
  Object.values(state.corp.servers)
    .flatMap(s => [...s.ice, ...s.root])
    .filter(c => c.isRezzed && titles.has(cardDef(c).title) && !getCardScript(c.cardCode)?.runnerCannotTrash);
const charmOffensive: CardScript = {
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
const scrounge: CardScript = {
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
const shred: CardScript = {
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
const cleanGetaway: CardScript = {
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
const lieLow: CardScript = {
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
const maintenanceAccess: CardScript = {
  extraClicks: 1,
  onPlay: ctx => startRun(ctx.state, 'archives', { source: runSource(ctx), eventCode: ctx.card.cardCode, redirectToHq: true }),
};

// Transfer of Wealth: Run HQ. If successful, take 1 tag and the Corp loses 3
// credits. Gain 2 credits for each credit lost this way.
const transferLoss = (state: GameState) => Math.min(3, state.corp.credits);
const transferOfWealth: CardScript = {
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
const illumination: CardScript = {
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
const ritual: CardScript = {
  onPlay: ({ state }) => drawForEffect(state, 'runner', state.runner.clicks, 'Ritual'),
  // The play action's click is spent before Ritual resolves (8.6.7b, f), so one fewer remains
  // (the 9.12.2b example counts the clicks left after playing it)
  liveValue: state => `Play now: draw ${Math.max(0, state.runner.clicks - 1)}`,
};

// --- Hardware ---------------------------------------------------------------------

// Bling: +1 MU. Whenever you install a card without spending credits, you may host
// the top card of your stack faceup on this hardware. You can play or install hosted
// cards as if they were in your grip. When your discard phase ends, trash all hosted cards.
const bling: CardScript = {
  modifiers: { memory: 1 },
  hostedPlayable: true,
  triggers: {
    installed: (ctx, e) => {
      if (cardDef(e.card).side_code !== 'runner' || e.paid !== 0 || ctx.state.runner.stack.length === 0) return;
      askChoice(ctx, 'runner', 'Bling: host the top card of your stack on Bling?', [
        { id: 'host', label: 'Host the top card' },
        { id: 'no', label: 'No' },
      ], 'host');
    },
    discard_phase_ends: ({ state, card }, e) => {
      if (e.side !== 'runner' || !card.hostedCards?.length) return;
      state.runner.heap.push(...card.hostedCards);
      addLog(state, 'runner', `Bling's hosted cards were trashed (${card.hostedCards.map(c => cardDef(c).title).join(', ')}).`);
      card.hostedCards = [];
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId !== 'host' || state.runner.stack.length === 0) return;
    const top = state.runner.stack.shift()!;
    card.hostedCards = [...(card.hostedCards ?? []), top];
    addLog(state, 'runner', `Runner hosted ${cardDef(top).title} on Bling.`);
  },
};

// Detente: +1 MU. The first time each turn you make a successful run on HQ, you may
// host 1 card from HQ at random faceup on this hardware. click, add 2 hosted cards
// to HQ: The Runner may access 1 card in HQ at random. Any player can use this ability.
const detenteReturn = (state: GameState, card: CardInstance, ids: string[]) => {
  for (const id of ids) {
    const hosted = card.hostedCards?.find(c => c.instanceId === id);
    if (!hosted) continue;
    card.hostedCards = card.hostedCards!.filter(c => c !== hosted);
    state.corp.hq.push(hosted);
    // Hosted faceup, so the Runner knows what went back
    revealInHand(state, 'corp', [hosted]);
  }
  addLog(state, 'runner', `${ids.length} card(s) hosted on Detente were added to HQ.`);
};
const askDetenteAccess = (ctx: EffectContext) => {
  if (ctx.state.corp.hq.length === 0 || ctx.state.activeRun) return;
  askChoice(ctx, 'runner', 'Detente: access 1 card in HQ at random?', [
    { id: 'access', label: 'Access 1 random card in HQ' },
    { id: 'no', label: 'No' },
  ], 'access');
};
const detente: CardScript = {
  modifiers: { memory: 1 },
  triggers: {
    successful_run: (ctx, e) => {
      if (e.server !== 'hq' || ctx.state.corp.hq.length === 0 || !useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
      askChoice(ctx, 'runner', 'Detente: host 1 card from HQ at random?', [
        { id: 'host', label: 'Host a random card from HQ' },
        { id: 'no', label: 'No' },
      ], 'host');
    },
  },
  abilities: [
    {
      label: 'Add 2 hosted cards to HQ: the Runner may access 1 card in HQ at random.',
      clicks: 1,
      anyPlayer: true,
      canUse: ({ card }) => ((card.hostedCards?.length ?? 0) >= 2 ? null : 'Needs 2 hosted cards'),
      resolve: ctx => {
        const hosted = ctx.card.hostedCards ?? [];
        if (hosted.length > 2) {
          askCards(ctx, ctx.side, 'Detente: choose 2 hosted cards to add to HQ.', hosted.map(c => c.instanceId), 2, 2, 'return');
          return;
        }
        detenteReturn(ctx.state, ctx.card, hosted.map(c => c.instanceId));
        askDetenteAccess(ctx);
      },
    },
  ],
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    if (source.step === 'host' && answer.kind === 'effect_choice' && answer.optionId === 'host') {
      if (state.corp.hq.length === 0) return;
      const target = state.corp.hq[nextInt(state.rng, state.corp.hq.length)];
      removeCard(state.corp.hq, target);
      target.isRezzed = true;
      card.hostedCards = [...(card.hostedCards ?? []), target];
      addLog(state, 'runner', `Runner hosted ${cardDef(target).title} from HQ on Detente.`);
    } else if (source.step === 'return' && answer.kind === 'effect_cards') {
      detenteReturn(state, card, answer.cardInstanceIds);
      askDetenteAccess(ctx);
    } else if (source.step === 'access' && answer.kind === 'effect_choice' && answer.optionId === 'access') {
      const hq = state.corp.hq;
      if (hq.length > 0) accessOutsideRun(state, [hq[nextInt(state.rng, hq.length)].instanceId]);
    }
  },
};

// Maglectric Rapid (748 Mod): Whenever you make a successful run on HQ, you may
// trash this hardware to derez 1 installed Corp card.
const rezzedCorpCards = (state: GameState) => Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]).filter(c => c.isRezzed);
const maglectric: CardScript = {
  triggers: {
    successful_run: (ctx, e) => {
      const targets = rezzedCorpCards(ctx.state);
      if (e.server !== 'hq' || targets.length === 0) return;
      askCards(ctx, 'runner', 'Maglectric Rapid: you may trash it to derez 1 installed Corp card.', targets.map(c => c.instanceId), 0, 1, 'derez');
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_cards' || answer.cardInstanceIds.length === 0) return;
    const target = findInstalledCorpCard(state, answer.cardInstanceIds[0])?.card;
    if (!target || !state.runner.rig.hardware.includes(card)) return;
    trashInstalledRunnerCard(state, card);
    derez(state, target);
  },
};

// GAMEDRAGON™ Pro: When you install this hardware and when your turn begins, you may
// host this hardware on an installed non-AI icebreaker. Host icebreaker gets +1
// strength. Abilities that increase its strength last for the remainder of the run.
const askGamedragonHost = (ctx: EffectContext) => {
  const breakers = ctx.state.runner.rig.programs.filter(
    p => isIcebreaker(p) && !/\bAI\b/.test(keywords(p)) && p.instanceId !== ctx.card.hostedOnId
  );
  if (breakers.length === 0) return;
  askChoice(ctx, 'runner', 'GAMEDRAGON™ Pro: host it on an icebreaker?', [
    ...breakers.map(b => ({ id: b.instanceId, label: `Host on ${cardDef(b).title}` })),
    { id: 'no', label: 'Leave it where it is' },
  ], 'host');
};
const gamedragon: CardScript = {
  modifiers: { hostStrength: 1, boostsLastForRun: true },
  triggers: {
    installed: (ctx, e) => isSelf(ctx, e.card) && askGamedragonHost(ctx),
    turn_begins: (ctx, e) => e.side === 'runner' && askGamedragonHost(ctx),
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId === 'no') return;
    const breaker = state.runner.rig.programs.find(p => p.instanceId === answer.optionId);
    if (!breaker || !state.runner.rig.hardware.includes(card)) return;
    const old = card.hostedOnId ? findCardAnywhere(state, card.hostedOnId) : undefined;
    if (old) old.hostedCardIds = old.hostedCardIds.filter(id => id !== card.instanceId);
    card.hostedOnId = breaker.instanceId;
    breaker.hostedCardIds.push(card.instanceId);
    addLog(state, 'runner', `Runner hosted GAMEDRAGON™ Pro on ${cardDef(breaker).title}.`);
  },
};

// Madani: click: Host any number of programs from your grip faceup on this hardware.
// Once per turn -> 0 credits: Install 1 hosted program (paying its install cost).
const madaniTargets = (state: GameState, card: CardInstance) => installableRunnerCards(state, card.hostedCards ?? []);
const madani: CardScript = {
  abilities: [
    {
      label: 'Host any number of programs from your grip on Madani.',
      clicks: 1,
      canUse: ({ state }) => (state.runner.grip.some(c => cardDef(c).type_code === 'program') ? null : 'No programs in your grip'),
      resolve: ctx => {
        const programs = ctx.state.runner.grip.filter(c => cardDef(c).type_code === 'program');
        askCards(ctx, 'runner', 'Madani: host any number of programs from your grip.', programs.map(c => c.instanceId), 0, programs.length, 'host_programs');
      },
    },
    {
      label: 'Install 1 hosted program.',
      oncePerTurn: true,
      canUse: ({ state, card }) => (madaniTargets(state, card).length > 0 ? null : 'No hosted program can be installed'),
      resolve: ctx =>
        askRunnerInstall(ctx, 'Madani: install 1 hosted program.', madaniTargets(ctx.state, ctx.card).map(c => c.instanceId), 1, 1, 'install'),
    },
  ],
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    if (source.step === 'host_programs' && answer.kind === 'effect_cards') {
      for (const id of answer.cardInstanceIds) {
        const program = state.runner.grip.find(c => c.instanceId === id);
        if (!program) continue;
        removeCard(state.runner.grip, program);
        card.hostedCards = [...(card.hostedCards ?? []), program];
      }
      addLog(state, 'runner', `Runner hosted ${answer.cardInstanceIds.length} program(s) on Madani.`);
    } else if (source.step === 'install' && answer.kind === 'effect_cards') {
      installRunnerChoice(ctx, answer.cardInstanceIds[0], 'host', 0, {}, answer.trashFirst);
    } else if (source.step === 'host') {
      installRunnerHostChoice(state, source, answer);
    }
  },
};

// --- Programs ------------------------------------------------------------------------

// Gourmand: Access -> trash: Trash the non-agenda card you are accessing. If you do, draw 1 card.
const gourmand: CardScript = {
  accessAbility: {
    label: 'trash Gourmand to trash this card and draw 1',
    canUse: (_ctx, accessed) => cardDef(accessed).type_code !== 'agenda',
    use: ({ state, card }, accessed) => {
      trashInstalledRunnerCard(state, card);
      addLog(state, 'runner', `Runner trashed Gourmand to trash ${cardDef(accessed).title}.`);
      trashAccessedCard(state, accessed);
      drawForEffect(state, 'runner', 1, 'Gourmand');
    },
  },
};

// Hantu (Killer, Virus): When you install this program, place 2 virus counters on it.
// Interface -> 1 credit: Break 1 sentry subroutine. Hosted virus counter: +2 strength.
const hantu: CardScript = {
  breaker: { breaks: 'sentry', breakMax: 1, breakCost: () => 1, boostCost: Infinity, boostAmount: () => 0 },
  triggers: { installed: (ctx, e) => isSelf(ctx, e.card) && addCounters(ctx.card, 'virus', 2) },
  abilities: [
    {
      label: 'Hosted virus counter: +2 strength.',
      counters: { type: 'virus', count: 1 },
      canUse: ({ state }) => (inBreakWindow(state) ? null : 'Only while encountering ice, before subroutines fire'),
      resolve: ({ state, card }) => addBreakerStrength(state, card, 2),
    },
  ],
};

// Rising Tide (Fracter): +1 strength for each fracter in your heap.
// Interface -> 1 credit: Break 1 barrier subroutine. 1 credit: +1 strength.
const risingTide: CardScript = {
  breaker: {
    breaks: 'barrier',
    breakMax: 1,
    breakCost: () => 1,
    boostCost: 1,
    boostAmount: () => 1,
    strengthModifier: state => state.runner.heap.filter(c => /fracter/i.test(keywords(c))).length,
  },
};

// Sang Kancil (Decoder): Interface -> 1 credit: Break 1 code gate subroutine.
// 3 credits: +2 strength. If a run event is active, this ability costs 2 credits less.
const sangKancil: CardScript = {
  breaker: {
    breaks: 'code gate',
    breakMax: 1,
    breakCost: () => 1,
    boostCost: state => (state.activeRun?.eventCode ? 1 : 3),
    boostAmount: () => 2,
  },
};

// Principia (Fracter): This program costs 1 credit less to install for each other
// installed icebreaker. Interface -> 1 credit: Break 1 barrier subroutine. 2 credits: +2 strength.
const principia: CardScript = {
  breaker: { breaks: 'barrier', breakMax: 1, breakCost: () => 1, boostCost: 2, boostAmount: () => 2 },
  installCostModifier: (state, card) => -state.runner.rig.programs.filter(p => p.instanceId !== card.instanceId && isIcebreaker(p)).length,
};

// Azimat: 2 recurring credits. You can spend hosted credits to pay trash costs.
const azimat: CardScript = {
  recurringCredits: 2,
  paysFor: (_state, _self, purpose) => purpose.kind === 'trash',
};

// Chromatophores (Trojan): Install only on a piece of ice. Host ice gains barrier, code gate, and sentry.
const chromatophores: CardScript = {
  installsOnIce: true,
  grantsIceSubtypes: ['barrier', 'code gate', 'sentry'],
};

// Devadatta Drone: When you install this program, place 2 power counters on it.
// Whenever you breach R&D, you may remove 1 hosted power counter to access 1 additional card.
const devadatta: CardScript = {
  triggers: {
    installed: (ctx, e) => isSelf(ctx, e.card) && addCounters(ctx.card, 'power', 2),
    breach_server: (ctx, e) => {
      if (e.server !== 'rd' || counters(ctx.card, 'power') === 0) return;
      askChoice(ctx, 'runner', 'Devadatta Drone: remove 1 power counter to access 1 additional card?', [
        { id: 'use', label: 'Access 1 additional card' },
        { id: 'no', label: 'No' },
      ], 'breach');
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId !== 'use' || !state.activeRun) return;
    removeCounters(card, 'power', 1);
    state.activeRun.extraAccesses += 1;
    addLog(state, 'runner', 'Runner will access 1 additional card (Devadatta Drone).');
  },
};

// --- Resources ------------------------------------------------------------------------

// Cacophony: The first time each turn you steal or trash a Corp card, place 1 power
// counter on this resource. When your action phase ends, you may remove 2 hosted
// power counters to sabotage 3.
const cacophonyCounter = (ctx: EffectContext) => {
  if (!useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
  addCounters(ctx.card, 'power', 1);
  addLog(ctx.state, 'runner', `Cacophony gained a power counter (now ${counters(ctx.card, 'power')}).`);
};
const cacophony: CardScript = {
  triggers: {
    agenda_stolen: cacophonyCounter,
    runner_trashed_corp_card: cacophonyCounter,
    action_phase_ends: (ctx, e) => {
      if (e.side !== 'runner' || counters(ctx.card, 'power') < 2) return;
      askChoice(ctx, 'runner', 'Cacophony: remove 2 power counters to sabotage 3?', [
        { id: 'sabotage', label: 'Sabotage 3' },
        { id: 'no', label: 'No' },
      ], 'use');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'use' && answer.kind === 'effect_choice' && answer.optionId === 'sabotage') {
      removeCounters(ctx.card, 'power', 2);
      sabotage(ctx, 3, 'sabotage');
    } else if (source.step === 'sabotage' && answer.kind === 'effect_cards') {
      resolveSabotage(ctx.state, Number(source.data?.x ?? 3), answer.cardInstanceIds);
    }
  },
};

// Rent Rioters: click click click, trash: Gain 9 credits.
const rentRioters: CardScript = {
  abilities: [
    {
      label: 'Gain 9 credits.',
      clicks: 3,
      trashSelf: true,
      resolve: ({ state }) => {
        gainCredits(state, 'runner', 9);
        addLog(state, 'runner', 'Runner gained 9 [credit] (Rent Rioters).');
      },
    },
  ],
};

// Fransofia Ward: The rez cost of each piece of ice is increased by 1 credit. Whenever
// you encounter a piece of ice, if the Corp has 15 credits or more, you may trash this
// resource to bypass that ice.
const fransofiaWard: CardScript = {
  modifiers: { rezCost: (_state, _self, rezzing) => (cardDef(rezzing).type_code === 'ice' ? 1 : 0) },
  triggers: {
    encounter_ice: (ctx, e) => {
      if (ctx.state.corp.credits < 15) return;
      askChoice(ctx, 'runner', `Fransofia Ward: trash it to bypass ${cardDef(e.ice).title}?`, [
        { id: 'bypass', label: 'Trash Fransofia Ward and bypass' },
        { id: 'no', label: 'No' },
      ], 'bypass', { iceId: e.ice.instanceId });
    },
  },
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId !== 'bypass') return;
    if (encounteredIce(state)?.instanceId !== source.data?.iceId || !state.runner.rig.resources.includes(card)) return;
    trashInstalledRunnerCard(state, card);
    bypassIce(state);
  },
};

// Open Market: When you install this resource, load 6 credits onto it. When it is
// empty, trash it. You can spend hosted credits to install connection and job
// resources. When your turn begins, take 1 credit from this resource.
const openMarket: CardScript = {
  trashWhenEmpty: true,
  paysFor: (_state, _self, purpose) =>
    purpose.kind === 'install' && cardDef(purpose.card).type_code === 'resource' && /\b(connection|job)\b/i.test(keywords(purpose.card)),
  triggers: {
    installed: (ctx, e) => isSelf(ctx, e.card) && loadCredits(ctx.state, ctx.card, 6),
    turn_begins: ({ state, card }, e) => e.side === 'runner' && counters(card, 'credit') > 0 && takeHostedCredits(state, card, 1),
  },
};

// "Knickknack" O'Brian: The first time each turn a run begins, you may trash 1 of
// your other installed cards. If you do, gain credits equal to its printed install
// cost and draw 1 card.
const knickknack: CardScript = {
  triggers: {
    run_begins: ctx => {
      if (!useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
      const others = installedRunnerCards(ctx.state).filter(c => c.instanceId !== ctx.card.instanceId);
      if (others.length === 0) return;
      askCards(ctx, 'runner', '"Knickknack" O\'Brian: you may trash 1 of your other installed cards to gain its install cost and draw 1.', others.map(c => c.instanceId), 0, 1, 'trash');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards' || answer.cardInstanceIds.length === 0) return;
    const target = installedRunnerCards(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
    if (!target) return;
    const gain = cardDef(target).cost ?? 0;
    trashInstalledRunnerCard(state, target);
    gainCredits(state, 'runner', gain);
    addLog(state, 'runner', `Runner trashed ${cardDef(target).title} and gained ${gain} [credit] ("Knickknack" O'Brian).`);
    drawForEffect(state, 'runner', 1, '"Knickknack" O\'Brian');
  },
};

// Side Hustle: When you install this resource and whenever a run begins, place 1
// credit on this resource. When there are 6 or more hosted credits, take all credits
// from this resource, trash it, and draw 1 card.
const sideHustlePlace = ({ state, card }: EffectContext) => {
  addCounters(card, 'credit', 1);
  if (counters(card, 'credit') < 6) return;
  const credits = counters(card, 'credit');
  removeCounters(card, 'credit', credits);
  gainCredits(state, 'runner', credits);
  trashInstalledRunnerCard(state, card);
  addLog(state, 'runner', `Runner took ${credits} [credit] from Side Hustle and trashed it.`);
  drawForEffect(state, 'runner', 1, 'Side Hustle');
};
const sideHustle: CardScript = {
  triggers: {
    installed: (ctx, e) => isSelf(ctx, e.card) && sideHustlePlace(ctx),
    run_begins: ctx => sideHustlePlace(ctx),
  },
};

export const elevationRunnerScripts: Record<string, CardScript> = {
  '35001': ryo,
  '35002': topan,
  '35003': charmOffensive,
  '35004': scrounge,
  '35005': shred,
  '35006': bling,
  '35007': gourmand,
  '35008': hantu,
  '35009': risingTide,
  '35010': cacophony,
  '35011': rentRioters,
  '35012': baz,
  '35013': muslihat,
  '35014': cleanGetaway,
  '35015': lieLow,
  '35016': maintenanceAccess,
  '35017': transferOfWealth,
  '35018': detente,
  '35019': maglectric,
  '35020': sangKancil,
  '35021': fransofiaWard,
  '35022': openMarket,
  '35023': dewi,
  '35024': magdalene,
  '35025': illumination,
  '35026': ritual,
  '35027': gamedragon,
  '35028': madani,
  '35029': azimat,
  '35030': chromatophores,
  '35031': devadatta,
  '35032': principia,
  '35033': knickknack,
  '35034': sideHustle,
};
