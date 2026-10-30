import { GameState } from '../types/state';
import { addLog } from '../engine/log';
import { cardDef } from '../cards';
import { dealNetDamage, giveTags, trashInstalledRunnerCard } from '../engine/damage';
import { turnFlag, TurnFlag } from '../engine/cardEffects';
import { drawCards, removeCard, turnKey } from '../engine/helpers';
import { shuffleRD } from '../engine/rdKnowledge';
import { CardScript } from './types';
import { askCards, askChoice, gainCredits } from './effects';

/** Corp operations from System Gateway. */

const gainOnly = (amount: number): CardScript => ({
  onPlay: ({ state }) => {
    gainCredits(state, 'corp', amount);
    addLog(state, 'corp', `Corp gained ${amount} [credit].`);
  },
});

// Hedge Fund: Gain 9 credits.
const hedgeFund = gainOnly(9);

// Government Subsidy: Gain 15 credits.
const governmentSubsidy = gainOnly(15);

// Hansei Review: Gain 10 credits. If there are any cards in HQ, trash 1 of them.
const hanseiReview: CardScript = {
  onPlay: ctx => {
    const { state } = ctx;
    gainCredits(state, 'corp', 10);
    addLog(state, 'corp', 'Corp gained 10 [credit].');
    if (state.corp.hq.length > 0) {
      askCards(ctx, 'corp', 'Hansei Review: trash 1 card from HQ.', state.corp.hq.map(c => c.instanceId), 1, 1, 'trash');
    }
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    for (const id of answer.cardInstanceIds) {
      const card = state.corp.hq.find(c => c.instanceId === id)!;
      removeCard(state.corp.hq, card);
      state.corp.archives.faceDown.push(card);
    }
    addLog(state, 'corp', 'Corp trashed 1 card from HQ.');
  },
};

// Sprint: Draw 3 cards. Shuffle 2 cards from HQ into R&D.
const sprint: CardScript = {
  onPlay: ctx => {
    const { state } = ctx;
    const drawn = drawCards(state, 'corp', 3);
    addLog(state, 'corp', `Corp drew ${drawn} card(s).`);
    if (state.winner) return;
    const count = Math.min(2, state.corp.hq.length);
    if (count > 0) {
      askCards(ctx, 'corp', `Sprint: choose ${count} card(s) from HQ to shuffle into R&D.`, state.corp.hq.map(c => c.instanceId), count, count, 'shuffle');
    }
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    for (const id of answer.cardInstanceIds) {
      const card = state.corp.hq.find(c => c.instanceId === id)!;
      removeCard(state.corp.hq, card);
      state.corp.rd.push(card);
    }
    shuffleRD(state);
    addLog(state, 'corp', `Corp shuffled ${answer.cardInstanceIds.length} card(s) from HQ into R&D.`);
  },
};

// Predictive Planogram: Resolve 1 of the following. If the Runner is tagged,
// you may resolve both instead. * Gain 3 credits. * Draw 3 cards.
const predictivePlanogram: CardScript = {
  onPlay: ctx => {
    const options = [
      { id: 'credits', label: 'Gain 3 credits' },
      { id: 'cards', label: 'Draw 3 cards' },
    ];
    if (ctx.state.runner.tags > 0) options.push({ id: 'both', label: 'Both (Runner is tagged)' });
    askChoice(ctx, 'corp', 'Predictive Planogram: choose an effect.', options, 'choose');
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'credits' || answer.optionId === 'both') {
      gainCredits(state, 'corp', 3);
      addLog(state, 'corp', 'Corp gained 3 [credit].');
    }
    if (answer.optionId === 'cards' || answer.optionId === 'both') {
      const drawn = drawCards(state, 'corp', 3);
      addLog(state, 'corp', `Corp drew ${drawn} card(s).`);
    }
  },
};

