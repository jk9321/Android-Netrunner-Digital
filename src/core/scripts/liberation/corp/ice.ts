import { CardInstance } from '../../../types/card';
import { EncounterState, GameState } from '../../../types/state';
import { shuffleRD } from '../../../engine/rdKnowledge';
import { addLog } from '../../../engine/log';
import { findInstalledCorpCard, removeCard, turnKey } from '../../../engine/helpers';
import { completeRez } from '../../../engine/actions/corp';
import { dealCoreDamage, dealNetDamage, giveTags, installedRunnerCards, trashInstalledRunnerCard } from '../../../engine/damage';
import { endTheRun } from '../../../engine/runEnd';
import { grantedBefore, grantRunSubroutines } from '../../../engine/ice';
import {
  availableCredits,
  corpTrashFromHQ,
  derez,
  drawForEffect,
  gainFromCard,
  installedIce,
  loseCredits,
  removeTags,
  spendCredits,
  takeBadPublicity,
  threatLevel,
  turnFlag,
  useOncePerTurn,
} from '../../../engine/cardEffects';
import { cards, cardsQuestion, choice, choiceQuestion, InstallData, prompts } from '../../steps';
import { CardScript, EffectContext, Subroutine } from '../../types';
import { corpInstallOptions, installCorpChoice, unlessPaysQuestion } from '../../effects';
import {
  archivesCards,
  faceUpTypes,
  hasKeyword,
  ids,
  installable,
  installAmongQuestion,
  isSelf,
  keywords,
  lycianIs,
  placeAdvancement,
  placeAdvancementQuestion,
  returnInstalledToHQ,
  runOnServerOf,
  serverOf,
  takeFromCorpZone,
  title,
  type,
  yesNo,
} from './helpers';

const endTheRunSub: Subroutine = { label: 'End the run.', resolve: ({ state }) => endTheRun(state) };

const netDamageSub = (n: number): Subroutine => ({ label: `Do ${n} net damage.`, resolve: ({ state }) => void dealNetDamage(state, n) });

const tagSub = (n: number): Subroutine => ({ label: `Give the Runner ${n} tag${n > 1 ? 's' : ''}.`, resolve: ({ state }) => giveTags(state, n) });

const loseCreditsSub = (n: number): Subroutine => ({
  label: `The Runner loses ${n} [credit].`,
  resolve: ({ state, card }) => {
    const lost = loseCredits(state, 'runner', n);
    addLog(state, 'corp', `The Runner lost ${lost} [credit] (${title(card)}).`);
  },
});

const loseClickSub: Subroutine = {
  label: 'The Runner loses [click].',
  resolve: ({ state }) => {
    if (state.runner.clicks > 0) state.runner.clicks -= 1;
  },
};

const gainSub = (n: number, label = `Gain ${n} [credit].`): Subroutine => ({
  label,
  resolve: ({ state, card }) => {
    gainFromCard(state, 'corp', n, card);
    addLog(state, 'corp', `Corp gained ${n} [credit] (${title(card)}).`);
  },
});

/**
 * "As an additional cost to rez this ice, take 1 bad publicity or remove 1
 * tag" (liability ice: Valentão, Piranhas): the question, asked from payRez with data { cost }...
 */
const liabilityQuestion = (ctx: EffectContext) =>
  choiceQuestion('corp', `${title(ctx.card)}: take 1 bad publicity or remove 1 tag to rez it.`, [
    { id: 'bp', label: 'Take 1 bad publicity' },
    ...(ctx.state.runner.tags > 0 ? [{ id: 'tag', label: 'Remove 1 tag' }] : []),
  ]);

/** ...and the step that answers it: pays the additional cost, then the rez cost, and rezzes. */
const liabilityRezStep = () =>
  choice<{ cost: number }>((ctx, a, { cost }) => {
    const { state, card } = ctx;
    if (a.optionId === 'tag' && state.runner.tags > 0) removeTags(state, 1);
    else takeBadPublicity(state, 1);
    spendCredits(state, 'corp', cost, { kind: 'rez', card });
    addLog(state, 'corp', `Corp spent ${cost} [credit] to rez ${title(card)}.`, undefined, 'rez');
    completeRez(state, card);
  });

// Ablative Barrier: Threat 3 -> When you rez this ice during a run against this server, you may
// install 1 non-agenda card from HQ or Archives in the root of or protecting another server.
// Subroutine: End the run.
const ablativeFlow = prompts({
  pick: cards((ctx, a) => {
    const { state } = ctx;
    const id = a.ids[0];
    const card = id && [...state.corp.hq, ...archivesCards(state)].find(c => c.instanceId === id);
    if (!card) return;
    const here = serverOf(state, ctx.card)?.id;
    ablativeFlow.askIf(ctx, 'server', installAmongQuestion(state, id, corpInstallOptions(state, card).filter(o => o.id !== here)), { cardId: id, install: true });
  }),
  server: choice<InstallData>((ctx, a, _d, source) => void installCorpChoice(ctx.state, source, a.raw)),
});

