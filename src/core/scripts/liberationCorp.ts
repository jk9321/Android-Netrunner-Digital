import { CardInstance } from '../types/card';
import { EncounterState, GameState } from '../types/state';
import { cardDef } from '../cards';
import { nextInt, shuffleInPlace } from '../rng';
import { noteRdPrivate, runnerSeesRd, shuffleRD } from '../engine/rdKnowledge';
import { addLog } from '../engine/log';
import { beforeCorpCardUninstalled, checkAgendaVictory, findInstalledCorpCard, removeCard, revealInHand, turnKey } from '../engine/helpers';
import { completeRez, rezForFree } from '../engine/actions/corp';
import { corpInstallCost, installCorpCardFrom } from '../engine/actions/install';
import { playBlocker, playCardFrom } from '../engine/actions/play';
import { dealCoreDamage, dealMeatDamage, dealNetDamage, giveTags, installedRunnerCards, trashInstalledRunnerCard, uninstallRunnerCard } from '../engine/damage';
import { endTheRun } from '../engine/runEnd';
import { beginEncounter, grantedBefore, grantRunSubroutines, iceSubtypes, isIcebreaker } from '../engine/ice';
import {
  addCounters,
  agendaPoints,
  availableCredits,
  corpTrashFromHQ,
  counters,
  derez,
  drawForEffect,
  gainFromCard,
  installedIce,
  loseCredits,
  moveUpgrade,
  removeCounters,
  removeTags,
  rezCost,
  runFlag,
  RunFlag,
  spendCredits,
  takeBadPublicity,
  takeHostedCredits,
  threatLevel,
  turnFlag,
  TurnFlag,
  upgradeAllowedIn,
  useOncePerTurn,
} from '../engine/cardEffects';
import { CardScript, EffectAnswer, EffectContext, Subroutine } from './types';
import {
  advanceableInstalled,
  answerPsiGame,
  arrangeNext,
  arrangeTop,
  askCards,
  askChoice,
  askEvenIfNone,
  askCorpInstall,
  corpInstallOptions,
  corpZoneOf,
  installCorpChoice,
  playPsiGame,
  takeFromRD,
} from './effects';

/** Corp cards from Liberation: The Automata Initiative (34031-34065) and Rebellion Without Rehearsal (34096-34130). */

const isSelf = (ctx: EffectContext, card: CardInstance) => card.instanceId === ctx.card.instanceId;
const type = (card: CardInstance) => cardDef(card).type_code;
const keywords = (card: CardInstance) => cardDef(card).keywords ?? '';
const hasKeyword = (card: CardInstance, word: string) => new RegExp(`\\b${word}\\b`, 'i').test(keywords(card));
const title = (card: CardInstance) => cardDef(card).title;
const ids = (cards: CardInstance[]) => cards.map(c => c.instanceId);
const onceKey = (card: CardInstance, n = 0) => `once:${card.instanceId}:${n}`;
const archivesCards = (state: GameState) => [...state.corp.archives.faceUp, ...state.corp.archives.faceDown];
const serverOf = (state: GameState, card: CardInstance) => findInstalledCorpCard(state, card.instanceId)?.server;
const installedCorpCards = (state: GameState) => Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]);
const yesNo = (yes: string, no = 'No') => [
  { id: 'yes', label: yes },
  { id: 'no', label: no },
];
const said = (answer: EffectAnswer, id = 'yes') => answer.kind === 'effect_choice' && answer.optionId === id;
const picked = (answer: EffectAnswer) => (answer.kind === 'effect_cards' ? answer.cardInstanceIds : []);
/** A run is in progress against this card's server. */
const runOnServerOf = (state: GameState, card: CardInstance) => {
  const run = state.activeRun;
  return !!run && !run.accessOnly && serverOf(state, card)?.id === run.server;
};
const isUnprotected = (state: GameState, card: CardInstance) => (serverOf(state, card)?.ice.length ?? 0) === 0;

const endTheRunSub: Subroutine = { label: 'End the run.', resolve: ({ state }) => endTheRun(state) };
const netDamageSub = (n: number): Subroutine => ({ label: `Do ${n} net damage.`, resolve: ({ state }) => void dealNetDamage(state, n) });
const tagSub = (n: number): Subroutine => ({ label: `Give the Runner ${n} tag${n > 1 ? 's' : ''}.`, resolve: ({ state }) => giveTags(state, n) });
const loseCreditsSub = (n: number): Subroutine => ({
  label: `The Runner loses ${n} [credit].`,
  resolve: ({ state, card }) => {
    const lost = loseCredits(state, 'runner', n);
    addLog(state, 'corp', `The Runner lost ${lost} [credit] (${title(card)}).`);
  },
});
const loseClickSub: Subroutine = {
  label: 'The Runner loses [click].',
  resolve: ({ state }) => {
    if (state.runner.clicks > 0) state.runner.clicks -= 1;
  },
};
const gainSub = (n: number, label = `Gain ${n} [credit].`): Subroutine => ({
  label,
  resolve: ({ state, card }) => {
    gainFromCard(state, 'corp', n, card);
    addLog(state, 'corp', `Corp gained ${n} [credit] (${title(card)}).`);
  },
});

/** "When you score this agenda": the handler runs only for this agenda. */
const onScore = (fn: (ctx: EffectContext) => void) => (ctx: EffectContext, e: { card: CardInstance }) => isSelf(ctx, e.card) && fn(ctx);

/** Cards from these that could be installed now (with these options). */
const installable = (state: GameState, cards: CardInstance[], opts: Parameters<typeof corpInstallOptions>[2] = {}) =>
  cards.filter(c => type(c) !== 'operation' && corpInstallOptions(state, c, opts).length > 0);

/** Removes a card from whichever of R&D, HQ or Archives holds it. */
function takeFromCorpZone(state: GameState, card: CardInstance): void {
  const { rd, hq, archives } = state.corp;
  removeCard(rd, card) || removeCard(hq, card) || removeCard(archives.faceUp, card) || removeCard(archives.faceDown, card);
}

/** Adds a card from Archives to HQ, revealing it if it was faceup. */
function archivesToHQ(state: GameState, id: string, source: string): void {
  const card = archivesCards(state).find(c => c.instanceId === id);
  if (!card) return;
  const faceUp = state.corp.archives.faceUp.includes(card);
  takeFromCorpZone(state, card);
  state.corp.hq.push(card);
  if (faceUp) revealInHand(state, 'corp', [card]);
  addLog(state, 'corp', `Corp added ${faceUp ? title(card) : 'a facedown card'} from Archives to HQ (${source}).`);
}

/**
 * An installed Corp card goes back to HQ (Tatu-Bola, Descent, Hermes): it
 * leaves play, so programs hosted on it are trashed and its counters go.
 */
export function returnInstalledToHQ(state: GameState, card: CardInstance): boolean {
  const found = findInstalledCorpCard(state, card.instanceId);
  if (!found) return false;
  beforeCorpCardUninstalled(state, card);
  removeCard(found.server.root, card) || removeCard(found.server.ice, card);
  for (const hostedId of card.hostedCardIds) {
    const hosted = state.runner.rig.programs.find(c => c.instanceId === hostedId);
    if (hosted) trashInstalledRunnerCard(state, hosted);
  }
  card.hostedCardIds = [];
  card.tokens = {};
  card.isRezzed = false;
  card.advancementCounters = 0;
  delete card.faceUp;
  delete card.chosenSubtypes;
  delete card.runnerKnows;
  state.corp.hq.push(card);
  return true;
}

/** A subroutine "X unless the Runner pays N credits" (they choose if they can pay). */
function unlessPays(ctx: EffectContext, amount: number, what: string, step: string, otherwise: () => void, canPay = true): void {
  if (!canPay || availableCredits(ctx.state, 'runner') < amount) {
    otherwise();
    return;
  }
  askChoice(ctx, 'runner', `${title(ctx.card)}: pay ${amount} [credit], or ${what}?`, [
    { id: 'pay', label: `Pay ${amount} [credit]` },
    { id: 'no', label: what[0].toUpperCase() + what.slice(1) },
  ], step);
}

/** Asks where to install a card, among the given server options (ids from corpInstallOptions). */
function askInstallAmong(ctx: EffectContext, cardId: string, step: string, options: { id: string; label: string }[], data: Record<string, string | number | boolean> = {}): boolean {
  if (options.length === 0) return false;
  const card = [...ctx.state.corp.hq, ...ctx.state.corp.rd, ...archivesCards(ctx.state)].find(c => c.instanceId === cardId);
  askChoice(ctx, 'corp', `Install ${card ? title(card) : 'the card'} where?`, options, step, { ...data, cardId, install: true });
  return true;
}

/** Nuvem SA: "The first time you trash a card from R&D during each of your turns, gain 2 credits." */
export function corpTrashedFromRD(state: GameState): void {
  if (state.corp.identity.cardCode !== NUVEM || state.activePlayer !== 'corp') return;
  if (!useOncePerTurn(state, `nuvem:${state.corp.identity.instanceId}`)) return;
  gainFromCard(state, 'corp', 2, state.corp.identity);
  addLog(state, 'corp', 'Corp gained 2 [credit] (Nuvem SA: Law of the Land).');
}
const NUVEM = '34121';

/** The Corp trashes the top card of R&D (Nuvem SA, The Basalt Spire). */
function trashTopOfRD(state: GameState, source: string): CardInstance | undefined {
  const top = state.corp.rd.shift();
  if (!top) return undefined;
  state.corp.archives.faceDown.push(top);
  addLog(state, 'corp', `Corp trashed the top card of R&D (${source}).`);
  corpTrashedFromRD(state);
  return top;
}

/**
 * "As an additional cost to rez this ice, take 1 bad publicity or remove 1
 * tag" (liability ice: Valentão, Piranhas).
 */
const liabilityRez: Pick<CardScript, 'payRez'> & { answer: (ctx: EffectContext, answer: EffectAnswer, cost: number) => void } = {
  payRez: (ctx, cost) => {
    const options = [{ id: 'bp', label: 'Take 1 bad publicity' }, ...(ctx.state.runner.tags > 0 ? [{ id: 'tag', label: 'Remove 1 tag' }] : [])];
    askChoice(ctx, 'corp', `${title(ctx.card)}: take 1 bad publicity or remove 1 tag to rez it.`, options, 'rez_cost', { cost });
  },
  answer: (ctx, answer, cost) => {
    const { state, card } = ctx;
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'tag' && state.runner.tags > 0) removeTags(state, 1);
    else takeBadPublicity(state, 1);
    spendCredits(state, 'corp', cost, { kind: 'rez', card });
    addLog(state, 'corp', `Corp spent ${cost} [credit] to rez ${title(card)}.`, undefined, 'rez');
    completeRez(state, card);
  },
};

/** "Play only if the Runner stole or trashed a Corp card during their last turn." */
const stoleOrTrashedLastTurn = (state: GameState) =>
  state.runnerLastTurnStoleOrTrashed ? null : 'The Runner did not steal or trash a Corp card during their last turn';

/** Asks which installed card gets `n` advancement counters (only cards that can be advanced, if `advanceable`). */
function askPlaceAdvancement(ctx: EffectContext, n: number, step: string, advanceable = true, among?: CardInstance[]): boolean {
  const cards = among ?? (advanceable ? advanceableInstalled(ctx.state) : installedCorpCards(ctx.state));
  if (cards.length === 0) return false;
  askCards(ctx, 'corp', `${title(ctx.card)}: place ${n} advancement counter${n > 1 ? 's' : ''} on 1 installed card.`, ids(cards), 1, 1, step, { n });
  return true;
}
function placeAdvancement(state: GameState, id: string, n: number, source: string): void {
  const found = findInstalledCorpCard(state, id);
  if (!found) return;
  found.card.advancementCounters += n;
  addLog(state, 'corp', `Corp placed ${n} advancement counter(s) on a card in ${found.server.name} (${source}).`);
}

/** Card types among faceup cards in Archives (Armed Asset Protection, Logjam). */
const faceUpTypes = (state: GameState, except?: CardInstance) =>
  new Set(state.corp.archives.faceUp.filter(c => c.instanceId !== except?.instanceId).map(c => type(c)));

/** "When your turn ends, you may move this upgrade to the root of another server." */
function askMoveUpgrade(ctx: EffectContext, step = 'move'): void {
  const from = serverOf(ctx.state, ctx.card);
  if (!from) return;
  const targets = Object.values(ctx.state.corp.servers).filter(s => s.id !== from.id && upgradeAllowedIn(ctx.state, ctx.card, s.id));
  if (targets.length === 0) return;
  askChoice(ctx, 'corp', `${title(ctx.card)}: move it to the root of another server?`, [...targets.map(s => ({ id: s.id, label: s.name })), { id: 'no', label: 'Stay' }], step);
}
const corpTurnEnds = (e: { side: string }) => e.side === 'corp';

// --- The Automata Initiative ------------------------------------------------------

// Salvo Testing: Whenever you score an agenda (including this one), you may do 1 core damage.
const salvoTesting: CardScript = {
  triggers: {
    agenda_scored: ctx => askChoice(ctx, 'corp', 'Salvo Testing: do 1 core damage?', yesNo('Do 1 core damage'), 'damage'),
  },
  onPromptAnswer: ({ state }, source, answer) => {
    if (source.step === 'damage' && said(answer)) dealCoreDamage(state, 1);
  },
};

// Stegodon MK IV: Each run, as long as a piece of ice has been derezzed during that run, each
// installed icebreaker gets -2 strength. Once per turn -> When a run begins, you may derez 1
// piece of ice not protecting the attacked server to gain 1 credit.
const stegodon: CardScript = {
  modifiers: {
    breakerStrength: (state, _self, breaker) => (runFlag(state, RunFlag.iceDerezzed) > 0 && isIcebreaker(breaker) ? -2 : 0),
  },
  triggers: {
    run_begins: (ctx, e) => {
      const { state } = ctx;
      if (turnFlag(state, onceKey(ctx.card)) > 0) return;
      const ice = Object.values(state.corp.servers).filter(s => s.id !== e.server).flatMap(s => s.ice).filter(c => c.isRezzed);
      if (ice.length === 0) return;
      askCards(ctx, 'corp', 'Stegodon MK IV: you may derez 1 piece of ice not protecting the attacked server to gain 1 [credit].', ids(ice), 0, 1, 'derez');
    },
  },
  onPromptAnswer: (ctx, _source, answer) => {
    const { state } = ctx;
    const ice = installedIce(state).find(c => c.instanceId === picked(answer)[0]);
    if (!ice) return;
    useOncePerTurn(state, onceKey(ctx.card));
    derez(state, ice);
    gainFromCard(state, 'corp', 1, ctx.card);
    addLog(state, 'corp', `Corp derezzed ${title(ice)} and gained 1 [credit] (Stegodon MK IV).`);
  },
};

