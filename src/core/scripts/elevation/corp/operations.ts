import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { shuffleInPlace } from '../../../rng';
import { shuffleRD } from '../../../engine/rdKnowledge';
import { addLog } from '../../../engine/log';
import { drawCards, forgetInHand, removeCard, revealInHand } from '../../../engine/helpers';
import { playCardFrom } from '../../../engine/actions/play';
import { dealMeatDamage, giveTags } from '../../../engine/damage';
import { agendaPoints, drawForEffect, gainFromCard, removeTags, threatLevel, turnFlag, TurnFlag } from '../../../engine/cardEffects';
import { CardScript, EffectContext } from '../../types';
import { advanceableInstalled, installCorpChoice } from '../../effects';
import { cards, cardsQuestion, choice, choiceQuestion, InstallData, prompts } from '../../steps';
import { askInstallFromHQ, ids, installFromHQ, installable,  safePlayBlockerFrom, type } from './helpers';

// Nanomanagement: Gain click click.
export const nanomanagement: CardScript = {
  onPlay: ({ state }) => {
    state.corp.clicks += 2;
    addLog(state, 'corp', 'Corp gained [click][click].');
  },
};

// Top-Down Solutions: Draw 2 cards. Install up to 2 cards from HQ (one at a time).
export const topDownSolutions: CardScript = {
  onPlay: ctx => {
    drawForEffect(ctx.state, 'corp', 2, 'Top-Down Solutions');
    if (!ctx.state.winner) askInstallFromHQ(ctx, 2, '');
  },
  ...installFromHQ.script,
};

// Peer Review (Transaction): Reveal all but 1 card in HQ. Gain 7 credits. You may install
// 1 card from HQ in the root of a remote server.
const peerReviewTargets = (state: GameState) =>
  installable(state, state.corp.hq.filter(c => type(c) !== 'ice'), { remoteRootOnly: true });

const peerReviewFlow = prompts({
  hide: cards((ctx, a) => peerReviewResolve(ctx, a.ids[0])),
  pick: cards((ctx, a) => {
    if (a.ids.length > 0) peerReviewFlow.corpInstall(ctx, a.ids[0], 'server', { remoteRootOnly: true });
  }),
  server: choice<{ cardId: string; install: true }>((ctx, a, _d, source) => void installCorpChoice(ctx.state, source, a.raw)),
});

function peerReviewResolve(ctx: EffectContext, hiddenId: string | undefined): void {
  const { state, card } = ctx;
  const shown = state.corp.hq.filter(c => c.instanceId !== hiddenId);
  if (shown.length > 0) addLog(state, 'corp', `Corp revealed ${shown.map(c => cardDef(c).title).join(', ')} (Peer Review).`);
  revealInHand(state, 'corp', shown);
  gainFromCard(state, 'corp', 7, card);
  const targets = peerReviewTargets(state);
  if (targets.length > 0) peerReviewFlow.cards(ctx, 'pick', { side: 'corp', message: 'Peer Review: you may install 1 card from HQ in the root of a remote server.', candidateIds: ids(targets), min: 0, max: 1 });
}

export const peerReview: CardScript = {
  onPlay: ctx => {
    const hq = ctx.state.corp.hq;
    // The Corp chooses which card stays hidden (rules 1.14.5: the controller makes the choices)
    if (hq.length >= 2) peerReviewFlow.ask(ctx, 'hide', cardsQuestion('corp', 'Peer Review: choose 1 card in HQ to keep hidden. The rest are revealed.', ids(hq), 1, 1));
    else peerReviewResolve(ctx, hq[0]?.instanceId);
  },
  ...peerReviewFlow.script,
};

