import { CardInstance } from '../types/card';
import { GameState } from '../types/state';
import { cardDef } from '../cards';
import { shuffleInPlace } from '../rng';
import { addLog } from '../engine/log';
import { drawCards, findInstalledCorpCard, removeCard } from '../engine/helpers';
import { completeRez } from '../engine/actions/corp';
import { playBlocker, playCardFrom } from '../engine/actions/play';
import { dealMeatDamage, dealNetDamage, dealCoreDamage, giveTags, trashInstalledRunnerCard } from '../engine/damage';
import { endTheRun } from '../engine/runEnd';
import { moveRunnerTo } from '../engine/ice';
import {
  addCounters,
  availableCredits,
  corpTrashFromHQ,
  counters,
  drawForEffect,
  flipIdentity,
  forfeitAgenda,
  gainFromCard,
  installedIce,
  loadCredits,
  placeDividends,
  purgeVirusCounters,
  removeCounters,
  removeTags,
  rezCost,
  spendCredits,
  takeHostedCredits,
  threatLevel,
  trashInstalledCard,
  turnFlag,
  TurnFlag,
  useOncePerTurn,
} from '../engine/cardEffects';
import { CardScript, EffectContext, Subroutine } from './types';
import { getCardScript } from './index';
import {
  advanceableInstalled,
  askCards,
  askChoice,
  askCorpInstall,
  corpInstallOptions,
  gainCredits,
  installCorpChoice,
  takeFromRD,
} from './effects';

/** Corp cards from Elevation. */

const isSelf = (ctx: EffectContext, card: CardInstance) => card.instanceId === ctx.card.instanceId;
const type = (card: CardInstance) => cardDef(card).type_code;
const keywords = (card: CardInstance) => cardDef(card).keywords ?? '';
const onceKey = (card: CardInstance) => `once:${card.instanceId}`;
const archivesCards = (state: GameState) => [...state.corp.archives.faceUp, ...state.corp.archives.faceDown];
const serverOf = (state: GameState, card: CardInstance) => findInstalledCorpCard(state, card.instanceId)?.server;
const installedCorpCards = (state: GameState) => Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]);
const ids = (cards: CardInstance[]) => cards.map(c => c.instanceId);

const endTheRunSub: Subroutine = { label: 'End the run.', resolve: ({ state }) => endTheRun(state) };
const netDamageSub = (amount: number): Subroutine => ({ label: `Do ${amount} net damage.`, resolve: ({ state }) => void dealNetDamage(state, amount) });

/** "When you score this agenda": the handler runs only for this agenda. */
const onScore = (fn: (ctx: EffectContext) => void) => (ctx: EffectContext, e: { card: CardInstance }) => isSelf(ctx, e.card) && fn(ctx);

/** Cards in a list that the Corp could install somewhere (not operations). */
const installable = (state: GameState, cards: CardInstance[], opts: Parameters<typeof corpInstallOptions>[2] = {}) =>
  cards.filter(c => type(c) !== 'operation' && corpInstallOptions(state, c, opts).length > 0);

/** "Dividends N ... When your discard phase ends, you may remove 1 hosted agenda counter to ..." */
function dividendAgenda(perExcess: number, label: string, canUse: (state: GameState) => boolean, use: (ctx: EffectContext) => void, more: Partial<CardScript> = {}): CardScript {
  return {
    ...more,
    triggers: {
      agenda_scored: onScore(ctx => placeDividends(ctx.state, ctx.card, perExcess)),
      discard_phase_ends: (ctx, e) => {
        if (e.side !== 'corp' || counters(ctx.card, 'agenda') === 0 || !canUse(ctx.state)) return;
        askChoice(ctx, 'corp', `${cardDef(ctx.card).title}: remove 1 agenda counter to ${label}?`, [
          { id: 'use', label: `Remove 1 agenda counter: ${label}` },
          { id: 'no', label: 'No' },
        ], 'dividend');
      },
    },
    onPromptAnswer: (ctx, source, answer) => {
      if (source.step === 'dividend') {
        if (answer.kind !== 'effect_choice' || answer.optionId !== 'use') return;
        removeCounters(ctx.card, 'agenda', 1);
        use(ctx);
        return;
      }
      more.onPromptAnswer?.(ctx, source, answer);
    },
  };
}

// --- Identities -------------------------------------------------------------

// LEO Construction: Once per turn -> Trash 1 rezzed bioroid card in the root of or
// protecting the attacked server: End the run.
const leoTargets = (state: GameState) => {
  const run = state.activeRun;
  const server = run && !run.accessOnly ? state.corp.servers[run.server] : undefined;
  return server ? [...server.ice, ...server.root].filter(c => c.isRezzed && /bioroid/i.test(keywords(c))) : [];
};
const leo: CardScript = {
  abilities: [
    {
      label: 'Trash 1 rezzed bioroid card in or protecting the attacked server: end the run.',
      oncePerTurn: true,
      canUse: ({ state }) => (leoTargets(state).length > 0 ? null : 'No rezzed bioroid card in or protecting the attacked server'),
      resolve: ctx => askCards(ctx, 'corp', 'LEO Construction: trash 1 rezzed bioroid card to end the run.', ids(leoTargets(ctx.state)), 1, 1, 'trash'),
    },
  ],
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    const target = leoTargets(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
    if (!target) return;
    trashInstalledCard(state, target);
    addLog(state, 'corp', `Corp trashed ${cardDef(target).title} (LEO Construction).`);
    endTheRun(state);
  },
};

// Poétrï Luxury Brands: Whenever you score an agenda, look at the top 3 cards of R&D.
// You may install 1 non-agenda card from among them. Whenever an agenda is stolen,
// you may install 1 non-agenda card from HQ.
const poetri: CardScript = {
  triggers: {
    agenda_scored: ctx => {
      const top = installable(ctx.state, ctx.state.corp.rd.slice(0, 3).filter(c => type(c) !== 'agenda'));
      addLog(ctx.state, 'corp', 'Corp looked at the top 3 cards of R&D (Poétrï Luxury Brands).');
      if (top.length > 0) askCards(ctx, 'corp', 'Poétrï: you may install 1 non-agenda card from the top 3 of R&D.', ids(top), 0, 1, 'pick');
    },
    agenda_stolen: ctx => {
      const cards = installable(ctx.state, ctx.state.corp.hq.filter(c => type(c) !== 'agenda'));
      if (cards.length > 0) askCards(ctx, 'corp', 'Poétrï: you may install 1 non-agenda card from HQ.', ids(cards), 0, 1, 'pick');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'pick' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      askCorpInstall(ctx, answer.cardInstanceIds[0], 'server');
    } else if (source.step === 'server') {
      installCorpChoice(ctx.state, source, answer);
    }
  },
};

// AU Co.: Whenever you do damage or trash 1 or more cards from HQ, place 1 power counter
// on this identity. When your turn begins, you may remove 2 hosted power counters to look
// at the top 3 cards of R&D. Trash 1 of those cards and add the rest to HQ.
const auCoCounter = (ctx: EffectContext) => {
  addCounters(ctx.card, 'power', 1);
};
const auCo: CardScript = {
  triggers: {
    damage_dealt: (ctx, e) => e.byCorp && auCoCounter(ctx),
    hq_trashed: auCoCounter,
    turn_begins: (ctx, e) => {
      if (e.side !== 'corp' || counters(ctx.card, 'power') < 2 || ctx.state.corp.rd.length === 0) return;
      askChoice(ctx, 'corp', 'AU Co.: remove 2 power counters to look at the top 3 cards of R&D?', [
        { id: 'use', label: 'Look at the top 3 of R&D' },
        { id: 'no', label: 'No' },
      ], 'use');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'use' && answer.kind === 'effect_choice' && answer.optionId === 'use') {
      removeCounters(ctx.card, 'power', 2);
      askCards(ctx, 'corp', 'AU Co.: trash 1 of the top 3 cards of R&D; the rest go to HQ.', ids(state.corp.rd.slice(0, 3)), 1, 1, 'trash');
    } else if (source.step === 'trash' && answer.kind === 'effect_cards') {
      const top = state.corp.rd.splice(0, 3);
      for (const card of top) {
        if (card.instanceId === answer.cardInstanceIds[0]) state.corp.archives.faceDown.push(card);
        else state.corp.hq.push(card);
      }
      addLog(state, 'corp', `Corp trashed 1 card and added ${top.length - 1} to HQ (AU Co.).`);
    }
  },
};