// Wage Workers: Whenever you finish taking an action, if you have taken that action exactly 3
// times this turn, gain [click].
const wageWorkers: CardScript = {
  triggers: {
    action_finished: ({ state }, e) => {
      if (e.side !== 'corp' || e.count !== 3 || state.activePlayer !== 'corp') return;
      state.corp.clicks += 1;
      addLog(state, 'corp', 'Corp gained [click] (Wage Workers).');
    },
  },
};

// Ablative Barrier: Threat 3 -> When you rez this ice during a run against this server, you may
// install 1 non-agenda card from HQ or Archives in the root of or protecting another server.
// Subroutine: End the run.
const ablativeBarrier: CardScript = {
  ice: {
    subroutines: [endTheRunSub],
    onRezDuringRunOnServer: ctx => {
      const { state } = ctx;
      if (threatLevel(state) < 3) return;
      const cards = installable(state, [...state.corp.hq, ...archivesCards(state)].filter(c => type(c) !== 'agenda'));
      // Asked even with nothing to install when the Corp's stops are on ALL (4.3.2, 4.4.6c, see askEvenIfNone)
      askEvenIfNone(
        ctx,
        'corp',
        cards.length > 0,
        () => askCards(ctx, 'corp', 'Ablative Barrier: you may install 1 non-agenda card from HQ or Archives in or protecting another server.', ids(cards), 0, 1, 'pick'),
        'Ablative Barrier: no non-agenda card in HQ or Archives you can install.',
      );
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'pick') {
      const id = picked(answer)[0];
      const card = id && [...state.corp.hq, ...archivesCards(state)].find(c => c.instanceId === id);
      if (!card) return;
      const here = serverOf(state, ctx.card)?.id;
      askInstallAmong(ctx, id, 'server', corpInstallOptions(state, card).filter(o => o.id !== here));
    } else if (source.step === 'server') {
      installCorpChoice(state, source, answer);
    }
  },
};

// Jaguarundi (Sentry - AP): Threat 4 -> When the Runner encounters this ice, give them 1 tag
// unless they spend [click]. Subroutines: Give the Runner 1 tag. If the Runner is tagged, do 1 core damage.
const jaguarundi: CardScript = {
  ice: {
    onEncounter: ctx => {
      const { state } = ctx;
      if (threatLevel(state) < 4) return;
      if (state.runner.clicks === 0) return giveTags(state, 1);
      askChoice(ctx, 'runner', 'Jaguarundi: spend [click], or take 1 tag?', [
        { id: 'click', label: 'Spend [click]' },
        { id: 'tag', label: 'Take 1 tag' },
      ], 'encounter');
    },
    subroutines: [
      tagSub(1),
      {
        label: 'If the Runner is tagged, do 1 core damage.',
        resolve: ({ state }) => {
          if (state.runner.tags > 0) dealCoreDamage(state, 1);
        },
      },
    ],
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (said(answer, 'click') && state.runner.clicks > 0) {
      state.runner.clicks -= 1;
      addLog(state, 'runner', 'Runner spent [click] (Jaguarundi).');
    } else giveTags(state, 1);
  },
};

// M.I.C. (Code Gate): [trash]: End the run unless the Runner spends [click]. Use this ability
// only during a run on this server. Subroutines: The Runner loses [click] (twice). End the run.
const mic: CardScript = {
  abilities: [
    {
      label: 'End the run unless the Runner spends [click].',
      trashSelf: true,
      canUse: ({ state, card }) => (runOnServerOf(state, card) ? null : 'Use this only during a run on this server'),
      resolve: ctx => {
        if (ctx.state.runner.clicks === 0) return endTheRun(ctx.state);
        askChoice(ctx, 'runner', 'M.I.C.: spend [click], or the run ends?', [
          { id: 'click', label: 'Spend [click]' },
          { id: 'end', label: 'End the run' },
        ], 'trash');
      },
    },
  ],
  ice: { subroutines: [loseClickSub, loseClickSub, endTheRunSub] },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (said(answer, 'click') && state.runner.clicks > 0) {
      state.runner.clicks -= 1;
      addLog(state, 'runner', 'Runner spent [click] (M.I.C.).');
    } else endTheRun(state);
  },
};

// Greasing the Palm: Gain 5 credits. You may install 1 card from HQ. You may remove 1 tag to
// place 1 advancement counter on that card.
const greasingThePalm: CardScript = {
  onPlay: ctx => {
    const { state } = ctx;
    gainFromCard(state, 'corp', 5, ctx.card);
    addLog(state, 'corp', 'Corp gained 5 [credit] (Greasing the Palm).');
    const cards = installable(state, state.corp.hq);
    if (cards.length > 0) askCards(ctx, 'corp', 'Greasing the Palm: you may install 1 card from HQ.', ids(cards), 0, 1, 'pick');
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'pick') {
      const id = picked(answer)[0];
      if (id) askCorpInstall(ctx, id, 'server');
    } else if (source.step === 'server') {
      const serverId = installCorpChoice(state, source, answer);
      const cardId = source.data?.cardId as string;
      if (!serverId || state.runner.tags === 0 || !findInstalledCorpCard(state, cardId)) return;
      askChoice(ctx, 'corp', 'Greasing the Palm: remove 1 tag to place 1 advancement counter on the installed card?', yesNo('Remove 1 tag'), 'tag', { cardId });
    } else if (source.step === 'tag' && said(answer) && state.runner.tags > 0) {
      removeTags(state, 1);
      placeAdvancement(state, source.data?.cardId as string, 1, 'Greasing the Palm');
    }
  },
};

// Vovô Ozetti (Sysop): The rez cost of each piece of ice protecting this server is lowered by 2.
// Threat 4 -> The rez cost of each card in the root of this server is lowered by 2. When your
// turn ends, you may move this upgrade to the root of another server.
const vovo: CardScript = {
  modifiers: {
    rezCost: (state, self, rezzing) => {
      const server = serverOf(state, self);
      if (!server) return 0;
      if (server.ice.includes(rezzing)) return -2;
      if (server.root.includes(rezzing) && threatLevel(state) >= 4) return -2;
      return 0;
    },
  },
  triggers: { discard_phase_ends: (ctx, e) => corpTurnEnds(e) && askMoveUpgrade(ctx) },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind === 'effect_choice' && answer.optionId !== 'no') moveUpgrade(state, card, answer.optionId);
  },
};

// A Teia: IP Recovery: Limit 2 remote servers. The first time each turn you install a card in the
// root of or protecting a remote server, you may install 1 card from HQ in the root of or
// protecting another remote server, ignoring all costs. You cannot score the second card this turn.
const aTeia: CardScript = {
  maxRemotes: 2,
  triggers: {
    installed: (ctx, e) => {
      const { state } = ctx;
      if (cardDef(e.card).side_code !== 'corp' || state.activePlayer !== 'corp') return;
      const server = serverOf(state, e.card);
      if (!server?.isRemote || !useOncePerTurn(state, onceKey(ctx.card))) return;
      const cards = state.corp.hq.filter(c => type(c) !== 'operation' && aTeiaOptions(state, c, server.id).length > 0);
      // Asked even with nothing to install when the Corp's stops are on ALL (4.3.2, see askEvenIfNone)
      askEvenIfNone(
        ctx,
        'corp',
        cards.length > 0,
        () => askCards(ctx, 'corp', 'A Teia: you may install 1 card from HQ in or protecting another remote server, ignoring all costs.', ids(cards), 0, 1, 'pick', { from: server.id }),
        'A Teia: no card in HQ you can install in another remote server.',
      );
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'pick') {
      const id = picked(answer)[0];
      const card = id && state.corp.hq.find(c => c.instanceId === id);
      if (card) askInstallAmong(ctx, id, 'server', aTeiaOptions(state, card, source.data?.from as string));
    } else if (source.step === 'server') {
      const serverId = installCorpChoice(state, source, answer, { ignoreCosts: true });
      const card = serverId && findInstalledCorpCard(state, source.data?.cardId as string)?.card;
      if (card) card.cannotScoreTurn = turnKey(state);
    }
  },
};
/** Another remote server (an existing one or, within the limit, a new one). */
const aTeiaOptions = (state: GameState, card: CardInstance, from: string) =>
  corpInstallOptions(state, card, { ignoreCosts: true }).filter(o => o.id !== from && (o.id === 'new' || state.corp.servers[o.id]?.isRemote));

// Fujii Asset Retrieval: When this agenda is scored or stolen, do 2 net damage.
const fujii: CardScript = {
  triggers: {
    agenda_scored: onScore(({ state }) => void dealNetDamage(state, 2)),
    agenda_stolen: (ctx, e) => isSelf(ctx, e.card) && void dealNetDamage(ctx.state, 2),
  },
};

// Front Company: Rez only during your turn. The first run each turn cannot be made against a
// remote server. The first time each turn a run on Archives begins, if this server is not
// protected by ice, do 2 net damage.
const frontCompany: CardScript = {
  rezBlocker: (state, card, cost) => {
    if (state.activePlayer !== 'corp') return 'Rez only during your turn';
    return availableCredits(state, 'corp', { kind: 'rez', card }) < cost ? 'Not enough credits to rez' : null;
  },
  modifiers: {
    runBlocker: (state, _self, serverId) =>
      state.runsThisTurn.length === 0 && state.corp.servers[serverId]?.isRemote ? 'The first run each turn cannot be made against a remote server (Front Company)' : null,
  },
  triggers: {
    run_begins: (ctx, e) => {
      if (e.server !== 'archives' || !useOncePerTurn(ctx.state, `front-archives:${ctx.card.instanceId}`)) return;
      if (isUnprotected(ctx.state, ctx.card)) dealNetDamage(ctx.state, 2);
    },
  },
};

// Attini (Code Gate - AP): Threat 3 -> The Runner cannot spend credits while subroutines on this
// ice are resolving. Subroutines (3): Do 1 net damage unless the Runner pays 2 credits.
const attiniSub: Subroutine = {
  label: 'Do 1 net damage unless the Runner pays 2 [credit].',
  resolve: ctx => unlessPays(ctx, 2, 'take 1 net damage', 'pay', () => void dealNetDamage(ctx.state, 1), threatLevel(ctx.state) < 3),
};
const attini: CardScript = {
  ice: { subroutines: [attiniSub, attiniSub, attiniSub] },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (said(answer, 'pay') && availableCredits(state, 'runner') >= 2) spendCredits(state, 'runner', 2);
    else dealNetDamage(state, 1);
  },
};

// Phoneutria (Sentry - AP - Observer): When the Runner passes this ice, if there are 4 or more
// cards in the grip, give them 1 tag. Subroutines: Do 1 net damage (twice).
const phoneutria: CardScript = {
  ice: {
    onPass: ({ state }) => {
      if (state.runner.grip.length >= 4) giveTags(state, 1);
    },
    subroutines: [netDamageSub(1), netDamageSub(1)],
  },
};

// Tatu-Bola (Barrier): When the Runner passes this ice, you may swap it with a piece of ice from
// HQ. If you do, gain 4 credits. (The new ice is installed unrezzed; no install cost.)
// Subroutine: End the run.
const tatuBola: CardScript = {
  ice: {
    onPass: ctx => {
      const ice = ctx.state.corp.hq.filter(c => type(c) === 'ice');
      // Asked even with no ice in HQ when the Corp's stops are on ALL (4.3.2, see askEvenIfNone)
      askEvenIfNone(ctx, 'corp', ice.length > 0, () => askCards(ctx, 'corp', 'Tatu-Bola: you may swap it with a piece of ice from HQ and gain 4 [credit].', ids(ice), 0, 1, 'swap'), 'Tatu-Bola: no ice in HQ to swap in.');
    },
    subroutines: [endTheRunSub],
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    const incoming = state.corp.hq.find(c => c.instanceId === picked(answer)[0]);
    const found = findInstalledCorpCard(state, card.instanceId);
    if (!incoming || !found) return;
    const index = found.server.ice.indexOf(card);
    removeCard(state.corp.hq, incoming);
    returnInstalledToHQ(state, card);
    incoming.isRezzed = false;
    incoming.advancementCounters = 0;
    incoming.tokens = {};
    incoming.installedTurn = turnKey(state);
    found.server.ice.splice(index, 0, incoming);
    gainFromCard(state, 'corp', 4, card);
    addLog(state, 'corp', `Corp swapped Tatu-Bola with a piece of ice from HQ and gained 4 [credit].`, undefined, 'install');
  },
};

// Mindscaping: Resolve 1 of the following: Gain 4 credits and draw 2 cards. Add 1 card from HQ
// to the top of R&D. / Do X net damage. X is equal to the number of tags the Runner has, up to 3.
const mindscaping: CardScript = {
  onPlay: ctx =>
    askChoice(ctx, 'corp', 'Mindscaping: choose one.', [
      { id: 'gain', label: 'Gain 4 [credit], draw 2, put 1 card from HQ on top of R&D' },
      { id: 'damage', label: `Do ${Math.min(3, ctx.state.runner.tags)} net damage` },
    ], 'mode'),
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'mode' && said(answer, 'gain')) {
      gainFromCard(state, 'corp', 4, ctx.card);
      drawForEffect(state, 'corp', 2, 'Mindscaping');
      addLog(state, 'corp', 'Corp gained 4 [credit] (Mindscaping).');
      if (state.corp.hq.length > 0) askCards(ctx, 'corp', 'Mindscaping: add 1 card from HQ to the top of R&D.', ids(state.corp.hq), 1, 1, 'top');
    } else if (source.step === 'mode') {
      dealNetDamage(state, Math.min(3, state.runner.tags));
    } else if (source.step === 'top') {
      const card = state.corp.hq.find(c => c.instanceId === picked(answer)[0]);
      if (!card) return;
      removeCard(state.corp.hq, card);
      state.corp.rd.unshift(card);
      addLog(state, 'corp', 'Corp added 1 card from HQ to the top of R&D (Mindscaping).');
    }
  },
};

