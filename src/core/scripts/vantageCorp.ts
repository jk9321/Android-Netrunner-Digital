import { CardInstance } from '../types/card';
import { GameState } from '../types/state';
import { cardDef } from '../cards';
import { shuffleInPlace } from '../rng';
import { shuffleRD } from '../engine/rdKnowledge';
import { addLog } from '../engine/log';
import { checkAgendaVictory, findInstalledCorpCard, removeCard, revealInHand, turnKey } from '../engine/helpers';
import { noteRdPrivate, runnerSeesRd } from '../engine/rdKnowledge';
import { completeRez, rezForFree } from '../engine/actions/corp';
import { installCorpCardFrom } from '../engine/actions/install';
import { dealMeatDamage, dealNetDamage, giveTags, installedRunnerCards, trashInstalledRunnerCard, uninstallRunnerCard } from '../engine/damage';
import { endRun, endTheRun } from '../engine/runEnd';
import { iceSubroutines } from '../engine/ice';
import {
  addCounters,
  availableCredits,
  corpTrashFromHQ,
  counters,
  drawForEffect,
  flipIdentity,
  gainFromCard,
  installedIce,
  loseCredits,
  moveUpgrade,
  purgeVirusCounters,
  removeBadPublicity,
  removeCounters,
  removeTags,
  rezCost,
  spendCredits,
  swapIce,
  takeBadPublicity,
  trashInstalledCard,
  turnFlag,
  TurnFlag,
  upgradeAllowedIn,
  useOncePerTurn,
} from '../engine/cardEffects';
import { corpInstallCost } from '../engine/actions/install';
import { CardScript, EffectContext, Subroutine } from './types';
import { advanceableInstalled, askCards, askChoice, askCorpInstall, corpInstallOptions, installCorpChoice, takeFromRD } from './effects';

/** Corp cards from Vantage Point. */

const isSelf = (ctx: EffectContext, card: CardInstance) => card.instanceId === ctx.card.instanceId;
const type = (card: CardInstance) => cardDef(card).type_code;
const keywords = (card: CardInstance) => cardDef(card).keywords ?? '';
const title = (card: CardInstance) => cardDef(card).title;
const ids = (cards: CardInstance[]) => cards.map(c => c.instanceId);
const onceKey = (card: CardInstance, n = 0) => `once:${card.instanceId}:${n}`;
const archivesCards = (state: GameState) => [...state.corp.archives.faceUp, ...state.corp.archives.faceDown];
const serverOf = (state: GameState, card: CardInstance) => findInstalledCorpCard(state, card.instanceId)?.server;
const installedCorpCards = (state: GameState) => Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]);
const isCentral = (serverId: string) => serverId === 'hq' || serverId === 'rd' || serverId === 'archives';
/** A run is in progress against this card's server (not Detente's access outside a run). */
const runOnServerOf = (state: GameState, card: CardInstance) => {
  const run = state.activeRun;
  return !!run && !run.accessOnly && serverOf(state, card)?.id === run.server;
};

const endTheRunSub: Subroutine = { label: 'End the run.', resolve: ({ state }) => endTheRun(state) };

/** "When you score this agenda": the handler runs only for this agenda. */
const onScore = (fn: (ctx: EffectContext) => void) => (ctx: EffectContext, e: { card: CardInstance }) => isSelf(ctx, e.card) && fn(ctx);

/** Removes a card from whichever of R&D, HQ or Archives holds it. */
function takeFromCorpZone(state: GameState, card: CardInstance): void {
  const { rd, hq, archives } = state.corp;
  removeCard(rd, card) || removeCard(hq, card) || removeCard(archives.faceUp, card) || removeCard(archives.faceDown, card);
}

/** A subroutine "X unless the Runner pays N credits": the Runner chooses if they can pay. `step` names the answer. */
function unlessPays(ctx: EffectContext, amount: number, what: string, step: string, otherwise: () => void): void {
  if (availableCredits(ctx.state, 'runner') < amount) {
    otherwise();
    return;
  }
  askChoice(ctx, 'runner', `${title(ctx.card)}: pay ${amount} [credit], or ${what}?`, [
    { id: 'pay', label: `Pay ${amount} [credit]` },
    { id: 'no', label: what[0].toUpperCase() + what.slice(1) },
  ], step);
}

/** Answers an unlessPays() prompt: pays, or runs the consequence. */
function answerUnlessPays(state: GameState, amount: number, optionId: string, otherwise: () => void): void {
  if (optionId === 'pay' && availableCredits(state, 'runner') >= amount) spendCredits(state, 'runner', amount);
  else otherwise();
}

/**
 * Arranges cards on top of R&D in the order the Corp picks: one prompt per
 * position, top first (rules 8.3.3). The cards must already be the top
 * `ids.length` cards of R&D. The script's onPromptAnswer calls arrangeNext() for `step`.
 */
function arrangeTop(ctx: EffectContext, cardIds: string[], step: string, placed: string[] = []): void {
  const { state } = ctx;
  const left = cardIds.filter(id => !placed.includes(id));
  if (left.length <= 1) {
    const order = [...placed, ...left];
    const cards = order.flatMap(id => state.corp.rd.find(c => c.instanceId === id) ?? []);
    for (const card of cards) removeCard(state.corp.rd, card);
    state.corp.rd.unshift(...cards);
    // Arranged in secret: the Runner only knows the cards are among these (rules 8.3.3)
    noteRdPrivate(state, cards.length);
    if (cards.length > 1) addLog(state, 'corp', `Corp arranged the top ${cards.length} cards of R&D.`);
    return;
  }
  askCards(ctx, 'corp', `${title(ctx.card)}: choose the card to put ${placed.length === 0 ? 'on top of R&D' : `in position ${placed.length + 1}`}.`, left, 1, 1, step, {
    ids: cardIds,
    placed,
  });
}
const arrangeNext = (ctx: EffectContext, data: Record<string, unknown> | undefined, picked: string, step: string) =>
  arrangeTop(ctx, (data?.ids as string[]) ?? [], step, [...((data?.placed as string[]) ?? []), picked]);

// --- Identities -------------------------------------------------------------