export const ablativeBarrier: CardScript = {
  ice: {
    subroutines: [endTheRunSub],
    onRezDuringRunOnServer: ctx => {
      const { state } = ctx;
      if (threatLevel(state) < 3) return;
      const cards = installable(state, [...state.corp.hq, ...archivesCards(state)].filter(c => type(c) !== 'agenda'));
      // Asked even with nothing to install when the Corp's stops are on ALL (4.3.2, 4.4.6c, see askEvenIfNone)
      ablativeFlow.evenIfNone(
        ctx,
        'corp',
        cards.length > 0,
        () =>
          ablativeFlow.ask(ctx, 'pick', cardsQuestion('corp', 'Ablative Barrier: you may install 1 non-agenda card from HQ or Archives in or protecting another server.', ids(cards), 0, 1)),
        'Ablative Barrier: no non-agenda card in HQ or Archives you can install.',
      );
    },
  },
  ...ablativeFlow.script,
};

// Jaguarundi (Sentry - AP): Threat 4 -> When the Runner encounters this ice, give them 1 tag
// unless they spend [click]. Subroutines: Give the Runner 1 tag. If the Runner is tagged, do 1 core damage.
const jaguarundiFlow = prompts({
  encounter: choice(({ state }, a) => {
    if (a.optionId === 'click' && state.runner.clicks > 0) {
      state.runner.clicks -= 1;
      addLog(state, 'runner', 'Runner spent [click] (Jaguarundi).');
    } else giveTags(state, 1);
  }),
});

export const jaguarundi: CardScript = {
  ice: {
    onEncounter: ctx => {
      const { state } = ctx;
      if (threatLevel(state) < 4) return;
      if (state.runner.clicks === 0) return giveTags(state, 1);
      jaguarundiFlow.ask(
        ctx,
        'encounter',
        choiceQuestion('runner', 'Jaguarundi: spend [click], or take 1 tag?', [
          { id: 'click', label: 'Spend [click]' },
          { id: 'tag', label: 'Take 1 tag' },
        ]),
      );
    },
    subroutines: [
      tagSub(1),
      {
        label: 'If the Runner is tagged, do 1 core damage.',
        resolve: ({ state }) => {
          if (state.runner.tags > 0) dealCoreDamage(state, 1);
        },
      },
    ],
  },
  ...jaguarundiFlow.script,
};

// M.I.C. (Code Gate): [trash]: End the run unless the Runner spends [click]. Use this ability
// only during a run on this server. Subroutines: The Runner loses [click] (twice). End the run.
const micFlow = prompts({
  trash: choice(({ state }, a) => {
    if (a.optionId === 'click' && state.runner.clicks > 0) {
      state.runner.clicks -= 1;
      addLog(state, 'runner', 'Runner spent [click] (M.I.C.).');
    } else endTheRun(state);
  }),
});

export const mic: CardScript = {
  abilities: [
    {
      label: 'End the run unless the Runner spends [click].',
      trashSelf: true,
      canUse: ({ state, card }) => (runOnServerOf(state, card) ? null : 'Use this only during a run on this server'),
      resolve: ctx => {
        if (ctx.state.runner.clicks === 0) return endTheRun(ctx.state);
        micFlow.ask(
          ctx,
          'trash',
          choiceQuestion('runner', 'M.I.C.: spend [click], or the run ends?', [
            { id: 'click', label: 'Spend [click]' },
            { id: 'end', label: 'End the run' },
          ]),
        );
      },
    },
  ],
  ice: { subroutines: [loseClickSub, loseClickSub, endTheRunSub] },
  ...micFlow.script,
};

// Attini (Code Gate - AP): Threat 3 -> The Runner cannot spend credits while subroutines on this
// ice are resolving. Subroutines (3): Do 1 net damage unless the Runner pays 2 credits.
const attiniSub: Subroutine = {
  label: 'Do 1 net damage unless the Runner pays 2 [credit].',
  resolve: ctx => {
    if (!attiniFlow.askIf(ctx, 'pay', unlessPaysQuestion(ctx, 2, 'take 1 net damage', threatLevel(ctx.state) < 3))) dealNetDamage(ctx.state, 1);
  },
};

const attiniFlow = prompts({
  pay: choice(({ state }, a) => {
    if (a.optionId === 'pay' && availableCredits(state, 'runner') >= 2) spendCredits(state, 'runner', 2);
    else dealNetDamage(state, 1);
  }),
});