// Adrian Seis (Psi - Clone - Sysop): Whenever the Runner makes a successful run on this server,
// play a Psi Game. If the bids differ, the Runner cannot access cards other than this upgrade
// for the remainder of that run. If the bids match, the Runner cannot access this upgrade for the
// remainder of that run. When your turn ends, you may move this upgrade to the root of another server.
const adrianSeis: CardScript = {
  triggers: {
    successful_run: (ctx, e) => {
      if (serverOf(ctx.state, ctx.card)?.id === e.server) playPsiGame(ctx, 'psi');
    },
    discard_phase_ends: (ctx, e) => corpTurnEnds(e) && askMoveUpgrade(ctx),
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    if (
      answerPsiGame(ctx, source, answer, match => {
        const run = state.activeRun;
        if (!run) return;
        if (match) {
          run.noAccessIds = [...(run.noAccessIds ?? []), card.instanceId];
          addLog(state, 'corp', 'Adrian Seis: the Runner cannot access it this run.');
        } else {
          run.accessOnlyIds = [card.instanceId];
          addLog(state, 'corp', 'Adrian Seis: the Runner cannot access cards other than Adrian Seis this run.');
        }
      })
    )
      return;
    if (source.step === 'move' && answer.kind === 'effect_choice' && answer.optionId !== 'no') moveUpgrade(state, card, answer.optionId);
  },
};

// Daniela Jorge Inácio (Sysop): As an additional cost to trash this upgrade, the Runner must add 2
// cards from the grip at random to the bottom of the stack. Persistent -> As an additional cost to
// steal an agenda from this server or its root, the Runner must add 2 cards from the grip at random
// to the bottom of the stack.
const daniela: CardScript = {
  trashGripCost: 2,
  persistent: true,
  stealCost: (state, self) => {
    const run = state.activeRun;
    if (!run || run.accessOnly) return null;
    const where = serverOf(state, self)?.id ?? run.persistentServers[self.instanceId];
    return where === run.server ? { gripToBottom: 2 } : null;
  },
};

// Epiphany Analytica: Nations Undivided: The first time each turn the Runner steals or trashes a
// Corp card, place 1 power counter on this identity. [click], hosted power counter: Look at the
// top 3 cards of R&D. You may install 1 of those cards.
const epiphanyCounter = (ctx: EffectContext) => {
  if (useOncePerTurn(ctx.state, onceKey(ctx.card))) {
    addCounters(ctx.card, 'power', 1);
    addLog(ctx.state, 'corp', 'Epiphany Analytica gained 1 power counter.');
  }
};
const epiphany: CardScript = {
  triggers: { agenda_stolen: epiphanyCounter, runner_trashed_corp_card: epiphanyCounter },
  abilities: [
    {
      label: 'Look at the top 3 cards of R&D. You may install 1 of them.',
      clicks: 1,
      counters: { type: 'power', count: 1 },
      resolve: ctx => {
        const top = ctx.state.corp.rd.slice(0, 3);
        noteRdPrivate(ctx.state, top.length);
        const cards = installable(ctx.state, top);
        addLog(ctx.state, 'corp', 'Corp looked at the top 3 cards of R&D (Epiphany Analytica).');
        if (cards.length > 0) askCards(ctx, 'corp', 'Epiphany Analytica: you may install 1 of the top 3 cards of R&D.', ids(cards), 0, 1, 'pick');
      },
    },
  ],
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'pick') {
      const id = picked(answer)[0];
      if (id) askCorpInstall(ctx, id, 'server');
    } else if (source.step === 'server') installCorpChoice(ctx.state, source, answer);
  },
};

// Oracle Thinktank: When the Runner steals this agenda, give them 1 tag. [click], remove 1 tag:
// Shuffle this agenda into R&D. The Corp can use this ability only if this agenda is in the
// Runner's score area.
const oracleThinktank: CardScript = {
  triggers: { agenda_stolen: (ctx, e) => isSelf(ctx, e.card) && giveTags(ctx.state, 1) },
  abilities: [
    {
      label: 'Remove 1 tag: shuffle this agenda into R&D.',
      clicks: 1,
      fromRunnerScoreArea: true,
      canUse: ({ state }) => (state.runner.tags > 0 ? null : 'The Runner has no tag to remove'),
      resolve: ({ state, card }) => {
        removeTags(state, 1);
        if (!removeCard(state.runner.scoreArea, card)) return;
        state.runner.score -= agendaPoints(card);
        delete card.asAgendaPoints;
        card.isRezzed = false;
        state.corp.rd.push(card);
        shuffleRD(state);
        addLog(state, 'corp', 'Corp removed 1 tag and shuffled Oracle Thinktank into R&D.');
      },
    },
  ],
};

// Balanced Coverage: When your turn begins, you may choose a card type to look at the top card of
// R&D. If that card has the chosen type, you may reveal it and gain 2 credits.
const CORP_TYPES = ['agenda', 'asset', 'upgrade', 'operation', 'ice'];
const balancedCoverage: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side !== 'corp' || ctx.state.corp.rd.length === 0) return;
      askChoice(ctx, 'corp', 'Balanced Coverage: choose a card type to look at the top card of R&D?', [
        ...CORP_TYPES.map(t => ({ id: t, label: t[0].toUpperCase() + t.slice(1) })),
        { id: 'no', label: 'Do not look' },
      ], 'type');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    const top = state.corp.rd[0];
    if (!top || answer.kind !== 'effect_choice') return;
    if (source.step === 'type' && answer.optionId !== 'no') {
      addLog(state, 'corp', `Corp named ${answer.optionId} and looked at the top card of R&D (Balanced Coverage).`);
      // Asked even on a miss when the Corp's stops are on ALL, so the wait doesn't tell the Runner the type matched (4.2.2)
      askEvenIfNone(
        ctx,
        'corp',
        type(top) === answer.optionId,
        () => askChoice(ctx, 'corp', `Balanced Coverage: the top card is ${title(top)}. Reveal it to gain 2 [credit]?`, yesNo('Reveal and gain 2 [credit]'), 'reveal'),
        `Balanced Coverage: the top card is ${title(top)}, not the type you named.`,
      );
    } else if (source.step === 'reveal' && said(answer)) {
      runnerSeesRd(state, top);
      gainFromCard(state, 'corp', 2, ctx.card);
      addLog(state, 'corp', `Corp revealed ${title(top)} from the top of R&D and gained 2 [credit] (Balanced Coverage).`, top.cardCode);
    }
  },
};

// Behold! (Ambush): While the Runner is accessing this asset in R&D, they must reveal it. When the
// Runner accesses this asset anywhere except in Archives, you may pay 4 credits to give them 2 tags.
const behold: CardScript = {
  revealedOnRdAccess: true,
  onAccessed: (ctx, where) => {
    if (where === 'archives') return;
    if (availableCredits(ctx.state, 'corp') < 4) {
      addLog(ctx.state, 'corp', 'Behold!: the Corp has less than 4 [credit], so it cannot give the Runner 2 tags.');
      return;
    }
    askChoice(ctx, 'corp', 'Behold!: pay 4 [credit] to give the Runner 2 tags?', yesNo('Pay 4 [credit]'), 'tags');
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (!said(answer) || availableCredits(state, 'corp') < 4) return;
    spendCredits(state, 'corp', 4);
    giveTags(state, 2);
  },
};

// Federal Fundraising: When your turn begins, you may look at the top 3 cards of R&D and arrange
// them in any order. Then, if this server is not protected by ice, you may draw 1 card.
const federalFundraising: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side !== 'corp') return;
      if (ctx.state.corp.rd.length > 0) {
        askChoice(ctx, 'corp', 'Federal Fundraising: look at the top 3 cards of R&D and arrange them?', yesNo('Look and arrange'), 'look');
      } else fundraisingDraw(ctx);
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'look') {
      if (said(answer)) {
        addLog(state, 'corp', 'Corp looked at the top 3 cards of R&D (Federal Fundraising).');
        arrangeTop(ctx, ids(state.corp.rd.slice(0, 3)), 'arrange');
      }
      if (!arranging(ctx)) fundraisingDraw(ctx);
    } else if (source.step === 'arrange' && answer.kind === 'effect_cards') {
      arrangeNext(ctx, source.data, answer.cardInstanceIds[0], 'arrange');
      if (!arranging(ctx)) fundraisingDraw(ctx);
    } else if (source.step === 'draw' && said(answer)) {
      drawForEffect(state, 'corp', 1, 'Federal Fundraising');
    }
  },
};
const arranging = (ctx: EffectContext) => ctx.state.pendingPrompts.some(p => 'source' in p && p.source.instanceId === ctx.card.instanceId && p.source.step === 'arrange');
function fundraisingDraw(ctx: EffectContext): void {
  if (isUnprotected(ctx.state, ctx.card) && ctx.state.corp.rd.length > 0) askChoice(ctx, 'corp', 'Federal Fundraising: draw 1 card?', yesNo('Draw 1 card'), 'draw');
}

// Starlit Knight (Sentry - Observer): Threat 4 -> When the Runner encounters this ice, it gains X
// "End the run." subroutines for the remainder of this run, after its other subroutines. X is the
// number of tags the Runner has. Subroutines: Give the Runner 1 tag (twice).
const starlitKnight: CardScript = {
  grantedSubroutines: [endTheRunSub],
  ice: {
    onEncounter: ({ state, card }) => {
      if (threatLevel(state) < 4 || state.runner.tags === 0) return;
      grantRunSubroutines(state, card, card.cardCode, 0, state.runner.tags);
      addLog(state, 'corp', `Starlit Knight gained ${state.runner.tags} "End the run." subroutine(s) for this run.`);
    },
    subroutines: [tagSub(1), tagSub(1)],
  },
};

// Virtual Service Agent (Code Gate - Observer): Whenever the Runner passes this ice after
// encountering it, if they did not break its printed subroutine with a decoder during that
// encounter, give them 1 tag. Subroutine: The Runner loses 1 credit.
const brokeWithDecoder = (state: GameState, ice: CardInstance, encounter: EncounterState, printedIndex: number) => {
  const by = encounter.brokenBy?.[printedIndex];
  const breaker = by && state.runner.rig.programs.find(p => p.instanceId === by);
  return !!encounter.broken[printedIndex] && !!breaker && hasKeyword(breaker, 'decoder') && !!ice;
};
const virtualServiceAgent: CardScript = {
  ice: {
    onPass: ({ state, card }, encounter) => {
      if (!encounter) return;
      const printed = encounter.grantedSubs?.length ?? 0;
      if (!brokeWithDecoder(state, card, encounter, printed)) giveTags(state, 1);
    },
    subroutines: [loseCreditsSub(1)],
  },
};

// Oppo Research (Terminal - Gray Ops): Play only if the Runner stole or trashed a Corp card during
// their last turn. After you resolve this operation, your action phase ends. Give the Runner 2 tags.
// Threat 3 -> You may pay 5 credits to give the Runner 2 tags.
const oppoResearch: CardScript = {
  terminal: true,
  canPlay: ({ state }) => stoleOrTrashedLastTurn(state),
  onPlay: ctx => {
    giveTags(ctx.state, 2);
    if (threatLevel(ctx.state) >= 3 && availableCredits(ctx.state, 'corp') >= 5) {
      askChoice(ctx, 'corp', 'Oppo Research: pay 5 [credit] to give the Runner 2 more tags?', yesNo('Pay 5 [credit]'), 'more');
    }
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (!said(answer) || availableCredits(state, 'corp') < 5) return;
    spendCredits(state, 'corp', 5);
    giveTags(state, 2);
  },
};

// Your Digital Life (Transaction): Gain 1 credit for each card in HQ.
const yourDigitalLife: CardScript = {
  liveValue: state => `${state.corp.hq.length - 1} [credit] (cards in HQ once it is played)`,
  onPlay: ({ state, card }) => {
    const n = state.corp.hq.length;
    gainFromCard(state, 'corp', n, card);
    addLog(state, 'corp', `Corp gained ${n} [credit] (Your Digital Life).`);
  },
};

// Slash and Burn Agriculture (Expansion - Expendable): [click], 1 credit, reveal and trash this
// agenda from HQ: Place 2 advancement counters on 1 installed card that you can advance.
const slashAndBurn: CardScript = {
  abilities: [
    {
      label: 'Reveal and trash this agenda from HQ: place 2 advancement counters on 1 installed card you can advance.',
      fromHQ: true,
      clicks: 1,
      credits: 1,
      canUse: ({ state }) => (advanceableInstalled(state).length > 0 ? null : 'No installed card can be advanced'),
      resolve: ctx => {
        corpTrashFromHQ(ctx.state, [ctx.card.instanceId], true);
        addLog(ctx.state, 'corp', 'Corp revealed and trashed Slash and Burn Agriculture from HQ.');
        askPlaceAdvancement(ctx, 2, 'place');
      },
    },
  ],
  onPromptAnswer: ({ state }, _source, answer) => placeAdvancement(state, picked(answer)[0], 2, 'Slash and Burn Agriculture'),
};

// Cybersand Harvester: Whenever you rez a piece of ice, place 2 credits on this asset. You can
// spend hosted credits to pay install costs. [trash]: Take all credits from this asset.
const cybersandHarvester: CardScript = {
  triggers: {
    rezzed: (ctx, e) => {
      if (type(e.card) !== 'ice') return;
      addCounters(ctx.card, 'credit', 2);
      addLog(ctx.state, 'corp', 'Cybersand Harvester: 2 [credit] placed on it.');
    },
  },
  paysFor: (_state, _self, purpose) => purpose.kind === 'install',
  abilities: [
    {
      label: 'Take all credits from this asset.',
      trashSelf: true,
      resolve: ({ state, card }) => void takeHostedCredits(state, card, counters(card, 'credit')),
    },
  ],
};

