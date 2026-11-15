import { cardDef } from '../../../cards';
import { addLog } from '../../../engine/log';
import { installedRunnerCards, trashInstalledRunnerCard } from '../../../engine/damage';
import {
  addCounters,
  counters,
  drawForEffect,
  loadCredits,
  removeCounters,
  takeHostedCredits,
  useOncePerTurn,
} from '../../../engine/cardEffects';
import { bypassIce, encounteredIce } from '../../../engine/ice';
import { CardScript, EffectContext } from '../../types';
import { gainCredits, resolveSabotage, sabotageQuestion, SabotageData } from '../../effects';
import { cards, cardsQuestion, choice, choiceQuestion, prompts } from '../../steps';
import { isSelf, keywords, onceKey } from './helpers';

// Cacophony: The first time each turn you steal or trash a Corp card, place 1 power
// counter on this resource. When your action phase ends, you may remove 2 hosted
// power counters to sabotage 3.
const cacophonyCounter = (ctx: EffectContext) => {
  if (!useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
  addCounters(ctx.card, 'power', 1);
  addLog(ctx.state, 'runner', `Cacophony gained a power counter (now ${counters(ctx.card, 'power')}).`);
};

const cacophonyFlow = prompts({
  use: choice((ctx, a) => {
    if (a.optionId !== 'sabotage') return;
    removeCounters(ctx.card, 'power', 2);
    cacophonyFlow.askIf(ctx, 'sabotage', sabotageQuestion(ctx.state, 3), { x: 3 });
  }),
  sabotage: cards<SabotageData>(({ state }, a, data) => resolveSabotage(state, Number(data.x ?? 3), a.ids)),
});

export const cacophony: CardScript = {
  triggers: {
    agenda_stolen: cacophonyCounter,
    runner_trashed_corp_card: cacophonyCounter,
    action_phase_ends: (ctx, e) => {
      if (e.side !== 'runner' || counters(ctx.card, 'power') < 2) return;
      cacophonyFlow.choice(ctx, 'use', choiceQuestion('runner', 'Cacophony: remove 2 power counters to sabotage 3?', [
        { id: 'sabotage', label: 'Sabotage 3' },
        { id: 'no', label: 'No' },
      ]));
    },
  },
  ...cacophonyFlow.script,
};

// Rent Rioters: click click click, trash: Gain 9 credits.
export const rentRioters: CardScript = {
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
const fransofiaFlow = prompts({
  bypass: choice<{ iceId: string }>(({ state, card }, a, data) => {
    if (a.optionId !== 'bypass') return;
    if (encounteredIce(state)?.instanceId !== data.iceId || !state.runner.rig.resources.includes(card)) return;
    trashInstalledRunnerCard(state, card);
    bypassIce(state);
  }),
});

export const fransofiaWard: CardScript = {
  modifiers: { rezCost: (_state, _self, rezzing) => (cardDef(rezzing).type_code === 'ice' ? 1 : 0) },
  triggers: {
    encounter_ice: (ctx, e) => {
      if (ctx.state.corp.credits < 15) return;
      fransofiaFlow.choice(ctx, 'bypass', choiceQuestion('runner', `Fransofia Ward: trash it to bypass ${cardDef(e.ice).title}?`, [
        { id: 'bypass', label: 'Trash Fransofia Ward and bypass' },
        { id: 'no', label: 'No' },
      ]), { iceId: e.ice.instanceId });
    },
  },
  ...fransofiaFlow.script,
};

// Open Market: When you install this resource, load 6 credits onto it. When it is
// empty, trash it. You can spend hosted credits to install connection and job
// resources. When your turn begins, take 1 credit from this resource.
export const openMarket: CardScript = {
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
const knickknackFlow = prompts({
  trash: cards(({ state }, a) => {
    if (a.ids.length === 0) return;
    const target = installedRunnerCards(state).find(c => c.instanceId === a.ids[0]);
    if (!target) return;
    const gain = cardDef(target).cost ?? 0;
    trashInstalledRunnerCard(state, target);
    gainCredits(state, 'runner', gain);
    addLog(state, 'runner', `Runner trashed ${cardDef(target).title} and gained ${gain} [credit] ("Knickknack" O'Brian).`);
    drawForEffect(state, 'runner', 1, '"Knickknack" O\'Brian');
  }),
});

export const knickknack: CardScript = {
  triggers: {
    run_begins: ctx => {
      if (!useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
      const others = installedRunnerCards(ctx.state).filter(c => c.instanceId !== ctx.card.instanceId);
      if (others.length === 0) return;
      knickknackFlow.cards(ctx, 'trash', cardsQuestion('runner', '"Knickknack" O\'Brian: you may trash 1 of your other installed cards to gain its install cost and draw 1.', others.map(c => c.instanceId), 0, 1));
    },
  },
  ...knickknackFlow.script,
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

export const sideHustle: CardScript = {
  triggers: {
    installed: (ctx, e) => isSelf(ctx, e.card) && sideHustlePlace(ctx),
    run_begins: ctx => sideHustlePlace(ctx),
  },
};

export const elevationRunnerResourcesScripts: Record<string, CardScript> = {
  '35010': cacophony,
  '35011': rentRioters,
  '35021': fransofiaWard,
  '35022': openMarket,
  '35033': knickknack,
  '35034': sideHustle,
};