// PT Untaian: When your discard phase ends, if there are 3 or fewer cards in HQ, you
// may pay 1 credit to place 1 advancement counter on an unrezzed card you can advance.
const untaianTargets = (state: GameState) => advanceableInstalled(state).filter(c => !c.isRezzed);
const ptUntaian: CardScript = {
  triggers: {
    discard_phase_ends: (ctx, e) => {
      const { state } = ctx;
      if (e.side !== 'corp' || state.corp.hq.length > 3 || state.corp.credits < 1) return;
      const targets = untaianTargets(state);
      if (targets.length === 0) return;
      askCards(ctx, 'corp', 'PT Untaian: you may pay 1 credit to place 1 advancement counter on an unrezzed card.', ids(targets), 0, 1, 'advance');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards' || answer.cardInstanceIds.length === 0) return;
    const target = untaianTargets(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
    if (!target || state.corp.credits < 1) return;
    state.corp.credits -= 1;
    target.advancementCounters += 1;
    addLog(state, 'corp', 'Corp paid 1 [credit] to place 1 advancement counter (PT Untaian).');
  },
};

// Nebula Talent Management: When your action phase ends, if you played an operation this
// turn, gain 1 credit and flip this identity. Flip side: The first time each turn you
// play an operation, gain click. When the Runner makes a successful run on HQ or R&D, flip.
const nebula: CardScript = {
  triggers: {
    action_phase_ends: ({ state, card }, e) => {
      if (e.side !== 'corp' || card.flipped || turnFlag(state, TurnFlag.operationsPlayed) === 0) return;
      gainCredits(state, 'corp', 1);
      addLog(state, 'corp', 'Corp gained 1 [credit] (Nebula Talent Management).');
      flipIdentity(state, 'corp');
    },
    operation_played: ({ state, card }) => {
      if (!card.flipped || turnFlag(state, TurnFlag.operationsPlayed) !== 1) return;
      state.corp.clicks += 1;
      addLog(state, 'corp', 'Corp gained [click] (Nebula Talent Management).');
    },
    successful_run: ({ state, card }, e) => {
      if (card.flipped && (e.server === 'hq' || e.server === 'rd')) flipIdentity(state, 'corp');
    },
  },
};

// Synapse Global: The first time each turn a tag is removed, you may reveal and install
// 1 card from HQ, ignoring all costs. click, remove 1 tag: Gain 2 credits.
const synapse: CardScript = {
  triggers: {
    tags_removed: ctx => {
      if (!useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
      const cards = installable(ctx.state, ctx.state.corp.hq, { ignoreCosts: true });
      if (cards.length === 0) return;
      askCards(ctx, 'corp', 'Synapse Global: you may reveal and install 1 card from HQ, ignoring all costs.', ids(cards), 0, 1, 'pick');
    },
  },
  abilities: [
    {
      label: 'Remove 1 tag: gain 2 credits.',
      clicks: 1,
      canUse: ({ state }) => (state.runner.tags > 0 ? null : 'The Runner has no tags'),
      resolve: ({ state }) => {
        removeTags(state, 1);
        gainCredits(state, 'corp', 2);
        addLog(state, 'corp', 'Corp removed 1 tag and gained 2 [credit] (Synapse Global).');
      },
    },
  ],
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'pick' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      const card = ctx.state.corp.hq.find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (card) addLog(ctx.state, 'corp', `Corp revealed ${cardDef(card).title} (Synapse Global).`);
      askCorpInstall(ctx, answer.cardInstanceIds[0], 'server', { ignoreCosts: true });
    } else if (source.step === 'server') {
      installCorpChoice(ctx.state, source, answer, { ignoreCosts: true });
    }
  },
};

// BANGUN: You may install agendas faceup. Whenever the Runner accesses a faceup
// installed agenda, do 2 meat damage and give the Runner 1 tag.
const bangun: CardScript = {
  agendasFaceUp: true,
  triggers: {
    card_accessed: ({ state }, e) => {
      if (e.where !== 'installed' || type(e.card) !== 'agenda' || !e.card.faceUp) return;
      dealMeatDamage(state, 2);
      if (!state.winner) giveTags(state, 1);
    },
  },
};

// The Zwicky Group: The first time each turn you gain credits through an ability on an
// agenda or operation, you may draw 1 card.
const zwicky: CardScript = {
  triggers: {
    credits_gained: (ctx, e) => {
      if (e.side !== 'corp' || !['agenda', 'operation'].includes(type(e.source))) return;
      if (!useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
      askChoice(ctx, 'corp', 'The Zwicky Group: draw 1 card?', [
        { id: 'draw', label: 'Draw 1 card' },
        { id: 'no', label: 'No' },
      ], 'draw');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind === 'effect_choice' && answer.optionId === 'draw') drawForEffect(state, 'corp', 1, 'The Zwicky Group');
  },
};

// --- Agendas ----------------------------------------------------------------

// Aggressive Trendsetting: The first time the Runner trashes an installed Corp card during
// each of their turns, they may spend click. If they do not, you get +1 allotted click for
// your next turn.
const aggressiveTrendsetting: CardScript = {
  triggers: {
    runner_trashed_corp_card: (ctx, e) => {
      const { state } = ctx;
      if (!e.wasInstalled || state.activePlayer !== 'runner' || !useOncePerTurn(state, onceKey(ctx.card))) return;
      if (state.runner.clicks === 0) {
        state.corp.bonusClicksNextTurn = (state.corp.bonusClicksNextTurn ?? 0) + 1;
        addLog(state, 'corp', 'Corp gets +1 [click] next turn (Aggressive Trendsetting).');
        return;
      }
      askChoice(ctx, 'runner', 'Aggressive Trendsetting: spend [click], or the Corp gets +1 [click] next turn.', [
        { id: 'spend', label: 'Spend [click]' },
        { id: 'no', label: 'Let the Corp have an extra [click]' },
      ], 'click');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'spend' && state.runner.clicks > 0) {
      state.runner.clicks -= 1;
      addLog(state, 'runner', 'Runner spent [click] (Aggressive Trendsetting).');
    } else {
      state.corp.bonusClicksNextTurn = (state.corp.bonusClicksNextTurn ?? 0) + 1;
      addLog(state, 'corp', 'Corp gets +1 [click] next turn (Aggressive Trendsetting).');
    }
  },
};

// Project Ingatan: Dividends 1. When your discard phase ends, you may remove 1 hosted agenda
// counter to install 1 card from Archives, ignoring all costs.
const ingatanTargets = (state: GameState) => installable(state, archivesCards(state), { ignoreCosts: true });
const projectIngatan = dividendAgenda(
  1,
  'install 1 card from Archives',
  state => ingatanTargets(state).length > 0,
  ctx => askCards(ctx, 'corp', 'Project Ingatan: install 1 card from Archives, ignoring all costs.', ids(ingatanTargets(ctx.state)), 1, 1, 'pick'),
  {
    onPromptAnswer: (ctx, source, answer) => {
      if (source.step === 'pick' && answer.kind === 'effect_cards') askCorpInstall(ctx, answer.cardInstanceIds[0], 'server', { ignoreCosts: true });
      else if (source.step === 'server') installCorpChoice(ctx.state, source, answer, { ignoreCosts: true });
    },
  }
);

// Proprionegation: When you score this agenda, place 1 agenda counter on it. Hosted agenda
// counter: The Runner moves to the outermost position of Archives. Use only during a run.
const proprionegation: CardScript = {
  triggers: { agenda_scored: onScore(({ card }) => addCounters(card, 'agenda', 1)) },
  abilities: [
    {
      label: 'Hosted agenda counter: the Runner moves to the outermost position of Archives.',
      counters: { type: 'agenda', count: 1 },
      canUse: ({ state }) => (state.activeRun && !state.activeRun.accessOnly && state.activeRun.phase !== 'access' ? null : 'Only during a run'),
      resolve: ({ state }) => moveRunnerTo(state, 'archives'),
    },
  ],
};

// Sericulture Expansion: Dividends 1. When your discard phase ends, you may remove 1 hosted
// agenda counter to place 2 advancement counters on 1 installed card.
const sericulture = dividendAgenda(
  1,
  'place 2 advancement counters on 1 installed card',
  state => installedCorpCards(state).length > 0,
  ctx => askCards(ctx, 'corp', 'Sericulture Expansion: place 2 advancement counters on 1 installed card.', ids(installedCorpCards(ctx.state)), 1, 1, 'advance'),
  {
    onPromptAnswer: ({ state }, source, answer) => {
      if (source.step !== 'advance' || answer.kind !== 'effect_cards') return;
      const target = installedCorpCards(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!target) return;
      target.advancementCounters += 2;
      addLog(state, 'corp', 'Corp placed 2 advancement counters on an installed card (Sericulture Expansion).');
    },
  }
);

// Embedded Reporting: Dividends 2. When your discard phase ends, you may remove 1 hosted
// agenda counter to search R&D for 1 operation and reveal it. (Shuffle R&D.) Add that
// operation to the top of R&D.
const rdOperations = (state: GameState) => state.corp.rd.filter(c => type(c) === 'operation');
const embeddedReporting = dividendAgenda(
  2,
  'search R&D for 1 operation and put it on top',
  state => rdOperations(state).length > 0,
  ctx => askCards(ctx, 'corp', 'Embedded Reporting: search R&D for 1 operation.', ids(rdOperations(ctx.state)), 1, 1, 'search'),
  {
    onPromptAnswer: ({ state }, source, answer) => {
      if (source.step !== 'search' || answer.kind !== 'effect_cards') return;
      const card = takeFromRD(state, answer.cardInstanceIds[0]);
      if (card) state.corp.rd.unshift(card);
    },
  }
);

// Off the Books: Dividends 1. When your discard phase ends, you may remove 1 hosted agenda
// counter to search R&D for 1 card and reveal it. (Shuffle R&D.) You may install that
// card, ignoring all costs. If you do not, add it to HQ.
const offTheBooks = dividendAgenda(
  1,
  'search R&D for 1 card',
  state => state.corp.rd.length > 0,
  ctx => askCards(ctx, 'corp', 'Off the Books: search R&D for 1 card.', ids(ctx.state.corp.rd), 1, 1, 'search'),
  {
    onPromptAnswer: (ctx, source, answer) => {
      const { state } = ctx;
      if (source.step === 'search' && answer.kind === 'effect_cards') {
        const card = takeFromRD(state, answer.cardInstanceIds[0]);
        if (!card) return;
        // Set aside in HQ while choosing; installing takes it from there
        state.corp.hq.push(card);
        const options = type(card) === 'operation' ? [] : corpInstallOptions(state, card, { ignoreCosts: true });
        if (options.length === 0) return;
        askChoice(ctx, 'corp', `Off the Books: install ${cardDef(card).title} ignoring all costs, or add it to HQ?`, [
          ...options,
          { id: 'hq', label: 'Add it to HQ' },
        ], 'install', { cardId: card.instanceId });
      } else if (source.step === 'install' && answer.kind === 'effect_choice' && answer.optionId !== 'hq') {
        installCorpChoice(state, source, answer, { ignoreCosts: true });
      }
    },
  }
);

// Next Big Thing: When this agenda is scored or stolen, place 1 agenda counter on it.
// click, hosted agenda counter: Draw 4 cards. Shuffle any number of cards from HQ into
// R&D. The Corp can use this ability even if this agenda is in the Runner's score area.
const nextBigThing: CardScript = {
  triggers: {
    agenda_scored: onScore(({ card }) => addCounters(card, 'agenda', 1)),
    agenda_stolen: onScore(({ card }) => addCounters(card, 'agenda', 1)),
  },
  abilities: [
    {
      label: 'Draw 4 cards, then shuffle any number of cards from HQ into R&D.',
      clicks: 1,
      counters: { type: 'agenda', count: 1 },
      fromRunnerScoreArea: true,
      resolve: ctx => {
        const { state } = ctx;
        drawForEffect(state, 'corp', 4, 'Next Big Thing');
        if (state.winner || state.corp.hq.length === 0) return;
        askCards(ctx, 'corp', 'Next Big Thing: shuffle any number of cards from HQ into R&D.', ids(state.corp.hq), 0, state.corp.hq.length, 'shuffle');
      },
    },
  ],
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    for (const id of answer.cardInstanceIds) {
      const card = state.corp.hq.find(c => c.instanceId === id);
      if (card) {
        removeCard(state.corp.hq, card);
        state.corp.rd.push(card);
      }
    }
    shuffleInPlace(state.rng, state.corp.rd);
    addLog(state, 'corp', `Corp shuffled ${answer.cardInstanceIds.length} card(s) from HQ into R&D.`);
  },
};

// Greenmail: When you score this agenda, gain 2 credits. When you forfeit this agenda, gain 4 credits.
const greenmail: CardScript = {
  triggers: {
    agenda_scored: onScore(({ state, card }) => gainFromCard(state, 'corp', 2, card)),
    agenda_forfeited: (ctx, e) => isSelf(ctx, e.card) && gainFromCard(ctx.state, 'corp', 4, ctx.card),
  },
};

// --- Assets -----------------------------------------------------------------

// Humanoid Resources: click click click, trash: Gain 4 credits and draw 3 cards. Install
// up to 2 cards from HQ (one at a time). You may play 1 operation from HQ.
function askInstallFromHQ(ctx: EffectContext, left: number, then: string): void {
  const cards = installable(ctx.state, ctx.state.corp.hq);
  if (left > 0 && cards.length > 0) {
    askCards(ctx, 'corp', `${cardDef(ctx.card).title}: you may install a card from HQ (${left} left).`, ids(cards), 0, 1, 'install_pick', { left, then });
    return;
  }
  if (then === 'operation') askPlayOperation(ctx);
}
function askPlayOperation(ctx: EffectContext): void {
  const ops = ctx.state.corp.hq.filter(c => type(c) === 'operation' && !safePlayBlocker(ctx.state, c));
  if (ops.length > 0) askCards(ctx, 'corp', `${cardDef(ctx.card).title}: you may play 1 operation from HQ.`, ids(ops), 0, 1, 'operation');
}
const safePlayBlocker = (state: GameState, card: CardInstance) => {
  try {
    return playBlocker(state, 'corp', card, true);
  } catch {
    return 'Not playable';
  }
};
/** onPromptAnswer for askInstallFromHQ() flows. Returns true if it handled the step. */
function installFromHQAnswer(ctx: EffectContext, source: Parameters<NonNullable<CardScript['onPromptAnswer']>>[1], answer: Parameters<NonNullable<CardScript['onPromptAnswer']>>[2]): boolean {
  const left = Number(source.data?.left ?? 0);
  const then = String(source.data?.then ?? '');
  if (source.step === 'install_pick' && answer.kind === 'effect_cards') {
    if (answer.cardInstanceIds.length === 0) {
      if (then === 'operation') askPlayOperation(ctx);
      return true;
    }
    if (!askCorpInstall(ctx, answer.cardInstanceIds[0], 'install_server', {}, { left, then })) askInstallFromHQ(ctx, left - 1, then);
    return true;
  }
  if (source.step === 'install_server') {
    installCorpChoice(ctx.state, source, answer);
    askInstallFromHQ(ctx, left - 1, then);
    return true;
  }
  if (source.step === 'operation' && answer.kind === 'effect_cards') {
    const card = ctx.state.corp.hq.find(c => c.instanceId === answer.cardInstanceIds[0]);
    if (card) playCardFrom(ctx.state, 'corp', card, ctx.state.corp.hq, { fromHand: true });
    return true;
  }
  return false;
}
const humanoidResources: CardScript = {
  abilities: [
    {
      label: 'Gain 4 credits and draw 3 cards; install up to 2 cards from HQ; you may play 1 operation.',
      clicks: 3,
      trashSelf: true,
      resolve: ctx => {
        gainCredits(ctx.state, 'corp', 4);
        drawForEffect(ctx.state, 'corp', 3, 'Humanoid Resources');
        if (!ctx.state.winner) askInstallFromHQ(ctx, 2, 'operation');
      },
    },
  ],
  onPromptAnswer: (ctx, source, answer) => void installFromHQAnswer(ctx, source, answer),
};

// Otto Campaign: When you rez this asset, load 6 credits onto it. When it is empty,
// trash it and gain click click. When your turn begins, take 2 credits from this asset.
const ottoCampaign: CardScript = {
  trashWhenEmpty: true,
  onEmptied: ({ state }) => {
    state.corp.clicks += 2;
    addLog(state, 'corp', 'Corp gained [click][click] (Otto Campaign).');
  },
  triggers: {
    rezzed: (ctx, e) => isSelf(ctx, e.card) && loadCredits(ctx.state, ctx.card, 6),
    turn_begins: ({ state, card }, e) => e.side === 'corp' && takeHostedCredits(state, card, 2),
  },
};

// Byte!: While the Runner is accessing this asset in R&D, they must reveal it. When the
// Runner accesses this asset anywhere except in Archives, you may pay 4 credits. If you
// do, give the Runner 1 tag and do 3 net damage.
const byte: CardScript = {
  revealedOnRdAccess: true,
  onAccessed: (ctx, where) => {
    if (where === 'archives' || ctx.state.corp.credits < 4) return;
    askChoice(ctx, 'corp', 'Byte!: pay 4 credits to give the Runner 1 tag and do 3 net damage?', [
      { id: 'pay', label: 'Pay 4: 1 tag and 3 net damage' },
      { id: 'no', label: 'No' },
    ], 'pay');
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId !== 'pay' || state.corp.credits < 4) return;
    state.corp.credits -= 4;
    giveTags(state, 1);
    dealNetDamage(state, 3);
  },
};

