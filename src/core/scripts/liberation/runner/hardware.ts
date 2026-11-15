import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { shuffleInPlace } from '../../../rng';
import { addLog } from '../../../engine/log';
import { removeCard } from '../../../engine/helpers';
import { breachOutsideRun, startRun } from '../../../engine/actions/run';
import { dealDamage, PREVENT_DAMAGE_STEP, PreventDamageData } from '../../../engine/damage';
import {
  counters,
  derez,
  drawForEffect,
  installedIce,
  removeCounters,
  removeFromGame,
  removeTags,
  runFlag,
  RunFlag,
  threatLevel,
  useOncePerTurn,
} from '../../../engine/cardEffects';
import { iceScript } from '../../../engine/ice';
import { ArrangeData, cards, cardsQuestion, choice, choiceQuestion, prompts, RunnerHostData } from '../../steps';
import { CardScript, EffectContext } from '../../types';
import { installableRunnerCards, installRunnerHostChoice } from '../../effects';
import { returnInstalledToHQ } from '../corp/helpers';
import { bypassIfStill, centralServers, ids, isInstalled, isSelf, onceKey, place, runSource, spendLoad, title, type, yesNo } from './helpers';

/** Successful runs on HQ, R&D and Archives this turn (The Wizard's Chest, Jeitinho). */
const ranAllCentrals = (state: GameState) => centralServers.every(id => state.runsThisTurn.some(r => r.server === id && r.successful));

// --- The Automata Initiative: Anarch -------------------------------------------------------

// Solidarity Badge: The first time each turn you trash a Corp card, place 1 power counter on this
// hardware. When your turn begins, you may remove 1 hosted power counter to draw 1 card or remove 1 tag.
const badgeFlow = prompts({
  use: choice(({ state, card }, a) => {
    if (a.optionId === 'no' || counters(card, 'power') === 0) return;
    removeCounters(card, 'power', 1);
    if (a.optionId === 'draw') drawForEffect(state, 'runner', 1, 'Solidarity Badge');
    else removeTags(state, 1);
  }),
});

export const solidarityBadge: CardScript = {
  triggers: {
    runner_trashed_corp_card: ctx => {
      if (useOncePerTurn(ctx.state, onceKey(ctx.card))) place(ctx.card, 'power', 1);
    },
    turn_begins: (ctx, e) => {
      if (e.side !== 'runner' || counters(ctx.card, 'power') === 0) return;
      badgeFlow.ask(
        ctx,
        'use',
        choiceQuestion('runner', 'Solidarity Badge: remove 1 power counter to draw 1 card or remove 1 tag?', [
          { id: 'draw', label: 'Draw 1 card' },
          ...(ctx.state.runner.tags > 0 ? [{ id: 'tag', label: 'Remove 1 tag' }] : []),
          { id: 'no', label: 'No' },
        ]),
      );
    },
  },
  ...badgeFlow.script,
};

// Capybara: Whenever you bypass a piece of ice, you may remove this hardware from the game to derez that ice.
const capybaraFlow = prompts({
  derez: choice<{ iceId: string }>(({ state, card }, a, data) => {
    const ice = installedIce(state).find(c => c.instanceId === data.iceId);
    if (a.optionId !== 'yes' || !ice || !isInstalled(state, card)) return;
    removeFromGame(state, card);
    derez(state, ice);
    addLog(state, 'runner', `Runner removed Capybara from the game to derez ${title(ice)}.`);
  }),
});

export const capybara: CardScript = {
  triggers: {
    ice_bypassed: (ctx, e) =>
      capybaraFlow.ask(ctx, 'derez', choiceQuestion('runner', `Capybara: remove it from the game to derez ${title(e.ice)}?`, yesNo('Remove Capybara and derez')), { iceId: e.ice.instanceId }),
  },
  ...capybaraFlow.script,
};

// Hermes (Console): +1 MU. Whenever an agenda is scored or stolen, add 1 unrezzed card to HQ.
const hermesTargets = (state: GameState) => Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]).filter(c => !c.isRezzed);

const hermesAsk = (ctx: EffectContext) => {
  const targets = hermesTargets(ctx.state);
  if (targets.length > 0) hermesFlow.ask(ctx, 'bounce', cardsQuestion('runner', 'Hermes: add 1 unrezzed installed card to HQ.', ids(targets), 1, 1));
};

const hermesFlow = prompts({
  bounce: cards(({ state }, a) => {
    const target = hermesTargets(state).find(c => c.instanceId === a.ids[0]);
    if (target && returnInstalledToHQ(state, target)) addLog(state, 'runner', 'Runner added an unrezzed card to HQ (Hermes).');
  }),
});