// Tree Line (Barrier - Expendable): [click], 1 credit, reveal and trash this ice from HQ: Place 3
// advancement counters on 1 installed piece of ice. You can advance this ice. It gets +1 strength
// for each hosted advancement counter. Subroutine: Gain 1 credit. End the run.
const treeLine: CardScript = {
  abilities: [
    {
      label: 'Reveal and trash this ice from HQ: place 3 advancement counters on 1 installed piece of ice.',
      fromHQ: true,
      clicks: 1,
      credits: 1,
      canUse: ({ state }) => (installedIce(state).length > 0 ? null : 'No installed ice'),
      resolve: ctx => {
        corpTrashFromHQ(ctx.state, [ctx.card.instanceId], true);
        addLog(ctx.state, 'corp', 'Corp revealed and trashed Tree Line from HQ.');
        askPlaceAdvancement(ctx, 3, 'place', false, installedIce(ctx.state));
      },
    },
  ],
  ice: {
    strengthModifier: (_state, ice) => ice.advancementCounters,
    subroutines: [
      {
        label: 'Gain 1 [credit]. End the run.',
        resolve: ({ state, card }) => {
          gainFromCard(state, 'corp', 1, card);
          endTheRun(state);
        },
      },
    ],
  },
  onPromptAnswer: ({ state }, _source, answer) => placeAdvancement(state, picked(answer)[0], 3, 'Tree Line'),
};

// Valentão (Code Gate - Liability): As an additional cost to rez this ice, take 1 bad publicity or
// remove 1 tag. Subroutines: Gain 2 credits. The Runner loses 2 credits. End the run if you have
// more credits than the Runner.
const ifRicherEtr: Subroutine = {
  label: 'End the run if you have more credits than the Runner.',
  resolve: ({ state }) => {
    if (state.corp.credits > state.runner.credits) endTheRun(state);
  },
};
const valentao: CardScript = {
  payRez: liabilityRez.payRez,
  ice: { subroutines: [gainSub(2), loseCreditsSub(2), ifRicherEtr] },
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'rez_cost') liabilityRez.answer(ctx, answer, Number(source.data?.cost ?? 0));
  },
};

// Armed Asset Protection (Transaction): Gain 3 credits. Gain 1 credit for each card type among
// faceup cards in Archives. If any of those cards are agendas, gain another 2 credits.
const aapGain = (state: GameState, self: CardInstance) => {
  const types = faceUpTypes(state, self);
  return 3 + types.size + (types.has('agenda') ? 2 : 0);
};
const armedAssetProtection: CardScript = {
  liveValue: (state, card) => `${aapGain(state, card)} [credit]`,
  onPlay: ({ state, card }) => {
    // While it resolves the operation itself is not yet in Archives (rules 8.6.4)
    const n = aapGain(state, card);
    gainFromCard(state, 'corp', n, card);
    addLog(state, 'corp', `Corp gained ${n} [credit] (Armed Asset Protection).`);
  },
};

// Pivot (Double): As an additional cost to play this operation, spend [click]. Search R&D for 1
// operation or agenda and reveal it. Add that card to HQ. Threat 3 -> You may play or install 1
// card from HQ.
const playableFromHQ = (state: GameState, card: CardInstance) => {
  if (type(card) !== 'operation') return installable(state, [card]).length > 0;
  try {
    return !playBlocker(state, 'corp', card, true);
  } catch {
    return false;
  }
};
const pivot: CardScript = {
  extraClicks: 1,
  onPlay: ctx => {
    const cards = ctx.state.corp.rd.filter(c => type(c) === 'operation' || type(c) === 'agenda');
    askCards(ctx, 'corp', 'Pivot: search R&D for 1 operation or agenda.', ids(cards), Math.min(1, cards.length), 1, 'search');
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'search') {
      const card = picked(answer).length ? takeFromRD(state, picked(answer)[0]) : undefined;
      if (!card) shuffleRD(state);
      else {
        state.corp.hq.push(card);
        revealInHand(state, 'corp', [card]);
      }
      const options = state.corp.hq.filter(c => playableFromHQ(state, c));
      // Asked even with nothing playable when the Corp's stops are on ALL (4.3.2, see askEvenIfNone)
      if (threatLevel(state) >= 3)
        askEvenIfNone(ctx, 'corp', options.length > 0, () => askCards(ctx, 'corp', 'Pivot: you may play or install 1 card from HQ.', ids(options), 0, 1, 'use'), 'Pivot: no card in HQ you can play or install.');
    } else if (source.step === 'use') {
      const card = state.corp.hq.find(c => c.instanceId === picked(answer)[0]);
      if (!card) return;
      if (type(card) === 'operation') playCardFrom(state, 'corp', card, state.corp.hq, { fromHand: true });
      else askCorpInstall(ctx, card.instanceId, 'server');
    } else if (source.step === 'server') installCorpChoice(state, source, answer);
  },
};

// Angelique Garza Correa (Ambush - Enforcer - Expendable): Threat 3 -> [click], 1 credit, reveal
// and trash this upgrade from HQ: Do 1 meat damage. When the Runner accesses this upgrade while it
// is rezzed, you may pay 2 credits to do 2 meat damage.
const angelique: CardScript = {
  abilities: [
    {
      label: 'Reveal and trash this upgrade from HQ: do 1 meat damage.',
      fromHQ: true,
      clicks: 1,
      credits: 1,
      canUse: ({ state }) => (threatLevel(state) >= 3 ? null : 'The threat level must be 3 or greater'),
      resolve: ({ state, card }) => {
        corpTrashFromHQ(state, [card.instanceId], true);
        addLog(state, 'corp', 'Corp revealed and trashed Angelique Garza Correa from HQ.');
        dealMeatDamage(state, 1);
      },
    },
  ],
  onAccessed: (ctx, where) => {
    if (where !== 'installed' || !ctx.card.isRezzed || availableCredits(ctx.state, 'corp') < 2) return;
    askChoice(ctx, 'corp', 'Angelique Garza Correa: pay 2 [credit] to do 2 meat damage?', yesNo('Pay 2 [credit]'), 'damage');
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (!said(answer) || availableCredits(state, 'corp') < 2) return;
    spendCredits(state, 'corp', 2);
    dealMeatDamage(state, 2);
  },
};

// Tucana: Remote server only. Persistent -> Whenever an agenda is scored or stolen from the root
// of this server, you may search R&D for 1 piece of ice. Install and rez that ice, paying a total
// of 3 credits less.
/** Where `ice` could go when installing and rezzing it for a total of `discount` less, and what it costs there. */
function installAndRezOptions(state: GameState, ice: CardInstance, discount: number, ignoreAll = false): { id: string; label: string }[] {
  const credits = state.corp.credits;
  const total = (serverId: string | null) => (ignoreAll ? 0 : Math.max(0, corpInstallCost(state, ice, serverId, false) + rezCost(state, ice) - discount));
  const options: { id: string; label: string }[] = [];
  const kinds = type(ice) === 'ice' ? Object.values(state.corp.servers) : Object.values(state.corp.servers).filter(s => s.isRemote || type(ice) === 'upgrade');
  if (total(null) <= credits) options.push({ id: 'new', label: `New remote server (${total(null)}c)` });
  for (const s of kinds) if (total(s.id) <= credits && corpInstallOptions(state, ice, { ignoreCosts: true }).some(o => o.id === s.id)) options.push({ id: s.id, label: `${s.name} (${total(s.id)}c)` });
  return options;
}
/** Installs the chosen card ignoring costs, pays the combined cost less the discount, and rezzes it. */
function installAndRez(state: GameState, cardId: string, serverOption: string, discount: number, ignoreAll = false): void {
  const card = [...state.corp.hq, ...state.corp.rd, ...archivesCards(state)].find(c => c.instanceId === cardId);
  const zone = card && corpZoneOf(state, cardId);
  if (!card || !zone) return;
  const serverId = serverOption === 'new' ? null : serverOption;
  const total = ignoreAll ? 0 : Math.max(0, corpInstallCost(state, card, serverId, false) + rezCost(state, card) - discount);
  if (state.corp.credits < total) return;
  const before = new Set(Object.keys(state.corp.servers));
  card.advancementCounters = 0;
  card.tokens = {};
  installCorpCardFrom(state, card, zone, serverId, true);
  state.corp.credits -= total;
  const installed = findInstalledCorpCard(state, cardId);
  if (!installed || type(card) === 'agenda') return;
  addLog(state, 'corp', `Corp paid ${total} [credit] to install and rez ${title(card)}.`, undefined, 'rez');
  rezForFree(state, card);
  void before;
}
const tucanaServer = (state: GameState, self: CardInstance) =>
  serverOf(state, self)?.id ?? state.activeRun?.persistentServers[self.instanceId];
const tucanaSearch = (ctx: EffectContext) => {
  const ice = ctx.state.corp.rd.filter(c => type(c) === 'ice');
  askCards(ctx, 'corp', 'Tucana: you may search R&D for 1 piece of ice to install and rez, paying 3 [credit] less in total.', ids(ice), 0, 1, 'search');
};
const tucana: CardScript = {
  installOnly: 'remote',
  persistent: true,
  triggers: {
    agenda_scored: (ctx, e) => e.serverId === tucanaServer(ctx.state, ctx.card) && tucanaSearch(ctx),
    agenda_stolen: (ctx, e) => !!e.serverId && e.serverId === tucanaServer(ctx.state, ctx.card) && tucanaSearch(ctx),
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'search') {
      const ice = picked(answer).length ? takeFromRD(state, picked(answer)[0]) : undefined;
      if (!ice) return shuffleRD(state);
      state.corp.rd.unshift(ice); // set aside where takeFromRD left it: back on top while the server is chosen
      const options = installAndRezOptions(state, ice, 3);
      if (!askInstallAmong(ctx, ice.instanceId, 'server', options)) {
        removeCard(state.corp.rd, ice);
        state.corp.rd.push(ice);
        shuffleRD(state);
      }
    } else if (source.step === 'server' && answer.kind === 'effect_choice') {
      installAndRez(state, source.data?.cardId as string, answer.optionId, 3);
      shuffleRD(state);
    }
  },
};

// B-1001 (Bioroid - Enforcer): Remove 1 tag: End the run. Use this ability only during a run
// against another server.
const b1001: CardScript = {
  abilities: [
    {
      label: 'Remove 1 tag: end the run.',
      canUse: ({ state, card }) => {
        const run = state.activeRun;
        if (!run || run.accessOnly || serverOf(state, card)?.id === run.server) return 'Use this only during a run against another server';
        return state.runner.tags > 0 ? null : 'The Runner has no tag to remove';
      },
      resolve: ({ state }) => {
        removeTags(state, 1);
        endTheRun(state);
      },
    },
  ],
};

// --- Rebellion Without Rehearsal ---------------------------------------------------

// Thunderbolt Armaments: Peace Through Power: Whenever you rez a piece of AP or destroyer ice
// during a run, that ice gets +1 strength and gains "End the run unless the Runner trashes 1 of
// their installed cards." after its other subroutines for the remainder of that run.
const THUNDERBOLT = '34096';
const thunderbolt: CardScript = {
  grantedSubroutines: [
    {
      label: 'End the run unless the Runner trashes 1 of their installed cards.',
      resolve: ({ state }) => {
        const mine = installedRunnerCards(state);
        if (mine.length === 0) return endTheRun(state);
        const ctx = { state, card: state.corp.identity, side: 'corp' as const };
        askChoice(ctx, 'runner', 'Thunderbolt Armaments: trash 1 of your installed cards, or the run ends.', [
          ...mine.map(c => ({ id: c.instanceId, label: `Trash ${title(c)}` })),
          { id: 'end', label: 'End the run' },
        ], 'etr');
      },
    },
  ],
  triggers: {
    rezzed: ({ state }, e) => {
      const run = state.activeRun;
      if (!run || run.accessOnly || type(e.card) !== 'ice' || !(hasKeyword(e.card, 'ap') || hasKeyword(e.card, 'destroyer'))) return;
      run.iceRunStrength ??= {};
      run.iceRunStrength[e.card.instanceId] = (run.iceRunStrength[e.card.instanceId] ?? 0) + 1;
      grantRunSubroutines(state, e.card, THUNDERBOLT, 0);
      addLog(state, 'corp', `${title(e.card)} gets +1 strength and a subroutine for this run (Thunderbolt Armaments).`);
    },
  },
  onPromptAnswer: ({ state }, source, answer) => {
    if (source.step !== 'etr' || answer.kind !== 'effect_choice') return;
    const target = installedRunnerCards(state).find(c => c.instanceId === answer.optionId);
    if (!target) return endTheRun(state);
    trashInstalledRunnerCard(state, target);
    addLog(state, 'runner', `Runner trashed ${title(target)} (Thunderbolt Armaments).`);
  },
};

// Lightning Laboratory: When you score this agenda, place 1 agenda counter on it. Whenever a run
// begins, you may remove 1 hosted agenda counter to rez up to 2 pieces of ice protecting the
// attacked server, ignoring all costs. When this turn ends, derez 2 pieces of ice protecting that server.
const lightningLab: CardScript = {
  triggers: {
    agenda_scored: onScore(({ card }) => addCounters(card, 'agenda', 1)),
    run_begins: (ctx, e) => {
      const ice = ctx.state.corp.servers[e.server]?.ice.filter(c => !c.isRezzed) ?? [];
      if (counters(ctx.card, 'agenda') === 0 || ice.length === 0) return;
      askCards(ctx, 'corp', 'Lightning Laboratory: remove 1 agenda counter to rez up to 2 pieces of ice protecting the attacked server for free?', ids(ice), 0, 2, 'rez', {
        server: e.server,
      });
    },
    discard_phase_ends: ctx => {
      const { state } = ctx;
      const server = state.corp.servers[String(turnFlagServer(state, ctx.card))];
      if (!server) return;
      delete state.turnFlags[lightningKey(ctx.card)];
      const rezzed = server.ice.filter(c => c.isRezzed);
      if (rezzed.length <= 2) rezzed.forEach(c => derez(state, c));
      else askCards(ctx, 'corp', 'Lightning Laboratory: derez 2 pieces of ice protecting that server.', ids(rezzed), 2, 2, 'derez');
    },
  },
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (source.step === 'rez' && picked(answer).length > 0 && counters(card, 'agenda') > 0) {
      removeCounters(card, 'agenda', 1);
      const serverId = source.data?.server as string;
      const index = Object.keys(state.corp.servers).indexOf(serverId);
      state.turnFlags[lightningKey(card)] = index + 1;
      for (const id of picked(answer)) {
        const ice = installedIce(state).find(c => c.instanceId === id);
        if (!ice || ice.isRezzed) continue;
        addLog(state, 'corp', `Corp rezzed ${title(ice)} for free (Lightning Laboratory).`, undefined, 'rez');
        rezForFree(state, ice);
      }
    } else if (source.step === 'derez') {
      for (const id of picked(answer)) {
        const ice = installedIce(state).find(c => c.instanceId === id);
        if (ice) derez(state, ice);
      }
    }
  },
};
const lightningKey = (card: CardInstance) => `lightning:${card.instanceId}`;
/** The server Lightning Laboratory rezzed ice on this turn (stored as its position in the server list, plus 1). */
const turnFlagServer = (state: GameState, card: CardInstance) => Object.keys(state.corp.servers)[turnFlag(state, lightningKey(card)) - 1];