// Phật Gioan Baotixita: When your discard phase ends, place 1 power counter on this asset.
// The first time each turn an agenda is scored or stolen, you may remove up to 2 hosted
// power counters. Do 1 net damage plus 1 net damage for each power counter removed this way.
const phatTrigger = (ctx: EffectContext) => {
  if (!useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
  const max = Math.min(2, counters(ctx.card, 'power'));
  const options = Array.from({ length: max + 1 }, (_, n) => ({ id: String(n), label: `Remove ${n} power counter(s): ${n + 1} net damage` }));
  askChoice(ctx, 'corp', 'Phật Gioan Baotixita: remove power counters for extra net damage.', options, 'damage');
};
const phat: CardScript = {
  triggers: {
    discard_phase_ends: ({ card }, e) => e.side === 'corp' && addCounters(card, 'power', 1),
    agenda_scored: phatTrigger,
    agenda_stolen: phatTrigger,
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    const n = Math.min(Number(answer.optionId), counters(card, 'power'));
    removeCounters(card, 'power', n);
    dealNetDamage(state, 1 + n);
  },
};

// Idiosyncresis: You can advance this asset. When your turn begins, you may trash this
// asset. If you do, for each hosted advancement counter, gain 3 credits and the Runner loses 2.
const idiosyncresis: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      const n = ctx.card.advancementCounters;
      if (e.side !== 'corp' || n === 0) return;
      askChoice(ctx, 'corp', `Idiosyncresis: trash it to gain ${3 * n} credits and make the Runner lose ${2 * n}?`, [
        { id: 'trash', label: `Trash it: gain ${3 * n}, Runner loses ${2 * n}` },
        { id: 'no', label: 'Keep it' },
      ], 'trash');
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId !== 'trash' || !serverOf(state, card)) return;
    const n = card.advancementCounters;
    trashInstalledCard(state, card);
    gainCredits(state, 'corp', 3 * n);
    state.runner.credits = Math.max(0, state.runner.credits - 2 * n);
    addLog(state, 'corp', `Corp trashed Idiosyncresis: gained ${3 * n} [credit], the Runner lost ${2 * n} [credit].`);
  },
};