// Bigger Picture (Gray Ops): Play only if the Runner is tagged. Resolve 1 of the following:
// Give the Runner 1 tag. Remove any number of tags. The Runner loses 5 credits for each tag
// removed this way. Gain credits equal to the number of credits the Runner lost.
const biggerPictureFlow = prompts({
  choose: choice(({ state, card }, a) => {
    if (a.optionId === 'tag') return giveTags(state, 1);
    const removed = removeTags(state, Number(a.optionId));
    const lost = Math.min(state.runner.credits, 5 * removed);
    state.runner.credits -= lost;
    addLog(state, 'corp', `Corp removed ${removed} tag(s); the Runner lost ${lost} [credit] (Bigger Picture).`);
    gainFromCard(state, 'corp', lost, card);
  }),
});

export const biggerPicture: CardScript = {
  canPlay: ({ state }) => (state.runner.tags > 0 ? null : 'The Runner must be tagged'),
  onPlay: ctx => {
    const tags = ctx.state.runner.tags;
    biggerPictureFlow.ask(
      ctx,
      'choose',
      choiceQuestion('corp', 'Bigger Picture: choose one.', [
        { id: 'tag', label: 'Give the Runner 1 tag' },
        ...Array.from({ length: tags }, (_, i) => ({ id: String(i + 1), label: `Remove ${i + 1} tag(s): the Runner loses ${5 * (i + 1)} credits` })),
      ]),
    );
  },
  ...biggerPictureFlow.script,
};

// IP Enforcement (Gray Ops): As an additional cost to play this operation, remove X tags.
// Install 1 agenda from the Runner's score area with a printed agenda point value equal to X.
// If the Runner is still tagged, place 1 advancement counter on that agenda.
const ipTargets = (state: GameState) =>
  state.runner.scoreArea.filter(a => (cardDef(a).agenda_points ?? 0) > 0 && (cardDef(a).agenda_points ?? 0) <= state.runner.tags);

const ipFlow = prompts({
  agenda: choice((ctx, a) => {
    const { state } = ctx;
    const agenda = state.runner.scoreArea.find(c => c.instanceId === a.optionId);
    if (!agenda) return;
    const x = cardDef(agenda).agenda_points ?? 0;
    removeTags(state, x);
    addLog(state, 'corp', `Corp removed ${x} tag(s) (IP Enforcement).`);
    ipFlow.corpInstall(ctx, agenda.instanceId, 'server', { remoteRootOnly: true });
  }),
  server: choice<InstallData>(({ state }, a, data, source) => {
    const agenda = state.runner.scoreArea.find(c => c.instanceId === data.cardId);
    if (!agenda) return;
    state.runner.score -= agendaPoints(agenda);
    delete agenda.asAgendaPoints;
    agenda.isRezzed = false;
    installCorpChoice(state, source, a.raw);
    if (state.runner.tags > 0) agenda.advancementCounters += 1;
    addLog(state, 'corp', `Corp installed ${cardDef(agenda).title} from the Runner's score area (IP Enforcement).`, undefined, 'install');
  }),
});

export const ipEnforcement: CardScript = {
  canPlay: ({ state }) => (ipTargets(state).length > 0 ? null : 'Needs an agenda in the Runner\'s score area worth no more than their tags'),
  // The Corp chooses X when paying (rule 1.16.6c). Only an X that matches an agenda's printed
  // points installs anything, so each option pairs an X with the agenda it takes back.
  onPlay: ctx => {
    const tags = ctx.state.runner.tags;
    const options = [...ipTargets(ctx.state)]
      .sort((a, b) => (cardDef(a).agenda_points ?? 0) - (cardDef(b).agenda_points ?? 0))
      .map(a => {
        const x = cardDef(a).agenda_points ?? 0;
        const counter = tags - x > 0 ? ', the Runner stays tagged: +1 advancement counter' : '';
        return { id: a.instanceId, label: `X = ${x}: remove ${x} of ${tags} tag(s), take back ${cardDef(a).title}${counter}` };
      });
    ipFlow.ask(ctx, 'agenda', choiceQuestion('corp', `IP Enforcement: choose X, the number of tags to remove (the Runner has ${tags}). You install the agenda worth X points.`, options));
  },
  ...ipFlow.script,
};