// Warm Reception: When your turn begins, you may install 1 card from HQ. You cannot score that card
// this turn. If this server is not protected by ice, you may derez this asset to derez another installed card.
const warmReception: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side !== 'corp') return;
      const cards = installable(ctx.state, ctx.state.corp.hq);
      if (cards.length > 0) askCards(ctx, 'corp', 'Warm Reception: you may install 1 card from HQ (you cannot score it this turn).', ids(cards), 0, 1, 'pick');
      else warmDerez(ctx);
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'pick') {
      const id = picked(answer)[0];
      if (!id || !askCorpInstall(ctx, id, 'server')) warmDerez(ctx);
    } else if (source.step === 'server') {
      const serverId = installCorpChoice(state, source, answer);
      const card = serverId && findInstalledCorpCard(state, source.data?.cardId as string)?.card;
      if (card) card.cannotScoreTurn = turnKey(state);
      warmDerez(ctx);
    } else if (source.step === 'derez') {
      const target = installedCorpCards(state).find(c => c.instanceId === picked(answer)[0]);
      if (!target || !ctx.card.isRezzed) return;
      derez(state, ctx.card);
      derez(state, target);
    }
  },
};
function warmDerez(ctx: EffectContext): void {
  const { state, card } = ctx;
  if (!card.isRezzed || !isUnprotected(state, card)) return;
  const others = installedCorpCards(state).filter(c => c.isRezzed && c.instanceId !== card.instanceId);
  if (others.length > 0) askCards(ctx, 'corp', 'Warm Reception: you may derez it to derez another installed card.', ids(others), 0, 1, 'derez');
}

// Working Prototype (Hostile): Whenever you rez a card (including this asset), place 1 power
// counter on this asset. [click], hosted power counter: Gain 3 credits. [click], 5 hosted power
// counters: Gain 6 credits. Add 1 installed resource to the top of the stack.
const workingPrototype: CardScript = {
  triggers: {
    rezzed: (ctx, e) => {
      if (cardDef(e.card).side_code === 'corp') addCounters(ctx.card, 'power', 1);
    },
  },
  abilities: [
    {
      label: 'Gain 3 [credit].',
      clicks: 1,
      counters: { type: 'power', count: 1 },
      resolve: ({ state, card }) => {
        gainFromCard(state, 'corp', 3, card);
        addLog(state, 'corp', 'Corp gained 3 [credit] (Working Prototype).');
      },
    },
    {
      label: 'Gain 6 [credit]. Add 1 installed resource to the top of the stack.',
      clicks: 1,
      counters: { type: 'power', count: 5 },
      resolve: ctx => {
        const { state, card } = ctx;
        gainFromCard(state, 'corp', 6, card);
        addLog(state, 'corp', 'Corp gained 6 [credit] (Working Prototype).');
        const resources = state.runner.rig.resources;
        if (resources.length > 0) askCards(ctx, 'corp', 'Working Prototype: add 1 installed resource to the top of the stack.', ids(resources), 1, 1, 'resource');
      },
    },
  ],
  onPromptAnswer: ({ state }, _source, answer) => {
    const resource = state.runner.rig.resources.find(c => c.instanceId === picked(answer)[0]);
    if (!resource) return;
    uninstallRunnerCard(state, resource, 'stackTop');
    addLog(state, 'corp', `Corp added ${title(resource)} to the top of the stack (Working Prototype).`);
  },
};

// Lycian Multi-Munition (Mythic - Destroyer): When you rez this ice, choose 1 or more subtypes
// among barrier, code gate, and sentry. This ice gains the chosen subtypes while it remains rezzed.
// When a turn ends, derez this ice. Subroutines: If this ice is a code gate, the Runner loses
// [click] and 1 credit. If this ice is a sentry, trash 1 installed program. If this ice is a
// barrier, gain 1 credit and end the run.
const LYCIAN_CHOICES: [string, string[]][] = [
  ['barrier', ['barrier']],
  ['code gate', ['code gate']],
  ['sentry', ['sentry']],
  ['barrier+code gate', ['barrier', 'code gate']],
  ['barrier+sentry', ['barrier', 'sentry']],
  ['code gate+sentry', ['code gate', 'sentry']],
  ['all', ['barrier', 'code gate', 'sentry']],
];
const lycianIs = (state: GameState, ice: CardInstance, subtype: 'barrier' | 'code gate' | 'sentry') => iceSubtypes(ice, state).includes(subtype);
const lycian: CardScript = {
  triggers: {
    rezzed: (ctx, e) => {
      if (!isSelf(ctx, e.card)) return;
      askChoice(ctx, 'corp', 'Lycian Multi-Munition: choose the subtypes it gains while rezzed.', LYCIAN_CHOICES.map(([id, list]) => ({ id, label: list.join(', ') })), 'subtypes');
    },
    discard_phase_ends: ({ state, card }) => derez(state, card),
  },
  ice: {
    subroutines: [
      {
        label: 'If this ice is a code gate, the Runner loses [click] and 1 [credit].',
        resolve: ({ state, card }) => {
          if (!lycianIs(state, card, 'code gate')) return;
          if (state.runner.clicks > 0) state.runner.clicks -= 1;
          loseCredits(state, 'runner', 1);
        },
      },
      {
        label: 'If this ice is a sentry, trash 1 installed program.',
        resolve: ctx => {
          const programs = ctx.state.runner.rig.programs;
          if (lycianIs(ctx.state, ctx.card, 'sentry') && programs.length > 0) askCards(ctx, 'corp', 'Lycian Multi-Munition: trash 1 installed program.', ids(programs), 1, 1, 'trash');
        },
      },
      {
        label: 'If this ice is a barrier, gain 1 [credit] and end the run.',
        resolve: ({ state, card }) => {
          if (!lycianIs(state, card, 'barrier')) return;
          gainFromCard(state, 'corp', 1, card);
          endTheRun(state);
        },
      },
    ],
  },
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (source.step === 'subtypes' && answer.kind === 'effect_choice') {
      card.chosenSubtypes = LYCIAN_CHOICES.find(([id]) => id === answer.optionId)?.[1] ?? ['barrier'];
      addLog(state, 'corp', `Lycian Multi-Munition is now a ${card.chosenSubtypes.join(' and ')}.`);
    } else if (source.step === 'trash') {
      const program = state.runner.rig.programs.find(c => c.instanceId === picked(answer)[0]);
      if (program) {
        trashInstalledRunnerCard(state, program);
        addLog(state, 'corp', `Lycian Multi-Munition trashed ${title(program)}.`);
      }
    }
  },
};

// Sorocaban Blade (Sentry - Destroyer): You cannot trash more than 1 installed Runner card with
// this ice during each encounter. Subroutines: Trash 1 installed resource. Trash 1 installed piece
// of hardware. Trash 1 installed program.
const SOROCABAN_KEY = 'sorocaban';
const sorocabanSub = (kind: 'resources' | 'hardware' | 'programs', label: string): Subroutine => ({
  label: `Trash 1 installed ${label}.`,
  resolve: ctx => {
    const encounter = ctx.state.activeRun?.encounter;
    if ((encounter?.flags?.[SOROCABAN_KEY] ?? 0) > 0) return;
    const cards = ctx.state.runner.rig[kind];
    if (cards.length > 0) askCards(ctx, 'corp', `Sorocaban Blade: trash 1 installed ${label}.`, ids(cards), 1, 1, 'trash');
  },
});
const sorocabanBlade: CardScript = {
  ice: { subroutines: [sorocabanSub('resources', 'resource'), sorocabanSub('hardware', 'piece of hardware'), sorocabanSub('programs', 'program')] },
  onPromptAnswer: ({ state }, _source, answer) => {
    const target = installedRunnerCards(state).find(c => c.instanceId === picked(answer)[0]);
    if (!target) return;
    trashInstalledRunnerCard(state, target);
    addLog(state, 'corp', `Sorocaban Blade trashed ${title(target)}.`);
    const encounter = state.activeRun?.encounter;
    if (encounter) encounter.flags = { ...(encounter.flags ?? {}), [SOROCABAN_KEY]: 1 };
  },
};

// Active Policing (Terminal - Gray Ops): Play only if the Runner stole or trashed a Corp card
// during their last turn. After you resolve this operation, your action phase ends. You may install
// 1 card from HQ. The Runner gets -1 allotted [click] for their next turn. Threat 3 -> You may pay
// 2 credits. If you do, the Runner gets -1 allotted [click] for their next turn.
const fewerClicks = (state: GameState) => {
  state.runner.bonusClicksNextTurn = (state.runner.bonusClicksNextTurn ?? 0) - 1;
  addLog(state, 'corp', 'The Runner gets -1 allotted [click] for their next turn.');
};
const activePolicingThreat = (ctx: EffectContext) => {
  if (threatLevel(ctx.state) >= 3 && availableCredits(ctx.state, 'corp') >= 2) {
    askChoice(ctx, 'corp', 'Active Policing: pay 2 [credit] for the Runner to get another -1 allotted [click]?', yesNo('Pay 2 [credit]'), 'threat');
  }
};
const activePolicing: CardScript = {
  terminal: true,
  canPlay: ({ state }) => stoleOrTrashedLastTurn(state),
  onPlay: ctx => {
    const cards = installable(ctx.state, ctx.state.corp.hq);
    if (cards.length > 0) askCards(ctx, 'corp', 'Active Policing: you may install 1 card from HQ.', ids(cards), 0, 1, 'pick');
    else {
      fewerClicks(ctx.state);
      activePolicingThreat(ctx);
    }
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'pick') {
      const id = picked(answer)[0];
      if (id && askCorpInstall(ctx, id, 'server')) return;
      fewerClicks(state);
      activePolicingThreat(ctx);
    } else if (source.step === 'server') {
      installCorpChoice(state, source, answer);
      fewerClicks(state);
      activePolicingThreat(ctx);
    } else if (source.step === 'threat' && said(answer) && availableCredits(state, 'corp') >= 2) {
      spendCredits(state, 'corp', 2);
      fewerClicks(state);
    }
  },
};

// Corporate Hospitality (Double - Transaction): As an additional cost to play this operation,
// spend [click]. Gain 6 credits and draw 2 cards. Add 1 card from Archives to HQ.
const corporateHospitality: CardScript = {
  extraClicks: 1,
  onPlay: ctx => {
    const { state, card } = ctx;
    gainFromCard(state, 'corp', 6, card);
    addLog(state, 'corp', 'Corp gained 6 [credit] (Corporate Hospitality).');
    drawForEffect(state, 'corp', 2, 'Corporate Hospitality');
    const archives = archivesCards(state).filter(c => c.instanceId !== card.instanceId);
    if (archives.length > 0) askCards(ctx, 'corp', 'Corporate Hospitality: add 1 card from Archives to HQ.', ids(archives), 1, 1, 'archives');
  },
  onPromptAnswer: ({ state }, _source, answer) => archivesToHQ(state, picked(answer)[0], 'Corporate Hospitality'),
};

// Brasília Government Grid (Region): Once per turn -> When you rez a piece of ice during a run
// against this server, you may derez another installed piece of ice. If you do, the rezzed ice
// gets +3 strength for the remainder of that run.
const brasilia: CardScript = {
  triggers: {
    rezzed: (ctx, e) => {
      const { state } = ctx;
      if (type(e.card) !== 'ice' || !runOnServerOf(state, ctx.card) || turnFlag(state, onceKey(ctx.card)) > 0) return;
      const others = installedIce(state).filter(c => c.isRezzed && c.instanceId !== e.card.instanceId);
      if (others.length > 0) askCards(ctx, 'corp', `Brasília Government Grid: you may derez another piece of ice to give ${title(e.card)} +3 strength this run.`, ids(others), 0, 1, 'derez', { iceId: e.card.instanceId });
    },
  },
  onPromptAnswer: ({ state, card }, source, answer) => {
    const other = installedIce(state).find(c => c.instanceId === picked(answer)[0]);
    const run = state.activeRun;
    if (!other || !run) return;
    useOncePerTurn(state, onceKey(card));
    derez(state, other);
    const iceId = source.data?.iceId as string;
    run.iceRunStrength ??= {};
    run.iceRunStrength[iceId] = (run.iceRunStrength[iceId] ?? 0) + 3;
    addLog(state, 'corp', 'The rezzed ice gets +3 strength for this run (Brasília Government Grid).');
  },
};

// See How They Run (Psi - Security): When you score this agenda, give the Runner 1 tag. Play a Psi
// Game. If the bids differ, do 1 core damage. If the bids match, do 1 net damage.
const seeHowTheyRun: CardScript = {
  triggers: {
    agenda_scored: onScore(ctx => {
      giveTags(ctx.state, 1);
      playPsiGame(ctx, 'psi');
    }),
  },
  onPromptAnswer: (ctx, source, answer) =>
    void answerPsiGame(ctx, source, answer, match => {
      if (match) dealNetDamage(ctx.state, 1);
      else dealCoreDamage(ctx.state, 1);
    }),
};

// Sisyphus Protocol: The first time each turn the Runner passes a rezzed code gate or sentry, you
// may pay 1 credit or trash 1 card from HQ. If you do, the Runner encounters that ice again.
const sisyphus: CardScript = {
  triggers: {
    ice_passed: (ctx, e) => {
      const { state } = ctx;
      if (!e.ice.isRezzed || !(lycianIs(state, e.ice, 'code gate') || lycianIs(state, e.ice, 'sentry'))) return;
      if (!useOncePerTurn(state, onceKey(ctx.card))) return;
      const options = [
        ...(availableCredits(state, 'corp') >= 1 ? [{ id: 'pay', label: 'Pay 1 [credit]' }] : []),
        ...state.corp.hq.map(c => ({ id: c.instanceId, label: `Trash ${title(c)} from HQ` })),
      ];
      if (options.length === 0) return;
      askChoice(ctx, 'corp', `Sisyphus Protocol: pay 1 [credit] or trash 1 card from HQ to make the Runner encounter ${title(e.ice)} again?`, [...options, { id: 'no', label: 'No' }], 'again', {
        iceId: e.ice.instanceId,
      });
    },
  },
  onPromptAnswer: ({ state }, source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId === 'no') return;
    const run = state.activeRun;
    const iceId = source.data?.iceId as string;
    const server = run && state.corp.servers[run.server];
    const ice = server?.ice.find(c => c.instanceId === iceId);
    if (answer.optionId === 'pay') spendCredits(state, 'corp', 1);
    else corpTrashFromHQ(state, [answer.optionId]);
    if (!run || !server || !ice || !ice.isRezzed || run.phase !== 'movement') return;
    addLog(state, 'corp', `The Runner encounters ${title(ice)} again (Sisyphus Protocol).`);
    run.icePosition = server.ice.indexOf(ice);
    run.icePassed = Math.max(0, run.icePassed - 1);
    beginEncounter(state, ice);
  },
};