// Public Access Plaza: When your turn begins, gain 1 credit. Threat 2 -> When the Runner
// trashes this asset (while it is rezzed), give them 1 tag.
const publicAccessPlaza: CardScript = {
  triggers: {
    turn_begins: ({ state }, e) => {
      if (e.side !== 'corp') return;
      gainCredits(state, 'corp', 1);
      addLog(state, 'corp', 'Corp gained 1 [credit] (Public Access Plaza).');
    },
    runner_trashed_corp_card: (ctx, e) => {
      if (isSelf(ctx, e.card) && e.wasRezzed && threatLevel(ctx.state) >= 2) giveTags(ctx.state, 1);
    },
  },
};

// Anthill Excavation Contract: When you rez this asset, load 8 credits onto it. When it is
// empty, trash it. When your turn begins, take 4 credits from this asset and draw 1 card.
const anthill: CardScript = {
  trashWhenEmpty: true,
  triggers: {
    rezzed: (ctx, e) => isSelf(ctx, e.card) && loadCredits(ctx.state, ctx.card, 8),
    turn_begins: ({ state, card }, e) => {
      if (e.side !== 'corp') return;
      takeHostedCredits(state, card, 4);
      drawForEffect(state, 'corp', 1, 'Anthill Excavation Contract');
    },
  },
};

// Plutus: As an additional cost to rez this asset, forfeit 1 agenda or reveal and trash 3
// cards from HQ. When your turn begins, you may play 1 transaction operation from Archives.
// After it resolves, remove it from the game.
const plutusOperations = (state: GameState) =>
  archivesCards(state).filter(c => type(c) === 'operation' && /transaction/i.test(keywords(c)) && !safePlayBlockerFrom(state, c));
