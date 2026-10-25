import { CardInstance } from '../types/card';
import { GameState } from '../types/state';
import { cardDef } from '../cards';
import { addLog } from '../engine/log';
import { illegal, removeCard } from '../engine/helpers';
import { installRunnerCardFrom, runnerInstallBlocker } from '../engine/actions/install';
import { startRun, trashAccessedCard } from '../engine/actions/run';
import {
  addCounters,
  counters,
  derez,
  drawForEffect,
  installedIce,
  loadCredits,
  takeHostedCredits,
  turnFlag,
  TurnFlag,
  useOncePerTurn,
} from '../engine/cardEffects';
import { encounteredIce, iceScript } from '../engine/ice';
import { CardScript, EffectContext } from './types';
import { askCards, askChoice, gainCredits } from './effects';

/** Runner identities, hardware, resources and non-icebreaker programs from System Gateway. */

const CENTRALS = ['hq', 'rd', 'archives'];
const isVirus = (card: CardInstance) => /\bvirus\b/i.test(cardDef(card).keywords ?? '');
const isSelf = (ctx: EffectContext, card: CardInstance) => card.instanceId === ctx.card.instanceId;

/** "When you install this program and when your turn begins, place 1 virus counter on this program." */
function virusGrowth(after?: (ctx: EffectContext) => void): CardScript['triggers'] {
  const grow = (ctx: EffectContext) => {
    addCounters(ctx.card, 'virus', 1);
    addLog(ctx.state, 'runner', `${cardDef(ctx.card).title} gained a virus counter (now ${counters(ctx.card, 'virus')}).`);
    after?.(ctx);
  };
  return {
    installed: (ctx, e) => isSelf(ctx, e.card) && grow(ctx),
    turn_begins: (ctx, e) => e.side === 'runner' && grow(ctx),
  };
}

/** True while the Runner is encountering ice and can still break (before subroutines fire). */
function inBreakWindow(state: GameState): boolean {
  const encounter = state.activeRun?.encounter;
  return Boolean(encounter && encounter.resolvingIndex === null && state.activeRun?.phase === 'encounter_ice');
}

// René "Loup" Arcemont: The first time each turn you trash a card you are
// accessing, gain 1 credit and draw 1 card.
const rene: CardScript = {
  triggers: {
    trashed_on_access: ({ state }) => {
      if (turnFlag(state, TurnFlag.accessTrashes) !== 1) return;
      gainCredits(state, 'runner', 1);
      drawForEffect(state, 'runner', 1, 'René Arcemont');
      addLog(state, 'runner', 'Runner gained 1 [credit] (René Arcemont).');
    },
  },
};

// Zahya Sadeghi: Once per turn -> When a run on HQ or R&D ends, you may gain
// 1 credit for each time you accessed a card during that run.
const zahya: CardScript = {
  triggers: {
    run_ends: ({ state, card }, e) => {
      if (!['hq', 'rd'].includes(e.server) || e.accessedCount === 0) return;
      if (!useOncePerTurn(state, `once:${card.instanceId}`)) return;
      gainCredits(state, 'runner', e.accessedCount);
      addLog(state, 'runner', `Runner gained ${e.accessedCount} [credit] (Zahya Sadeghi).`);
    },
  },
};

// Tāo Salonga: Whenever an agenda is scored or stolen, you may swap 2 installed pieces of ice.
const askSwap = (ctx: EffectContext) => {
  const ice = installedIce(ctx.state);
  if (ice.length < 2) return;
  askCards(ctx, 'runner', 'Tāo Salonga: choose 2 installed ice to swap, or none.', ice.map(c => c.instanceId), 0, 2, 'swap');
};
const tao: CardScript = {
  triggers: { agenda_scored: askSwap, agenda_stolen: askSwap },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards' || answer.cardInstanceIds.length === 0) return;
    if (answer.cardInstanceIds.length !== 2) illegal('Choose 2 pieces of ice, or none');
    swapIce(state, answer.cardInstanceIds[0], answer.cardInstanceIds[1]);
  },
};

