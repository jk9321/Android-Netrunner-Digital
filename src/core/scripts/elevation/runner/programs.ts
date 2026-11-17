import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { addLog } from '../../../engine/log';
import { trashAccessedCard } from '../../../engine/actions/run';
import { trashInstalledRunnerCard } from '../../../engine/damage';
import { addCounters, counters, drawForEffect, removeCounters } from '../../../engine/cardEffects';
import { addBreakerStrength, isIcebreaker } from '../../../engine/ice';
import { CardScript } from '../../types';
import { choice, choiceQuestion, prompts } from '../../steps';
import { isSelf, keywords } from './helpers';

/** True while the Runner is encountering ice and can still break (before subroutines fire). */
function inBreakWindow(state: GameState): boolean {
  const encounter = state.activeRun?.encounter;
  return Boolean(encounter && encounter.resolvingIndex === null && state.activeRun?.phase === 'encounter_ice' && !encounter.onEncounterPending);
}

// Gourmand: Access -> trash: Trash the non-agenda card you are accessing. If you do, draw 1 card.
export const gourmand: CardScript = {
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
export const hantu: CardScript = {
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
export const risingTide: CardScript = {
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
export const sangKancil: CardScript = {
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
export const principia: CardScript = {
  breaker: { breaks: 'barrier', breakMax: 1, breakCost: () => 1, boostCost: 2, boostAmount: () => 2 },
  installCostModifier: (state, card) => -state.runner.rig.programs.filter(p => p.instanceId !== card.instanceId && isIcebreaker(p)).length,
};

// Azimat: 2 recurring credits. You can spend hosted credits to pay trash costs.
export const azimat: CardScript = {
  recurringCredits: 2,
  paysFor: (_state, _self, purpose) => purpose.kind === 'trash',
};

// Chromatophores (Trojan): Install only on a piece of ice. Host ice gains barrier, code gate, and sentry.
export const chromatophores: CardScript = {
  installsOnIce: true,
  grantsIceSubtypes: ['barrier', 'code gate', 'sentry'],
};

// Devadatta Drone: When you install this program, place 2 power counters on it.
// Whenever you breach R&D, you may remove 1 hosted power counter to access 1 additional card.
const devadattaFlow = prompts({
  breach: choice(({ state, card }, a) => {
    if (a.optionId !== 'use' || !state.activeRun) return;
    removeCounters(card, 'power', 1);
    state.activeRun.extraAccesses += 1;
    addLog(state, 'runner', 'Runner will access 1 additional card (Devadatta Drone).');
  }),
});

export const devadatta: CardScript = {
  triggers: {
    installed: (ctx, e) => isSelf(ctx, e.card) && addCounters(ctx.card, 'power', 2),
    breach_server: (ctx, e) => {
      if (e.server !== 'rd' || counters(ctx.card, 'power') === 0) return;
      devadattaFlow.choice(ctx, 'breach', choiceQuestion('runner', 'Devadatta Drone: remove 1 power counter to access 1 additional card?', [
        { id: 'use', label: 'Access 1 additional card' },
        { id: 'no', label: 'No' },
      ]));
    },
  },
  ...devadattaFlow.script,
};

// --- Resources ------------------------------------------------------------------------

export const elevationRunnerProgramsScripts: Record<string, CardScript> = {
  '35007': gourmand,
  '35008': hantu,
  '35009': risingTide,
  '35020': sangKancil,
  '35029': azimat,
  '35030': chromatophores,
  '35031': devadatta,
  '35032': principia,
};