const safePlayBlockerFrom = (state: GameState, card: CardInstance) => {
  try {
    return playBlocker(state, 'corp', card, false);
  } catch {
    return 'Not playable';
  }
};
const plutus: CardScript = {
  rezBlocker: (state, card, cost) => {
    if (availableCredits(state, 'corp', { kind: 'rez', card }) < cost) return 'Not enough credits to rez';
    return state.corp.scoreArea.length > 0 || state.corp.hq.length >= 3 ? null : 'Needs an agenda to forfeit or 3 cards in HQ';
  },
  payRez: (ctx, cost) => {
    const { state } = ctx;
    askChoice(ctx, 'corp', 'Plutus: forfeit 1 agenda or trash 3 cards from HQ to rez it.', [
      ...state.corp.scoreArea.map(a => ({ id: a.instanceId, label: `Forfeit ${cardDef(a).title}` })),
      ...(state.corp.hq.length >= 3 ? [{ id: 'hq', label: 'Reveal and trash 3 cards from HQ' }] : []),
    ], 'rez_cost', { cost });
  },
  triggers: {
    turn_begins: (ctx, e) => {
      const ops = plutusOperations(ctx.state);
      if (e.side !== 'corp' || ops.length === 0) return;
      askCards(ctx, 'corp', 'Plutus: you may play 1 transaction operation from Archives (then remove it from the game).', ids(ops), 0, 1, 'play');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    const cost = Number(source.data?.cost ?? 0);
    if (source.step === 'rez_cost' && answer.kind === 'effect_choice') {
      if (answer.optionId === 'hq') {
        askCards(ctx, 'corp', 'Plutus: reveal and trash 3 cards from HQ.', ids(state.corp.hq), 3, 3, 'rez_trash', { cost });
        return;
      }
      const agenda = state.corp.scoreArea.find(a => a.instanceId === answer.optionId);
      if (!agenda) return;
      forfeitAgenda(state, agenda);
      spendCredits(state, 'corp', cost, { kind: 'rez', card });
      completeRez(state, card);
    } else if (source.step === 'rez_trash' && answer.kind === 'effect_cards') {
      const trashed = corpTrashFromHQ(state, answer.cardInstanceIds);
      addLog(state, 'corp', `Corp revealed and trashed ${trashed.map(c => cardDef(c).title).join(', ')} (Plutus).`);
      spendCredits(state, 'corp', cost, { kind: 'rez', card });
      completeRez(state, card);
    } else if (source.step === 'play' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      const op = archivesCards(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!op) return;
      const zone = state.corp.archives.faceUp.includes(op) ? state.corp.archives.faceUp : state.corp.archives.faceDown;
      playCardFrom(state, 'corp', op, zone, { fromHand: false, removeAfter: true });
    }
  },
};

// --- Ice ----------------------------------------------------------------------

/** "Trash 1 installed program" (the Corp chooses). */
const trashProgramSub = (label = 'Trash 1 installed program.'): Subroutine => ({
  label,
  resolve: ctx => {
    const programs = ctx.state.runner.rig.programs;
    if (programs.length === 0) return;
    askCards(ctx, 'corp', `${cardDef(ctx.card).title}: trash 1 installed program.`, ids(programs), 1, 1, 'trash_program');
  },
});
/** onPromptAnswer for trashProgramSub. */
const trashProgramAnswer = (state: GameState, answer: Parameters<NonNullable<CardScript['onPromptAnswer']>>[2]) => {
  if (answer.kind !== 'effect_cards') return;
  const program = state.runner.rig.programs.find(p => p.instanceId === answer.cardInstanceIds[0]);
  if (program) {
    trashInstalledRunnerCard(state, program);
    addLog(state, 'corp', `Corp trashed ${cardDef(program).title}.`);
  }
};

// Bumi 1.0 (Sentry - Bioroid - AP - Destroyer): When you rez this ice during a run against
// this server, you may trash 1 installed trojan program. Lose click: Break 1 subroutine.
// Subroutine: Trash 1 installed program. Subroutine: Do 1 core damage.
const trojans = (state: GameState) => state.runner.rig.programs.filter(p => /trojan/i.test(keywords(p)));
const bumi: CardScript = {
  ice: {
    subroutines: [trashProgramSub(), { label: 'Do 1 core damage.', resolve: ({ state }) => void dealCoreDamage(state, 1) }],
    onRezDuringRunOnServer: ctx => {
      const targets = trojans(ctx.state);
      if (targets.length > 0) askCards(ctx, 'corp', 'Bumi 1.0: you may trash 1 installed trojan.', ids(targets), 0, 1, 'trash_program');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => trashProgramAnswer(state, answer),
};

// Scatter Field (Code Gate): While this ice is the only piece of ice protecting this server,
// it gets +4 strength. Subroutine: You may install 1 card from HQ. Subroutine: End the run.
const scatterField: CardScript = {
  ice: {
    strengthModifier: (state, ice) => (serverOf(state, ice)?.ice.length === 1 ? 4 : 0),
    subroutines: [
      {
        label: 'You may install 1 card from HQ.',
        resolve: ctx => {
          const cards = installable(ctx.state, ctx.state.corp.hq);
          if (cards.length > 0) askCards(ctx, 'corp', 'Scatter Field: you may install 1 card from HQ.', ids(cards), 0, 1, 'pick');
        },
      },
      endTheRunSub,
    ],
  },
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'pick' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) askCorpInstall(ctx, answer.cardInstanceIds[0], 'server');
    else if (source.step === 'server') installCorpChoice(ctx.state, source, answer);
  },
};

// Empiricist (Sentry - AP - Observer): Subroutine: Draw 1 card. You may add 1 card from HQ
// to the top of R&D. Subroutine: Do 1 net damage. Give the Runner 1 tag. Subroutine: Do 2 net damage.
const empiricist: CardScript = {
  ice: {
    subroutines: [
      {
        label: 'Draw 1 card. You may add 1 card from HQ to the top of R&D.',
        resolve: ctx => {
          drawForEffect(ctx.state, 'corp', 1, 'Empiricist');
          if (ctx.state.winner || ctx.state.corp.hq.length === 0) return;
          askCards(ctx, 'corp', 'Empiricist: you may add 1 card from HQ to the top of R&D.', ids(ctx.state.corp.hq), 0, 1, 'top');
        },
      },
      {
        label: 'Do 1 net damage. Give the Runner 1 tag.',
        resolve: ({ state }) => {
          dealNetDamage(state, 1);
          if (!state.winner) giveTags(state, 1);
        },
      },
      netDamageSub(2),
    ],
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards' || answer.cardInstanceIds.length === 0) return;
    const card = state.corp.hq.find(c => c.instanceId === answer.cardInstanceIds[0]);
    if (!card) return;
    removeCard(state.corp.hq, card);
    state.corp.rd.unshift(card);
    addLog(state, 'corp', 'Corp added 1 card from HQ to the top of R&D (Empiricist).');
  },
};

// Mycoweb (Code Gate): Subroutine: You may install 1 piece of ice from Archives, ignoring all
// costs. Subroutine: You may rez 1 installed piece of ice, paying 2 credits less.
// Subroutine: Resolve 1 subroutine on a rezzed sentry. Subroutine: Resolve 1 subroutine on another rezzed code gate.
const archivesIce = (state: GameState) => installable(state, archivesCards(state).filter(c => type(c) === 'ice'), { ignoreCosts: true });
const mycowebRezTargets = (state: GameState) =>
  installedIce(state).filter(c => !c.isRezzed && state.corp.credits >= Math.max(0, rezCost(state, c) - 2) && !hasRezHooks(c));
const hasRezHooks = (card: CardInstance) => !!(getScript(card)?.rezBlocker || getScript(card)?.payRez);
const rezzedOfSubtype = (state: GameState, subtype: string, except?: CardInstance) =>
  installedIce(state).filter(c => c.isRezzed && c !== except && new RegExp(subtype, 'i').test(keywords(c)) && (getScript(c)?.ice?.subroutines.length ?? 0) > 0);
const mycoweb: CardScript = {
  ice: {
    subroutines: [
      {
        label: 'You may install 1 piece of ice from Archives, ignoring all costs.',
        resolve: ctx => {
          const ice = archivesIce(ctx.state);
          if (ice.length > 0) askCards(ctx, 'corp', 'Mycoweb: you may install 1 ice from Archives, ignoring all costs.', ids(ice), 0, 1, 'install');
        },
      },
      {
        label: 'You may rez 1 installed piece of ice, paying 2 credits less.',
        resolve: ctx => {
          const ice = mycowebRezTargets(ctx.state);
          if (ice.length > 0) askCards(ctx, 'corp', 'Mycoweb: you may rez 1 installed ice, paying 2 credits less.', ids(ice), 0, 1, 'rez');
        },
      },
      {
        label: 'Resolve 1 subroutine on a rezzed sentry.',
        resolve: ctx => {
          const ice = rezzedOfSubtype(ctx.state, 'sentry');
          if (ice.length > 0) askCards(ctx, 'corp', 'Mycoweb: choose a rezzed sentry.', ids(ice), 1, 1, 'borrow_ice');
        },
      },
      {
        label: 'Resolve 1 subroutine on another rezzed code gate.',
        resolve: ctx => {
          const ice = rezzedOfSubtype(ctx.state, 'code gate', ctx.card);
          if (ice.length > 0) askCards(ctx, 'corp', 'Mycoweb: choose another rezzed code gate.', ids(ice), 1, 1, 'borrow_ice');
        },
      },
    ],
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'install' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      askCorpInstall(ctx, answer.cardInstanceIds[0], 'server', { ignoreCosts: true });
    } else if (source.step === 'server') {
      installCorpChoice(state, source, answer, { ignoreCosts: true });
    } else if (source.step === 'rez' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      const ice = installedIce(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!ice) return;
      const cost = Math.max(0, rezCost(state, ice) - 2);
      spendCredits(state, 'corp', cost, { kind: 'rez', card: ice });
      addLog(state, 'corp', `Corp spent ${cost} [credit] to rez ${cardDef(ice).title} (Mycoweb).`, undefined, 'rez');
      completeRez(state, ice);
    } else if (source.step === 'borrow_ice' && answer.kind === 'effect_cards') {
      const ice = installedIce(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      const subs = ice ? getScript(ice)?.ice?.subroutines ?? [] : [];
      if (!ice || subs.length === 0) return;
      askChoice(ctx, 'corp', `Mycoweb: resolve which subroutine on ${cardDef(ice).title}?`, subs.map((s, i) => ({ id: String(i), label: s.label })), 'borrow_sub', {
        iceId: ice.instanceId,
      });
    } else if (source.step === 'borrow_sub' && answer.kind === 'effect_choice') {
      const ice = installedIce(state).find(c => c.instanceId === source.data?.iceId);
      const sub = ice && getScript(ice)?.ice?.subroutines[Number(answer.optionId)];
      if (!ice || !sub) return;
      addLog(state, 'corp', `Mycoweb resolves a subroutine on ${cardDef(ice).title}: ${sub.label}`);
      sub.resolve({ state, card: ice, side: 'corp' });
    }
  },
};

// Semak-samun (Barrier - AP): The Runner cannot break the printed subroutine on this ice
// except using a fracter. Subroutine: End the run unless the Runner suffers 3 net damage.
const semakSamun: CardScript = {
  ice: {
    fracterOnly: true,
    subroutines: [
      {
        label: 'End the run unless the Runner suffers 3 net damage.',
        resolve: ctx =>
          askChoice(ctx, 'runner', 'Semak-samun: suffer 3 net damage, or the run ends.', [
            { id: 'damage', label: 'Suffer 3 net damage' },
            { id: 'end', label: 'End the run' },
          ], 'choice'),
      },
    ],
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'damage') dealNetDamage(state, 3);
    else endTheRun(state);
  },
};

// Doomscroll (Sentry - AP - Observer): Subroutine: Give the Runner 1 tag.
// Subroutine: Do 1 net damage. Subroutine: Do 2 net damage if the Runner has at least 2 tags.
const doomscroll: CardScript = {
  ice: {
    subroutines: [
      { label: 'Give the Runner 1 tag.', resolve: ({ state }) => giveTags(state, 1) },
      netDamageSub(1),
      {
        label: 'Do 2 net damage if the Runner has at least 2 tags.',
        resolve: ({ state }) => {
          if (state.runner.tags >= 2) dealNetDamage(state, 2);
        },
      },
    ],
  },
};

// N-Pot (Code Gate): 3 credits: Break 1 subroutine on this ice. Only the Runner can use this
// ability. Subroutine: End the run. Subroutine: If the threat level is 2 or greater, end the
// run. Subroutine: If the threat level is 4 or greater, end the run.
const threatEtr = (level: number): Subroutine => ({
  label: `If the threat level is ${level} or greater, end the run.`,
  resolve: ({ state }) => {
    if (threatLevel(state) >= level) endTheRun(state);
  },
});
const nPot: CardScript = {
  ice: { runnerBreakCost: 3, subroutines: [endTheRunSub, threatEtr(2), threatEtr(4)] },
};