// Touch-ups (Double): As an additional cost to play this operation, spend click. Place 2
// advancement counters on 1 installed card you can advance. If you do, choose a card type and
// reveal the grip. Choose up to 2 revealed cards of that type. The Runner shuffles those cards into the stack.
const RUNNER_TYPES = ['event', 'hardware', 'program', 'resource'] as const;

const touchUpsFlow = prompts({
  advance: cards((ctx, a) => {
    const { state } = ctx;
    const target = advanceableInstalled(state).find(c => c.instanceId === a.ids[0]);
    if (!target) return;
    target.advancementCounters += 2;
    addLog(state, 'corp', 'Corp placed 2 advancement counters (Touch-ups).');
    touchUpsFlow.ask(ctx, 'type', choiceQuestion('corp', 'Touch-ups: choose a card type, then reveal the grip.', RUNNER_TYPES.map(t => ({ id: t, label: t[0].toUpperCase() + t.slice(1) }))));
  }),
  type: choice((ctx, a) => {
    const { state } = ctx;
    addLog(state, 'corp', `The Runner revealed their grip: ${state.runner.grip.map(c => cardDef(c).title).join(', ') || 'empty'}.`);
    revealInHand(state, 'runner', state.runner.grip);
    const matching = state.runner.grip.filter(c => type(c) === a.optionId);
    if (matching.length === 0) return;
    touchUpsFlow.ask(ctx, 'shuffle', cardsQuestion('corp', 'Touch-ups: choose up to 2 of them to shuffle into the stack.', ids(matching), 0, Math.min(2, matching.length)));
  }),
  shuffle: cards(({ state }, a) => {
    for (const id of a.ids) {
      const card = state.runner.grip.find(c => c.instanceId === id);
      if (!card) continue;
      removeCard(state.runner.grip, card);
      forgetInHand(state, 'runner', [card]);
      state.runner.stack.push(card);
    }
    shuffleInPlace(state.rng, state.runner.stack);
    addLog(state, 'runner', `The Runner shuffled ${a.ids.length} card(s) into their stack (Touch-ups).`);
  }),
});