// Méliès U: Only the Brightest. When your discard phase ends, secretly set your identity to
// any copy of Méliès U (rules 1.5.2b: each copy's back names HQ, R&D or Archives). When the
// Runner makes a successful run on a central server, flip this identity. When the Runner's
// action phase ends, gain 1 credit. Back side: when you flip this identity to this side during
// a run on its server, look at the top card of R&D. You may trash that card. If you do, add 1
// card from Archives to HQ. When the Runner's discard phase ends, flip this identity.
const MELIES_SERVERS = { hq: 'HQ', rd: 'R&D', archives: 'Archives' } as const;
const melies: CardScript = {
  triggers: {
    discard_phase_ends: (ctx, e) => {
      const { state } = ctx;
      if (e.side === 'runner') {
        if (state.corp.identity.flipped) flipIdentity(state, 'corp');
        return;
      }
      askChoice(ctx, 'corp', 'Méliès U: secretly set your identity to the copy for which server?', [
        { id: 'hq', label: 'HQ' },
        { id: 'rd', label: 'R&D' },
        { id: 'archives', label: 'Archives' },
      ], 'set');
    },
    successful_run: (ctx, e) => {
      const { state } = ctx;
      if (state.corp.identity.flipped || !isCentral(e.server)) return;
      flipIdentity(state, 'corp');
      const side = state.corp.meliesServer ?? 'hq';
      addLog(state, 'corp', `Méliès U was flipped: the ${MELIES_SERVERS[side]} side.`);
      if (side !== e.server || state.corp.rd.length === 0) return;
      const top = state.corp.rd[0];
      askChoice(ctx, 'corp', `Méliès U: the top card of R&D is ${title(top)}. Trash it to add 1 card from Archives to HQ?`, [
        { id: 'trash', label: `Trash ${title(top)}` },
        { id: 'no', label: 'Leave it' },
      ], 'top');
    },
    action_phase_ends: (ctx, e) => {
      if (e.side !== 'runner' || ctx.state.corp.identity.flipped) return;
      gainFromCard(ctx.state, 'corp', 1, ctx.card);
      addLog(ctx.state, 'corp', 'Corp gained 1 [credit] (Méliès U).');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'set' && answer.kind === 'effect_choice') {
      state.corp.meliesServer = answer.optionId as 'hq' | 'rd' | 'archives';
      state.corp.identity.flipped = false;
      addLog(state, 'corp', 'Corp secretly set their identity (Méliès U).');
    } else if (source.step === 'top' && answer.kind === 'effect_choice' && answer.optionId === 'trash') {
      const top = state.corp.rd.shift();
      if (!top) return;
      state.corp.archives.faceDown.push(top);
      addLog(state, 'corp', 'Corp trashed the top card of R&D (Méliès U).');
      askCards(ctx, 'corp', 'Méliès U: add 1 card from Archives to HQ.', ids(archivesCards(state)), 1, 1, 'archives');
    } else if (source.step === 'archives' && answer.kind === 'effect_cards') {
      const card = archivesCards(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!card) return;
      const faceUp = state.corp.archives.faceUp.includes(card);
      takeFromCorpZone(state, card);
      state.corp.hq.push(card);
      if (faceUp) revealInHand(state, 'corp', [card]);
      addLog(state, 'corp', `Corp added ${faceUp ? title(card) : 'a facedown card'} from Archives to HQ (Méliès U).`);
    }
  },
};

// Editorial Division: Ad Nihilum. The first time each turn you take bad publicity, you may
// search R&D for 1 non-agenda black ops, gray ops, or liability card and reveal it. Add it to HQ.
const editorialTargets = (state: GameState) =>
  state.corp.rd.filter(c => type(c) !== 'agenda' && /\b(black ops|gray ops|liability)\b/i.test(keywords(c)));
const editorial: CardScript = {
  triggers: {
    bad_publicity_taken: ctx => {
      if (!useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
      askCards(ctx, 'corp', 'Editorial Division: you may search R&D for 1 black ops, gray ops or liability card.', ids(editorialTargets(ctx.state)), 0, 1, 'search');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    const card = answer.cardInstanceIds.length > 0 ? takeFromRD(state, answer.cardInstanceIds[0]) : undefined;
    if (!card) {
      shuffleRD(state);
      return;
    }
    state.corp.hq.push(card);
    revealInHand(state, 'corp', [card]);
  },
};

// --- Agendas ----------------------------------------------------------------

// Méliès City Luxury Line: As an additional cost to steal this agenda, the Runner must spend
// click. When you score this agenda, gain click.
const meliesCity: CardScript = {
  stealCost: (_state, self, agenda) => (self.instanceId === agenda.instanceId ? { clicks: 1 } : null),
  triggers: {
    agenda_scored: onScore(({ state }) => {
      state.corp.clicks += 1;
      addLog(state, 'corp', 'Corp gained [click] (Méliès City Luxury Line).');
    }),
  },
};

// Lotus Haze: When you score this agenda, place 3 agenda counters on it. Hosted agenda
// counter: Move 1 rezzed upgrade to the root of another server.
const movableUpgrades = (state: GameState) =>
  installedCorpCards(state).filter(
    c => type(c) === 'upgrade' && c.isRezzed && Object.keys(state.corp.servers).some(id => id !== serverOf(state, c)?.id && upgradeAllowedIn(state, c, id))
  );
const lotusHaze: CardScript = {
  triggers: {
    agenda_scored: onScore(ctx => addCounters(ctx.card, 'agenda', 3)),
  },
  abilities: [
    {
      label: 'Move 1 rezzed upgrade to the root of another server.',
      counters: { type: 'agenda', count: 1 },
      canUse: ({ state }) => (movableUpgrades(state).length > 0 ? null : 'No rezzed upgrade can move'),
      resolve: ctx => askCards(ctx, 'corp', 'Lotus Haze: move which rezzed upgrade?', ids(movableUpgrades(ctx.state)), 1, 1, 'upgrade'),
    },
  ],
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'upgrade' && answer.kind === 'effect_cards') {
      const upgrade = movableUpgrades(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!upgrade) return;
      const from = serverOf(state, upgrade)?.id;
      const options = Object.values(state.corp.servers)
        .filter(s => s.id !== from && upgradeAllowedIn(state, upgrade, s.id))
        .map(s => ({ id: s.id, label: s.name }));
      askChoice(ctx, 'corp', `Lotus Haze: move ${title(upgrade)} to which server?`, options, 'server', { cardId: upgrade.instanceId });
    } else if (source.step === 'server' && answer.kind === 'effect_choice') {
      const upgrade = findInstalledCorpCard(state, String(source.data?.cardId))?.card;
      if (upgrade) moveUpgrade(state, upgrade, answer.optionId);
    }
  },
};

// Witch Hunt (Initiative - Liability): When this agenda is scored or stolen, take 1 bad
// publicity. When your action phase ends, if you scored this agenda this turn, remove all
// tags, then give the Runner 3 tags.
const witchHunt: CardScript = {
  triggers: {
    agenda_scored: onScore(({ state }) => takeBadPublicity(state, 1)),
    agenda_stolen: (ctx, e) => isSelf(ctx, e.card) && takeBadPublicity(ctx.state, 1),
    action_phase_ends: (ctx, e) => {
      const { state, card } = ctx;
      if (e.side !== 'corp' || card.scoredTurn !== turnKey(state) || !state.corp.scoreArea.includes(card)) return;
      removeTags(state, state.runner.tags);
      giveTags(state, 3);
      addLog(state, 'corp', 'Witch Hunt: the Runner\'s tags were removed and they took 3 tags.');
    },
  },
};

// Sacrifice Zone Expansion (Public - Expansion): Install only faceup. The first time each turn
// you advance this agenda, gain 3 credits. Once per turn -> When the Runner makes a successful
// run on another server, you may remove 1 hosted advancement counter to do 1 meat damage.
const sacrificeZone: CardScript = {
  installFaceUpOnly: true,
  triggers: {
    advanced: (ctx, e) => {
      if (!isSelf(ctx, e.card) || !useOncePerTurn(ctx.state, onceKey(ctx.card, 0))) return;
      gainFromCard(ctx.state, 'corp', 3, ctx.card);
      addLog(ctx.state, 'corp', 'Corp gained 3 [credit] (Sacrifice Zone Expansion).');
    },
    successful_run: (ctx, e) => {
      const { state, card } = ctx;
      if (card.advancementCounters === 0 || serverOf(state, card)?.id === e.server || turnFlag(state, onceKey(card, 1)) > 0) return;
      askChoice(ctx, 'corp', 'Sacrifice Zone Expansion: remove 1 advancement counter to do 1 meat damage?', [
        { id: 'yes', label: 'Remove 1 counter: 1 meat damage' },
        { id: 'no', label: 'No' },
      ], 'meat');
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId !== 'yes' || card.advancementCounters === 0) return;
    useOncePerTurn(state, onceKey(card, 1));
    card.advancementCounters -= 1;
    dealMeatDamage(state, 1);
  },
};

// Let Them Dream: When you score this agenda, you may search HQ, R&D, or Archives for 1 agenda
// and reveal it. Add that agenda to HQ or the bottom of R&D. While this agenda is in the
// Runner's score area, it is worth 1 less agenda point (see stealAgenda).
const LTD_ZONES = { hq: 'HQ', rd: 'R&D', archives: 'Archives' } as const;
const ltdZone = (state: GameState, zone: string) =>
  zone === 'hq' ? state.corp.hq : zone === 'rd' ? state.corp.rd : archivesCards(state);