// Biawak (Sentry - Destroyer): You can forfeit 1 agenda as you rez this ice to pay for 10
// credits of its rez cost. Subroutine: Trash 1 installed program or end the run.
// Subroutine: Trash 1 installed resource or end the run. Subroutine: End the run.
const orEndTheRun = (kind: 'program' | 'resource'): Subroutine => ({
  label: `Trash 1 installed ${kind} or end the run.`,
  resolve: ctx => {
    const cards = kind === 'program' ? ctx.state.runner.rig.programs : ctx.state.runner.rig.resources;
    if (cards.length === 0) return endTheRun(ctx.state);
    askChoice(ctx, 'corp', `Biawak: trash a ${kind} or end the run?`, [
      ...cards.map(c => ({ id: c.instanceId, label: `Trash ${cardDef(c).title}` })),
      { id: 'end', label: 'End the run' },
    ], 'trash_or_end');
  },
});
const biawak: CardScript = {
  rezBlocker: (state, card, cost) => {
    const credits = availableCredits(state, 'corp', { kind: 'rez', card });
    if (credits >= cost) return null;
    return state.corp.scoreArea.length > 0 && credits >= cost - 10 ? null : 'Not enough credits to rez';
  },
  payRez: (ctx, cost) => {
    const { state, card } = ctx;
    const canPay = availableCredits(state, 'corp', { kind: 'rez', card }) >= cost;
    const options = [
      ...(canPay ? [{ id: 'pay', label: `Pay ${cost} credits` }] : []),
      ...(availableCredits(state, 'corp', { kind: 'rez', card }) >= cost - 10
        ? state.corp.scoreArea.map(a => ({ id: a.instanceId, label: `Forfeit ${cardDef(a).title} and pay ${Math.max(0, cost - 10)}` }))
        : []),
    ];
    askChoice(ctx, 'corp', 'Biawak: how do you pay its rez cost?', options, 'rez_cost', { cost });
  },
  ice: { subroutines: [orEndTheRun('program'), orEndTheRun('resource'), endTheRunSub] },
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (source.step === 'rez_cost') {
      const cost = Number(source.data?.cost ?? 0);
      if (answer.optionId === 'pay') {
        spendCredits(state, 'corp', cost, { kind: 'rez', card });
      } else {
        const agenda = state.corp.scoreArea.find(a => a.instanceId === answer.optionId);
        if (!agenda) return;
        forfeitAgenda(state, agenda);
        spendCredits(state, 'corp', Math.max(0, cost - 10), { kind: 'rez', card });
      }
      addLog(state, 'corp', 'Corp rezzed Biawak.', undefined, 'rez');
      completeRez(state, card);
      return;
    }
    if (answer.optionId === 'end') return endTheRun(state);
    const target = [...state.runner.rig.programs, ...state.runner.rig.resources].find(c => c.instanceId === answer.optionId);
    if (target) {
      trashInstalledRunnerCard(state, target);
      addLog(state, 'corp', `Biawak trashed ${cardDef(target).title}.`);
    }
  },
};

// Kessleroid (Barrier): The Runner cannot trash this ice (while it is rezzed).
// Subroutine: End the run. Subroutine: End the run.
const kessleroid: CardScript = { runnerCannotTrash: true, ice: { subroutines: [endTheRunSub, endTheRunSub] } };

// Syailendra (Code Gate - AP): You can advance this ice. When the Runner encounters this ice,
// if it has 3 or more hosted advancement counters, you may place 1 advancement counter on an
// installed card you can advance. Subroutine: You may place 1 advancement counter on an
// installed card you can advance. Subroutine: The Runner loses 2 credits. Subroutine: Do 1 net damage.
const askAdvanceOne = (ctx: EffectContext) => {
  const targets = advanceableInstalled(ctx.state);
  if (targets.length > 0) askCards(ctx, 'corp', 'Syailendra: you may place 1 advancement counter on an installed card you can advance.', ids(targets), 0, 1, 'advance');
};
const syailendra: CardScript = {
  ice: {
    onEncounter: ctx => {
      if (ctx.card.advancementCounters >= 3) askAdvanceOne(ctx);
    },
    subroutines: [
      { label: 'You may place 1 advancement counter on an installed card you can advance.', resolve: askAdvanceOne },
      {
        label: 'The Runner loses 2 credits.',
        resolve: ({ state }) => {
          state.runner.credits = Math.max(0, state.runner.credits - 2);
        },
      },
      netDamageSub(1),
    ],
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards' || answer.cardInstanceIds.length === 0) return;
    const target = advanceableInstalled(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
    if (!target) return;
    target.advancementCounters += 1;
    addLog(state, 'corp', 'Corp placed 1 advancement counter (Syailendra).');
  },
};

// Flyswatter (Code Gate): When you rez this ice during a run against this server, purge
// virus counters. Subroutine: End the run.
const flyswatter: CardScript = {
  ice: {
    subroutines: [endTheRunSub],
    onRezDuringRunOnServer: ({ state }) => {
      const removed = purgeVirusCounters(state);
      addLog(state, 'corp', `Flyswatter purged virus counters (${removed} removed).`);
    },
  },
};

// Lamplighter (Sentry - Observer): When an agenda is scored or stolen from this server or its
// root, trash this ice. Subroutine: Give the Runner 1 tag unless they pay 3 credits.
// Subroutine: End the run if the Runner is tagged.
const lamplighter: CardScript = {
  triggers: {
    agenda_scored: (ctx, e) => {
      if (serverOf(ctx.state, ctx.card)?.id === e.serverId) trashInstalledCard(ctx.state, ctx.card);
    },
    agenda_stolen: ctx => {
      const run = ctx.state.activeRun;
      if (run && serverOf(ctx.state, ctx.card)?.id === run.server) trashInstalledCard(ctx.state, ctx.card);
    },
  },
  ice: {
    subroutines: [
      {
        label: 'Give the Runner 1 tag unless they pay 3 credits.',
        resolve: ctx => {
          if (availableCredits(ctx.state, 'runner') < 3) return giveTags(ctx.state, 1);
          askChoice(ctx, 'runner', 'Lamplighter: pay 3 credits or take 1 tag?', [
            { id: 'pay', label: 'Pay 3 credits' },
            { id: 'tag', label: 'Take 1 tag' },
          ], 'tag');
        },
      },
      {
        label: 'End the run if the Runner is tagged.',
        resolve: ({ state }) => {
          if (state.runner.tags > 0) endTheRun(state);
        },
      },
    ],
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'pay') spendCredits(state, 'runner', 3);
    else giveTags(state, 1);
  },
};

// --- Operations -------------------------------------------------------------------

// Nanomanagement: Gain click click.
const nanomanagement: CardScript = {
  onPlay: ({ state }) => {
    state.corp.clicks += 2;
    addLog(state, 'corp', 'Corp gained [click][click].');
  },
};

// Top-Down Solutions: Draw 2 cards. Install up to 2 cards from HQ (one at a time).
const topDownSolutions: CardScript = {
  onPlay: ctx => {
    drawForEffect(ctx.state, 'corp', 2, 'Top-Down Solutions');
    if (!ctx.state.winner) askInstallFromHQ(ctx, 2, '');
  },
  onPromptAnswer: (ctx, source, answer) => void installFromHQAnswer(ctx, source, answer),
};

// Peer Review (Transaction): Reveal all but 1 card in HQ. Gain 7 credits. You may install
// 1 card from HQ in the root of a remote server.
const peerReviewTargets = (state: GameState) =>
  installable(state, state.corp.hq.filter(c => type(c) !== 'ice'), { remoteRootOnly: true });
const peerReview: CardScript = {
  onPlay: ctx => {
    const { state, card } = ctx;
    const shown = state.corp.hq.slice(1);
    if (shown.length > 0) addLog(state, 'corp', `Corp revealed ${shown.map(c => cardDef(c).title).join(', ')} (Peer Review).`);
    gainFromCard(state, 'corp', 7, card);
    const targets = peerReviewTargets(state);
    if (targets.length > 0) askCards(ctx, 'corp', 'Peer Review: you may install 1 card from HQ in the root of a remote server.', ids(targets), 0, 1, 'pick');
  },
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'pick' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      askCorpInstall(ctx, answer.cardInstanceIds[0], 'server', { remoteRootOnly: true });
    } else if (source.step === 'server') {
      installCorpChoice(ctx.state, source, answer);
    }
  },
};