export const attini: CardScript = {
  ice: { subroutines: [attiniSub, attiniSub, attiniSub] },
  ...attiniFlow.script,
};

// Phoneutria (Sentry - AP - Observer): When the Runner passes this ice, if there are 4 or more
// cards in the grip, give them 1 tag. Subroutines: Do 1 net damage (twice).
export const phoneutria: CardScript = {
  ice: {
    onPass: ({ state }) => {
      if (state.runner.grip.length >= 4) giveTags(state, 1);
    },
    subroutines: [netDamageSub(1), netDamageSub(1)],
  },
};

// Tatu-Bola (Barrier): When the Runner passes this ice, you may swap it with a piece of ice from
// HQ. If you do, gain 4 credits. (The new ice is installed unrezzed; no install cost.)
// Subroutine: End the run.
const tatuBolaFlow = prompts({
  swap: cards(({ state, card }, a) => {
    const incoming = state.corp.hq.find(c => c.instanceId === a.ids[0]);
    const found = findInstalledCorpCard(state, card.instanceId);
    if (!incoming || !found) return;
    const index = found.server.ice.indexOf(card);
    removeCard(state.corp.hq, incoming);
    returnInstalledToHQ(state, card);
    incoming.isRezzed = false;
    incoming.advancementCounters = 0;
    incoming.tokens = {};
    incoming.installedTurn = turnKey(state);
    found.server.ice.splice(index, 0, incoming);
    gainFromCard(state, 'corp', 4, card);
    addLog(state, 'corp', `Corp swapped Tatu-Bola with a piece of ice from HQ and gained 4 [credit].`, undefined, 'install');
  }),
});

export const tatuBola: CardScript = {
  ice: {
    onPass: ctx => {
      const ice = ctx.state.corp.hq.filter(c => type(c) === 'ice');
      // Asked even with no ice in HQ when the Corp's stops are on ALL (4.3.2, see askEvenIfNone)
      tatuBolaFlow.evenIfNone(
        ctx,
        'corp',
        ice.length > 0,
        () => tatuBolaFlow.ask(ctx, 'swap', cardsQuestion('corp', 'Tatu-Bola: you may swap it with a piece of ice from HQ and gain 4 [credit].', ids(ice), 0, 1)),
        'Tatu-Bola: no ice in HQ to swap in.',
      );
    },
    subroutines: [endTheRunSub],
  },
  ...tatuBolaFlow.script,
};

// Starlit Knight (Sentry - Observer): Threat 4 -> When the Runner encounters this ice, it gains X
// "End the run." subroutines for the remainder of this run, after its other subroutines. X is the
// number of tags the Runner has. Subroutines: Give the Runner 1 tag (twice).
export const starlitKnight: CardScript = {
  grantedSubroutines: [endTheRunSub],
  ice: {
    onEncounter: ({ state, card }) => {
      if (threatLevel(state) < 4 || state.runner.tags === 0) return;
      grantRunSubroutines(state, card, card.cardCode, 0, state.runner.tags);
      addLog(state, 'corp', `Starlit Knight gained ${state.runner.tags} "End the run." subroutine(s) for this run.`);
    },
    subroutines: [tagSub(1), tagSub(1)],
  },
};

// Virtual Service Agent (Code Gate - Observer): Whenever the Runner passes this ice after
// encountering it, if they did not break its printed subroutine with a decoder during that
// encounter, give them 1 tag. Subroutine: The Runner loses 1 credit.
const brokeWithDecoder = (state: GameState, ice: CardInstance, encounter: EncounterState, printedIndex: number) => {
  const by = encounter.brokenBy?.[printedIndex];
  const breaker = by && state.runner.rig.programs.find(p => p.instanceId === by);
  return !!encounter.broken[printedIndex] && !!breaker && hasKeyword(breaker, 'decoder') && !!ice;
};

export const virtualServiceAgent: CardScript = {
  ice: {
    onPass: ({ state, card }, encounter) => {
      if (!encounter) return;
      const printed = encounter.grantedSubs?.length ?? 0;
      if (!brokeWithDecoder(state, card, encounter, printed)) giveTags(state, 1);
    },
    subroutines: [loseCreditsSub(1)],
  },
};

// Tree Line (Barrier - Expendable): [click], 1 credit, reveal and trash this ice from HQ: Place 3
// advancement counters on 1 installed piece of ice. You can advance this ice. It gets +1 strength
// for each hosted advancement counter. Subroutine: Gain 1 credit. End the run.
const treeLineFlow = prompts({
  place: cards<{ n: number }>(({ state }, a) => placeAdvancement(state, a.ids[0], 3, 'Tree Line')),
});