export const hermes: CardScript = {
  modifiers: { memory: 1 },
  triggers: { agenda_scored: hermesAsk, agenda_stolen: hermesAsk },
  // Resolving after another "scored" ability (Send a Message rezzing a card), only still-unrezzed cards
  liveCandidates: state => ids(hermesTargets(state)),
  ...hermesFlow.script,
};

// AirbladeX (JSRF Ed.) (Vehicle): When you install this hardware, load 3 power counters onto it.
// When it is empty, trash it. [interrupt] -> Hosted power counter: Prevent 1 net damage. Use this
// ability only during a run. [interrupt] -> Hosted power counter: Prevent a "when encountered"
// ability on a piece of ice. (The Runner is asked how much net damage to prevent, so they can save counters.)
const airbladeFlow = prompts({
  [PREVENT_DAMAGE_STEP]: choice<PreventDamageData>(({ state, card }, a, d) => {
    const n = Math.min(Number(a.optionId), d.amount, counters(card, 'power'));
    if (n > 0) {
      addLog(state, 'runner', `Runner prevented ${n} net damage (AirbladeX).`);
      spendLoad(state, card, n);
    }
    dealDamage(state, d.damageType, d.amount - n, d.byCorp, { preventionAsked: true, then: d.then || undefined });
  }),
  prevent: choice<{ iceId: string }>(({ state, card }, a, d) => {
    const encounter = state.activeRun?.encounter;
    if (a.optionId !== 'yes' || !encounter || encounter.iceId !== d.iceId || counters(card, 'power') === 0) return;
    encounter.onEncounterPending = false;
    addLog(state, 'runner', 'Runner prevented the "when encountered" ability (AirbladeX).');
    spendLoad(state, card);
  }),
});

export const airblade: CardScript = {
  triggers: {
    installed: (ctx, e) => isSelf(ctx, e.card) && place(ctx.card, 'power', 3),
    encounter_ice: (ctx, e) => {
      if (!iceScript(e.ice)?.onEncounter || counters(ctx.card, 'power') === 0) return;
      airbladeFlow.ask(ctx, 'prevent', choiceQuestion('runner', `AirbladeX: spend 1 power counter to prevent ${title(e.ice)}'s "when encountered" ability?`, yesNo('Prevent it')), {
        iceId: e.ice.instanceId,
      });
    },
  },
  canPreventDamage: (state, self, kind, amount) =>
    kind === 'net' && state.activeRun && !state.activeRun.accessOnly ? Math.min(amount, counters(self, 'power')) : 0,
  ...airbladeFlow.script,
};

// LilyPAD (Console): +2 MU. The first time each turn you install a program, you may draw 1 card.
const lilypadFlow = prompts({
  draw: choice(({ state }, a) => {
    if (a.optionId === 'yes') drawForEffect(state, 'runner', 1, 'LilyPAD');
  }),
});

export const lilypad: CardScript = {
  modifiers: { memory: 2 },
  triggers: {
    installed: (ctx, e) => {
      if (type(e.card) !== 'program' || cardDef(e.card).side_code !== 'runner') return;
      if (useOncePerTurn(ctx.state, onceKey(ctx.card))) lilypadFlow.ask(ctx, 'draw', choiceQuestion('runner', 'LilyPAD: draw 1 card?', yesNo('Draw 1 card')));
    },
  },
  ...lilypadFlow.script,
};

// Amanuensis (Console): +1 MU. When your turn ends, place 1 power counter on this hardware if you
// are tagged. Whenever you remove 1 or more tags, you may remove 1 hosted power counter to draw 2 cards.
const amanuensisFlow = prompts({
  draw: choice(({ state, card }, a) => {
    if (a.optionId !== 'yes' || counters(card, 'power') === 0) return;
    removeCounters(card, 'power', 1);
    drawForEffect(state, 'runner', 2, 'Amanuensis');
  }),
});

export const amanuensis: CardScript = {
  modifiers: { memory: 1 },
  triggers: {
    discard_phase_ends: (ctx, e) => {
      if (e.side === 'runner' && ctx.state.runner.tags > 0) place(ctx.card, 'power', 1);
    },
    tags_removed: ctx => {
      if (counters(ctx.card, 'power') > 0) amanuensisFlow.ask(ctx, 'draw', choiceQuestion('runner', 'Amanuensis: remove 1 power counter to draw 2 cards?', yesNo('Draw 2 cards')));
    },
  },
  ...amanuensisFlow.script,
};