const letThemDream: CardScript = {
  triggers: {
    agenda_scored: onScore(ctx =>
      askChoice(ctx, 'corp', 'Let Them Dream: you may search HQ, R&D or Archives for 1 agenda.', [
        ...Object.entries(LTD_ZONES).map(([id, label]) => ({ id, label: `Search ${label}` })),
        { id: 'no', label: 'No' },
      ], 'zone')
    ),
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'zone' && answer.kind === 'effect_choice' && answer.optionId !== 'no') {
      const agendas = ltdZone(state, answer.optionId).filter(c => type(c) === 'agenda');
      if (agendas.length === 0) {
        if (answer.optionId === 'rd') shuffleRD(state);
        return;
      }
      askCards(ctx, 'corp', 'Let Them Dream: choose 1 agenda.', ids(agendas), 1, 1, 'agenda', { zone: answer.optionId });
    } else if (source.step === 'agenda' && answer.kind === 'effect_cards') {
      const card = ltdZone(state, String(source.data?.zone)).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!card) return;
      takeFromCorpZone(state, card);
      if (source.data?.zone === 'rd') shuffleRD(state);
      addLog(state, 'corp', `Corp revealed ${title(card)} (Let Them Dream).`);
      state.corp.hq.push(card);
      askChoice(ctx, 'corp', `Let Them Dream: add ${title(card)} to HQ or the bottom of R&D?`, [
        { id: 'hq', label: 'Add it to HQ' },
        { id: 'bottom', label: 'Bottom of R&D' },
      ], 'where', { cardId: card.instanceId });
    } else if (source.step === 'where' && answer.kind === 'effect_choice') {
      const card = state.corp.hq.find(c => c.instanceId === source.data?.cardId);
      if (!card) return;
      if (answer.optionId === 'bottom') {
        removeCard(state.corp.hq, card);
        state.corp.rd.push(card);
        runnerSeesRd(state, card); // revealed, then put on the bottom
      } else {
        revealInHand(state, 'corp', [card]);
      }
    }
  },
};

// --- Assets -----------------------------------------------------------------

// Synchrocyclotron (Facility): The first double operation you play each turn costs click less to play.
const synchrocyclotron: CardScript = {
  modifiers: {
    playClickDiscount: (state, _self, playing) =>
      type(playing) === 'operation' && /\bdouble\b/i.test(keywords(playing)) && turnFlag(state, TurnFlag.doublesPlayed) === 0 ? 1 : 0,
  },
};

// Esca (Ambush): While the Runner is accessing this asset in R&D, they must reveal it. When
// the Runner accesses this asset, they lose 1 credit. If they are tagged, do 1 net damage.
const esca: CardScript = {
  revealedOnRdAccess: true,
  onAccessed: ({ state }) => {
    const lost = loseCredits(state, 'runner', 1);
    addLog(state, 'corp', `Esca: the Runner lost ${lost} [credit].`);
    if (state.runner.tags > 0) dealNetDamage(state, 1);
  },
};

// Magistrate Revontulet (Executive): As an additional cost to steal an agenda, the Runner must
// pay 3 credits. Whenever you score an agenda, the Runner loses 3 credits.
const magistrate: CardScript = {
  stealCost: () => ({ credits: 3 }),
  triggers: {
    agenda_scored: ({ state }) => {
      const lost = loseCredits(state, 'runner', 3);
      addLog(state, 'corp', `The Runner lost ${lost} [credit] (Magistrate Revontulet).`);
    },
  },
};

// Nihilo Agent (Enforcer - Liability): When you rez this asset, load 3 power counters onto it.
// When it is empty, trash it. When your turn begins, remove 1 tag and 1 bad publicity. When
// your discard phase ends, give the Runner 1 tag, take 1 bad publicity, and remove 1 hosted power counter.
const nihiloAgent: CardScript = {
  triggers: {
    rezzed: (ctx, e) => isSelf(ctx, e.card) && addCounters(ctx.card, 'power', 3),
    turn_begins: ({ state }, e) => {
      if (e.side !== 'corp') return;
      const tags = removeTags(state, 1);
      const bp = removeBadPublicity(state, 1);
      addLog(state, 'corp', `Nihilo Agent removed ${tags} tag(s) and ${bp} bad publicity.`);
    },
    discard_phase_ends: (ctx, e) => {
      const { state, card } = ctx;
      if (e.side !== 'corp') return;
      giveTags(state, 1);
      takeBadPublicity(state, 1);
      removeCounters(card, 'power', 1);
      if (counters(card, 'power') === 0) {
        trashInstalledCard(state, card);
        addLog(state, 'corp', 'Nihilo Agent is empty and was trashed.');
      }
    },
  },
};

// Luana Campos (Executive - Liability): When your turn begins, you may host 1 of your bad
// publicity counters on this asset. If you do, gain 3 credits and draw 1 card.
// Interrupt -> When this asset would be uninstalled, take all hosted bad publicity.
const HOSTED_BP = 'badPublicity';
const luana: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side !== 'corp' || ctx.state.corp.badPublicity === 0) return;
      askChoice(ctx, 'corp', 'Luana Campos: host 1 bad publicity on it to gain 3 credits and draw 1 card?', [
        { id: 'host', label: 'Host 1 bad publicity: gain 3, draw 1' },
        { id: 'no', label: 'No' },
      ], 'host');
    },
  },
  onUninstall: ({ state, card }) => {
    const hosted = card.tokens[HOSTED_BP] ?? 0;
    card.tokens[HOSTED_BP] = 0;
    takeBadPublicity(state, hosted);
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId !== 'host' || state.corp.badPublicity === 0) return;
    state.corp.badPublicity -= 1;
    card.tokens[HOSTED_BP] = (card.tokens[HOSTED_BP] ?? 0) + 1;
    gainFromCard(state, 'corp', 3, card);
    drawForEffect(state, 'corp', 1, 'Luana Campos');
    addLog(state, 'corp', 'Corp hosted 1 bad publicity on Luana Campos and gained 3 [credit].');
  },
};

// --- Ice --------------------------------------------------------------------

// Ansel 2.0 (Sentry - Bioroid - Destroyer): Lose click click: Break up to 2 subroutines on this
// ice. Only the Runner can use this ability. Subroutines: Trash 1 installed Runner card.
// Remove 1 card in the heap from the game. You may install 1 card from HQ or Archives. End the run.
const anselInstallable = (state: GameState) =>
  [...state.corp.hq, ...archivesCards(state)].filter(c => type(c) !== 'operation' && corpInstallOptions(state, c).length > 0);