export const treeLine: CardScript = {
  abilities: [
    {
      label: 'Reveal and trash this ice from HQ: place 3 advancement counters on 1 installed piece of ice.',
      fromHQ: true,
      clicks: 1,
      credits: 1,
      canUse: ({ state }) => (installedIce(state).length > 0 ? null : 'No installed ice'),
      resolve: ctx => {
        corpTrashFromHQ(ctx.state, [ctx.card.instanceId], true);
        addLog(ctx.state, 'corp', 'Corp revealed and trashed Tree Line from HQ.');
        treeLineFlow.askIf(ctx, 'place', placeAdvancementQuestion(ctx, 3, false, installedIce(ctx.state)), { n: 3 });
      },
    },
  ],
  ice: {
    strengthModifier: (_state, ice) => ice.advancementCounters,
    subroutines: [
      {
        label: 'Gain 1 [credit]. End the run.',
        resolve: ({ state, card }) => {
          gainFromCard(state, 'corp', 1, card);
          endTheRun(state);
        },
      },
    ],
  },
  ...treeLineFlow.script,
};

// Valentão (Code Gate - Liability): As an additional cost to rez this ice, take 1 bad publicity or
// remove 1 tag. Subroutines: Gain 2 credits. The Runner loses 2 credits. End the run if you have
// more credits than the Runner.
const ifRicherEtr: Subroutine = {
  label: 'End the run if you have more credits than the Runner.',
  resolve: ({ state }) => {
    if (state.corp.credits > state.runner.credits) endTheRun(state);
  },
};

const valentaoFlow = prompts({ rez_cost: liabilityRezStep() });

export const valentao: CardScript = {
  payRez: (ctx, cost) => valentaoFlow.ask(ctx, 'rez_cost', liabilityQuestion(ctx), { cost }),
  ice: { subroutines: [gainSub(2), loseCreditsSub(2), ifRicherEtr] },
  ...valentaoFlow.script,
};

// Lycian Multi-Munition (Mythic - Destroyer): When you rez this ice, choose 1 or more subtypes
// among barrier, code gate, and sentry. This ice gains the chosen subtypes while it remains rezzed.
// When a turn ends, derez this ice. Subroutines: If this ice is a code gate, the Runner loses
// [click] and 1 credit. If this ice is a sentry, trash 1 installed program. If this ice is a
// barrier, gain 1 credit and end the run.
const LYCIAN_CHOICES: [string, string[]][] = [
  ['barrier', ['barrier']],
  ['code gate', ['code gate']],
  ['sentry', ['sentry']],
  ['barrier+code gate', ['barrier', 'code gate']],
  ['barrier+sentry', ['barrier', 'sentry']],
  ['code gate+sentry', ['code gate', 'sentry']],
  ['all', ['barrier', 'code gate', 'sentry']],
];

const lycianFlow = prompts({
  subtypes: choice(({ state, card }, a) => {
    card.chosenSubtypes = LYCIAN_CHOICES.find(([id]) => id === a.optionId)?.[1] ?? ['barrier'];
    addLog(state, 'corp', `Lycian Multi-Munition is now a ${card.chosenSubtypes.join(' and ')}.`);
  }),
  trash: cards(({ state }, a) => {
    const program = state.runner.rig.programs.find(c => c.instanceId === a.ids[0]);
    if (program) {
      trashInstalledRunnerCard(state, program);
      addLog(state, 'corp', `Lycian Multi-Munition trashed ${title(program)}.`);
    }
  }),
});

export const lycian: CardScript = {
  triggers: {
    rezzed: (ctx, e) => {
      if (!isSelf(ctx, e.card)) return;
      lycianFlow.ask(ctx, 'subtypes', choiceQuestion('corp', 'Lycian Multi-Munition: choose the subtypes it gains while rezzed.', LYCIAN_CHOICES.map(([id, list]) => ({ id, label: list.join(', ') }))));
    },
    discard_phase_ends: ({ state, card }) => derez(state, card),
  },
  ice: {
    subroutines: [
      {
        label: 'If this ice is a code gate, the Runner loses [click] and 1 [credit].',
        resolve: ({ state, card }) => {
          if (!lycianIs(state, card, 'code gate')) return;
          if (state.runner.clicks > 0) state.runner.clicks -= 1;
          loseCredits(state, 'runner', 1);
        },
      },
      {
        label: 'If this ice is a sentry, trash 1 installed program.',
        resolve: ctx => {
          const programs = ctx.state.runner.rig.programs;
          if (lycianIs(ctx.state, ctx.card, 'sentry') && programs.length > 0) lycianFlow.ask(ctx, 'trash', cardsQuestion('corp', 'Lycian Multi-Munition: trash 1 installed program.', ids(programs), 1, 1));
        },
      },
      {
        label: 'If this ice is a barrier, gain 1 [credit] and end the run.',
        resolve: ({ state, card }) => {
          if (!lycianIs(state, card, 'barrier')) return;
          gainFromCard(state, 'corp', 1, card);
          endTheRun(state);
        },
      },
    ],
  },
  ...lycianFlow.script,
};