// Bigger Picture (Gray Ops): Play only if the Runner is tagged. Resolve 1 of the following:
// Give the Runner 1 tag. Remove any number of tags. The Runner loses 5 credits for each tag
// removed this way. Gain credits equal to the number of credits the Runner lost.
const biggerPicture: CardScript = {
  canPlay: ({ state }) => (state.runner.tags > 0 ? null : 'The Runner must be tagged'),
  onPlay: ctx => {
    const tags = ctx.state.runner.tags;
    askChoice(ctx, 'corp', 'Bigger Picture: choose one.', [
      { id: 'tag', label: 'Give the Runner 1 tag' },
      ...Array.from({ length: tags }, (_, i) => ({ id: String(i + 1), label: `Remove ${i + 1} tag(s): the Runner loses ${5 * (i + 1)} credits` })),
    ], 'choose');
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'tag') return giveTags(state, 1);
    const removed = removeTags(state, Number(answer.optionId));
    const lost = Math.min(state.runner.credits, 5 * removed);
    state.runner.credits -= lost;
    addLog(state, 'corp', `Corp removed ${removed} tag(s); the Runner lost ${lost} [credit] (Bigger Picture).`);
    gainFromCard(state, 'corp', lost, card);
  },
};

// IP Enforcement (Gray Ops): As an additional cost to play this operation, remove X tags.
// Install 1 agenda from the Runner's score area with a printed agenda point value equal to X.
// If the Runner is still tagged, place 1 advancement counter on that agenda.
const ipTargets = (state: GameState) =>
  state.runner.scoreArea.filter(a => (cardDef(a).agenda_points ?? 0) > 0 && (cardDef(a).agenda_points ?? 0) <= state.runner.tags);
const ipEnforcement: CardScript = {
  canPlay: ({ state }) => (ipTargets(state).length > 0 ? null : 'Needs an agenda in the Runner\'s score area worth no more than their tags'),
  onPlay: ctx => askCards(ctx, 'corp', 'IP Enforcement: choose an agenda in the Runner\'s score area (remove tags equal to its points).', ids(ipTargets(ctx.state)), 1, 1, 'agenda'),
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'agenda' && answer.kind === 'effect_cards') {
      const agenda = state.runner.scoreArea.find(a => a.instanceId === answer.cardInstanceIds[0]);
      if (!agenda) return;
      const x = cardDef(agenda).agenda_points ?? 0;
      removeTags(state, x);
      addLog(state, 'corp', `Corp removed ${x} tag(s) (IP Enforcement).`);
      askCorpInstall(ctx, agenda.instanceId, 'server', { remoteRootOnly: true });
    } else if (source.step === 'server' && answer.kind === 'effect_choice') {
      const agenda = state.runner.scoreArea.find(a => a.instanceId === source.data?.cardId);
      if (!agenda) return;
      state.runner.score -= cardDef(agenda).agenda_points ?? 0;
      agenda.isRezzed = false;
      installCorpChoice(state, source, answer);
      if (state.runner.tags > 0) agenda.advancementCounters += 1;
      addLog(state, 'corp', `Corp installed ${cardDef(agenda).title} from the Runner's score area (IP Enforcement).`, undefined, 'install');
    }
  },
};

// Touch-ups (Double): As an additional cost to play this operation, spend click. Place 2
// advancement counters on 1 installed card you can advance. If you do, choose a card type and
// reveal the grip. Choose up to 2 revealed cards of that type. The Runner shuffles those cards into the stack.
const RUNNER_TYPES = ['event', 'hardware', 'program', 'resource'] as const;
const touchUps: CardScript = {
  extraClicks: 1,
  onPlay: ctx => {
    const targets = advanceableInstalled(ctx.state);
    if (targets.length > 0) askCards(ctx, 'corp', 'Touch-ups: place 2 advancement counters on 1 installed card you can advance.', ids(targets), 1, 1, 'advance');
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'advance' && answer.kind === 'effect_cards') {
      const target = advanceableInstalled(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!target) return;
      target.advancementCounters += 2;
      addLog(state, 'corp', 'Corp placed 2 advancement counters (Touch-ups).');
      askChoice(ctx, 'corp', 'Touch-ups: choose a card type, then reveal the grip.', RUNNER_TYPES.map(t => ({ id: t, label: t[0].toUpperCase() + t.slice(1) })), 'type');
    } else if (source.step === 'type' && answer.kind === 'effect_choice') {
      addLog(state, 'corp', `The Runner revealed their grip: ${state.runner.grip.map(c => cardDef(c).title).join(', ') || 'empty'}.`);
      const matching = state.runner.grip.filter(c => type(c) === answer.optionId);
      if (matching.length === 0) return;
      askCards(ctx, 'corp', 'Touch-ups: choose up to 2 of them to shuffle into the stack.', ids(matching), 0, Math.min(2, matching.length), 'shuffle');
    } else if (source.step === 'shuffle' && answer.kind === 'effect_cards') {
      for (const id of answer.cardInstanceIds) {
        const card = state.runner.grip.find(c => c.instanceId === id);
        if (!card) continue;
        removeCard(state.runner.grip, card);
        state.runner.stack.push(card);
      }
      shuffleInPlace(state.rng, state.runner.stack);
      addLog(state, 'runner', `The Runner shuffled ${answer.cardInstanceIds.length} card(s) into their stack (Touch-ups).`);
    }
  },
};

// Key Performance Indicators (Transaction): Resolve 2 of the following in any order:
// Draw 1 card. Shuffle 1 card from HQ into R&D. / Install 1 piece of ice from HQ, ignoring all
// costs. / Place 1 advancement counter on an installed card you can advance. / Gain 2 credits.
const KPI_OPTIONS = [
  { id: 'draw', label: 'Draw 1 card, then shuffle 1 card from HQ into R&D' },
  { id: 'ice', label: 'Install 1 ice from HQ, ignoring all costs' },
  { id: 'advance', label: 'Place 1 advancement counter on a card you can advance' },
  { id: 'credits', label: 'Gain 2 credits' },
];
function askKpi(ctx: EffectContext, done: string[]): void {
  if (done.length >= 2) return;
  const options = KPI_OPTIONS.filter(o => !done.includes(o.id));
  askChoice(ctx, 'corp', `Key Performance Indicators: choose ${done.length === 0 ? 'the first' : 'the second'} effect.`, options, 'choose', { done });
}
const kpi: CardScript = {
  onPlay: ctx => askKpi(ctx, []),
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    const done = (source.data?.done as string[]) ?? [];
    if (source.step === 'choose' && answer.kind === 'effect_choice') {
      const now = [...done, answer.optionId];
      switch (answer.optionId) {
        case 'draw':
          drawCards(state, 'corp', 1);
          addLog(state, 'corp', 'Corp drew 1 card (Key Performance Indicators).');
          if (state.corp.hq.length > 0) return askCards(ctx, 'corp', 'KPI: shuffle 1 card from HQ into R&D.', ids(state.corp.hq), 1, 1, 'shuffle', { done: now });
          break;
        case 'ice': {
          const ice = installable(state, state.corp.hq.filter(c => type(c) === 'ice'), { ignoreCosts: true });
          if (ice.length > 0) return askCards(ctx, 'corp', 'KPI: install 1 ice from HQ, ignoring all costs.', ids(ice), 1, 1, 'ice', { done: now });
          break;
        }
        case 'advance': {
          const targets = advanceableInstalled(state);
          if (targets.length > 0) return askCards(ctx, 'corp', 'KPI: place 1 advancement counter.', ids(targets), 1, 1, 'advance', { done: now });
          break;
        }
        case 'credits':
          gainFromCard(state, 'corp', 2, card);
          addLog(state, 'corp', 'Corp gained 2 [credit] (Key Performance Indicators).');
          break;
      }
      return askKpi(ctx, now);
    }
    if (source.step === 'shuffle' && answer.kind === 'effect_cards') {
      const target = state.corp.hq.find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (target) {
        removeCard(state.corp.hq, target);
        state.corp.rd.push(target);
        shuffleInPlace(state.rng, state.corp.rd);
      }
      return askKpi(ctx, done);
    }
    if (source.step === 'ice' && answer.kind === 'effect_cards') {
      if (!askCorpInstall(ctx, answer.cardInstanceIds[0], 'ice_server', { ignoreCosts: true }, { done })) askKpi(ctx, done);
      return;
    }
    if (source.step === 'ice_server') {
      installCorpChoice(state, source, answer, { ignoreCosts: true });
      return askKpi(ctx, done);
    }
    if (source.step === 'advance' && answer.kind === 'effect_cards') {
      const target = advanceableInstalled(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (target) target.advancementCounters += 1;
      return askKpi(ctx, done);
    }
  },
};

