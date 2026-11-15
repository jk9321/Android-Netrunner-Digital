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
import { corpInstallOptions, installCorpChoice, takeFromRD } from '../../effects';
import { cards, cardsQuestion, choice, ChoiceStep, choiceQuestion, Flow, InstallData, NoData, prompts } from '../../steps';
import { archivesCards, ids, installable, isSelf, onceKey, type } from './helpers';

const installedCorpCards = (state: GameState) => Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]);

/** "When you score this agenda": the handler runs only for this agenda. */
const onScore = (fn: (ctx: EffectContext) => void) => (ctx: EffectContext, e: { card: CardInstance }) => isSelf(ctx, e.card) && fn(ctx);

/** The "remove 1 hosted agenda counter to ..." step of a dividend agenda: `use` asks the agenda's own next question. */
const dividendStep = (use: (ctx: EffectContext) => void) =>
  choice((ctx, a) => {
    if (a.optionId !== 'use') return;
    removeCounters(ctx.card, 'agenda', 1);
    use(ctx);
  });

/** "Dividends N ... When your discard phase ends, you may remove 1 hosted agenda counter to ..." (`flow` has a dividendStep). */
function dividendAgenda(perExcess: number, label: string, canUse: (state: GameState) => boolean, flow: Flow<{ dividend: ChoiceStep<NoData> }>): CardScript {
  return {
    triggers: {
      agenda_scored: (ctx, e) => isSelf(ctx, e.card) && placeDividends(ctx.state, ctx.card, perExcess, e.advancementCounters),
      discard_phase_ends: (ctx, e) => {
        if (e.side !== 'corp' || counters(ctx.card, 'agenda') === 0) return;
        // canUse can depend on hidden cards (an operation in R&D, a facedown card in Archives): asked anyway when the
        // Corp's stops are on ALL (4.2.2, 4.4.6c, see askEvenIfNone)
        flow.evenIfNone(
          ctx,
          'corp',
          canUse(ctx.state),
          () =>
            flow.ask(
              ctx,
              'dividend',
              choiceQuestion('corp', `${cardDef(ctx.card).title}: remove 1 agenda counter to ${label}?`, [
                { id: 'use', label: `Remove 1 agenda counter: ${label}` },
                { id: 'no', label: 'No' },
              ]),
            ),
          `${cardDef(ctx.card).title}: nothing to ${label} with.`,
        );
      },
    },
    ...flow.script,
  };
}

// --- Identities -------------------------------------------------------------

// Aggressive Trendsetting: The first time the Runner trashes an installed Corp card during
// each of their turns, they may spend click. If they do not, you get +1 allotted click for
// your next turn.
const trendsettingFlow = prompts({
  click: choice(({ state }, a) => {
    if (a.optionId === 'spend' && state.runner.clicks > 0) {
      state.runner.clicks -= 1;
      addLog(state, 'runner', 'Runner spent [click] (Aggressive Trendsetting).');
    } else {
      state.corp.bonusClicksNextTurn = (state.corp.bonusClicksNextTurn ?? 0) + 1;
      addLog(state, 'corp', 'Corp gets +1 [click] next turn (Aggressive Trendsetting).');
    }
  }),
});

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
      trendsettingFlow.ask(
        ctx,
        'click',
        choiceQuestion('runner', 'Aggressive Trendsetting: spend [click], or the Corp gets +1 [click] next turn.', [
          { id: 'spend', label: 'Spend [click]' },
          { id: 'no', label: 'Let the Corp have an extra [click]' },
        ]),
      );
    },
  },
  ...trendsettingFlow.script,
};

// Project Ingatan: Dividends 1. When your discard phase ends, you may remove 1 hosted agenda
// counter to install 1 card from Archives, ignoring all costs.
const ingatanTargets = (state: GameState) => installable(state, archivesCards(state), { ignoreCosts: true });

const ingatanFlow = prompts({
  dividend: dividendStep(ctx => ingatanFlow.ask(ctx, 'pick', cardsQuestion('corp', 'Project Ingatan: install 1 card from Archives, ignoring all costs.', ids(ingatanTargets(ctx.state)), 1, 1))),
  pick: cards((ctx, a) => void ingatanFlow.corpInstall(ctx, a.ids[0], 'server', { ignoreCosts: true })),
  server: choice<InstallData>((ctx, a, _d, source) => void installCorpChoice(ctx.state, source, a.raw, { ignoreCosts: true })),
});