// Sorocaban Blade (Sentry - Destroyer): You cannot trash more than 1 installed Runner card with
// this ice during each encounter. Subroutines: Trash 1 installed resource. Trash 1 installed piece
// of hardware. Trash 1 installed program.
const SOROCABAN_KEY = 'sorocaban';

const sorocabanSub = (kind: 'resources' | 'hardware' | 'programs', label: string): Subroutine => ({
  label: `Trash 1 installed ${label}.`,
  resolve: ctx => {
    const encounter = ctx.state.activeRun?.encounter;
    if ((encounter?.flags?.[SOROCABAN_KEY] ?? 0) > 0) return;
    const cards = ctx.state.runner.rig[kind];
    if (cards.length > 0) sorocabanFlow.ask(ctx, 'trash', cardsQuestion('corp', `Sorocaban Blade: trash 1 installed ${label}.`, ids(cards), 1, 1));
  },
});

const sorocabanFlow = prompts({
  trash: cards(({ state }, a) => {
    const target = installedRunnerCards(state).find(c => c.instanceId === a.ids[0]);
    if (!target) return;
    trashInstalledRunnerCard(state, target);
    addLog(state, 'corp', `Sorocaban Blade trashed ${title(target)}.`);
    const encounter = state.activeRun?.encounter;
    if (encounter) encounter.flags = { ...(encounter.flags ?? {}), [SOROCABAN_KEY]: 1 };
  }),
});

export const sorocabanBlade: CardScript = {
  ice: { subroutines: [sorocabanSub('resources', 'resource'), sorocabanSub('hardware', 'piece of hardware'), sorocabanSub('programs', 'program')] },
  ...sorocabanFlow.script,
};

// Boto (Barrier - AP): Threat 4 -> This ice gets +2 strength. Subroutines: Do 2 net damage. You may
// trash 1 card from HQ to end the run (twice).
const botoEtr: Subroutine = {
  label: 'You may trash 1 card from HQ to end the run.',
  resolve: ctx => {
    if (ctx.state.corp.hq.length > 0) botoFlow.ask(ctx, 'etr', cardsQuestion('corp', 'Boto: you may trash 1 card from HQ to end the run.', ids(ctx.state.corp.hq), 0, 1));
  },
};

const botoFlow = prompts({
  etr: cards(({ state }, a) => {
    if (corpTrashFromHQ(state, a.ids).length > 0) endTheRun(state);
  }),
});

export const boto: CardScript = {
  ice: { strengthModifier: state => (threatLevel(state) >= 4 ? 2 : 0), subroutines: [netDamageSub(2), botoEtr, botoEtr] },
  ...botoFlow.script,
};

// Cloud Eater (Sentry - AP - Destroyer - Observer): Whenever an encounter with this ice ends, if it
// was rezzed this turn, trash 1 installed Runner card unless the Runner takes 2 tags or suffers 3
// net damage. Subroutines: Trash 1 installed Runner card. Give the Runner 2 tags. Do 3 net damage.
const cloudEaterKey = (card: CardInstance) => `rezzed:${card.instanceId}`;

const cloudEaterFlow = prompts({
  ends: choice((ctx, a) => {
    const { state } = ctx;
    if (a.optionId === 'tags') giveTags(state, 2);
    else if (a.optionId === 'net') dealNetDamage(state, 3);
    else cloudEaterFlow.ask(ctx, 'trash', cardsQuestion('corp', 'Cloud Eater: trash 1 installed Runner card.', ids(installedRunnerCards(state)), 1, 1));
  }),
  trash: cards(({ state }, a) => {
    const target = installedRunnerCards(state).find(c => c.instanceId === a.ids[0]);
    if (target) {
      trashInstalledRunnerCard(state, target);
      addLog(state, 'corp', `Cloud Eater trashed ${title(target)}.`);
    }
  }),
});

