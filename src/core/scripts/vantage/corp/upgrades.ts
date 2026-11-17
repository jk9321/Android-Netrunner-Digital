import { GameState } from '../../../types/state';
import { addLog } from '../../../engine/log';
import { revealInHand } from '../../../engine/helpers';
import { dealMeatDamage } from '../../../engine/damage';
import { endTheRun } from '../../../engine/runEnd';
import { addCounters, turnFlag, TurnFlag, useOncePerTurn } from '../../../engine/cardEffects';
import { CardScript, EffectContext } from '../../types';
import { advanceableInstalled } from '../../effects';
import { cards, cardsQuestion, choice, choiceQuestion, prompts } from '../../steps';
import { ids, isSelf, onceKey, runOnServerOf, serverOf, title } from './helpers';

// Perfect Recall: When you rez this upgrade and whenever an agenda is scored or stolen from
// this server or its root, place 1 power counter on this upgrade. Hosted power counter: Reveal
// 1 card in HQ. The Runner cannot steal or trash copies of that card for the remainder of this
// run. Use this ability only during a run.
const recallFlow = prompts({
  reveal: cards(({ state }, a) => {
    const card = state.corp.hq.find(c => c.instanceId === a.ids[0]);
    const run = state.activeRun;
    if (!card || !run) return;
    revealInHand(state, 'corp', [card]);
    run.protectedTitles = [...(run.protectedTitles ?? []), title(card)];
    addLog(state, 'corp', `Corp revealed ${title(card)}: the Runner cannot steal or trash copies of it this run (Perfect Recall).`);
  }),
});

export const perfectRecall: CardScript = {
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
      resolve: ctx => recallFlow.cards(ctx, 'reveal', cardsQuestion('corp', 'Perfect Recall: reveal 1 card in HQ.', ids(ctx.state.corp.hq), 1, 1)),
    },
  ],
  ...recallFlow.script,
};

// The Red Room (Facility): Central server only. The first time each turn an agenda is scored
// or stolen, place 1 power counter on this upgrade. Hosted power counter: End the run. Use this
// ability only during a run against another server.
const redRoomCounter = (ctx: EffectContext) => useOncePerTurn(ctx.state, onceKey(ctx.card)) && addCounters(ctx.card, 'power', 1);

export const redRoom: CardScript = {
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

const hypeFlow = prompts({
  advance: cards<{ server: string }>(({ state }, a, data) => {
    const card = hypeTargets(state, String(data.server)).find(c => c.instanceId === a.ids[0]);
    if (!card) return;
    card.advancementCounters += 1;
    addLog(state, 'corp', 'Corp placed 1 advancement counter (Hype Machine).');
  }),
});

export const hypeMachine: CardScript = {
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
        hypeFlow.cards(ctx, 'advance', cardsQuestion('corp', 'Hype Machine: place 1 advancement counter on which card?', ids(hypeTargets(ctx.state, server.id)), 1, 1), { server: server.id });
      },
    },
  ],
  ...hypeFlow.script,
};

// Flagship (Ritzy): HQ or R&D only. Runs against this server cannot be declared successful.
// Persistent -> During each run against this server, the Runner cannot access more than 1 card
// other than this upgrade. (Engine: actions/run.ts, rules 6.9.5, 7.4.2b.)
export const flagship: CardScript = {
  installOnly: 'hq-rd',
  blocksSuccess: true,
  limitsAccessToOne: true,
  persistent: true,
};

// Shackleton Grid (Region): Once per turn -> When the Runner spends credits from outside their
// credit pool during a run against this server, you may do 4 meat damage. Limit 1 region per server.
const shackletonFlow = prompts({
  meat: choice(({ state, card }, a) => {
    if (a.optionId !== 'yes' || !useOncePerTurn(state, onceKey(card))) return;
    dealMeatDamage(state, 4);
  }),
});

export const shackleton: CardScript = {
  triggers: {
    credits_spent_outside_pool: ctx => {
      const { state, card } = ctx;
      if (!runOnServerOf(state, card) || turnFlag(state, onceKey(card)) > 0) return;
      shackletonFlow.choice(ctx, 'meat', choiceQuestion('corp', 'Shackleton Grid: the Runner spent credits from outside their pool. Do 4 meat damage?', [
        { id: 'yes', label: 'Do 4 meat damage' },
        { id: 'no', label: 'Not now' },
      ]));
    },
  },
  ...shackletonFlow.script,
};

export const vantageCorpUpgradesScripts: Record<string, CardScript> = {
  '36035': perfectRecall,
  '36045': redRoom,
  '36055': hypeMachine,
  '36064': flagship,
  '36065': shackleton,
};