// Charlotte Caçador (Clone): You can advance this asset. When your turn begins, you may remove 1
// hosted advancement counter to gain 4 credits and draw 1 card. [trash], hosted advancement
// counter: Gain 3 credits.
const charlotte: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side !== 'corp' || ctx.card.advancementCounters === 0) return;
      askChoice(ctx, 'corp', 'Charlotte Caçador: remove 1 advancement counter to gain 4 [credit] and draw 1 card?', yesNo('Remove 1 counter'), 'use');
    },
  },
  abilities: [
    {
      label: 'Hosted advancement counter: gain 3 [credit].',
      trashSelf: true,
      canUse: ({ card }) => (card.advancementCounters > 0 ? null : 'Needs a hosted advancement counter'),
      resolve: ({ state, card }) => {
        card.advancementCounters -= 1;
        gainFromCard(state, 'corp', 3, card);
        addLog(state, 'corp', 'Corp gained 3 [credit] (Charlotte Caçador).');
      },
    },
  ],
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (!said(answer) || card.advancementCounters === 0) return;
    card.advancementCounters -= 1;
    gainFromCard(state, 'corp', 4, card);
    addLog(state, 'corp', 'Corp gained 4 [credit] (Charlotte Caçador).');
    drawForEffect(state, 'corp', 1, 'Charlotte Caçador');
  },
};

// Cohort Guidance Program (Clone): When your turn begins, you may resolve 1 of the following:
// Trash 1 card from HQ. If you do, gain 2 credits and draw 1 card. / Turn 1 facedown card in
// Archives faceup. If you do, place 1 advancement counter on an installed card.
const cohortGuidance: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      const { state } = ctx;
      if (e.side !== 'corp') return;
      const options = [
        ...(state.corp.hq.length > 0 ? [{ id: 'trash', label: 'Trash 1 card from HQ: gain 2 [credit] and draw 1' }] : []),
        ...(state.corp.archives.faceDown.length > 0 && installedCorpCards(state).length > 0 ? [{ id: 'flip', label: 'Turn a facedown Archives card faceup: place 1 advancement counter' }] : []),
      ];
      if (options.length > 0) askChoice(ctx, 'corp', 'Cohort Guidance Program: choose one, or neither.', [...options, { id: 'no', label: 'Neither' }], 'mode');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'mode' && said(answer, 'trash')) {
      askCards(ctx, 'corp', 'Cohort Guidance Program: trash 1 card from HQ.', ids(state.corp.hq), 1, 1, 'hq');
    } else if (source.step === 'mode' && said(answer, 'flip')) {
      askCards(ctx, 'corp', 'Cohort Guidance Program: turn 1 facedown card in Archives faceup.', ids(state.corp.archives.faceDown), 1, 1, 'flip');
    } else if (source.step === 'hq' && corpTrashFromHQ(state, picked(answer)).length > 0) {
      gainFromCard(state, 'corp', 2, ctx.card);
      addLog(state, 'corp', 'Corp gained 2 [credit] (Cohort Guidance Program).');
      drawForEffect(state, 'corp', 1, 'Cohort Guidance Program');
    } else if (source.step === 'flip') {
      const card = state.corp.archives.faceDown.find(c => c.instanceId === picked(answer)[0]);
      if (!card) return;
      removeCard(state.corp.archives.faceDown, card);
      state.corp.archives.faceUp.push(card);
      addLog(state, 'corp', `Corp turned ${title(card)} faceup in Archives (Cohort Guidance Program).`);
      askPlaceAdvancement(ctx, 1, 'place', false);
    } else if (source.step === 'place') {
      placeAdvancement(state, picked(answer)[0], 1, 'Cohort Guidance Program');
    }
  },
};

// Boto (Barrier - AP): Threat 4 -> This ice gets +2 strength. Subroutines: Do 2 net damage. You may
// trash 1 card from HQ to end the run (twice).
const botoEtr: Subroutine = {
  label: 'You may trash 1 card from HQ to end the run.',
  resolve: ctx => {
    if (ctx.state.corp.hq.length > 0) askCards(ctx, 'corp', 'Boto: you may trash 1 card from HQ to end the run.', ids(ctx.state.corp.hq), 0, 1, 'etr');
  },
};
const boto: CardScript = {
  ice: { strengthModifier: state => (threatLevel(state) >= 4 ? 2 : 0), subroutines: [netDamageSub(2), botoEtr, botoEtr] },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (corpTrashFromHQ(state, picked(answer)).length > 0) endTheRun(state);
  },
};

// Cloud Eater (Sentry - AP - Destroyer - Observer): Whenever an encounter with this ice ends, if it
// was rezzed this turn, trash 1 installed Runner card unless the Runner takes 2 tags or suffers 3
// net damage. Subroutines: Trash 1 installed Runner card. Give the Runner 2 tags. Do 3 net damage.
const cloudEaterKey = (card: CardInstance) => `rezzed:${card.instanceId}`;
const cloudEater: CardScript = {
  triggers: { rezzed: (ctx, e) => isSelf(ctx, e.card) && void (ctx.state.turnFlags[cloudEaterKey(ctx.card)] = 1) },
  ice: {
    onEncounterEnds: ctx => {
      const { state } = ctx;
      if (turnFlag(state, cloudEaterKey(ctx.card)) === 0 || installedRunnerCards(state).length === 0) return;
      askChoice(ctx, 'runner', 'Cloud Eater: take 2 tags or suffer 3 net damage, or the Corp trashes 1 of your installed cards.', [
        { id: 'tags', label: 'Take 2 tags' },
        { id: 'net', label: 'Suffer 3 net damage' },
        { id: 'trash', label: 'The Corp trashes 1 installed card' },
      ], 'ends');
    },
    subroutines: [
      {
        label: 'Trash 1 installed Runner card.',
        resolve: ctx => {
          const cards = installedRunnerCards(ctx.state);
          if (cards.length > 0) askCards(ctx, 'corp', 'Cloud Eater: trash 1 installed Runner card.', ids(cards), 1, 1, 'trash');
        },
      },
      tagSub(2),
      netDamageSub(3),
    ],
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'ends' && answer.kind === 'effect_choice') {
      if (answer.optionId === 'tags') giveTags(state, 2);
      else if (answer.optionId === 'net') dealNetDamage(state, 3);
      else askCards(ctx, 'corp', 'Cloud Eater: trash 1 installed Runner card.', ids(installedRunnerCards(state)), 1, 1, 'trash');
    } else if (source.step === 'trash') {
      const target = installedRunnerCards(state).find(c => c.instanceId === picked(answer)[0]);
      if (target) {
        trashInstalledRunnerCard(state, target);
        addLog(state, 'corp', `Cloud Eater trashed ${title(target)}.`);
      }
    }
  },
};

// Tributary (Code Gate): The first time each turn a run begins, you may move this ice to the
// outermost position protecting the attacked server. Subroutines: You may draw 1 card. You may
// install 1 piece of ice from HQ protecting another server, ignoring all costs. / Each piece of ice
// gets +2 strength for the remainder of this run.
const tributary: CardScript = {
  triggers: {
    run_begins: (ctx, e) => {
      if (!useOncePerTurn(ctx.state, `run-begins:${ctx.card.instanceId}`)) return;
      const server = ctx.state.corp.servers[e.server];
      if (!server || server.ice[server.ice.length - 1]?.instanceId === ctx.card.instanceId) return;
      askChoice(ctx, 'corp', 'Tributary: move it to the outermost position protecting the attacked server?', yesNo('Move it'), 'move');
    },
  },
  ice: {
    subroutines: [
      {
        label: 'You may draw 1 card. You may install 1 piece of ice from HQ protecting another server, ignoring all costs.',
        resolve: ctx => {
          if (ctx.state.corp.rd.length > 0) askChoice(ctx, 'corp', 'Tributary: draw 1 card?', yesNo('Draw 1 card'), 'draw');
          else tributaryInstall(ctx);
        },
      },
      {
        label: 'Each piece of ice gets +2 strength for the remainder of this run.',
        resolve: ({ state }) => {
          if (state.activeRun) state.activeRun.iceStrengthBonus = (state.activeRun.iceStrengthBonus ?? 0) + 2;
        },
      },
    ],
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    if (source.step === 'move' && said(answer)) {
      const run = state.activeRun;
      const from = serverOf(state, card);
      const to = run && state.corp.servers[run.server];
      if (!from || !to) return;
      removeCard(from.ice, card);
      to.ice.push(card);
      addLog(state, 'corp', `Tributary moved to the outermost position protecting ${to.name}.`);
    } else if (source.step === 'draw') {
      if (said(answer)) drawForEffect(state, 'corp', 1, 'Tributary');
      tributaryInstall(ctx);
    } else if (source.step === 'pick') {
      const id = picked(answer)[0];
      const ice = id && state.corp.hq.find(c => c.instanceId === id);
      const here = state.activeRun?.server;
      if (ice) askInstallAmong(ctx, id, 'server', corpInstallOptions(state, ice, { ignoreCosts: true }).filter(o => o.id !== here && o.id !== 'new'));
    } else if (source.step === 'server') {
      installCorpChoice(state, source, answer, { ignoreCosts: true });
    }
  },
};
function tributaryInstall(ctx: EffectContext): void {
  const here = ctx.state.activeRun?.server;
  const ice = ctx.state.corp.hq.filter(c => type(c) === 'ice');
  if (!Object.keys(ctx.state.corp.servers).some(id => id !== here)) return;
  // Asked even with no ice in HQ when the Corp's stops are on ALL (4.3.2, see askEvenIfNone)
  askEvenIfNone(
    ctx,
    'corp',
    ice.length > 0,
    () => askCards(ctx, 'corp', 'Tributary: you may install 1 piece of ice from HQ protecting another server, ignoring all costs.', ids(ice), 0, 1, 'pick'),
    'Tributary: no ice in HQ to install.',
  );
}

// Bring Them Home (Terminal - Black Ops): Play only if the Runner stole or trashed a Corp card
// during their last turn. After you resolve this operation, your action phase ends. Reveal and add
// 2 cards at random from the grip to the top of the stack. Threat 3 -> You may pay 2 credits to
// reveal 1 card in the grip at random. The Runner shuffles it into the stack.
const randomGripCard = (state: GameState) => state.runner.grip[nextInt(state.rng, state.runner.grip.length)];
const bringThemHome: CardScript = {
  terminal: true,
  canPlay: ({ state }) => stoleOrTrashedLastTurn(state),
  onPlay: ctx => {
    const { state } = ctx;
    for (let i = 0; i < 2 && state.runner.grip.length > 0; i++) {
      const card = randomGripCard(state);
      removeCard(state.runner.grip, card);
      state.runner.stack.unshift(card);
      addLog(state, 'corp', `Corp revealed ${title(card)} from the grip and added it to the top of the stack (Bring Them Home).`, card.cardCode);
    }
    if (threatLevel(state) >= 3 && state.runner.grip.length > 0 && availableCredits(state, 'corp') >= 2) {
      askChoice(ctx, 'corp', 'Bring Them Home: pay 2 [credit] to shuffle 1 random card from the grip into the stack?', yesNo('Pay 2 [credit]'), 'threat');
    }
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (!said(answer) || state.runner.grip.length === 0 || availableCredits(state, 'corp') < 2) return;
    spendCredits(state, 'corp', 2);
    const card = randomGripCard(state);
    removeCard(state.runner.grip, card);
    state.runner.stack.push(card);
    shuffleInPlace(state.rng, state.runner.stack);
    addLog(state, 'corp', `Corp revealed ${title(card)} from the grip; the Runner shuffled it into the stack (Bring Them Home).`, card.cardCode);
  },
};

// Kingmaking (Research): When you score this agenda, draw up to 3 cards. You may add 1 agenda worth
// 1 or less agenda points from HQ to your score area.
const kingmaking: CardScript = {
  triggers: {
    agenda_scored: onScore(ctx => {
      const n = Math.min(3, ctx.state.corp.rd.length);
      askChoice(ctx, 'corp', 'Kingmaking: draw how many cards?', [3, 2, 1, 0].filter(k => k <= n).map(k => ({ id: String(k), label: `Draw ${k}` })), 'draw');
    }),
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'draw' && answer.kind === 'effect_choice') {
      drawForEffect(state, 'corp', Number(answer.optionId), 'Kingmaking');
      const small = state.corp.hq.filter(c => type(c) === 'agenda' && (cardDef(c).agenda_points ?? 0) <= 1);
      // Asked even with no such agenda in HQ when the Corp's stops are on ALL (4.3.2, see askEvenIfNone)
      askEvenIfNone(
        ctx,
        'corp',
        small.length > 0,
        () => askCards(ctx, 'corp', 'Kingmaking: you may add 1 agenda worth 1 or less agenda points from HQ to your score area.', ids(small), 0, 1, 'add'),
        'Kingmaking: no agenda worth 1 or less agenda points in HQ.',
      );
    } else if (source.step === 'add') {
      const agenda = state.corp.hq.find(c => c.instanceId === picked(answer)[0]);
      if (!agenda) return;
      removeCard(state.corp.hq, agenda);
      agenda.isRezzed = true;
      agenda.scoredTurn = turnKey(state);
      state.corp.scoreArea.push(agenda);
      state.corp.score += agendaPoints(agenda);
      addLog(state, 'corp', `Corp added ${title(agenda)} to their score area (Kingmaking). Total: ${state.corp.score}`);
      checkAgendaVictory(state);
    }
  },
};