const ansel2: CardScript = {
  ice: {
    clickBreak: { clicks: 2, max: 2 },
    subroutines: [
      {
        label: 'Trash 1 installed Runner card.',
        resolve: ctx => {
          const cards = installedRunnerCards(ctx.state);
          if (cards.length > 0) askCards(ctx, 'corp', 'Ansel 2.0: trash 1 installed Runner card.', ids(cards), 1, 1, 'trash');
        },
      },
      {
        label: 'Remove 1 card in the heap from the game.',
        resolve: ctx => {
          const heap = ctx.state.runner.heap;
          if (heap.length > 0) askCards(ctx, 'corp', 'Ansel 2.0: remove 1 card in the heap from the game.', ids(heap), 1, 1, 'heap');
        },
      },
      {
        label: 'You may install 1 card from HQ or Archives.',
        resolve: ctx => {
          const cards = anselInstallable(ctx.state);
          if (cards.length > 0) askCards(ctx, 'corp', 'Ansel 2.0: you may install 1 card from HQ or Archives.', ids(cards), 0, 1, 'install');
        },
      },
      endTheRunSub,
    ],
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'trash' && answer.kind === 'effect_cards') {
      const card = installedRunnerCards(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!card) return;
      trashInstalledRunnerCard(state, card);
      addLog(state, 'corp', `Corp trashed ${title(card)} (Ansel 2.0).`);
    } else if (source.step === 'heap' && answer.kind === 'effect_cards') {
      const card = state.runner.heap.find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!card) return;
      removeCard(state.runner.heap, card);
      state.removedFromGame.push(card);
      addLog(state, 'corp', `Corp removed ${title(card)} in the heap from the game (Ansel 2.0).`);
    } else if (source.step === 'install' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      askCorpInstall(ctx, answer.cardInstanceIds[0], 'server');
    } else if (source.step === 'server') {
      installCorpChoice(state, source, answer);
    }
  },
};

// Reverb (Barrier - Harmonic): The rez cost of this ice is lowered by 1 credit for each other
// unrezzed piece of ice. Subroutines: End the run. End the run.
const otherUnrezzedIce = (state: GameState, self: CardInstance) => installedIce(state).filter(c => !c.isRezzed && c.instanceId !== self.instanceId).length;
const reverb: CardScript = {
  ownRezCostModifier: (state, self) => -otherUnrezzedIce(state, self),
  liveValue: (state, self) => `Rez cost now ${Math.max(0, 4 - otherUnrezzedIce(state, self))}[credit]`,
  ice: { subroutines: [endTheRunSub, endTheRunSub] },
};

// Sleipnir (Code Gate): Subroutines: You may draw 1 card. You may shuffle 1 card from HQ or
// Archives into R&D. End the run.
const sleipnir: CardScript = {
  ice: {
    subroutines: [
      {
        label: 'You may draw 1 card.',
        resolve: ctx =>
          askChoice(ctx, 'corp', 'Sleipnir: draw 1 card?', [
            { id: 'draw', label: 'Draw 1 card' },
            { id: 'no', label: 'No' },
          ], 'draw'),
      },
      {
        label: 'You may shuffle 1 card from HQ or Archives into R&D.',
        resolve: ctx => {
          const cards = [...ctx.state.corp.hq, ...archivesCards(ctx.state)];
          if (cards.length > 0) askCards(ctx, 'corp', 'Sleipnir: you may shuffle 1 card from HQ or Archives into R&D.', ids(cards), 0, 1, 'shuffle');
        },
      },
      endTheRunSub,
    ],
  },
  onPromptAnswer: ({ state }, source, answer) => {
    if (source.step === 'draw' && answer.kind === 'effect_choice' && answer.optionId === 'draw') {
      drawForEffect(state, 'corp', 1, 'Sleipnir');
    } else if (source.step === 'shuffle' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      const card = [...state.corp.hq, ...archivesCards(state)].find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!card) return;
      const visible = state.corp.archives.faceUp.includes(card);
      takeFromCorpZone(state, card);
      state.corp.rd.push(card);
      shuffleRD(state);
      addLog(state, 'corp', `Corp shuffled ${visible ? title(card) : 'a card'} into R&D (Sleipnir).`);
    }
  },
};

// Vertigo (Code Gate): When the Runner passes this ice, if they have no click remaining, they
// cannot steal or trash Corp cards for the remainder of this run. Subroutine: The Runner loses click.
const vertigo: CardScript = {
  ice: {
    onPass: ({ state }) => {
      if (!state.activeRun || state.runner.clicks > 0) return;
      state.activeRun.cannotStealOrTrash = true;
      addLog(state, 'corp', 'Vertigo: the Runner cannot steal or trash Corp cards this run.');
    },
    subroutines: [
      {
        label: 'The Runner loses [click].',
        resolve: ({ state }) => {
          if (state.runner.clicks > 0) state.runner.clicks -= 1;
        },
      },
    ],
  },
};

// ezaM (Code Gate): click: Swap this ice with another installed piece of ice. Subroutines: Look
// at the top card of R&D. You may add that card to the bottom of R&D. Each piece of ice gets +1
// strength for the remainder of this run.
const ezam: CardScript = {
  abilities: [
    {
      label: 'Swap this ice with another installed piece of ice.',
      clicks: 1,
      canUse: ({ state, card }) => (installedIce(state).some(c => c.instanceId !== card.instanceId) ? null : 'No other installed ice'),
      resolve: ctx =>
        askCards(ctx, 'corp', 'ezaM: swap it with which piece of ice?', ids(installedIce(ctx.state).filter(c => c.instanceId !== ctx.card.instanceId)), 1, 1, 'swap'),
    },
  ],
  ice: {
    subroutines: [
      {
        label: 'Look at the top card of R&D. You may add that card to the bottom of R&D.',
        resolve: ctx => {
          const top = ctx.state.corp.rd[0];
          if (!top) return;
          askChoice(ctx, 'corp', `ezaM: the top card of R&D is ${title(top)}. Add it to the bottom of R&D?`, [
            { id: 'bottom', label: 'Bottom of R&D' },
            { id: 'leave', label: 'Leave it on top' },
          ], 'top');
        },
      },
      {
        label: 'Each piece of ice gets +1 strength for the remainder of this run.',
        resolve: ({ state }) => {
          if (state.activeRun) state.activeRun.iceStrengthBonus = (state.activeRun.iceStrengthBonus ?? 0) + 1;
        },
      },
    ],
  },
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (source.step === 'swap' && answer.kind === 'effect_cards') {
      swapIce(state, card.instanceId, answer.cardInstanceIds[0]);
    } else if (source.step === 'top' && answer.kind === 'effect_choice' && answer.optionId === 'bottom') {
      const top = state.corp.rd.shift();
      if (top) state.corp.rd.push(top);
      addLog(state, 'corp', 'Corp added the top card of R&D to the bottom (ezaM).');
    }
  },
};

// Knowledge Seeker (Code Gate): Whenever an encounter with this ice ends, if it has 3 or more
// hosted virus counters, purge virus counters and derez this ice. Subroutines: Place 1 virus
// counter on this ice. Look at the top 4 cards of R&D and arrange them in any order. End the run.
const knowledgeSeeker: CardScript = {
  ice: {
    onEncounterEnds: ({ state, card }) => {
      if (counters(card, 'virus') < 3 || !card.isRezzed) return;
      const purged = purgeVirusCounters(state);
      card.isRezzed = false;
      addLog(state, 'corp', `Knowledge Seeker purged ${purged} virus counter(s) and was derezzed.`);
    },
    subroutines: [
      { label: 'Place 1 virus counter on this ice.', resolve: ({ card }) => addCounters(card, 'virus', 1) },
      {
        label: 'Look at the top 4 cards of R&D and arrange them in any order.',
        resolve: ctx => arrangeTop(ctx, ids(ctx.state.corp.rd.slice(0, 4)), 'arrange'),
      },
      endTheRunSub,
    ],
  },
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'arrange' && answer.kind === 'effect_cards') arrangeNext(ctx, source.data, answer.cardInstanceIds[0], 'arrange');
  },
};