// Measured Response (Black Ops): Play only if the threat level is 4 or greater, and only if
// the Runner made a successful run during their last turn. Do 4 meat damage unless the Runner pays 8 credits.
const measuredResponse: CardScript = {
  canPlay: ({ state }) => {
    if (threatLevel(state) < 4) return 'The threat level must be 4 or greater';
    return state.runnerLastTurnRuns.some(r => r.successful) ? null : 'The Runner did not make a successful run during their last turn';
  },
  onPlay: ctx => {
    if (ctx.state.runner.credits < 8) return void dealMeatDamage(ctx.state, 4);
    askChoice(ctx, 'runner', 'Measured Response: pay 8 credits or suffer 4 meat damage?', [
      { id: 'pay', label: 'Pay 8 credits' },
      { id: 'damage', label: 'Take 4 meat damage' },
    ], 'choice');
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'pay') {
      state.runner.credits -= 8;
      addLog(state, 'runner', 'Runner paid 8 [credit] (Measured Response).');
    } else {
      dealMeatDamage(state, 4);
    }
  },
};

// Petty Cash (Transaction): Play only if you have not finished an action yet this turn.
// Gain 5 credits. If you played this operation from anywhere except HQ, gain click.
// click: Play this operation from Archives. After it resolves, remove it from the game.
const pettyCash: CardScript = {
  canPlay: ({ state }) => (turnFlag(state, TurnFlag.actionsFinished) === 0 ? null : 'You have already finished an action this turn'),
  onPlay: ({ state, card, playedFromHand }) => {
    gainFromCard(state, 'corp', 5, card);
    addLog(state, 'corp', 'Corp gained 5 [credit] (Petty Cash).');
    if (!playedFromHand) {
      state.corp.clicks += 1;
      addLog(state, 'corp', 'Corp gained [click] (Petty Cash).');
    }
  },
  abilities: [
    {
      label: 'Play Petty Cash from Archives, then remove it from the game.',
      clicks: 1,
      fromArchives: true,
      canUse: ({ state, card }) => safePlayBlockerFrom(state, card),
      resolve: ({ state, card }) => {
        const zone = state.corp.archives.faceUp.includes(card) ? state.corp.archives.faceUp : state.corp.archives.faceDown;
        playCardFrom(state, 'corp', card, zone, { fromHand: false, removeAfter: true });
      },
    },
  ],
};

// --- Upgrades -------------------------------------------------------------------

// Mercia B4LL4RD: When your action phase ends, you may install 1 piece of ice from HQ,
// paying 1 credit less. If you do, move this upgrade to the root of the server that piece of ice is protecting.
const merciaTargets = (state: GameState) => installable(state, state.corp.hq.filter(c => type(c) === 'ice'), { discount: 1 });
const mercia: CardScript = {
  triggers: {
    action_phase_ends: (ctx, e) => {
      const ice = merciaTargets(ctx.state);
      if (e.side !== 'corp' || ice.length === 0) return;
      askCards(ctx, 'corp', 'Mercia B4LL4RD: you may install 1 ice from HQ, paying 1 credit less.', ids(ice), 0, 1, 'pick');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    if (source.step === 'pick' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      askCorpInstall(ctx, answer.cardInstanceIds[0], 'server', { discount: 1 });
    } else if (source.step === 'server') {
      const serverId = installCorpChoice(state, source, answer, { discount: 1 });
      const from = serverOf(state, card);
      if (!serverId || !from || from.id === serverId) return;
      removeCard(from.root, card);
      state.corp.servers[serverId].root.push(card);
      addLog(state, 'corp', `Mercia B4LL4RD moved to ${state.corp.servers[serverId].name}.`);
    }
  },
};

// Mitra Aman: Whenever the Runner approaches a piece of ice protecting this server, you may
// trash this upgrade. If you do, gain 3 credits and you may swap the ice being approached
// with a piece of ice from Archives or HQ.
const mitraAman: CardScript = {
  triggers: {
    approach_ice: (ctx, e) => {
      if (serverOf(ctx.state, ctx.card)?.id !== e.server) return;
      askChoice(ctx, 'corp', 'Mitra Aman: trash it to gain 3 credits (and you may swap the approached ice)?', [
        { id: 'trash', label: 'Trash Mitra Aman' },
        { id: 'no', label: 'No' },
      ], 'trash', { iceId: e.ice.instanceId });
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    if (source.step === 'trash' && answer.kind === 'effect_choice' && answer.optionId === 'trash') {
      if (!serverOf(state, card)) return;
      trashInstalledCard(state, card);
      gainCredits(state, 'corp', 3);
      addLog(state, 'corp', 'Corp trashed Mitra Aman and gained 3 [credit].');
      const swaps = [...state.corp.hq, ...archivesCards(state)].filter(c => type(c) === 'ice');
      if (swaps.length > 0) {
        askCards(ctx, 'corp', 'Mitra Aman: you may swap the approached ice with ice from HQ or Archives.', ids(swaps), 0, 1, 'swap', {
          iceId: source.data!.iceId as string,
        });
      }
    } else if (source.step === 'swap' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      swapWithInstalled(state, source.data!.iceId as string, answer.cardInstanceIds[0]);
    }
  },
};

/** Swaps an installed ice with a piece of ice in HQ or Archives (Mitra Aman). */
function swapWithInstalled(state: GameState, installedId: string, otherId: string): void {
  const found = findInstalledCorpCard(state, installedId);
  const zone = [state.corp.hq, state.corp.archives.faceUp, state.corp.archives.faceDown].find(z => z.some(c => c.instanceId === otherId));
  if (!found || found.location !== 'ice' || !zone) return;
  const other = zone.find(c => c.instanceId === otherId)!;
  const index = found.server.ice.indexOf(found.card);
  // Programs hosted on the outgoing ice are trashed with it leaving play
  for (const hostedId of found.card.hostedCardIds) {
    const hosted = state.runner.rig.programs.find(p => p.instanceId === hostedId);
    if (hosted) trashInstalledRunnerCard(state, hosted);
  }
  const outgoing = found.card;
  outgoing.hostedCardIds = [];
  outgoing.isRezzed = false;
  outgoing.advancementCounters = 0;
  outgoing.tokens = {};
  zone[zone.indexOf(other)] = outgoing;
  other.isRezzed = false;
  delete other.installedTurn;
  found.server.ice[index] = other;
  addLog(state, 'corp', `Corp swapped the approached ice with a piece of ice from ${zone === state.corp.hq ? 'HQ' : 'Archives'}.`);
}

// Mahkota Langit Grid (Region): 2 recurring credits. You can spend hosted credits to rez
// assets in the root of this server and ice protecting this server. Persistent -> The trash
// cost of each asset in the root of this server is increased by 2 credits. Limit 1 region per server.
const mahkota: CardScript = {
  recurringCredits: 2,
  persistent: true,
  paysFor: (state, self, purpose) => {
    if (purpose.kind !== 'rez') return false;
    const server = serverOf(state, self);
    if (!server) return false;
    return server.ice.includes(purpose.card) || (server.root.includes(purpose.card) && type(purpose.card) === 'asset');
  },
  modifiers: {
    trashCost: (state, self, trashing, serverId) => {
      const own = serverOf(state, self)?.id ?? state.activeRun?.persistentServers[self.instanceId];
      return type(trashing) === 'asset' && own !== undefined && own === serverId ? 2 : 0;
    },
  },
};

const getScript = (card: CardInstance) => getCardScript(card.cardCode);

export const elevationCorpScripts: Record<string, CardScript> = {
  '35035': leo,
  '35036': poetri,
  '35037': aggressiveTrendsetting,
  '35038': projectIngatan,
  '35039': humanoidResources,
  '35040': ottoCampaign,
  '35041': bumi,
  '35042': scatterField,
  '35043': nanomanagement,
  '35044': topDownSolutions,
  '35045': mercia,
  '35046': auCo,
  '35047': ptUntaian,
  '35048': proprionegation,
  '35049': sericulture,
  '35050': byte,
  '35051': phat,
  '35052': empiricist,
  '35053': mycoweb,
  '35054': semakSamun,
  '35055': peerReview,
  '35056': mitraAman,
  '35057': nebula,
  '35058': synapse,
  '35059': embeddedReporting,
  '35060': nextBigThing,
  '35061': idiosyncresis,
  '35062': publicAccessPlaza,
  '35063': doomscroll,
  '35064': nPot,
  '35065': biggerPicture,
  '35066': ipEnforcement,
  '35067': touchUps,
  '35068': bangun,
  '35069': zwicky,
  '35070': greenmail,
  '35071': offTheBooks,
  '35072': anthill,
  '35073': plutus,
  '35074': biawak,
  '35075': kessleroid,
  '35076': syailendra,
  '35077': kpi,
  '35078': measuredResponse,
  '35079': flyswatter,
  '35080': lamplighter,
  '35081': pettyCash,
  '35082': mahkota,
};