/** Installed Corp cards that were not installed this turn. */
function seamlessLaunchTargets(state: GameState): string[] {
  const now = turnKey(state);
  return Object.values(state.corp.servers)
    .flatMap(s => [...s.ice, ...s.root])
    .filter(c => c.installedTurn !== now)
    .map(c => c.instanceId);
}

// Seamless Launch: Place 2 advancement counters on 1 installed card that you
// did not install this turn.
const seamlessLaunch: CardScript = {
  canPlay: ({ state }) => (seamlessLaunchTargets(state).length === 0 ? 'No installed card you did not install this turn' : null),
  onPlay: ctx => {
    askCards(ctx, 'corp', 'Seamless Launch: place 2 advancement counters on 1 installed card.', seamlessLaunchTargets(ctx.state), 1, 1, 'target');
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    const card = Object.values(state.corp.servers)
      .flatMap(s => [...s.ice, ...s.root])
      .find(c => c.instanceId === answer.cardInstanceIds[0])!;
    card.advancementCounters += 2;
    addLog(state, 'corp', `Corp placed 2 advancement counters on an installed card (now ${card.advancementCounters}).`);
  },
};

// Neurospike: Do X net damage, where X is equal to the sum of the printed
// agenda points on agendas you scored this turn.
const neurospike: CardScript = {
  liveValue: state => `X = ${turnFlag(state, TurnFlag.agendaPointsScored)}: ${turnFlag(state, TurnFlag.agendaPointsScored)} net damage`,
  onPlay: ({ state }) => {
    const x = turnFlag(state, TurnFlag.agendaPointsScored);
    if (x > 0) dealNetDamage(state, x);
    else addLog(state, 'corp', 'Neurospike: no agenda points scored this turn, so no damage.');
  },
};

// Public Trail: Play only if the Runner made a successful run during their last
// turn. Give the Runner 1 tag unless they pay 8 credits.
const publicTrail: CardScript = {
  canPlay: ({ state }) =>
    state.runnerLastTurnRuns.some(r => r.successful) ? null : 'The Runner did not make a successful run during their last turn',
  onPlay: ctx => {
    if (ctx.state.runner.credits < 8) return giveTags(ctx.state, 1);
    askChoice(ctx, 'runner', 'Public Trail: pay 8 credits or take 1 tag?', [
      { id: 'pay', label: 'Pay 8 credits' },
      { id: 'tag', label: 'Take 1 tag' },
    ], 'choice');
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'pay') {
      state.runner.credits -= 8;
      addLog(state, 'runner', 'Runner paid 8 [credit] to avoid the tag (Public Trail).');
    } else {
      giveTags(state, 1);
    }
  },
};

// Retribution: Play only if the Runner is tagged. Trash 1 installed program or piece of hardware.
const programsAndHardware = (state: GameState) => [...state.runner.rig.programs, ...state.runner.rig.hardware];
const retribution: CardScript = {
  canPlay: ({ state }) => {
    if (state.runner.tags === 0) return 'The Runner must be tagged';
    return programsAndHardware(state).length > 0 ? null : 'The Runner has no installed program or hardware';
  },
  onPlay: ctx =>
    askCards(ctx, 'corp', 'Retribution: trash 1 installed program or piece of hardware.', programsAndHardware(ctx.state).map(c => c.instanceId), 1, 1, 'trash'),
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    const card = programsAndHardware(state).find(c => c.instanceId === answer.cardInstanceIds[0])!;
    trashInstalledRunnerCard(state, card);
    addLog(state, 'corp', `Corp trashed ${cardDef(card).title} (Retribution).`);
  },
};

export const operationScripts: Record<string, CardScript> = {
  '30040': seamlessLaunch,
  '30041': sprint,
  '30048': hanseiReview,
  '30049': neurospike,
  '30056': predictivePlanogram,
  '30057': publicTrail,
  '30064': governmentSubsidy,
  '30065': retribution,
  '30075': hedgeFund,
};