// Lionsmane (Sentry - AP): Subroutines: Do 2 net damage. Do 2 net damage unless the Runner pays
// 3 credits. Do 2 net damage unless the Runner jacks out.
const lionsmane: CardScript = {
  ice: {
    subroutines: [
      { label: 'Do 2 net damage.', resolve: ({ state }) => void dealNetDamage(state, 2) },
      {
        label: 'Do 2 net damage unless the Runner pays 3 [credit].',
        resolve: ctx => unlessPays(ctx, 3, 'take 2 net damage', 'pay', () => dealNetDamage(ctx.state, 2)),
      },
      {
        label: 'Do 2 net damage unless the Runner jacks out.',
        resolve: ctx =>
          askChoice(ctx, 'runner', 'Lionsmane: jack out, or take 2 net damage?', [
            { id: 'jack', label: 'Jack out' },
            { id: 'damage', label: 'Take 2 net damage' },
          ], 'jack'),
      },
    ],
  },
  onPromptAnswer: ({ state }, source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (source.step === 'pay') {
      answerUnlessPays(state, 3, answer.optionId, () => dealNetDamage(state, 2));
    } else if (source.step === 'jack') {
      if (answer.optionId === 'jack' && state.activeRun) {
        state.activeRun.isJackedOut = true;
        addLog(state, 'runner', 'Runner jacked out.');
        endRun(state);
      } else {
        dealNetDamage(state, 2);
      }
    }
  },
};

// Vicsek (Trap - AP - Observer): Subroutines: Do X net damage and give the Runner X tags. X is
// equal to the number of tags the Runner has. Give the Runner 1 tag. Trash this ice.
const vicsek: CardScript = {
  liveValue: state => `X = ${state.runner.tags}`,
  ice: {
    subroutines: [
      {
        label: 'Do X net damage and give the Runner X tags (X = the Runner\'s tags).',
        resolve: ({ state }) => {
          const x = state.runner.tags;
          if (x === 0) return;
          dealNetDamage(state, x);
          if (!state.winner) giveTags(state, x);
        },
      },
      {
        label: 'Give the Runner 1 tag. Trash this ice.',
        resolve: ({ state, card }) => {
          giveTags(state, 1);
          if (findInstalledCorpCard(state, card.instanceId)) {
            trashInstalledCard(state, card);
            addLog(state, 'corp', 'Vicsek was trashed.');
          }
        },
      },
    ],
  },
};

// Grubber (Barrier - Liability): When you rez this ice, if it is protecting a central server,
// take 1 bad publicity. Subroutines: End the run unless the Runner pays 3 credits (twice).
const grubberSub = (i: number): Subroutine => ({
  label: 'End the run unless the Runner pays 3 [credit].',
  resolve: ctx => unlessPays(ctx, 3, 'end the run', `pay${i}`, () => endTheRun(ctx.state)),
});
const grubber: CardScript = {
  triggers: {
    rezzed: (ctx, e) => {
      if (!isSelf(ctx, e.card)) return;
      const server = serverOf(ctx.state, ctx.card);
      if (server && isCentral(server.id)) takeBadPublicity(ctx.state, 1);
    },
  },
  ice: { subroutines: [grubberSub(0), grubberSub(1)] },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind === 'effect_choice') answerUnlessPays(state, 3, answer.optionId, () => endTheRun(state));
  },
};

// Lethe (Sentry - Observer): Whenever the Runner bypasses or fully breaks this ice, give them
// 1 tag. Subroutines: You may add 1 card from Archives to the top or bottom of R&D. Add 1
// installed Runner card to the grip.
const lethe: CardScript = {
  triggers: {
    ice_fully_broken: (ctx, e) => isSelf(ctx, e.ice) && giveTags(ctx.state, 1),
  },
  ice: {
    onBypassed: ({ state }) => giveTags(state, 1),
    subroutines: [
      {
        label: 'You may add 1 card from Archives to the top or bottom of R&D.',
        resolve: ctx => {
          const cards = archivesCards(ctx.state);
          if (cards.length > 0) askCards(ctx, 'corp', 'Lethe: you may add 1 card from Archives to R&D.', ids(cards), 0, 1, 'archives');
        },
      },
      {
        label: 'Add 1 installed Runner card to the grip.',
        resolve: ctx => {
          const cards = installedRunnerCards(ctx.state);
          if (cards.length > 0) askCards(ctx, 'corp', 'Lethe: add 1 installed Runner card to the grip.', ids(cards), 1, 1, 'grip');
        },
      },
    ],
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'archives' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      askChoice(ctx, 'corp', 'Lethe: top or bottom of R&D?', [
        { id: 'top', label: 'Top of R&D' },
        { id: 'bottom', label: 'Bottom of R&D' },
      ], 'where', { cardId: answer.cardInstanceIds[0] });
    } else if (source.step === 'where' && answer.kind === 'effect_choice') {
      const card = archivesCards(state).find(c => c.instanceId === source.data?.cardId);
      if (!card) return;
      const visible = state.corp.archives.faceUp.includes(card);
      takeFromCorpZone(state, card);
      if (answer.optionId === 'top') state.corp.rd.unshift(card);
      else state.corp.rd.push(card);
      addLog(state, 'corp', `Corp added ${visible ? title(card) : 'a card'} from Archives to the ${answer.optionId} of R&D (Lethe).`);
    } else if (source.step === 'grip' && answer.kind === 'effect_cards') {
      const card = installedRunnerCards(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!card) return;
      uninstallRunnerCard(state, card, 'grip');
      addLog(state, 'corp', `${title(card)} was added to the grip (Lethe).`);
    }
  },
};

// Paywall (Barrier): When the Runner encounters this ice, they lose 1 credit. Subroutine: End
// the run unless the Runner pays 1 credit.
const paywall: CardScript = {
  ice: {
    onEncounter: ({ state }) => {
      const lost = loseCredits(state, 'runner', 1);
      if (lost > 0) addLog(state, 'corp', 'Paywall: the Runner lost 1 [credit].');
    },
    subroutines: [
      {
        label: 'End the run unless the Runner pays 1 [credit].',
        resolve: ctx => unlessPays(ctx, 1, 'end the run', 'pay', () => endTheRun(ctx.state)),
      },
    ],
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind === 'effect_choice') answerUnlessPays(state, 1, answer.optionId, () => endTheRun(state));
  },
};

// Event Horizon (Sentry - Destroyer): trash: End the run. Use this ability only during a run
// against this server. Subroutines: Trash 1 installed program unless the Runner pays 3
// credits. End the run unless the Runner pays 3 credits.
const eventHorizon: CardScript = {
  abilities: [
    {
      label: 'End the run.',
      trashSelf: true,
      canUse: ({ state, card }) => (runOnServerOf(state, card) ? null : 'Only during a run against this server'),
      resolve: ({ state }) => endTheRun(state),
    },
  ],
  ice: {
    subroutines: [
      {
        label: 'Trash 1 installed program unless the Runner pays 3 [credit].',
        resolve: ctx => {
          if (ctx.state.runner.rig.programs.length === 0) return;
          unlessPays(ctx, 3, 'the Corp trashes 1 program', 'program', () => askProgramTrash(ctx));
        },
      },
      {
        label: 'End the run unless the Runner pays 3 [credit].',
        resolve: ctx => unlessPays(ctx, 3, 'end the run', 'etr', () => endTheRun(ctx.state)),
      },
    ],
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'program' && answer.kind === 'effect_choice') {
      answerUnlessPays(state, 3, answer.optionId, () => askProgramTrash(ctx));
    } else if (source.step === 'etr' && answer.kind === 'effect_choice') {
      answerUnlessPays(state, 3, answer.optionId, () => endTheRun(state));
    } else if (source.step === 'trash' && answer.kind === 'effect_cards') {
      const program = state.runner.rig.programs.find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!program) return;
      trashInstalledRunnerCard(state, program);
      addLog(state, 'corp', `Corp trashed ${title(program)} (Event Horizon).`);
    }
  },
};
function askProgramTrash(ctx: EffectContext): void {
  const programs = ctx.state.runner.rig.programs;
  if (programs.length > 0) askCards(ctx, 'corp', `${title(ctx.card)}: trash 1 installed program.`, ids(programs), 1, 1, 'trash');
}