// The Wizard's Chest: Use this hardware only if you made a successful run on HQ, R&D, and Archives
// this turn. [trash]: Choose hardware, program, or resource. Set aside cards from the top of your
// stack faceup until you set aside 2 cards of the chosen type. You may install 1 of those 2 cards,
// ignoring all costs. Shuffle the rest of the set-aside cards into your stack.
const chestFlow = prompts({
  type: choice((ctx, a) => {
    const { state } = ctx;
    const setAside: CardInstance[] = [];
    let found = 0;
    while (found < 2 && state.runner.stack.length > 0) {
      const card = state.runner.stack.shift()!;
      setAside.push(card);
      if (type(card) === a.optionId) found++;
    }
    addLog(state, 'runner', `Runner set aside ${setAside.map(title).join(', ') || 'nothing'} (The Wizard's Chest).`);
    // Set-aside cards wait in the grip-free "removed" limbo: kept on the stack's bottom until the choice is made
    const chosen = setAside.filter(c => type(c) === a.optionId);
    const rest = setAside.filter(c => !chosen.includes(c));
    state.runner.stack.push(...rest);
    shuffleInPlace(state.rng, state.runner.stack);
    state.runner.stack.push(...chosen);
    const options = installableRunnerCards(state, chosen, 99);
    if (options.length > 0) {
      chestFlow.runnerInstall(ctx, 'install', { message: "The Wizard's Chest: you may install 1 of them, ignoring all costs.", candidateIds: ids(options), min: 0, max: 1 }, { chosen: ids(chosen).join(',') });
    } else shuffleInPlace(state.rng, state.runner.stack);
  }),
  install: cards<{ chosen: string }>((ctx, a) => {
    if (a.ids[0]) chestFlow.installRunner(ctx, a.ids[0], 'host', 99, a.trashFirst);
    shuffleInPlace(ctx.state.rng, ctx.state.runner.stack);
  }),
  host: choice<RunnerHostData>((ctx, a, _d, source) => {
    installRunnerHostChoice(ctx.state, source, a.raw);
    shuffleInPlace(ctx.state.rng, ctx.state.runner.stack);
  }),
});

export const wizardsChest: CardScript = {
  abilities: [
    {
      label: 'Set aside cards from the top of your stack until 2 of a chosen type; install 1 free.',
      trashSelf: true,
      canUse: ({ state }) => (ranAllCentrals(state) ? null : 'You need successful runs on HQ, R&D and Archives this turn'),
      resolve: ctx =>
        chestFlow.ask(
          ctx,
          'type',
          choiceQuestion('runner', "The Wizard's Chest: choose a card type.", [
            { id: 'hardware', label: 'Hardware' },
            { id: 'program', label: 'Program' },
            { id: 'resource', label: 'Resource' },
          ]),
        ),
    },
  ],
  ...chestFlow.script,
};

// Alarm Clock: When your turn begins, you may run HQ. The first time you encounter a piece of ice
// during that run, you may spend [click][click] to bypass it.
const alarmFlow = prompts({
  run: choice((ctx, a) => {
    if (a.optionId === 'yes') startRun(ctx.state, 'hq', { source: runSource(ctx) });
  }),
  bypass: choice<{ iceId: string }>(({ state }, a, data) => {
    if (a.optionId !== 'yes' || state.runner.clicks < 2) return;
    state.runner.clicks -= 2;
    bypassIfStill(state, data.iceId);
  }),
});

export const alarmClock: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side === 'runner') alarmFlow.ask(ctx, 'run', choiceQuestion('runner', 'Alarm Clock: run HQ?', yesNo('Run HQ')));
    },
    encounter_ice: (ctx, e) => {
      const run = ctx.state.activeRun;
      if (!run?.runEffects.some(r => r.instanceId === ctx.card.instanceId) || runFlag(ctx.state, RunFlag.encounters) !== 1 || ctx.state.runner.clicks < 2) return;
      alarmFlow.ask(ctx, 'bypass', choiceQuestion('runner', `Alarm Clock: spend [click][click] to bypass ${title(e.ice)}?`, yesNo('Spend [click][click] and bypass')), { iceId: e.ice.instanceId });
    },
  },
  ...alarmFlow.script,
};

// Jeitinho (Weapon): When your turn ends, if you made a successful run on HQ, R&D, and Archives this
// turn, you may add this hardware to your score area as an assassination agenda worth 0 agenda
// points. Then, if you have 3 assassination agendas in your score area, you win the game. Threat 3 ->
// Whenever you bypass a piece of ice, you may spend [click] to install this hardware from your heap.
const JEITINHO = '34079';