function swapIce(state: GameState, a: string, b: string): void {
  const where = (id: string) => {
    for (const server of Object.values(state.corp.servers)) {
      const index = server.ice.findIndex(c => c.instanceId === id);
      if (index !== -1) return { server, index };
    }
    throw new Error(`Ice ${id} not installed`);
  };
  const pa = where(a);
  const pb = where(b);
  const ice = pa.server.ice[pa.index];
  pa.server.ice[pa.index] = pb.server.ice[pb.index];
  pb.server.ice[pb.index] = ice;
  addLog(state, 'runner', `Runner swapped ice in ${pa.server.name} and ${pb.server.name} (Tāo Salonga).`);
}

// Carnivore: +1 MU. Access, once per turn -> Trash 2 cards from your grip:
// Trash the card you are accessing. Limit 1 console per player.
const carnivore: CardScript = {
  modifiers: { memory: 1 },
  accessAbility: {
    label: 'trash 2 cards from your grip to trash this card',
    canUse: ({ state, card }) => state.runner.grip.length >= 2 && turnFlag(state, `once:${card.instanceId}`) === 0,
    use: (ctx, accessed) => {
      useOncePerTurn(ctx.state, `once:${ctx.card.instanceId}`);
      askCards(ctx, 'runner', 'Carnivore: choose 2 cards from your grip to trash.', ctx.state.runner.grip.map(c => c.instanceId), 2, 2, 'carnivore', {
        accessedId: accessed.instanceId,
      });
    },
  },
  onPromptAnswer: ({ state }, source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    for (const id of answer.cardInstanceIds) {
      const card = state.runner.grip.find(c => c.instanceId === id)!;
      removeCard(state.runner.grip, card);
      state.runner.heap.push(card);
    }
    const accessed = Object.values(state.corp.servers)
      .flatMap(s => [...s.root, ...s.ice])
      .concat(state.corp.hq, state.corp.rd)
      .find(c => c.instanceId === source.data?.accessedId);
    if (accessed) {
      addLog(state, 'runner', `Runner trashed 2 cards from their grip to trash ${cardDef(accessed).title} (Carnivore).`);
      trashAccessedCard(state, accessed);
    }
  },
};

// Docklands Pass: The first time each turn you breach HQ, access 1 additional card.
const docklandsPass: CardScript = {
  modifiers: {
    breachAccesses: (state, _self, serverId) => (serverId === 'hq' && turnFlag(state, TurnFlag.hqBreaches) === 0 ? 1 : 0),
  },
};

// Pennyshaver: +1 MU. Whenever you make a successful run, place 1 credit on this
// hardware. click: Place 1 credit on this hardware, then take all credits from it.
const pennyshaver: CardScript = {
  modifiers: { memory: 1 },
  triggers: { successful_run: ({ card }) => addCounters(card, 'credit', 1) },
  abilities: [
    {
      label: 'Place 1 credit here, then take all credits from it.',
      clicks: 1,
      resolve: ({ state, card }) => {
        addCounters(card, 'credit', 1);
        takeHostedCredits(state, card, counters(card, 'credit'));
      },
    },
  ],
};

// DZMZ Optimizer: +1 MU. The first program you install each turn costs 1 credit less to install.
const dzmzOptimizer: CardScript = {
  modifiers: {
    memory: 1,
    runnerInstallCost: (state, _self, installing) =>
      cardDef(installing).type_code === 'program' && turnFlag(state, TurnFlag.programsInstalled) === 0 ? -1 : 0,
  },
};

// Pantograph: +1 MU. Whenever an agenda is scored or stolen, gain 1 credit.
// Then, you may install 1 card from your grip. Limit 1 console per player.
const pantographTrigger = (ctx: EffectContext) => {
  const { state } = ctx;
  gainCredits(state, 'runner', 1);
  addLog(state, 'runner', 'Runner gained 1 [credit] (Pantograph).');
  const installable = state.runner.grip.filter(c => cardDef(c).type_code !== 'event' && !runnerInstallBlocker(state, c));
  if (installable.length === 0) return;
  askCards(ctx, 'runner', 'Pantograph: you may install 1 card from your grip.', installable.map(c => c.instanceId), 0, 1, 'install');
};
const pantograph: CardScript = {
  modifiers: { memory: 1 },
  triggers: { agenda_scored: pantographTrigger, agenda_stolen: pantographTrigger },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards' || answer.cardInstanceIds.length === 0) return;
    // The card may have left the grip, or stopped being installable, since the prompt was asked
    const card = state.runner.grip.find(c => c.instanceId === answer.cardInstanceIds[0]);
    if (!card || runnerInstallBlocker(state, card)) return;
    installRunnerCardFrom(state, card, state.runner.grip);
  },
};