// Stoke the Embers (Initiative): When you score this agenda, gain 3 credits and place 1
// advancement counter on an installed card. When you install this agenda from anywhere except HQ,
// you may reveal it. If you do, gain 2 credits and place 1 advancement counter on an installed card.
const stokeTheEmbers: CardScript = {
  triggers: {
    agenda_scored: onScore(ctx => {
      gainFromCard(ctx.state, 'corp', 3, ctx.card);
      addLog(ctx.state, 'corp', 'Corp gained 3 [credit] (Stoke the Embers).');
      askPlaceAdvancement(ctx, 1, 'place', false);
    }),
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'place') placeAdvancement(state, picked(answer)[0], 1, 'Stoke the Embers');
    else if (source.step === 'reveal' && said(answer)) {
      ctx.card.runnerKnows = true;
      addLog(state, 'corp', 'Corp revealed Stoke the Embers as it was installed.', ctx.card.cardCode);
      gainFromCard(state, 'corp', 2, ctx.card);
      askPlaceAdvancement(ctx, 1, 'place', false);
    }
  },
  // Inactive while installed unrezzed, so this runs from installCorpCardFrom on the card itself
  onCorpInstalled: (ctx, fromHQ) => {
    if (fromHQ) return;
    askChoice(ctx, 'corp', 'Stoke the Embers: reveal it to gain 2 [credit] and place 1 advancement counter on an installed card?', yesNo('Reveal it'), 'reveal');
  },
};

// Janaína "JK" Dumont Kindelán (Academic - Clone): When your turn begins, place 3 credits on this
// asset. [click], add this asset to HQ: Take all credits from this asset. You may install 1 card from HQ.
const janaina: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side !== 'corp') return;
      addCounters(ctx.card, 'credit', 3);
      addLog(ctx.state, 'corp', 'Janaína "JK" Dumont Kindelán: 3 [credit] placed on it.');
    },
  },
  abilities: [
    {
      label: 'Add this asset to HQ: take all credits from it. You may install 1 card from HQ.',
      clicks: 1,
      resolve: ctx => {
        const { state, card } = ctx;
        const credits = counters(card, 'credit');
        returnInstalledToHQ(state, card);
        gainFromCard(state, 'corp', credits, card);
        addLog(state, 'corp', `Corp added Janaína "JK" Dumont Kindelán to HQ and took ${credits} [credit].`);
        const cards = installable(state, state.corp.hq);
        if (cards.length > 0) askCards(ctx, 'corp', 'Janaína "JK" Dumont Kindelán: you may install 1 card from HQ.', ids(cards), 0, 1, 'pick');
      },
    },
  ],
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'pick') {
      const id = picked(answer)[0];
      if (id) askCorpInstall(ctx, id, 'server');
    } else if (source.step === 'server') installCorpChoice(ctx.state, source, answer);
  },
};

// Capacitor (Barrier): While the Runner is tagged, this ice gets +2 strength. Subroutines: Gain 1
// credit for each tag the Runner has. End the run.
const capacitor: CardScript = {
  ice: {
    strengthModifier: state => (state.runner.tags > 0 ? 2 : 0),
    subroutines: [
      {
        label: 'Gain 1 [credit] for each tag the Runner has.',
        resolve: ({ state, card }) => gainFromCard(state, 'corp', state.runner.tags, card),
      },
      endTheRunSub,
    ],
  },
};

// Piranhas (Code Gate - AP - Liability): As an additional cost to rez this ice, take 1 bad
// publicity or remove 1 tag. Subroutines: You may draw 1 card. Do 1 net damage. End the run if
// there are more cards in HQ than in the grip.
const piranhas: CardScript = {
  payRez: liabilityRez.payRez,
  ice: {
    subroutines: [
      {
        label: 'You may draw 1 card.',
        resolve: ctx => {
          if (ctx.state.corp.rd.length > 0) askChoice(ctx, 'corp', 'Piranhas: draw 1 card?', yesNo('Draw 1 card'), 'draw');
        },
      },
      netDamageSub(1),
      {
        label: 'End the run if there are more cards in HQ than in the grip.',
        resolve: ({ state }) => {
          if (state.corp.hq.length > state.runner.grip.length) endTheRun(state);
        },
      },
    ],
  },
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'rez_cost') liabilityRez.answer(ctx, answer, Number(source.data?.cost ?? 0));
    else if (source.step === 'draw' && said(answer)) drawForEffect(ctx.state, 'corp', 1, 'Piranhas');
  },
};

// Seraph (Sentry - AP - Observer - Deep Net): When the Runner encounters this ice, they lose 3
// credits unless they suffer 2 net damage or take 1 tag. Subroutines: The Runner loses 3 credits.
// Do 2 net damage. Give the Runner 1 tag.
const seraph: CardScript = {
  ice: {
    onEncounter: ctx =>
      askChoice(ctx, 'runner', 'Seraph: lose 3 [credit], suffer 2 net damage, or take 1 tag?', [
        { id: 'credits', label: 'Lose 3 [credit]' },
        { id: 'net', label: 'Suffer 2 net damage' },
        { id: 'tag', label: 'Take 1 tag' },
      ], 'encounter'),
    subroutines: [loseCreditsSub(3), netDamageSub(2), tagSub(1)],
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'net') dealNetDamage(state, 2);
    else if (answer.optionId === 'tag') giveTags(state, 1);
    else addLog(state, 'corp', `The Runner lost ${loseCredits(state, 'runner', 3)} [credit] (Seraph).`);
  },
};

// Sudden Commandment (Mandate): Draw 2 cards. You may play 1 non-terminal operation from HQ.
// Threat 3 -> If this operation is the first mandate you played this turn, you may pay 3 credits
// to gain [click].
const suddenThreat = (ctx: EffectContext) => {
  const { state } = ctx;
  if (threatLevel(state) >= 3 && turnFlag(state, TurnFlag.mandatesPlayed) === 1 && turnFlag(state, `sudden-first:${ctx.card.instanceId}`) > 0 && availableCredits(state, 'corp') >= 3) {
    askChoice(ctx, 'corp', 'Sudden Commandment: pay 3 [credit] to gain [click]?', yesNo('Pay 3 [credit]'), 'click');
  }
};
const suddenCommandment: CardScript = {
  onPlay: ctx => {
    const { state, card } = ctx;
    if (turnFlag(state, TurnFlag.mandatesPlayed) === 1) state.turnFlags[`sudden-first:${card.instanceId}`] = 1;
    drawForEffect(state, 'corp', 2, 'Sudden Commandment');
    const ops = state.corp.hq.filter(c => type(c) === 'operation' && !hasKeyword(c, 'terminal') && playableFromHQ(state, c));
    // Asked even with no operation to play when the Corp's stops are on ALL (4.3.2, see askEvenIfNone); the one answer
    // goes on to the Threat question like a decline
    const asked = askEvenIfNone(
      ctx,
      'corp',
      ops.length > 0,
      () => askCards(ctx, 'corp', 'Sudden Commandment: you may play 1 non-terminal operation from HQ.', ids(ops), 0, 1, 'play'),
      'Sudden Commandment: no non-terminal operation in HQ you can play.',
      'OK',
      { step: 'play' },
    );
    if (!asked) suddenThreat(ctx);
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'play') {
      const op = state.corp.hq.find(c => c.instanceId === picked(answer)[0]);
      if (op) playCardFrom(state, 'corp', op, state.corp.hq, { fromHand: true });
      suddenThreat(ctx);
    } else if (source.step === 'click' && said(answer) && availableCredits(state, 'corp') >= 3) {
      spendCredits(state, 'corp', 3);
      state.corp.clicks += 1;
      addLog(state, 'corp', 'Corp paid 3 [credit] to gain [click] (Sudden Commandment).');
    }
  },
};

// The Holo Man (Academic - Executive - Sysop): When your turn begins, you may move this upgrade to
// the root of another server. Once per turn -> [click], 4 credits: Place 2 advancement counters on
// 1 card in the root of or protecting this server. If you have not installed any cards from HQ this
// turn, instead place 3 advancement counters on that card.
const holoManCount = (state: GameState) => (turnFlag(state, TurnFlag.installedFromHQ) > 0 ? 2 : 3);
const holoMan: CardScript = {
  triggers: { turn_begins: (ctx, e) => e.side === 'corp' && askMoveUpgrade(ctx) },
  liveValue: state => `${holoManCount(state)} advancement counters`,
  abilities: [
    {
      label: 'Place 2 advancement counters on 1 card in or protecting this server (3 if you installed no card from HQ this turn).',
      clicks: 1,
      credits: 4,
      oncePerTurn: true,
      canUse: ({ state, card }) => ((serverOf(state, card)?.root.length ?? 0) + (serverOf(state, card)?.ice.length ?? 0) > 1 ? null : 'No other card in or protecting this server'),
      resolve: ctx => {
        const server = serverOf(ctx.state, ctx.card);
        if (!server) return;
        const n = holoManCount(ctx.state);
        askPlaceAdvancement(ctx, n, 'place', false, [...server.root, ...server.ice].filter(c => c.instanceId !== ctx.card.instanceId));
      },
    },
  ],
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (source.step === 'move' && answer.kind === 'effect_choice' && answer.optionId !== 'no') moveUpgrade(state, card, answer.optionId);
    else if (source.step === 'place') placeAdvancement(state, picked(answer)[0], Number(source.data?.n ?? 2), 'The Holo Man');
  },
};

// Nuvem SA: Law of the Land: Whenever you finish resolving an operation or an action on an
// expendable card, look at the top card of R&D. You may trash that card. The first time you trash
// a card from R&D during each of your turns, gain 2 credits.
const nuvemLook = (ctx: EffectContext) => {
  const top = ctx.state.corp.rd[0];
  if (!top) return;
  noteRdPrivate(ctx.state, 1);
  askChoice(ctx, 'corp', `Nuvem SA: the top card of R&D is ${title(top)}. Trash it?`, [
    { id: 'trash', label: `Trash ${title(top)}` },
    { id: 'no', label: 'Leave it' },
  ], 'look', { topId: top.instanceId });
};
const nuvem: CardScript = {
  triggers: {
    operation_finished: ctx => nuvemLook(ctx),
    expendable_action_finished: ctx => nuvemLook(ctx),
  },
  onPromptAnswer: ({ state }, source, answer) => {
    if (said(answer, 'trash') && state.corp.rd[0]?.instanceId === source.data?.topId) trashTopOfRD(state, 'Nuvem SA');
  },
};

// Eminent Domain (Expansion - Expendable): [click], 1 credit, reveal and trash this agenda from
// HQ: Install and rez 1 card from HQ, paying a total of 5 credits less. When you score this agenda,
// you may search R&D for 1 card. Install and rez that card, ignoring all costs.
const rezzable = (c: CardInstance) => type(c) !== 'operation' && type(c) !== 'agenda';
const eminentDomain: CardScript = {
  abilities: [
    {
      label: 'Reveal and trash this agenda from HQ: install and rez 1 card from HQ, paying 5 [credit] less in total.',
      fromHQ: true,
      clicks: 1,
      credits: 1,
      resolve: ctx => {
        const { state, card } = ctx;
        corpTrashFromHQ(state, [card.instanceId], true);
        addLog(state, 'corp', 'Corp revealed and trashed Eminent Domain from HQ.');
        const cards = state.corp.hq.filter(c => rezzable(c) && installAndRezOptions(state, c, 5).length > 0);
        // Asked even with nothing to install and rez when the Corp's stops are on ALL (4.3.2, see askEvenIfNone)
        askEvenIfNone(
          ctx,
          'corp',
          cards.length > 0,
          () => askCards(ctx, 'corp', 'Eminent Domain: install and rez 1 card from HQ, paying 5 [credit] less in total.', ids(cards), 0, 1, 'hq'),
          'Eminent Domain: no card in HQ you can install and rez.',
        );
      },
    },
  ],
  triggers: {
    agenda_scored: onScore(ctx => {
      const cards = ctx.state.corp.rd.filter(rezzable);
      askCards(ctx, 'corp', 'Eminent Domain: you may search R&D for 1 card to install and rez, ignoring all costs.', ids(cards), 0, 1, 'search');
    }),
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'hq') {
      const id = picked(answer)[0];
      const card = id && state.corp.hq.find(c => c.instanceId === id);
      if (card) askInstallAmong(ctx, id, 'hq-server', installAndRezOptions(state, card, 5));
    } else if (source.step === 'hq-server' && answer.kind === 'effect_choice') {
      installAndRez(state, source.data?.cardId as string, answer.optionId, 5);
    } else if (source.step === 'search') {
      const card = picked(answer).length ? takeFromRD(state, picked(answer)[0]) : undefined;
      if (!card) return shuffleRD(state);
      state.corp.hq.push(card);
      if (!askInstallAmong(ctx, card.instanceId, 'rd-server', installAndRezOptions(state, card, 0, true))) return;
    } else if (source.step === 'rd-server' && answer.kind === 'effect_choice') {
      installAndRez(state, source.data?.cardId as string, answer.optionId, 0, true);
    }
  },
};

// The Basalt Spire: When the Runner steals this agenda, you may add 1 card from Archives to HQ.
// When you score this agenda, place 2 agenda counters on it. Once per turn -> Hosted agenda counter,
// trash the top card of R&D: Add 1 card from Archives to HQ.
const askArchivesToHQ = (ctx: EffectContext, optional: boolean) => {
  const cards = archivesCards(ctx.state);
  if (cards.length > 0) askCards(ctx, 'corp', `${title(ctx.card)}: ${optional ? 'you may add' : 'add'} 1 card from Archives to HQ.`, ids(cards), optional ? 0 : 1, 1, 'archives');
};
const basaltSpire: CardScript = {
  triggers: {
    agenda_stolen: (ctx, e) => isSelf(ctx, e.card) && askArchivesToHQ(ctx, true),
    agenda_scored: onScore(({ card }) => addCounters(card, 'agenda', 2)),
  },
  abilities: [
    {
      label: 'Hosted agenda counter, trash the top card of R&D: add 1 card from Archives to HQ.',
      counters: { type: 'agenda', count: 1 },
      oncePerTurn: true,
      canUse: ({ state }) => (state.corp.rd.length > 0 ? null : 'R&D is empty'),
      resolve: ctx => {
        trashTopOfRD(ctx.state, 'The Basalt Spire');
        askArchivesToHQ(ctx, false);
      },
    },
  ],
  onPromptAnswer: ({ state }, _source, answer) => archivesToHQ(state, picked(answer)[0], 'The Basalt Spire'),
};