export const cloudEater: CardScript = {
  triggers: { rezzed: (ctx, e) => isSelf(ctx, e.card) && void (ctx.state.turnFlags[cloudEaterKey(ctx.card)] = 1) },
  ice: {
    onEncounterEnds: ctx => {
      const { state } = ctx;
      if (turnFlag(state, cloudEaterKey(ctx.card)) === 0 || installedRunnerCards(state).length === 0) return;
      cloudEaterFlow.ask(
        ctx,
        'ends',
        choiceQuestion('runner', 'Cloud Eater: take 2 tags or suffer 3 net damage, or the Corp trashes 1 of your installed cards.', [
          { id: 'tags', label: 'Take 2 tags' },
          { id: 'net', label: 'Suffer 3 net damage' },
          { id: 'trash', label: 'The Corp trashes 1 installed card' },
        ]),
      );
    },
    subroutines: [
      {
        label: 'Trash 1 installed Runner card.',
        resolve: ctx => {
          const cards = installedRunnerCards(ctx.state);
          if (cards.length > 0) cloudEaterFlow.ask(ctx, 'trash', cardsQuestion('corp', 'Cloud Eater: trash 1 installed Runner card.', ids(cards), 1, 1));
        },
      },
      tagSub(2),
      netDamageSub(3),
    ],
  },
  ...cloudEaterFlow.script,
};

// Tributary (Code Gate): The first time each turn a run begins, you may move this ice to the
// outermost position protecting the attacked server. Subroutines: You may draw 1 card. You may
// install 1 piece of ice from HQ protecting another server, ignoring all costs. / Each piece of ice
// gets +2 strength for the remainder of this run.
const tributaryFlow = prompts({
  move: choice(({ state, card }, a) => {
    if (a.optionId !== 'yes') return;
    const run = state.activeRun;
    const from = serverOf(state, card);
    const to = run && state.corp.servers[run.server];
    if (!from || !to) return;
    removeCard(from.ice, card);
    to.ice.push(card);
    addLog(state, 'corp', `Tributary moved to the outermost position protecting ${to.name}.`);
  }),
  draw: choice((ctx, a) => {
    if (a.optionId === 'yes') drawForEffect(ctx.state, 'corp', 1, 'Tributary');
    tributaryInstall(ctx);
  }),
  pick: cards((ctx, a) => {
    const { state } = ctx;
    const id = a.ids[0];
    const ice = id && state.corp.hq.find(c => c.instanceId === id);
    const here = state.activeRun?.server;
    if (!ice) return;
    const options = corpInstallOptions(state, ice, { ignoreCosts: true }).filter(o => o.id !== here && o.id !== 'new');
    tributaryFlow.askIf(ctx, 'server', installAmongQuestion(state, id, options), { cardId: id, install: true });
  }),
  server: choice<InstallData>((ctx, a, _d, source) => void installCorpChoice(ctx.state, source, a.raw, { ignoreCosts: true })),
});

export const tributary: CardScript = {
  triggers: {
    run_begins: (ctx, e) => {
      if (!useOncePerTurn(ctx.state, `run-begins:${ctx.card.instanceId}`)) return;
      const server = ctx.state.corp.servers[e.server];
      if (!server || server.ice[server.ice.length - 1]?.instanceId === ctx.card.instanceId) return;
      tributaryFlow.ask(ctx, 'move', choiceQuestion('corp', 'Tributary: move it to the outermost position protecting the attacked server?', yesNo('Move it')));
    },
  },
  ice: {
    subroutines: [
      {
        label: 'You may draw 1 card. You may install 1 piece of ice from HQ protecting another server, ignoring all costs.',
        resolve: ctx => {
          if (ctx.state.corp.rd.length > 0) tributaryFlow.ask(ctx, 'draw', choiceQuestion('corp', 'Tributary: draw 1 card?', yesNo('Draw 1 card')));
          else tributaryInstall(ctx);
        },
      },
      {
        label: 'Each piece of ice gets +2 strength for the remainder of this run.',
        resolve: ({ state }) => {
          if (state.activeRun) state.activeRun.iceStrengthBonus = (state.activeRun.iceStrengthBonus ?? 0) + 2;
        },
      },
    ],
  },
  ...tributaryFlow.script,
};

function tributaryInstall(ctx: EffectContext): void {
  const here = ctx.state.activeRun?.server;
  const ice = ctx.state.corp.hq.filter(c => type(c) === 'ice');
  if (!Object.keys(ctx.state.corp.servers).some(id => id !== here)) return;
  // Asked even with no ice in HQ when the Corp's stops are on ALL (4.3.2, see askEvenIfNone)
  tributaryFlow.evenIfNone(
    ctx,
    'corp',
    ice.length > 0,
    () => tributaryFlow.ask(ctx, 'pick', cardsQuestion('corp', 'Tributary: you may install 1 piece of ice from HQ protecting another server, ignoring all costs.', ids(ice), 0, 1)),
    'Tributary: no ice in HQ to install.',
  );
}

// Capacitor (Barrier): While the Runner is tagged, this ice gets +2 strength. Subroutines: Gain 1
// credit for each tag the Runner has. End the run.
export const capacitor: CardScript = {
  ice: {
    strengthModifier: state => (state.runner.tags > 0 ? 2 : 0),
    subroutines: [
      {
        label: 'Gain 1 [credit] for each tag the Runner has.',
        resolve: ({ state, card }) => gainFromCard(state, 'corp', state.runner.tags, card),
      },
      endTheRunSub,
    ],
  },
};