// T400 Memory Diamond: +1 MU. You get +1 maximum hand size.
const t400: CardScript = { modifiers: { memory: 1, handSize: 1 } };

// Botulus: Install only on a piece of ice. When you install this program and
// when your turn begins, place 1 virus counter on this program.
// Hosted virus counter: Break 1 subroutine on host ice.
const botulus: CardScript = {
  installsOnIce: true,
  triggers: virusGrowth(),
  abilities: [
    {
      label: 'Hosted virus counter: break 1 subroutine on host ice.',
      counters: { type: 'virus', count: 1 },
      canUse: ({ state, card }) => {
        if (!inBreakWindow(state)) return 'Only while encountering ice, before subroutines fire';
        if (state.activeRun!.encounter!.iceId !== card.hostedOnId) return 'Only while encountering the host ice';
        if (state.activeRun!.encounter!.broken.every(Boolean)) return 'No unbroken subroutines';
        return null;
      },
      resolve: ctx => {
        const encounter = ctx.state.activeRun!.encounter!;
        const ice = encounteredIce(ctx.state)!;
        const subs = iceScript(ice)?.subroutines ?? [];
        const options = encounter.broken.flatMap((b, i) => (b ? [] : [{ id: String(i), label: subs[i]?.label ?? `Subroutine ${i + 1}` }]));
        if (options.length === 1) {
          breakWithBotulus(ctx.state, Number(options[0].id));
          return;
        }
        askChoice(ctx, 'runner', 'Botulus: break which subroutine?', options, 'break');
      },
    },
  ],
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind === 'effect_choice') breakWithBotulus(state, Number(answer.optionId));
  },
};

function breakWithBotulus(state: GameState, index: number): void {
  const encounter = state.activeRun?.encounter;
  if (!encounter) return;
  encounter.broken[index] = true;
  addLog(state, 'runner', `Botulus broke subroutine ${index + 1}.`);
}

// Fermenter: When you install this program and when your turn begins, place 1
// virus counter on this program. click, trash: Gain 2 credits for each hosted virus counter.
const fermenter: CardScript = {
  triggers: virusGrowth(),
  abilities: [
    {
      label: 'Gain 2 credits for each hosted virus counter.',
      clicks: 1,
      trashSelf: true,
      resolve: ({ state, card }) => {
        const gain = 2 * counters(card, 'virus');
        gainCredits(state, 'runner', gain);
        addLog(state, 'runner', `Runner gained ${gain} [credit] (Fermenter).`);
      },
    },
  ],
};

// Leech: Whenever you make a successful run on a central server, place 1 virus
// counter on this program. Hosted virus counter: The ice you are encountering
// gets -1 strength for the remainder of this encounter.
const leech: CardScript = {
  triggers: {
    successful_run: ({ card }, e) => {
      if (CENTRALS.includes(e.server)) addCounters(card, 'virus', 1);
    },
  },
  abilities: [
    {
      label: 'Hosted virus counter: encountered ice gets -1 strength.',
      counters: { type: 'virus', count: 1 },
      canUse: ({ state }) => (inBreakWindow(state) ? null : 'Only while encountering ice, before subroutines fire'),
      resolve: ({ state }) => {
        state.activeRun!.encounter!.iceStrengthModifier -= 1;
      },
    },
  ],
};

// Tranquilizer: Install only on a piece of ice. When you install this program
// and when your turn begins, place 1 virus counter on this program. Then, if
// there are 3 or more hosted virus counters, derez host ice.
const tranquilizer: CardScript = {
  installsOnIce: true,
  triggers: virusGrowth(({ state, card }) => {
    if (counters(card, 'virus') < 3) return;
    const host = installedIce(state).find(c => c.instanceId === card.hostedOnId);
    if (host) derez(state, host);
  }),
};