// Hearts and Minds (Political): When your turn begins, you may move 1 advancement counter from an
// installed card to an installed card you can advance. If this server is not protected by ice, you
// may also place 1 advancement counter on an installed card you can advance.
const heartsAndMinds: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side !== 'corp') return;
      const sources = installedCorpCards(ctx.state).filter(c => c.advancementCounters > 0);
      if (sources.length > 0 && advanceableInstalled(ctx.state).length > 0) {
        askCards(ctx, 'corp', 'Hearts and Minds: you may move 1 advancement counter from an installed card...', ids(sources), 0, 1, 'from');
      } else heartsPlace(ctx);
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'from') {
      const from = picked(answer)[0];
      const targets = advanceableInstalled(state).filter(c => c.instanceId !== from);
      if (from && targets.length > 0) askCards(ctx, 'corp', 'Hearts and Minds: ...to an installed card you can advance.', ids(targets), 1, 1, 'to', { from });
      else heartsPlace(ctx);
    } else if (source.step === 'to') {
      const from = findInstalledCorpCard(state, source.data?.from as string)?.card;
      const to = findInstalledCorpCard(state, picked(answer)[0])?.card;
      if (from && to && from.advancementCounters > 0) {
        from.advancementCounters -= 1;
        to.advancementCounters += 1;
        addLog(state, 'corp', 'Corp moved 1 advancement counter (Hearts and Minds).');
      }
      heartsPlace(ctx);
    } else if (source.step === 'place') {
      placeAdvancement(state, picked(answer)[0], 1, 'Hearts and Minds');
    }
  },
};
function heartsPlace(ctx: EffectContext): void {
  const cards = advanceableInstalled(ctx.state);
  if (isUnprotected(ctx.state, ctx.card) && cards.length > 0) {
    askCards(ctx, 'corp', 'Hearts and Minds: you may also place 1 advancement counter on an installed card you can advance.', ids(cards), 0, 1, 'place');
  }
}

// Descent (Code Gate - Expendable): [click], 1 credit, reveal and trash this ice from HQ: Draw 1
// card. Reveal up to 2 agendas in HQ and/or Archives and shuffle them into R&D. When your turn
// begins, you may add this ice to HQ. Subroutine: End the run.
const descent: CardScript = {
  abilities: [
    {
      label: 'Reveal and trash this ice from HQ: draw 1 card; shuffle up to 2 agendas from HQ and/or Archives into R&D.',
      fromHQ: true,
      clicks: 1,
      credits: 1,
      resolve: ctx => {
        const { state, card } = ctx;
        corpTrashFromHQ(state, [card.instanceId], true);
        addLog(state, 'corp', 'Corp revealed and trashed Descent from HQ.');
        drawForEffect(state, 'corp', 1, 'Descent');
        const agendas = [...state.corp.hq, ...archivesCards(state)].filter(c => type(c) === 'agenda');
        // Asked even with no agenda when the Corp's stops are on ALL (4.3.2, 4.4.6c, see askEvenIfNone)
        askEvenIfNone(
          ctx,
          'corp',
          agendas.length > 0,
          () => askCards(ctx, 'corp', 'Descent: reveal up to 2 agendas in HQ and/or Archives to shuffle into R&D.', ids(agendas), 0, 2, 'shuffle'),
          'Descent: no agenda in HQ or Archives.',
        );
      },
    },
  ],
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side === 'corp' && serverOf(ctx.state, ctx.card)) askChoice(ctx, 'corp', 'Descent: add it to HQ?', yesNo('Add Descent to HQ'), 'return');
    },
  },
  ice: { subroutines: [endTheRunSub] },
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (source.step === 'return' && said(answer)) {
      if (returnInstalledToHQ(state, card)) addLog(state, 'corp', 'Corp added Descent to HQ.');
    } else if (source.step === 'shuffle' && picked(answer).length > 0) {
      for (const id of picked(answer)) {
        const agenda = [...state.corp.hq, ...archivesCards(state)].find(c => c.instanceId === id);
        if (!agenda) continue;
        takeFromCorpZone(state, agenda);
        state.corp.rd.push(agenda);
        addLog(state, 'corp', `Corp revealed ${title(agenda)} and shuffled it into R&D (Descent).`, agenda.cardCode);
      }
      shuffleRD(state);
    }
  },
};

// Hammer (Sentry - Destroyer - Observer): During each encounter with this ice, the Runner cannot
// break more than 1 of its printed subroutines except using killers. Subroutines: Give the Runner 1
// tag. Trash 1 installed resource or piece of hardware. Trash 1 installed program that is not a
// decoder, fracter, or killer.
const isKiller = (state: GameState, id: string | undefined) => {
  const breaker = id && state.runner.rig.programs.find(p => p.instanceId === id);
  return !!breaker && hasKeyword(breaker, 'killer');
};
const hammerTrash = (kinds: ('resources' | 'hardware' | 'programs')[], label: string, filter: (c: CardInstance) => boolean = () => true): Subroutine => ({
  label,
  resolve: ctx => {
    const cards = kinds.flatMap(k => ctx.state.runner.rig[k]).filter(filter);
    if (cards.length > 0) askCards(ctx, 'corp', `Hammer: ${label[0].toLowerCase()}${label.slice(1)}`, ids(cards), 1, 1, 'trash');
  },
});
const hammer: CardScript = {
  ice: {
    breakRestriction: (state, ice, breaker, indices) => {
      const encounter = state.activeRun?.encounter;
      if (!encounter || (breaker && hasKeyword(breaker, 'killer'))) return null;
      const first = grantedBefore(state, ice);
      const printed = (i: number) => i >= first && i < first + 3;
      const already = Object.entries(encounter.brokenBy ?? {}).filter(([i, by]) => printed(Number(i)) && !isKiller(state, by)).length;
      return already + indices.filter(printed).length > 1 ? 'Only 1 of Hammer\'s printed subroutines can be broken except with killers' : null;
    },
    subroutines: [
      tagSub(1),
      hammerTrash(['resources', 'hardware'], 'Trash 1 installed resource or piece of hardware.'),
      hammerTrash(['programs'], 'Trash 1 installed program that is not a decoder, fracter, or killer.', c => !/\b(decoder|fracter|killer)\b/i.test(keywords(c))),
    ],
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    const target = installedRunnerCards(state).find(c => c.instanceId === picked(answer)[0]);
    if (!target) return;
    trashInstalledRunnerCard(state, target);
    addLog(state, 'corp', `Hammer trashed ${title(target)}.`);
  },
};

// Logjam (Barrier): You can advance this ice. It gets +1 strength for each hosted advancement
// counter. When you rez this ice, place 1 advancement counter on it plus 1 advancement counter for
// each card type among faceup cards in Archives. Subroutines: Gain 2 credits. End the run. / End
// the run. / End the run.
const logjam: CardScript = {
  liveValue: state => `${1 + faceUpTypes(state).size} advancement counters when rezzed`,
  triggers: {
    rezzed: (ctx, e) => {
      if (!isSelf(ctx, e.card)) return;
      const n = 1 + faceUpTypes(ctx.state).size;
      ctx.card.advancementCounters += n;
      addLog(ctx.state, 'corp', `Logjam: ${n} advancement counter(s) placed on it.`);
    },
  },
  ice: {
    strengthModifier: (_state, ice) => ice.advancementCounters,
    subroutines: [
      {
        label: 'Gain 2 [credit]. End the run.',
        resolve: ({ state, card }) => {
          gainFromCard(state, 'corp', 2, card);
          endTheRun(state);
        },
      },
      endTheRunSub,
      endTheRunSub,
    ],
  },
};

// Business As Usual (Gray Ops): Resolve 1 of the following: Place 1 advancement counter on each of
// up to 2 installed cards you can advance. / Remove all virus counters from 1 installed card.
// Threat 3 -> You may also resolve the other mode.
const bauAdvance = (ctx: EffectContext, next: string) => {
  const cards = advanceableInstalled(ctx.state);
  if (cards.length > 0) askCards(ctx, 'corp', 'Business As Usual: place 1 advancement counter on each of up to 2 installed cards you can advance.', ids(cards), 0, 2, 'advance', { next });
  else bauNext(ctx, next);
};
const bauVirus = (ctx: EffectContext, next: string) => {
  const cards = [...installedCorpCards(ctx.state), ...installedRunnerCards(ctx.state)].filter(c => counters(c, 'virus') > 0);
  if (cards.length > 0) askCards(ctx, 'corp', 'Business As Usual: remove all virus counters from 1 installed card.', ids(cards), 1, 1, 'virus', { next });
  else bauNext(ctx, next);
};
const bauNext = (ctx: EffectContext, next: string) => {
  if (next === 'virus') bauVirus(ctx, '');
  else if (next === 'advance') bauAdvance(ctx, '');
};
const businessAsUsual: CardScript = {
  onPlay: ctx => {
    const both = threatLevel(ctx.state) >= 3;
    askChoice(ctx, 'corp', 'Business As Usual: choose a mode.', [
      { id: 'advance', label: 'Place advancement counters on up to 2 cards' },
      { id: 'virus', label: 'Remove all virus counters from 1 card' },
      ...(both ? [{ id: 'both', label: 'Both (threat 3)' }] : []),
    ], 'mode');
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    const next = String(source.data?.next ?? '');
    if (source.step === 'mode' && answer.kind === 'effect_choice') {
      if (answer.optionId === 'virus') bauVirus(ctx, '');
      else bauAdvance(ctx, answer.optionId === 'both' ? 'virus' : '');
    } else if (source.step === 'advance') {
      for (const id of picked(answer)) placeAdvancement(state, id, 1, 'Business As Usual');
      bauNext(ctx, next);
    } else if (source.step === 'virus') {
      const card = [...installedCorpCards(state), ...installedRunnerCards(state)].find(c => c.instanceId === picked(answer)[0]);
      if (card) {
        addLog(state, 'corp', `Corp removed ${counters(card, 'virus')} virus counter(s) from ${title(card)} (Business As Usual).`);
        card.tokens.virus = 0;
      }
      bauNext(ctx, next);
    }
  },
};

// Isaac Liberdade (Bioroid - Sysop): Each advanced piece of ice protecting this server gets +2
// strength. Whenever this upgrade moves to the root of a server, you may place 1 advancement counter
// on a piece of ice protecting that server that has no advancement counters. When your turn ends,
// you may move this upgrade to the root of another server.
const isaacPlace = (ctx: EffectContext) => {
  const ice = serverOf(ctx.state, ctx.card)?.ice.filter(c => c.advancementCounters === 0) ?? [];
  if (ice.length > 0) askCards(ctx, 'corp', 'Isaac Liberdade: you may place 1 advancement counter on a piece of ice protecting this server that has none.', ids(ice), 0, 1, 'place');
};
const isaac: CardScript = {
  modifiers: {
    iceStrength: (state, self, ice) => (ice.advancementCounters > 0 && serverOf(state, self)?.ice.includes(ice) ? 2 : 0),
  },
  triggers: { discard_phase_ends: (ctx, e) => corpTurnEnds(e) && askMoveUpgrade(ctx) },
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    if (source.step === 'move' && answer.kind === 'effect_choice' && answer.optionId !== 'no') {
      if (moveUpgrade(state, card, answer.optionId)) isaacPlace(ctx);
    } else if (source.step === 'place') placeAdvancement(state, picked(answer)[0], 1, 'Isaac Liberdade');
  },
};

// The Powers That Be (Ritzy): Whenever you score an agenda, you may install 1 card from HQ or
// Archives, ignoring all costs.
const powersThatBe: CardScript = {
  triggers: {
    agenda_scored: ctx => {
      const cards = installable(ctx.state, [...ctx.state.corp.hq, ...archivesCards(ctx.state)], { ignoreCosts: true });
      if (cards.length > 0) askCards(ctx, 'corp', 'The Powers That Be: you may install 1 card from HQ or Archives, ignoring all costs.', ids(cards), 0, 1, 'pick');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'pick') {
      const id = picked(answer)[0];
      if (id) askCorpInstall(ctx, id, 'server', { ignoreCosts: true });
    } else if (source.step === 'server') installCorpChoice(ctx.state, source, answer, { ignoreCosts: true });
  },
};

export const liberationCorpScripts: Record<string, CardScript> = {
  '34031': salvoTesting,
  '34032': stegodon,
  '34033': wageWorkers,
  '34034': ablativeBarrier,
  '34035': jaguarundi,
  '34036': mic,
  '34037': greasingThePalm,
  '34038': vovo,
  '34039': aTeia,
  '34040': fujii,
  '34041': frontCompany,
  '34042': attini,
  '34043': phoneutria,
  '34044': tatuBola,
  '34045': mindscaping,
  '34046': adrianSeis,
  '34047': daniela,
  '34048': epiphany,
  '34049': oracleThinktank,
  '34050': balancedCoverage,
  '34051': behold,
  '34052': federalFundraising,
  '34053': starlitKnight,
  '34054': virtualServiceAgent,
  '34055': oppoResearch,
  '34056': yourDigitalLife,
  '34057': slashAndBurn,
  '34058': cybersandHarvester,
  '34059': treeLine,
  '34060': valentao,
  '34061': armedAssetProtection,
  '34062': pivot,
  '34063': angelique,
  '34064': tucana,
  '34065': b1001,
  '34096': thunderbolt,
  '34097': lightningLab,
  '34098': warmReception,
  '34099': workingPrototype,
  '34100': lycian,
  '34101': sorocabanBlade,
  '34102': activePolicing,
  '34103': corporateHospitality,
  '34104': brasilia,
  '34105': seeHowTheyRun,
  '34106': sisyphus,
  '34107': charlotte,
  '34108': cohortGuidance,
  '34109': boto,
  '34110': cloudEater,
  '34111': tributary,
  '34112': bringThemHome,
  '34113': kingmaking,
  '34114': stokeTheEmbers,
  '34115': janaina,
  '34116': capacitor,
  '34117': piranhas,
  '34118': seraph,
  '34119': suddenCommandment,
  '34120': holoMan,
  '34121': nuvem,
  '34122': eminentDomain,
  '34123': basaltSpire,
  '34124': heartsAndMinds,
  '34125': descent,
  '34126': hammer,
  '34127': logjam,
  '34128': businessAsUsual,
  '34129': isaac,
  '34130': powersThatBe,
};