export const projectIngatan = dividendAgenda(1, 'install 1 card from Archives', state => ingatanTargets(state).length > 0, ingatanFlow);

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
const sericultureFlow = prompts({
  dividend: dividendStep(ctx =>
    sericultureFlow.ask(ctx, 'advance', cardsQuestion('corp', 'Sericulture Expansion: place 2 advancement counters on 1 installed card.', ids(installedCorpCards(ctx.state)), 1, 1)),
  ),
  advance: cards(({ state }, a) => {
    const target = installedCorpCards(state).find(c => c.instanceId === a.ids[0]);
    if (!target) return;
    target.advancementCounters += 2;
    addLog(state, 'corp', 'Corp placed 2 advancement counters on an installed card (Sericulture Expansion).');
  }),
});

export const sericulture = dividendAgenda(1, 'place 2 advancement counters on 1 installed card', state => installedCorpCards(state).length > 0, sericultureFlow);

// Embedded Reporting: Dividends 2. When your discard phase ends, you may remove 1 hosted
// agenda counter to search R&D for 1 operation and reveal it. (Shuffle R&D.) Add that
// operation to the top of R&D.
const rdOperations = (state: GameState) => state.corp.rd.filter(c => type(c) === 'operation');

const embeddedFlow = prompts({
  dividend: dividendStep(ctx => embeddedFlow.ask(ctx, 'search', cardsQuestion('corp', 'Embedded Reporting: search R&D for 1 operation.', ids(rdOperations(ctx.state)), 1, 1))),
  search: cards(({ state }, a) => {
    const card = takeFromRD(state, a.ids[0]);
    if (card) {
      state.corp.rd.unshift(card);
      runnerSeesRd(state, card); // revealed, then put on top
    }
  }),
});

export const embeddedReporting = dividendAgenda(2, 'search R&D for 1 operation and put it on top', state => rdOperations(state).length > 0, embeddedFlow);

// Off the Books: Dividends 1. When your discard phase ends, you may remove 1 hosted agenda
// counter to search R&D for 1 card and reveal it. (Shuffle R&D.) You may install that
// card, ignoring all costs. If you do not, add it to HQ.
const offTheBooksFlow = prompts({
  dividend: dividendStep(ctx => offTheBooksFlow.ask(ctx, 'search', cardsQuestion('corp', 'Off the Books: search R&D for 1 card.', ids(ctx.state.corp.rd), 1, 1))),
  search: cards((ctx, a) => {
    const { state } = ctx;
    const card = takeFromRD(state, a.ids[0]);
    if (!card) return;
    // Set aside in HQ while choosing; installing takes it from there
    state.corp.hq.push(card);
    const options = type(card) === 'operation' ? [] : corpInstallOptions(state, card, { ignoreCosts: true });
    if (options.length === 0) {
      revealInHand(state, 'corp', [card]);
      return;
    }
    offTheBooksFlow.ask(
      ctx,
      'install',
      choiceQuestion('corp', `Off the Books: install ${cardDef(card).title} ignoring all costs, or add it to HQ?`, [...options, { id: 'hq', label: 'Add it to HQ' }]),
      { cardId: card.instanceId },
    );
  }),
  // Not the reserved install data (no `install: true`): the question also offers adding the card to HQ
  install: choice<{ cardId: string }>(({ state }, a, data, source) => {
    if (a.optionId !== 'hq') return void installCorpChoice(state, source, a.raw, { ignoreCosts: true, revealed: true });
    const card = state.corp.hq.find(c => c.instanceId === data.cardId);
    if (card) revealInHand(state, 'corp', [card]);
  }),
});

export const offTheBooks = dividendAgenda(1, 'search R&D for 1 card', state => state.corp.rd.length > 0, offTheBooksFlow);

// Next Big Thing: When this agenda is scored or stolen, place 1 agenda counter on it.
// click, hosted agenda counter: Draw 4 cards. Shuffle any number of cards from HQ into
// R&D. The Corp can use this ability even if this agenda is in the Runner's score area.
const nextBigThingFlow = prompts({
  shuffle: cards(({ state }, a) => {
    for (const id of a.ids) {
      const card = state.corp.hq.find(c => c.instanceId === id);
      if (card) {
        removeCard(state.corp.hq, card);
        state.corp.rd.push(card);
      }
    }
    shuffleRD(state);
    addLog(state, 'corp', `Corp shuffled ${a.ids.length} card(s) from HQ into R&D.`);
  }),
});

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
        nextBigThingFlow.ask(ctx, 'shuffle', cardsQuestion('corp', 'Next Big Thing: shuffle any number of cards from HQ into R&D.', ids(state.corp.hq), 0, state.corp.hq.length));
      },
    },
  ],
  ...nextBigThingFlow.script,
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