export const touchUps: CardScript = {
  extraClicks: 1,
  onPlay: ctx => {
    const targets = advanceableInstalled(ctx.state);
    if (targets.length > 0) touchUpsFlow.ask(ctx, 'advance', cardsQuestion('corp', 'Touch-ups: place 2 advancement counters on 1 installed card you can advance.', ids(targets), 1, 1));
  },
  ...touchUpsFlow.script,
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

/** The modes already resolved. */
type KpiDone = { done: string[] };

function askKpi(ctx: EffectContext, done: string[]): void {
  if (done.length >= 2) return;
  const options = KPI_OPTIONS.filter(o => !done.includes(o.id));
  kpiFlow.ask(ctx, 'choose', choiceQuestion('corp', `Key Performance Indicators: choose ${done.length === 0 ? 'the first' : 'the second'} effect.`, options), { done });
}

const kpiFlow = prompts({
  choose: choice<KpiDone>((ctx, a, { done }) => {
    const { state, card } = ctx;
    const now = [...(done ?? []), a.optionId];
    switch (a.optionId) {
      case 'draw':
        drawCards(state, 'corp', 1);
        addLog(state, 'corp', 'Corp drew 1 card (Key Performance Indicators).');
        if (state.corp.hq.length > 0) return kpiFlow.ask(ctx, 'shuffle', cardsQuestion('corp', 'KPI: shuffle 1 card from HQ into R&D.', ids(state.corp.hq), 1, 1), { done: now });
        break;
      case 'ice': {
        const ice = installable(state, state.corp.hq.filter(c => type(c) === 'ice'), { ignoreCosts: true });
        if (ice.length > 0) return kpiFlow.ask(ctx, 'ice', cardsQuestion('corp', 'KPI: install 1 ice from HQ, ignoring all costs.', ids(ice), 1, 1), { done: now });
        break;
      }
      case 'advance': {
        const targets = advanceableInstalled(state);
        if (targets.length > 0) return kpiFlow.ask(ctx, 'advance', cardsQuestion('corp', 'KPI: place 1 advancement counter.', ids(targets), 1, 1), { done: now });
        break;
      }
      case 'credits':
        gainFromCard(state, 'corp', 2, card);
        addLog(state, 'corp', 'Corp gained 2 [credit] (Key Performance Indicators).');
        break;
    }
    askKpi(ctx, now);
  }),
  shuffle: cards<KpiDone>((ctx, a, { done }) => {
    const { state } = ctx;
    const target = state.corp.hq.find(c => c.instanceId === a.ids[0]);
    if (target) {
      removeCard(state.corp.hq, target);
      state.corp.rd.push(target);
      shuffleRD(state);
    }
    askKpi(ctx, done ?? []);
  }),
  ice: cards<KpiDone>((ctx, a, { done }) => {
    if (!kpiFlow.corpInstall(ctx, a.ids[0], 'ice_server', { ignoreCosts: true }, { done: done ?? [] })) askKpi(ctx, done ?? []);
  }),
  ice_server: choice<KpiDone & InstallData>((ctx, a, { done }, source) => {
    installCorpChoice(ctx.state, source, a.raw, { ignoreCosts: true });
    askKpi(ctx, done ?? []);
  }),
  advance: cards<KpiDone>((ctx, a, { done }) => {
    const target = advanceableInstalled(ctx.state).find(c => c.instanceId === a.ids[0]);
    if (target) target.advancementCounters += 1;
    askKpi(ctx, done ?? []);
  }),
});

export const kpi: CardScript = {
  onPlay: ctx => askKpi(ctx, []),
  ...kpiFlow.script,
};

// Measured Response (Black Ops): Play only if the threat level is 4 or greater, and only if
// the Runner made a successful run during their last turn. Do 4 meat damage unless the Runner pays 8 credits.
const measuredFlow = prompts({
  choice: choice(({ state }, a) => {
    if (a.optionId === 'pay') {
      state.runner.credits -= 8;
      addLog(state, 'runner', 'Runner paid 8 [credit] (Measured Response).');
    } else {
      dealMeatDamage(state, 4);
    }
  }),
});

export const measuredResponse: CardScript = {
  canPlay: ({ state }) => {
    if (threatLevel(state) < 4) return 'The threat level must be 4 or greater';
    return state.runnerLastTurnRuns.some(r => r.successful) ? null : 'The Runner did not make a successful run during their last turn';
  },
  onPlay: ctx => {
    if (ctx.state.runner.credits < 8) return void dealMeatDamage(ctx.state, 4);
    measuredFlow.ask(
      ctx,
      'choice',
      choiceQuestion('runner', 'Measured Response: pay 8 credits or suffer 4 meat damage?', [
        { id: 'pay', label: 'Pay 8 credits' },
        { id: 'damage', label: 'Take 4 meat damage' },
      ]),
    );
  },
  ...measuredFlow.script,
};

// Petty Cash (Transaction): Play only if you have not finished an action yet this turn.
// Gain 5 credits. If you played this operation from anywhere except HQ, gain click.
// click: Play this operation from Archives. After it resolves, remove it from the game.
export const pettyCash: CardScript = {
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

export const elevationCorpOperationsScripts: Record<string, CardScript> = {
  '35043': nanomanagement,
  '35044': topDownSolutions,
  '35055': peerReview,
  '35065': biggerPicture,
  '35066': ipEnforcement,
  '35067': touchUps,
  '35077': kpi,
  '35078': measuredResponse,
  '35081': pettyCash,
};