const jeitinhoFlow = prompts({
  score: choice(({ state, card }, a) => {
    if (a.optionId !== 'yes' || !isInstalled(state, card)) return;
    removeCard(state.runner.rig.hardware, card);
    card.tokens = {};
    card.asAgendaPoints = 0;
    state.runner.scoreArea.push(card);
    addLog(state, 'runner', 'Runner added Jeitinho to their score area as an assassination agenda.');
    if (state.runner.scoreArea.filter(c => c.cardCode === JEITINHO).length >= 3) {
      state.winner = 'runner';
      state.winReason = 'Jeitinho: 3 assassination agendas';
      addLog(state, 'runner', 'The Runner has 3 assassination agendas and wins the game (Jeitinho).');
    }
  }),
  install: choice((ctx, a) => {
    const { state, card } = ctx;
    if (a.optionId !== 'yes' || state.runner.clicks === 0 || !state.runner.heap.includes(card)) return;
    state.runner.clicks -= 1;
    jeitinhoFlow.installRunnerNoHost(ctx, card.instanceId, 0, a.trashFirst);
  }),
});

export const jeitinho: CardScript = {
  triggers: {
    discard_phase_ends: (ctx, e) => {
      if (e.side === 'runner' && ranAllCentrals(ctx.state)) jeitinhoFlow.ask(ctx, 'score', choiceQuestion('runner', 'Jeitinho: add it to your score area as an assassination agenda?', yesNo('Add to score area')));
    },
  },
  heapTriggers: {
    ice_bypassed: ctx => {
      const { state } = ctx;
      if (threatLevel(state) < 3 || state.runner.clicks === 0 || installableRunnerCards(state, [ctx.card]).length === 0) return;
      jeitinhoFlow.ask(ctx, 'install', choiceQuestion('runner', 'Jeitinho: spend [click] to install it from your heap?', yesNo('Spend [click] and install')));
    },
  },
  ...jeitinhoFlow.script,
};

// Cataloguer: When you install this hardware, load 2 power counters onto it. When it is empty, trash
// it. Whenever you make a successful run on R&D, instead of breaching R&D, you may remove 1 hosted
// power counter to look at the top 4 cards of R&D and arrange them in any order. [click], hosted
// power counter: Breach R&D. Use this ability only if you made a successful run on R&D this turn.
const cataloguerFlow = prompts({
  instead: choice((ctx, a) => {
    const { state, card } = ctx;
    if (a.optionId !== 'yes' || !state.activeRun) return;
    state.activeRun.breachInstead = 'none';
    const top = ids(state.corp.rd.slice(0, 4));
    spendLoad(state, card);
    addLog(state, 'runner', 'Runner looked at the top 4 cards of R&D (Cataloguer).');
    cataloguerFlow.arrangeTop(ctx, 'arrange', top, 'runner');
  }),
  arrange: cards<ArrangeData>((ctx, a, data) => cataloguerFlow.arrangeNext(ctx, 'arrange', data, a.ids[0])),
});

export const cataloguer: CardScript = {
  triggers: {
    installed: (ctx, e) => isSelf(ctx, e.card) && place(ctx.card, 'power', 2),
    successful_run: (ctx, e) => {
      if (e.server !== 'rd' || counters(ctx.card, 'power') === 0 || ctx.state.activeRun?.breachInstead) return;
      cataloguerFlow.ask(ctx, 'instead', choiceQuestion('runner', 'Cataloguer: remove 1 power counter to arrange the top 4 cards of R&D instead of breaching it?', yesNo('Arrange instead')));
    },
  },
  abilities: [
    {
      label: 'Hosted power counter: breach R&D.',
      clicks: 1,
      canUse: ({ state, card }) => {
        if (counters(card, 'power') === 0) return 'No power counters';
        return state.runsThisTurn.some(r => r.server === 'rd' && r.successful) ? null : 'You need a successful run on R&D this turn';
      },
      resolve: ({ state, card }) => {
        spendLoad(state, card);
        breachOutsideRun(state, 'rd');
      },
    },
  ],
  ...cataloguerFlow.script,
};

export const liberationRunnerHardwareScripts: Record<string, CardScript> = {
  '34003': solidarityBadge,
  '34013': capybara,
  '34014': hermes,
  '34022': airblade,
  '34023': lilypad,
  '34069': amanuensis,
  '34070': wizardsChest,
  '34078': alarmClock,
  '34079': jeitinho,
  '34088': cataloguer,
};