// Conduit: Whenever a successful run on R&D ends, you may place 1 virus counter
// on this program. click: Run R&D. If successful, access X additional cards
// when you breach R&D. X is equal to the number of hosted virus counters.
const conduit: CardScript = {
  triggers: {
    run_ends: ({ card }, e) => {
      if (e.server === 'rd' && e.successful) addCounters(card, 'virus', 1);
    },
  },
  abilities: [
    {
      label: 'Run R&D.',
      clicks: 1,
      resolve: ({ state, card }) => startRun(state, 'rd', { source: { cardCode: card.cardCode, instanceId: card.instanceId } }),
    },
  ],
  onRunSuccessful: ({ state, card }) => {
    state.activeRun!.extraAccesses += counters(card, 'virus');
  },
};

// Cookbook: Whenever you install a virus program, you may place 1 virus counter on it.
const cookbook: CardScript = {
  triggers: {
    installed: ({ state }, e) => {
      if (cardDef(e.card).type_code !== 'program' || !isVirus(e.card)) return;
      addCounters(e.card, 'virus', 1);
      addLog(state, 'runner', `Cookbook placed a virus counter on ${cardDef(e.card).title}.`);
    },
  },
};

// Red Team: When you install this resource, load 12 credits onto it. When it is
// empty, trash it. click: Run a central server you have not run this turn. If
// successful, take 3 credits from this resource.
const unrunCentrals = (state: GameState) => CENTRALS.filter(s => !state.runsThisTurn.some(r => r.server === s));
const redTeam: CardScript = {
  trashWhenEmpty: true,
  triggers: { installed: (ctx, e) => isSelf(ctx, e.card) && loadCredits(ctx.state, ctx.card, 12) },
  abilities: [
    {
      label: 'Run a central server you have not run this turn.',
      clicks: 1,
      canUse: ({ state }) => (unrunCentrals(state).length > 0 ? null : 'You have run every central server this turn'),
      resolve: ctx => {
        const options = unrunCentrals(ctx.state).map(id => ({ id, label: ctx.state.corp.servers[id].name }));
        askChoice(ctx, 'runner', 'Red Team: run which central server?', options, 'run');
      },
    },
  ],
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    startRun(state, answer.optionId, { source: { cardCode: card.cardCode, instanceId: card.instanceId } });
  },
  onRunSuccessful: ({ state, card }) => {
    if (state.runner.rig.resources.includes(card)) takeHostedCredits(state, card, 3);
  },
};

// Telework Contract: When you install this resource, load 9 credits onto it.
// When it is empty, trash it. Once per turn -> click: Take 3 credits from this resource.
const teleworkContract: CardScript = {
  trashWhenEmpty: true,
  triggers: { installed: (ctx, e) => isSelf(ctx, e.card) && loadCredits(ctx.state, ctx.card, 9) },
  abilities: [{ label: 'Take 3 credits from this resource.', clicks: 1, oncePerTurn: true, resolve: ({ state, card }) => void takeHostedCredits(state, card, 3) }],
};

// Smartware Distributor: click: Place 3 credits on this resource. When your
// turn begins, take 1 credit from this resource.
const smartwareDistributor: CardScript = {
  triggers: {
    turn_begins: ({ state, card }, e) => {
      if (e.side === 'runner' && counters(card, 'credit') > 0) takeHostedCredits(state, card, 1);
    },
  },
  abilities: [{ label: 'Place 3 credits on this resource.', clicks: 1, resolve: ({ card }) => addCounters(card, 'credit', 3) }],
};

// Verbal Plasticity: The first time each turn you take the basic action to
// draw 1 card, instead draw 2 cards.
const verbalPlasticity: CardScript = { modifiers: { firstBasicDraw: 2 } };

export const runnerCardScripts: Record<string, CardScript> = {
  '30001': rene,
  '30003': carnivore,
  '30004': botulus,
  '30007': fermenter,
  '30008': leech,
  '30009': cookbook,
  '30010': zahya,
  '30013': docklandsPass,
  '30014': pennyshaver,
  '30017': tranquilizer,
  '30018': redTeam,
  '30019': tao,
  '30022': dzmzOptimizer,
  '30023': pantograph,
  '30024': conduit,
  '30027': teleworkContract,
  '30031': t400,
  '30033': smartwareDistributor,
  '30034': verbalPlasticity,
};