// Piranhas (Code Gate - AP - Liability): As an additional cost to rez this ice, take 1 bad
// publicity or remove 1 tag. Subroutines: You may draw 1 card. Do 1 net damage. End the run if
// there are more cards in HQ than in the grip.
const piranhasFlow = prompts({
  rez_cost: liabilityRezStep(),
  draw: choice((ctx, a) => {
    if (a.optionId === 'yes') drawForEffect(ctx.state, 'corp', 1, 'Piranhas');
  }),
});

export const piranhas: CardScript = {
  payRez: (ctx, cost) => piranhasFlow.ask(ctx, 'rez_cost', liabilityQuestion(ctx), { cost }),
  ice: {
    subroutines: [
      {
        label: 'You may draw 1 card.',
        resolve: ctx => {
          if (ctx.state.corp.rd.length > 0) piranhasFlow.ask(ctx, 'draw', choiceQuestion('corp', 'Piranhas: draw 1 card?', yesNo('Draw 1 card')));
        },
      },
      netDamageSub(1),
      {
        label: 'End the run if there are more cards in HQ than in the grip.',
        resolve: ({ state }) => {
          if (state.corp.hq.length > state.runner.grip.length) endTheRun(state);
        },
      },
    ],
  },
  ...piranhasFlow.script,
};

// Seraph (Sentry - AP - Observer - Deep Net): When the Runner encounters this ice, they lose 3
// credits unless they suffer 2 net damage or take 1 tag. Subroutines: The Runner loses 3 credits.
// Do 2 net damage. Give the Runner 1 tag.
const seraphFlow = prompts({
  encounter: choice(({ state }, a) => {
    if (a.optionId === 'net') dealNetDamage(state, 2);
    else if (a.optionId === 'tag') giveTags(state, 1);
    else addLog(state, 'corp', `The Runner lost ${loseCredits(state, 'runner', 3)} [credit] (Seraph).`);
  }),
});

export const seraph: CardScript = {
  ice: {
    onEncounter: ctx =>
      seraphFlow.ask(
        ctx,
        'encounter',
        choiceQuestion('runner', 'Seraph: lose 3 [credit], suffer 2 net damage, or take 1 tag?', [
          { id: 'credits', label: 'Lose 3 [credit]' },
          { id: 'net', label: 'Suffer 2 net damage' },
          { id: 'tag', label: 'Take 1 tag' },
        ]),
      ),
    subroutines: [loseCreditsSub(3), netDamageSub(2), tagSub(1)],
  },
  ...seraphFlow.script,
};

// Descent (Code Gate - Expendable): [click], 1 credit, reveal and trash this ice from HQ: Draw 1
// card. Reveal up to 2 agendas in HQ and/or Archives and shuffle them into R&D. When your turn
// begins, you may add this ice to HQ. Subroutine: End the run.
const descentFlow = prompts({
  return: choice(({ state, card }, a) => {
    if (a.optionId === 'yes' && returnInstalledToHQ(state, card)) addLog(state, 'corp', 'Corp added Descent to HQ.');
  }),
  shuffle: cards(({ state }, a) => {
    if (a.ids.length === 0) return;
    for (const id of a.ids) {
      const agenda = [...state.corp.hq, ...archivesCards(state)].find(c => c.instanceId === id);
      if (!agenda) continue;
      takeFromCorpZone(state, agenda);
      state.corp.rd.push(agenda);
      addLog(state, 'corp', `Corp revealed ${title(agenda)} and shuffled it into R&D (Descent).`, agenda.cardCode);
    }
    shuffleRD(state);
  }),
});

export const descent: CardScript = {
  abilities: [
    {
      label: 'Reveal and trash this ice from HQ: draw 1 card; shuffle up to 2 agendas from HQ and/or Archives into R&D.',
      fromHQ: true,
      clicks: 1,
      credits: 1,
      resolve: ctx => {
        const { state, card } = ctx;
        corpTrashFromHQ(state, [card.instanceId], true);
        addLog(state, 'corp', 'Corp revealed and trashed Descent from HQ.');
        drawForEffect(state, 'corp', 1, 'Descent');
        const agendas = [...state.corp.hq, ...archivesCards(state)].filter(c => type(c) === 'agenda');
        // Asked even with no agenda when the Corp's stops are on ALL (4.3.2, 4.4.6c, see askEvenIfNone)
        descentFlow.evenIfNone(
          ctx,
          'corp',
          agendas.length > 0,
          () => descentFlow.ask(ctx, 'shuffle', cardsQuestion('corp', 'Descent: reveal up to 2 agendas in HQ and/or Archives to shuffle into R&D.', ids(agendas), 0, 2)),
          'Descent: no agenda in HQ or Archives.',
        );
      },
    },
  ],
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side === 'corp' && serverOf(ctx.state, ctx.card)) descentFlow.ask(ctx, 'return', choiceQuestion('corp', 'Descent: add it to HQ?', yesNo('Add Descent to HQ')));
    },
  },
  ice: { subroutines: [endTheRunSub] },
  ...descentFlow.script,
};

