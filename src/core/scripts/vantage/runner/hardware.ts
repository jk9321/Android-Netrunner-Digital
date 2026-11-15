import { cardDef } from '../../../cards';
import { addLog } from '../../../engine/log';
import { removeCard } from '../../../engine/helpers';
import { giveTags } from '../../../engine/damage';
import { addCounters, useOncePerTurn } from '../../../engine/cardEffects';
import { iceStrength } from '../../../engine/ice';
import { fireTrigger } from '../../../engine/triggers';
import { CardScript } from '../../types';
import { gainCredits } from '../../effects';
import { cards, cardsQuestion, choice, choiceQuestion, prompts } from '../../steps';
import { ids, isSelf, onceKey } from './helpers';

// The Tungsten Tailor: Each piece of ice gets -1 strength. The first time each turn you
// break a subroutine on a piece of ice with 0 or less strength, gain 1 credit.
export const tungstenTailor: CardScript = {
  modifiers: { iceStrength: () => -1 },
  triggers: {
    subroutines_broken: (ctx, e) => {
      if (iceStrength(ctx.state, e.ice) > 0 || !useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
      gainCredits(ctx.state, 'runner', 1);
      addLog(ctx.state, 'runner', 'Runner gained 1 [credit] (The Tungsten Tailor).');
    },
  },
};

// Borrowed Goods: +1 MU. When you install this hardware, if you are not tagged, take 1 tag.
export const borrowedGoods: CardScript = {
  modifiers: { memory: 1 },
  triggers: {
    installed: (ctx, e) => {
      if (isSelf(ctx, e.card) && ctx.state.runner.tags === 0) giveTags(ctx.state, 1);
    },
  },
};

// Rotary: +1 MU. Whenever you breach HQ or R&D, you may take 1 tag to access 1 additional
// card. click, 2 credits: Trash this hardware. Only the Corp can use this ability, and only
// if the Runner is tagged. Limit 1 console per player.
const rotaryFlow = prompts({
  breach: choice(({ state }, a) => {
    if (a.optionId !== 'tag' || !state.activeRun) return;
    giveTags(state, 1);
    state.activeRun.extraAccesses += 1;
    addLog(state, 'runner', 'Runner took 1 tag to access 1 additional card (Rotary).');
  }),
});

export const rotary: CardScript = {
  modifiers: { memory: 1 },
  triggers: {
    breach_server: (ctx, e) => {
      if (e.server !== 'hq' && e.server !== 'rd') return;
      rotaryFlow.choice(ctx, 'breach', choiceQuestion('runner', 'Rotary: take 1 tag to access 1 additional card?', [
        { id: 'tag', label: 'Take 1 tag: access 1 more card' },
        { id: 'no', label: 'No' },
      ]));
    },
  },
  abilities: [
    {
      label: 'Trash Rotary (Corp only, while the Runner is tagged).',
      anyPlayer: true,
      clicks: 1,
      credits: 2,
      trashSelf: true,
      canUse: ({ state, side }) => (side !== 'corp' ? 'Only the Corp can use this ability' : state.runner.tags > 0 ? null : 'Only while the Runner is tagged'),
      resolve: ({ state }) => addLog(state, 'corp', 'Corp trashed Rotary.'),
    },
  ],
  ...rotaryFlow.script,
};

// Methuselah (Console - Stealth): +1 MU. Whenever a run begins, you may trash 1 piece of
// hardware from your grip to place 2 credits on this hardware. You can spend hosted credits
// during runs. Limit 1 console per player.
const methuselahFlow = prompts({
  trash: cards(({ state, card }, a) => {
    if (a.ids.length === 0) return;
    const hardware = state.runner.grip.find(c => c.instanceId === a.ids[0]);
    if (!hardware) return;
    removeCard(state.runner.grip, hardware);
    state.runner.heap.push(hardware);
    addCounters(card, 'credit', 2);
    addLog(state, 'runner', `Runner trashed ${cardDef(hardware).title} from their grip to place 2 [credit] on Methuselah.`);
    fireTrigger(state, { type: 'hardware_trashed', card: hardware });
  }),
});

export const methuselah: CardScript = {
  modifiers: { memory: 1 },
  paysDuringRuns: true,
  triggers: {
    run_begins: ctx => {
      const hardware = ctx.state.runner.grip.filter(c => cardDef(c).type_code === 'hardware');
      if (hardware.length > 0) {
        methuselahFlow.cards(ctx, 'trash', cardsQuestion('runner', 'Methuselah: you may trash 1 piece of hardware from your grip to place 2 [credit] on it.', ids(hardware), 0, 1));
      }
    },
  },
  ...methuselahFlow.script,
};

// Touchstone (Stealth): The first time each turn you play an event, place 1 credit on this
// hardware. You can spend hosted credits during runs.
export const touchstone: CardScript = {
  paysDuringRuns: true,
  triggers: {
    event_played: ctx => {
      if (!useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
      addCounters(ctx.card, 'credit', 1);
      addLog(ctx.state, 'runner', 'Touchstone: 1 [credit] placed on it.');
    },
  },
};

// --- Programs ---------------------------------------------------------------

export const vantageRunnerHardwareScripts: Record<string, CardScript> = {
  '36003': tungstenTailor,
  '36013': borrowedGoods,
  '36014': rotary,
  '36020': methuselah,
  '36021': touchstone,
};