// Flywheel (Sentry): Subroutines (twice): Gain 1 credit. You may draw 1 card.
const flywheelSub: Subroutine = {
  label: 'Gain 1 [credit]. You may draw 1 card.',
  resolve: ctx => {
    gainFromCard(ctx.state, 'corp', 1, ctx.card);
    askChoice(ctx, 'corp', 'Flywheel: draw 1 card?', [
      { id: 'draw', label: 'Draw 1 card' },
      { id: 'no', label: 'No' },
    ], 'draw');
  },
};
const flywheel: CardScript = {
  ice: { subroutines: [flywheelSub, flywheelSub] },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind === 'effect_choice' && answer.optionId === 'draw') drawForEffect(state, 'corp', 1, 'Flywheel');
  },
};

// Tocsin (Code Gate - Expendable): click, 1 credit, reveal and trash this ice from HQ: Search
// R&D for up to 1 barrier and up to 1 sentry and reveal them. Add those cards to HQ.
// Subroutines: The Runner loses 2 credits. End the run. End the run.
const iceOfType = (state: GameState, subtype: string) =>
  state.corp.rd.filter(c => type(c) === 'ice' && new RegExp(`\\b${subtype}\\b`, 'i').test(keywords(c)));
const tocsin: CardScript = {
  abilities: [
    {
      label: 'Reveal and trash this ice from HQ: search R&D for up to 1 barrier and up to 1 sentry.',
      fromHQ: true,
      clicks: 1,
      credits: 1,
      resolve: ctx => {
        const { state, card } = ctx;
        corpTrashFromHQ(state, [card.instanceId], true);
        addLog(state, 'corp', 'Corp revealed and trashed Tocsin from HQ.');
        askCards(ctx, 'corp', 'Tocsin: search R&D for up to 1 barrier.', ids(iceOfType(state, 'barrier')), 0, 1, 'barrier');
      },
    },
  ],
  ice: {
    subroutines: [
      {
        label: 'The Runner loses 2 [credit].',
        resolve: ({ state }) => {
          const lost = loseCredits(state, 'runner', 2);
          addLog(state, 'corp', `The Runner lost ${lost} [credit] (Tocsin).`);
        },
      },
      endTheRunSub,
      endTheRunSub,
    ],
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (answer.kind !== 'effect_cards') return;
    for (const id of answer.cardInstanceIds) {
      const found = state.corp.rd.find(c => c.instanceId === id);
      if (!found) continue;
      removeCard(state.corp.rd, found);
      state.corp.hq.push(found);
      revealInHand(state, 'corp', [found]);
      addLog(state, 'corp', `Corp revealed ${title(found)} and added it to HQ (Tocsin).`);
    }
    if (source.step === 'barrier') {
      askCards(ctx, 'corp', 'Tocsin: search R&D for up to 1 sentry.', ids(iceOfType(state, 'sentry')), 0, 1, 'sentry');
    } else {
      shuffleRD(state);
    }
  },
};

// --- Operations -------------------------------------------------------------

// Caveat Emptor (Transaction): Resolve 1 of the following: Gain 6 credits. The Runner gets -1
// allotted click for their next turn. / Gain 10 credits. The Runner gets +1 allotted click for their next turn.
const caveatEmptor: CardScript = {
  onPlay: ctx =>
    askChoice(ctx, 'corp', 'Caveat Emptor: choose one.', [
      { id: 'six', label: 'Gain 6 [credit]; the Runner gets -1 [click] next turn' },
      { id: 'ten', label: 'Gain 10 [credit]; the Runner gets +1 [click] next turn' },
    ], 'mode'),
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    const six = answer.optionId === 'six';
    gainFromCard(state, 'corp', six ? 6 : 10, card);
    state.runner.bonusClicksNextTurn = (state.runner.bonusClicksNextTurn ?? 0) + (six ? -1 : 1);
    addLog(state, 'corp', `Corp gained ${six ? 6 : 10} [credit]; the Runner gets ${six ? '-1' : '+1'} [click] next turn (Caveat Emptor).`);
  },
};

// realloc() (Double): As an additional cost to play this operation, spend click. Choose 2
// rezzed pieces of ice. For each chosen piece of ice, gain credits equal to its printed rez
// cost, then derez it.
const rezzedIce = (state: GameState) => installedIce(state).filter(c => c.isRezzed);
const realloc: CardScript = {
  extraClicks: 1,
  canPlay: ({ state }) => (rezzedIce(state).length > 0 ? null : 'No rezzed ice'),
  liveValue: state => {
    const best = rezzedIce(state).map(c => cardDef(c).cost ?? 0).sort((a, b) => b - a);
    return `Up to ${(best[0] ?? 0) + (best[1] ?? 0)}[credit] now`;
  },
  onPlay: ctx => {
    const ice = rezzedIce(ctx.state);
    const n = Math.min(2, ice.length);
    askCards(ctx, 'corp', 'realloc(): choose 2 rezzed pieces of ice to derez for their printed rez cost.', ids(ice), n, n, 'ice');
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    for (const id of answer.cardInstanceIds) {
      const ice = rezzedIce(state).find(c => c.instanceId === id);
      if (!ice) continue;
      gainFromCard(state, 'corp', cardDef(ice).cost ?? 0, card);
      ice.isRezzed = false;
      addLog(state, 'corp', `Corp gained ${cardDef(ice).cost ?? 0} [credit] and derezzed ${title(ice)} (realloc()).`);
    }
  },
};

// Retirement Plan (Double): As an additional cost to play this operation, spend click. Install
// 1 agenda, asset, or piece of ice from Archives.
const retirementTargets = (state: GameState) =>
  archivesCards(state).filter(c => ['agenda', 'asset', 'ice'].includes(type(c)) && corpInstallOptions(state, c).length > 0);
const retirementPlan: CardScript = {
  extraClicks: 1,
  canPlay: ({ state }) => (retirementTargets(state).length > 0 ? null : 'No agenda, asset or ice in Archives to install'),
  onPlay: ctx => askCards(ctx, 'corp', 'Retirement Plan: install 1 agenda, asset or piece of ice from Archives.', ids(retirementTargets(ctx.state)), 1, 1, 'pick'),
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'pick' && answer.kind === 'effect_cards') askCorpInstall(ctx, answer.cardInstanceIds[0], 'server');
    else if (source.step === 'server') installCorpChoice(ctx.state, source, answer);
  },
};

// Cultivate: Look at the top 5 cards of R&D. Trash 1 of those cards, add 1 of them to HQ, and
// arrange the rest in any order.
const cultivate: CardScript = {
  canPlay: ({ state }) => (state.corp.rd.length > 0 ? null : 'R&D is empty'),
  onPlay: ctx => askCards(ctx, 'corp', 'Cultivate: trash 1 of the top 5 cards of R&D.', ids(ctx.state.corp.rd.slice(0, 5)), 1, 1, 'trash', { ids: ids(ctx.state.corp.rd.slice(0, 5)) }),
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (answer.kind !== 'effect_cards') return;
    const set = (source.data?.ids as string[]) ?? [];
    if (source.step === 'trash') {
      const card = state.corp.rd.find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (card) {
        removeCard(state.corp.rd, card);
        state.corp.archives.faceDown.push(card);
        noteRdPrivate(state, set.length); // which of them is not declared (rules 8.3.3b)
      }
      const rest = set.filter(id => id !== answer.cardInstanceIds[0] && state.corp.rd.some(c => c.instanceId === id));
      if (rest.length === 0) return;
      askCards(ctx, 'corp', 'Cultivate: add 1 of the cards to HQ.', rest, 1, 1, 'hq', { ids: rest });
    } else if (source.step === 'hq') {
      const card = state.corp.rd.find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (card) {
        removeCard(state.corp.rd, card);
        state.corp.hq.push(card);
        noteRdPrivate(state, set.length);
      }
      addLog(state, 'corp', 'Corp trashed 1 card and added 1 card to HQ (Cultivate).');
      arrangeTop(ctx, set.filter(id => id !== answer.cardInstanceIds[0]), 'arrange');
    } else if (source.step === 'arrange') {
      arrangeNext(ctx, source.data, answer.cardInstanceIds[0], 'arrange');
    }
  },
};