// Hammer (Sentry - Destroyer - Observer): During each encounter with this ice, the Runner cannot
// break more than 1 of its printed subroutines except using killers. Subroutines: Give the Runner 1
// tag. Trash 1 installed resource or piece of hardware. Trash 1 installed program that is not a
// decoder, fracter, or killer.
const isKiller = (state: GameState, id: string | undefined) => {
  const breaker = id && state.runner.rig.programs.find(p => p.instanceId === id);
  return !!breaker && hasKeyword(breaker, 'killer');
};

const hammerTrash = (kinds: ('resources' | 'hardware' | 'programs')[], label: string, filter: (c: CardInstance) => boolean = () => true): Subroutine => ({
  label,
  resolve: ctx => {
    const cards = kinds.flatMap(k => ctx.state.runner.rig[k]).filter(filter);
    if (cards.length > 0) hammerFlow.ask(ctx, 'trash', cardsQuestion('corp', `Hammer: ${label[0].toLowerCase()}${label.slice(1)}`, ids(cards), 1, 1));
  },
});

const hammerFlow = prompts({
  trash: cards(({ state }, a) => {
    const target = installedRunnerCards(state).find(c => c.instanceId === a.ids[0]);
    if (!target) return;
    trashInstalledRunnerCard(state, target);
    addLog(state, 'corp', `Hammer trashed ${title(target)}.`);
  }),
});

export const hammer: CardScript = {
  ice: {
    breakRestriction: (state, ice, breaker, indices) => {
      const encounter = state.activeRun?.encounter;
      if (!encounter || (breaker && hasKeyword(breaker, 'killer'))) return null;
      const first = grantedBefore(state, ice);
      const printed = (i: number) => i >= first && i < first + 3;
      const already = Object.entries(encounter.brokenBy ?? {}).filter(([i, by]) => printed(Number(i)) && !isKiller(state, by)).length;
      return already + indices.filter(printed).length > 1 ? 'Only 1 of Hammer\'s printed subroutines can be broken except with killers' : null;
    },
    subroutines: [
      tagSub(1),
      hammerTrash(['resources', 'hardware'], 'Trash 1 installed resource or piece of hardware.'),
      hammerTrash(['programs'], 'Trash 1 installed program that is not a decoder, fracter, or killer.', c => !/\b(decoder|fracter|killer)\b/i.test(keywords(c))),
    ],
  },
  ...hammerFlow.script,
};

// Logjam (Barrier): You can advance this ice. It gets +1 strength for each hosted advancement
// counter. When you rez this ice, place 1 advancement counter on it plus 1 advancement counter for
// each card type among faceup cards in Archives. Subroutines: Gain 2 credits. End the run. / End
// the run. / End the run.
export const logjam: CardScript = {
  liveValue: state => `${1 + faceUpTypes(state).size} advancement counters when rezzed`,
  triggers: {
    rezzed: (ctx, e) => {
      if (!isSelf(ctx, e.card)) return;
      const n = 1 + faceUpTypes(ctx.state).size;
      ctx.card.advancementCounters += n;
      addLog(ctx.state, 'corp', `Logjam: ${n} advancement counter(s) placed on it.`);
    },
  },
  ice: {
    strengthModifier: (_state, ice) => ice.advancementCounters,
    subroutines: [
      {
        label: 'Gain 2 [credit]. End the run.',
        resolve: ({ state, card }) => {
          gainFromCard(state, 'corp', 2, card);
          endTheRun(state);
        },
      },
      endTheRunSub,
      endTheRunSub,
    ],
  },
};

export const liberationCorpIceScripts: Record<string, CardScript> = {
  '34034': ablativeBarrier,
  '34035': jaguarundi,
  '34036': mic,
  '34042': attini,
  '34043': phoneutria,
  '34044': tatuBola,
  '34053': starlitKnight,
  '34054': virtualServiceAgent,
  '34059': treeLine,
  '34060': valentao,
  '34100': lycian,
  '34101': sorocabanBlade,
  '34109': boto,
  '34110': cloudEater,
  '34111': tributary,
  '34116': capacitor,
  '34117': piranhas,
  '34118': seraph,
  '34125': descent,
  '34126': hammer,
  '34127': logjam,
};
