import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { shuffleRD } from '../../../engine/rdKnowledge';
import { addLog } from '../../../engine/log';
import { removeCard, revealInHand } from '../../../engine/helpers';
import { runnerSeesRd } from '../../../engine/rdKnowledge';
import { moveRunnerTo } from '../../../engine/ice';
import {
  addCounters,
  counters,
  drawForEffect,
  gainFromCard,
  placeDividends,
  removeCounters,
  useOncePerTurn,
} from '../../../engine/cardEffects';
import { CardScript, EffectContext } from '../../types';
import { askCards, askEvenIfNone, askChoice, askCorpInstall, corpInstallOptions, installCorpChoice, takeFromRD } from '../../effects';
import { archivesCards, ids, installable, isSelf, onceKey, type } from './helpers';

const installedCorpCards = (state: GameState) => Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]);

/** "When you score this agenda": the handler runs only for this agenda. */
const onScore = (fn: (ctx: EffectContext) => void) => (ctx: EffectContext, e: { card: CardInstance }) => isSelf(ctx, e.card) && fn(ctx);

/** "Dividends N ... When your discard phase ends, you may remove 1 hosted agenda counter to ..." */
function dividendAgenda(perExcess: number, label: string, canUse: (state: GameState) => boolean, use: (ctx: EffectContext) => void, more: Partial<CardScript> = {}): CardScript {
  return {
    ...more,
    triggers: {
      agenda_scored: (ctx, e) => isSelf(ctx, e.card) && placeDividends(ctx.state, ctx.card, perExcess, e.advancementCounters),
      discard_phase_ends: (ctx, e) => {
        if (e.side !== 'corp' || counters(ctx.card, 'agenda') === 0) return;
        // canUse can depend on hidden cards (an operation in R&D, a facedown card in Archives): asked anyway when the
        // Corp's stops are on ALL (4.2.2, 4.4.6c, see askEvenIfNone)
        askEvenIfNone(
          ctx,
          'corp',
          canUse(ctx.state),
          () =>
            askChoice(ctx, 'corp', `${cardDef(ctx.card).title}: remove 1 agenda counter to ${label}?`, [
              { id: 'use', label: `Remove 1 agenda counter: ${label}` },
              { id: 'no', label: 'No' },
            ], 'dividend'),
          `${cardDef(ctx.card).title}: nothing to ${label} with.`,
        );
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

// Aggressive Trendsetting: The first time the Runner trashes an installed Corp card during
// each of their turns, they may spend click. If they do not, you get +1 allotted click for
// your next turn.
export const aggressiveTrendsetting: CardScript = {
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

export const projectIngatan = dividendAgenda(
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
export const proprionegation: CardScript = {
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
export const sericulture = dividendAgenda(
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

export const embeddedReporting = dividendAgenda(
  2,
  'search R&D for 1 operation and put it on top',
  state => rdOperations(state).length > 0,
  ctx => askCards(ctx, 'corp', 'Embedded Reporting: search R&D for 1 operation.', ids(rdOperations(ctx.state)), 1, 1, 'search'),
  {
    onPromptAnswer: ({ state }, source, answer) => {
      if (source.step !== 'search' || answer.kind !== 'effect_cards') return;
      const card = takeFromRD(state, answer.cardInstanceIds[0]);
      if (card) {
        state.corp.rd.unshift(card);
        runnerSeesRd(state, card); // revealed, then put on top
      }
    },
  }
);

// Off the Books: Dividends 1. When your discard phase ends, you may remove 1 hosted agenda
// counter to search R&D for 1 card and reveal it. (Shuffle R&D.) You may install that
// card, ignoring all costs. If you do not, add it to HQ.
export const offTheBooks = dividendAgenda(
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
        if (options.length === 0) {
          revealInHand(state, 'corp', [card]);
          return;
        }
        askChoice(ctx, 'corp', `Off the Books: install ${cardDef(card).title} ignoring all costs, or add it to HQ?`, [
          ...options,
          { id: 'hq', label: 'Add it to HQ' },
        ], 'install', { cardId: card.instanceId });
      } else if (source.step === 'install' && answer.kind === 'effect_choice' && answer.optionId !== 'hq') {
        installCorpChoice(state, source, answer, { ignoreCosts: true, revealed: true });
      } else if (source.step === 'install' && answer.kind === 'effect_choice') {
        const card = state.corp.hq.find(c => c.instanceId === source.data?.cardId);
        if (card) revealInHand(state, 'corp', [card]);
      }
    },
  }
);

// Next Big Thing: When this agenda is scored or stolen, place 1 agenda counter on it.
// click, hosted agenda counter: Draw 4 cards. Shuffle any number of cards from HQ into
// R&D. The Corp can use this ability even if this agenda is in the Runner's score area.
export const nextBigThing: CardScript = {
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
    shuffleRD(state);
    addLog(state, 'corp', `Corp shuffled ${answer.cardInstanceIds.length} card(s) from HQ into R&D.`);
  },
};

// Greenmail: When you score this agenda, gain 2 credits. When you forfeit this agenda, gain 4 credits.
export const greenmail: CardScript = {
  triggers: {
    agenda_scored: onScore(({ state, card }) => gainFromCard(state, 'corp', 2, card)),
    agenda_forfeited: (ctx, e) => isSelf(ctx, e.card) && gainFromCard(ctx.state, 'corp', 4, ctx.card),
  },
};

// --- Assets -----------------------------------------------------------------

export const elevationCorpAgendasScripts: Record<string, CardScript> = {
  '35037': aggressiveTrendsetting,
  '35038': projectIngatan,
  '35048': proprionegation,
  '35049': sericulture,
  '35059': embeddedReporting,
  '35060': nextBigThing,
  '35070': greenmail,
  '35071': offTheBooks,
};