// Unleash (Gray Ops): As an additional cost to play this operation, remove 1 tag. Rez 1
// installed piece of ice, ignoring all costs. You may resolve 1 subroutine on that ice.
const unrezzedIce = (state: GameState) => installedIce(state).filter(c => !c.isRezzed);
const unleash: CardScript = {
  canPlay: ({ state }) => {
    if (state.runner.tags === 0) return 'The Runner has no tag to remove';
    return unrezzedIce(state).length > 0 ? null : 'No unrezzed ice';
  },
  onPlay: ctx => {
    removeTags(ctx.state, 1);
    addLog(ctx.state, 'corp', 'Corp removed 1 tag (Unleash).');
    askCards(ctx, 'corp', 'Unleash: rez 1 installed piece of ice, ignoring all costs.', ids(unrezzedIce(ctx.state)), 1, 1, 'rez');
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'rez' && answer.kind === 'effect_cards') {
      const ice = unrezzedIce(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!ice) return;
      addLog(state, 'corp', `Corp rezzed ${title(ice)} (Unleash).`, undefined, 'rez');
      completeRez(state, ice);
      const subs = iceSubroutines(state, ice);
      if (subs.length === 0) return;
      askChoice(ctx, 'corp', `Unleash: you may resolve 1 subroutine on ${title(ice)}.`, [
        ...subs.map((s, i) => ({ id: String(i), label: s.label })),
        { id: 'none', label: 'None' },
      ], 'sub', { iceId: ice.instanceId });
    } else if (source.step === 'sub' && answer.kind === 'effect_choice' && answer.optionId !== 'none') {
      const ice = findInstalledCorpCard(state, String(source.data?.iceId))?.card;
      const sub = ice ? iceSubroutines(state, ice)[Number(answer.optionId)] : undefined;
      if (!ice || !sub) return;
      addLog(state, 'corp', `Unleash resolves ${title(ice)}'s subroutine: ${sub.label}`);
      sub.resolve({ state, card: ice, side: 'corp' });
    }
  },
};

// Flood the Market (Double): As an additional cost to play this operation, spend click. Choose
// 1 installed card you can advance. Place 1 advancement counter on that card for each remote
// server that has a card in its root and is protected by ice.
const floodCount = (state: GameState) => Object.values(state.corp.servers).filter(s => s.isRemote && s.root.length > 0 && s.ice.length > 0).length;
const floodTheMarket: CardScript = {
  extraClicks: 1,
  canPlay: ({ state }) => (advanceableInstalled(state).length > 0 ? null : 'No installed card you can advance'),
  liveValue: state => `${floodCount(state)} advancement counter(s) now`,
  onPlay: ctx => askCards(ctx, 'corp', `Flood the Market: place ${floodCount(ctx.state)} advancement counter(s) on 1 card you can advance.`, ids(advanceableInstalled(ctx.state)), 1, 1, 'target'),
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    const card = advanceableInstalled(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
    if (!card) return;
    const n = floodCount(state);
    card.advancementCounters += n;
    addLog(state, 'corp', `Corp placed ${n} advancement counter(s) (Flood the Market).`);
  },
};

// Scapegoat (Gray Ops): Resolve 1 of the following of the Runner's choice: Remove 2 bad
// publicity. / Choose 1 installed Runner card. The Runner shuffles it into the stack.
const scapegoat: CardScript = {
  onPlay: ctx =>
    askChoice(ctx, 'runner', 'Scapegoat: choose what the Corp gets.', [
      { id: 'bp', label: 'The Corp removes 2 bad publicity' },
      { id: 'shuffle', label: 'The Corp chooses 1 installed Runner card to shuffle into the stack' },
    ], 'mode'),
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'mode' && answer.kind === 'effect_choice') {
      if (answer.optionId === 'bp') {
        removeBadPublicity(state, 2);
        return;
      }
      const cards = installedRunnerCards(state);
      if (cards.length > 0) askCards(ctx, 'corp', 'Scapegoat: choose 1 installed Runner card to shuffle into the stack.', ids(cards), 1, 1, 'card');
    } else if (source.step === 'card' && answer.kind === 'effect_cards') {
      const card = installedRunnerCards(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!card) return;
      uninstallRunnerCard(state, card, 'stack');
      shuffleInPlace(state.rng, state.runner.stack);
      addLog(state, 'corp', `The Runner shuffled ${title(card)} into the stack (Scapegoat).`);
    }
  },
};

// Myōshu: Play only if you scored an agenda this turn that you did not install this turn. Add
// this operation to your score area as an agenda worth 2 agenda points.
const myoshu: CardScript = {
  canPlay: ({ state }) => (turnFlag(state, TurnFlag.scoredNotInstalledThisTurn) > 0 ? null : 'Play only if you scored an agenda this turn that you did not install this turn'),
  onPlay: ({ state, card }) => {
    if (!removeCard(state.corp.archives.faceUp, card)) return;
    card.asAgendaPoints = 2;
    state.corp.scoreArea.push(card);
    state.corp.score += 2;
    addLog(state, 'corp', `Myōshu was added to the Corp's score area as an agenda worth 2 points. Total: ${state.corp.score}`);
    checkAgendaVictory(state);
  },
};

// Reanimation Protocol (Liability): Install and rez 1 piece of ice from Archives, paying a
// total of 10 credits less. If you rezzed a piece of non-liability ice this way, take 1 bad publicity.
const reanimationTotal = (state: GameState, ice: CardInstance, serverId: string | null) =>
  Math.max(0, corpInstallCost(state, ice, serverId, false) + rezCost(state, ice) - 10);
const reanimationServers = (state: GameState, ice: CardInstance) =>
  [null, ...Object.keys(state.corp.servers)].filter(id => reanimationTotal(state, ice, id) <= state.corp.credits);
const reanimationTargets = (state: GameState) => archivesCards(state).filter(c => type(c) === 'ice' && reanimationServers(state, c).length > 0);
const reanimationProtocol: CardScript = {
  canPlay: ({ state }) => (archivesCards(state).some(c => type(c) === 'ice') ? null : 'No ice in Archives'),
  onPlay: ctx => {
    const targets = reanimationTargets(ctx.state);
    if (targets.length > 0) askCards(ctx, 'corp', 'Reanimation Protocol: install and rez 1 piece of ice from Archives, paying 10 credits less.', ids(targets), 1, 1, 'ice');
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'ice' && answer.kind === 'effect_cards') {
      const ice = archivesCards(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!ice) return;
      const options = reanimationServers(state, ice).map(id => ({
        id: id ?? 'new',
        label: `${id ? state.corp.servers[id].name : 'New remote server'} (${reanimationTotal(state, ice, id)}[credit])`,
      }));
      askChoice(ctx, 'corp', `Reanimation Protocol: install ${title(ice)} where?`, options, 'server', { cardId: ice.instanceId });
    } else if (source.step === 'server' && answer.kind === 'effect_choice') {
      const ice = archivesCards(state).find(c => c.instanceId === source.data?.cardId);
      if (!ice) return;
      const serverId = answer.optionId === 'new' ? null : answer.optionId;
      const total = reanimationTotal(state, ice, serverId);
      if (total > state.corp.credits) return;
      const zone = state.corp.archives.faceUp.includes(ice) ? state.corp.archives.faceUp : state.corp.archives.faceDown;
      installCorpCardFrom(state, ice, zone, serverId, true);
      state.corp.credits -= total;
      addLog(state, 'corp', `Corp installed and rezzed ${title(ice)} for ${total} [credit] (Reanimation Protocol).`, undefined, 'rez');
      rezForFree(state, ice);
      if (!/\bliability\b/i.test(keywords(ice))) takeBadPublicity(state, 1);
    }
  },
};

// Vulture Fund (Transaction - Liability): Gain 14 credits and take 1 bad publicity.
const vultureFund: CardScript = {
  onPlay: ({ state, card }) => {
    gainFromCard(state, 'corp', 14, card);
    addLog(state, 'corp', 'Corp gained 14 [credit] (Vulture Fund).');
    takeBadPublicity(state, 1);
  },
};

// --- Upgrades ---------------------------------------------------------------

// Perfect Recall: When you rez this upgrade and whenever an agenda is scored or stolen from
// this server or its root, place 1 power counter on this upgrade. Hosted power counter: Reveal
// 1 card in HQ. The Runner cannot steal or trash copies of that card for the remainder of this
// run. Use this ability only during a run.
const perfectRecall: CardScript = {
  triggers: {
    rezzed: (ctx, e) => isSelf(ctx, e.card) && addCounters(ctx.card, 'power', 1),
    agenda_scored: (ctx, e) => serverOf(ctx.state, ctx.card)?.id === e.serverId && addCounters(ctx.card, 'power', 1),
    agenda_stolen: (ctx, e) => !!e.serverId && serverOf(ctx.state, ctx.card)?.id === e.serverId && addCounters(ctx.card, 'power', 1),
  },
  abilities: [
    {
      label: 'Reveal 1 card in HQ: the Runner cannot steal or trash copies of it this run.',
      counters: { type: 'power', count: 1 },
      canUse: ({ state }) => {
        if (!state.activeRun || state.activeRun.accessOnly) return 'Only during a run';
        return state.corp.hq.length > 0 ? null : 'HQ is empty';
      },
      resolve: ctx => askCards(ctx, 'corp', 'Perfect Recall: reveal 1 card in HQ.', ids(ctx.state.corp.hq), 1, 1, 'reveal'),
    },
  ],
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    const card = state.corp.hq.find(c => c.instanceId === answer.cardInstanceIds[0]);
    const run = state.activeRun;
    if (!card || !run) return;
    revealInHand(state, 'corp', [card]);
    run.protectedTitles = [...(run.protectedTitles ?? []), title(card)];
    addLog(state, 'corp', `Corp revealed ${title(card)}: the Runner cannot steal or trash copies of it this run (Perfect Recall).`);
  },
};

// The Red Room (Facility): Central server only. The first time each turn an agenda is scored
// or stolen, place 1 power counter on this upgrade. Hosted power counter: End the run. Use this
// ability only during a run against another server.
const redRoomCounter = (ctx: EffectContext) => useOncePerTurn(ctx.state, onceKey(ctx.card)) && addCounters(ctx.card, 'power', 1);
const redRoom: CardScript = {
  installOnly: 'central',
  triggers: { agenda_scored: redRoomCounter, agenda_stolen: redRoomCounter },
  abilities: [
    {
      label: 'End the run.',
      counters: { type: 'power', count: 1 },
      canUse: ({ state, card }) => {
        const run = state.activeRun;
        if (!run || run.accessOnly) return 'Only during a run';
        return serverOf(state, card)?.id !== run.server ? null : 'Only during a run against another server';
      },
      resolve: ({ state }) => endTheRun(state),
    },
  ],
};

// Hype Machine (Advertisement): As long as an agenda was scored or stolen this turn, the rez
// cost of this upgrade is lowered by 6 credits. trash: Place 1 advancement counter on a card
// you can advance in the root of this server.
const hypeTargets = (state: GameState, serverId: string) =>
  (state.corp.servers[serverId]?.root ?? []).filter(c => advanceableInstalled(state).includes(c));
const hypeMachine: CardScript = {
  ownRezCostModifier: state => (turnFlag(state, TurnFlag.agendasScoredOrStolen) > 0 ? -6 : 0),
  abilities: [
    {
      label: 'Place 1 advancement counter on a card you can advance in the root of this server.',
      trashSelf: true,
      canUse: ({ state, card }) => {
        const server = serverOf(state, card);
        return server && hypeTargets(state, server.id).length > 0 ? null : 'Nothing to advance in this server';
      },
      resolve: ctx => {
        const server = serverOf(ctx.state, ctx.card)!;
        askCards(ctx, 'corp', 'Hype Machine: place 1 advancement counter on which card?', ids(hypeTargets(ctx.state, server.id)), 1, 1, 'advance', { server: server.id });
      },
    },
  ],
  onPromptAnswer: ({ state }, source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    const card = hypeTargets(state, String(source.data?.server)).find(c => c.instanceId === answer.cardInstanceIds[0]);
    if (!card) return;
    card.advancementCounters += 1;
    addLog(state, 'corp', 'Corp placed 1 advancement counter (Hype Machine).');
  },
};

// Flagship (Ritzy): HQ or R&D only. Runs against this server cannot be declared successful.
// Persistent -> During each run against this server, the Runner cannot access more than 1 card
// other than this upgrade. (Engine: actions/run.ts, rules 6.9.5, 7.4.2b.)
const flagship: CardScript = {
  installOnly: 'hq-rd',
  blocksSuccess: true,
  limitsAccessToOne: true,
  persistent: true,
};

// Shackleton Grid (Region): Once per turn -> When the Runner spends credits from outside their
// credit pool during a run against this server, you may do 4 meat damage. Limit 1 region per server.
const shackleton: CardScript = {
  triggers: {
    credits_spent_outside_pool: ctx => {
      const { state, card } = ctx;
      if (!runOnServerOf(state, card) || turnFlag(state, onceKey(card)) > 0) return;
      askChoice(ctx, 'corp', 'Shackleton Grid: the Runner spent credits from outside their pool. Do 4 meat damage?', [
        { id: 'yes', label: 'Do 4 meat damage' },
        { id: 'no', label: 'Not now' },
      ], 'meat');
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId !== 'yes' || !useOncePerTurn(state, onceKey(card))) return;
    dealMeatDamage(state, 4);
  },
};

export const vantageCorpScripts: Record<string, CardScript> = {
  '36026': meliesCity,
  '36027': synchrocyclotron,
  '36028': ansel2,
  '36029': reverb,
  '36030': sleipnir,
  '36031': vertigo,
  '36032': caveatEmptor,
  '36033': realloc,
  '36034': retirementPlan,
  '36035': perfectRecall,
  '36036': melies,
  '36037': lotusHaze,
  '36038': esca,
  '36039': ezam,
  '36040': knowledgeSeeker,
  '36041': lionsmane,
  '36042': vicsek,
  '36043': cultivate,
  '36044': unleash,
  '36045': redRoom,
  '36046': editorial,
  '36047': witchHunt,
  '36048': magistrate,
  '36049': nihiloAgent,
  '36050': grubber,
  '36051': lethe,
  '36052': paywall,
  '36053': floodTheMarket,
  '36054': scapegoat,
  '36055': hypeMachine,
  '36056': sacrificeZone,
  '36057': luana,
  '36058': eventHorizon,
  '36059': flywheel,
  '36060': tocsin,
  '36061': myoshu,
  '36062': reanimationProtocol,
  '36063': vultureFund,
  '36064': flagship,
  '36065': shackleton,
  '36066': letThemDream,
};
