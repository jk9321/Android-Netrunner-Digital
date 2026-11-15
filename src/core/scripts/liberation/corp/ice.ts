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
import { cards, choice, prompts } from '../../steps';
import { CardScript, EffectAnswer, EffectContext, Subroutine } from '../../types';
import { askCards, askChoice, askEvenIfNone, corpInstallOptions, installCorpChoice } from '../../effects';
import { archivesCards, askInstallAmong, askPlaceAdvancement, faceUpTypes, hasKeyword, ids, installable, isSelf, keywords, lycianIs, picked, placeAdvancement, returnInstalledToHQ, runOnServerOf, said, serverOf, takeFromCorpZone, title, type, yesNo } from './helpers';

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

/** A subroutine "X unless the Runner pays N credits" (they choose if they can pay). */
function unlessPays(ctx: EffectContext, amount: number, what: string, step: string, otherwise: () => void, canPay = true): void {
  if (!canPay || availableCredits(ctx.state, 'runner') < amount) {
    otherwise();
    return;
  }
  askChoice(ctx, 'runner', `${title(ctx.card)}: pay ${amount} [credit], or ${what}?`, [
    { id: 'pay', label: `Pay ${amount} [credit]` },
    { id: 'no', label: what[0].toUpperCase() + what.slice(1) },
  ], step);
}

/**
 * "As an additional cost to rez this ice, take 1 bad publicity or remove 1
 * tag" (liability ice: Valentão, Piranhas).
 */
const liabilityRez: Pick<CardScript, 'payRez'> & { answer: (ctx: EffectContext, answer: EffectAnswer, cost: number) => void } = {
  payRez: (ctx, cost) => {
    const options = [{ id: 'bp', label: 'Take 1 bad publicity' }, ...(ctx.state.runner.tags > 0 ? [{ id: 'tag', label: 'Remove 1 tag' }] : [])];
    askChoice(ctx, 'corp', `${title(ctx.card)}: take 1 bad publicity or remove 1 tag to rez it.`, options, 'rez_cost', { cost });
  },
  answer: (ctx, answer, cost) => {
    const { state, card } = ctx;
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'tag' && state.runner.tags > 0) removeTags(state, 1);
    else takeBadPublicity(state, 1);
    spendCredits(state, 'corp', cost, { kind: 'rez', card });
    addLog(state, 'corp', `Corp spent ${cost} [credit] to rez ${title(card)}.`, undefined, 'rez');
    completeRez(state, card);
  },
};

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
    askInstallAmong(ctx, id, 'server', corpInstallOptions(state, card).filter(o => o.id !== here));
  }),
  server: choice<{ cardId: string; install: true }>((ctx, a, _d, source) => void installCorpChoice(ctx.state, source, a.raw)),
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
          ablativeFlow.cards(ctx, 'pick', {
            side: 'corp',
            message: 'Ablative Barrier: you may install 1 non-agenda card from HQ or Archives in or protecting another server.',
            candidateIds: ids(cards),
            min: 0,
            max: 1,
          }),
        'Ablative Barrier: no non-agenda card in HQ or Archives you can install.',
      );
    },
  },
  ...ablativeFlow.script,
};

// Jaguarundi (Sentry - AP): Threat 4 -> When the Runner encounters this ice, give them 1 tag
// unless they spend [click]. Subroutines: Give the Runner 1 tag. If the Runner is tagged, do 1 core damage.
export const jaguarundi: CardScript = {
  ice: {
    onEncounter: ctx => {
      const { state } = ctx;
      if (threatLevel(state) < 4) return;
      if (state.runner.clicks === 0) return giveTags(state, 1);
      askChoice(ctx, 'runner', 'Jaguarundi: spend [click], or take 1 tag?', [
        { id: 'click', label: 'Spend [click]' },
        { id: 'tag', label: 'Take 1 tag' },
      ], 'encounter');
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
  onPromptAnswer: ({ state }, _source, answer) => {
    if (said(answer, 'click') && state.runner.clicks > 0) {
      state.runner.clicks -= 1;
      addLog(state, 'runner', 'Runner spent [click] (Jaguarundi).');
    } else giveTags(state, 1);
  },
};

// M.I.C. (Code Gate): [trash]: End the run unless the Runner spends [click]. Use this ability
// only during a run on this server. Subroutines: The Runner loses [click] (twice). End the run.
export const mic: CardScript = {
  abilities: [
    {
      label: 'End the run unless the Runner spends [click].',
      trashSelf: true,
      canUse: ({ state, card }) => (runOnServerOf(state, card) ? null : 'Use this only during a run on this server'),
      resolve: ctx => {
        if (ctx.state.runner.clicks === 0) return endTheRun(ctx.state);
        askChoice(ctx, 'runner', 'M.I.C.: spend [click], or the run ends?', [
          { id: 'click', label: 'Spend [click]' },
          { id: 'end', label: 'End the run' },
        ], 'trash');
      },
    },
  ],
  ice: { subroutines: [loseClickSub, loseClickSub, endTheRunSub] },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (said(answer, 'click') && state.runner.clicks > 0) {
      state.runner.clicks -= 1;
      addLog(state, 'runner', 'Runner spent [click] (M.I.C.).');
    } else endTheRun(state);
  },
};

// Attini (Code Gate - AP): Threat 3 -> The Runner cannot spend credits while subroutines on this
// ice are resolving. Subroutines (3): Do 1 net damage unless the Runner pays 2 credits.
const attiniSub: Subroutine = {
  label: 'Do 1 net damage unless the Runner pays 2 [credit].',
  resolve: ctx => unlessPays(ctx, 2, 'take 1 net damage', 'pay', () => void dealNetDamage(ctx.state, 1), threatLevel(ctx.state) < 3),
};

export const attini: CardScript = {
  ice: { subroutines: [attiniSub, attiniSub, attiniSub] },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (said(answer, 'pay') && availableCredits(state, 'runner') >= 2) spendCredits(state, 'runner', 2);
    else dealNetDamage(state, 1);
  },
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
export const tatuBola: CardScript = {
  ice: {
    onPass: ctx => {
      const ice = ctx.state.corp.hq.filter(c => type(c) === 'ice');
      // Asked even with no ice in HQ when the Corp's stops are on ALL (4.3.2, see askEvenIfNone)
      askEvenIfNone(ctx, 'corp', ice.length > 0, () => askCards(ctx, 'corp', 'Tatu-Bola: you may swap it with a piece of ice from HQ and gain 4 [credit].', ids(ice), 0, 1, 'swap'), 'Tatu-Bola: no ice in HQ to swap in.');
    },
    subroutines: [endTheRunSub],
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    const incoming = state.corp.hq.find(c => c.instanceId === picked(answer)[0]);
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
  },
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
        askPlaceAdvancement(ctx, 3, 'place', false, installedIce(ctx.state));
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
  onPromptAnswer: ({ state }, _source, answer) => placeAdvancement(state, picked(answer)[0], 3, 'Tree Line'),
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

export const valentao: CardScript = {
  payRez: liabilityRez.payRez,
  ice: { subroutines: [gainSub(2), loseCreditsSub(2), ifRicherEtr] },
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'rez_cost') liabilityRez.answer(ctx, answer, Number(source.data?.cost ?? 0));
  },
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

export const lycian: CardScript = {
  triggers: {
    rezzed: (ctx, e) => {
      if (!isSelf(ctx, e.card)) return;
      askChoice(ctx, 'corp', 'Lycian Multi-Munition: choose the subtypes it gains while rezzed.', LYCIAN_CHOICES.map(([id, list]) => ({ id, label: list.join(', ') })), 'subtypes');
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
          if (lycianIs(ctx.state, ctx.card, 'sentry') && programs.length > 0) askCards(ctx, 'corp', 'Lycian Multi-Munition: trash 1 installed program.', ids(programs), 1, 1, 'trash');
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
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (source.step === 'subtypes' && answer.kind === 'effect_choice') {
      card.chosenSubtypes = LYCIAN_CHOICES.find(([id]) => id === answer.optionId)?.[1] ?? ['barrier'];
      addLog(state, 'corp', `Lycian Multi-Munition is now a ${card.chosenSubtypes.join(' and ')}.`);
    } else if (source.step === 'trash') {
      const program = state.runner.rig.programs.find(c => c.instanceId === picked(answer)[0]);
      if (program) {
        trashInstalledRunnerCard(state, program);
        addLog(state, 'corp', `Lycian Multi-Munition trashed ${title(program)}.`);
      }
    }
  },
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
    if (cards.length > 0) askCards(ctx, 'corp', `Sorocaban Blade: trash 1 installed ${label}.`, ids(cards), 1, 1, 'trash');
  },
});

export const sorocabanBlade: CardScript = {
  ice: { subroutines: [sorocabanSub('resources', 'resource'), sorocabanSub('hardware', 'piece of hardware'), sorocabanSub('programs', 'program')] },
  onPromptAnswer: ({ state }, _source, answer) => {
    const target = installedRunnerCards(state).find(c => c.instanceId === picked(answer)[0]);
    if (!target) return;
    trashInstalledRunnerCard(state, target);
    addLog(state, 'corp', `Sorocaban Blade trashed ${title(target)}.`);
    const encounter = state.activeRun?.encounter;
    if (encounter) encounter.flags = { ...(encounter.flags ?? {}), [SOROCABAN_KEY]: 1 };
  },
};

// Boto (Barrier - AP): Threat 4 -> This ice gets +2 strength. Subroutines: Do 2 net damage. You may
// trash 1 card from HQ to end the run (twice).
const botoEtr: Subroutine = {
  label: 'You may trash 1 card from HQ to end the run.',
  resolve: ctx => {
    if (ctx.state.corp.hq.length > 0) askCards(ctx, 'corp', 'Boto: you may trash 1 card from HQ to end the run.', ids(ctx.state.corp.hq), 0, 1, 'etr');
  },
};

export const boto: CardScript = {
  ice: { strengthModifier: state => (threatLevel(state) >= 4 ? 2 : 0), subroutines: [netDamageSub(2), botoEtr, botoEtr] },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (corpTrashFromHQ(state, picked(answer)).length > 0) endTheRun(state);
  },
};

// Cloud Eater (Sentry - AP - Destroyer - Observer): Whenever an encounter with this ice ends, if it
// was rezzed this turn, trash 1 installed Runner card unless the Runner takes 2 tags or suffers 3
// net damage. Subroutines: Trash 1 installed Runner card. Give the Runner 2 tags. Do 3 net damage.
const cloudEaterKey = (card: CardInstance) => `rezzed:${card.instanceId}`;

export const cloudEater: CardScript = {
  triggers: { rezzed: (ctx, e) => isSelf(ctx, e.card) && void (ctx.state.turnFlags[cloudEaterKey(ctx.card)] = 1) },
  ice: {
    onEncounterEnds: ctx => {
      const { state } = ctx;
      if (turnFlag(state, cloudEaterKey(ctx.card)) === 0 || installedRunnerCards(state).length === 0) return;
      askChoice(ctx, 'runner', 'Cloud Eater: take 2 tags or suffer 3 net damage, or the Corp trashes 1 of your installed cards.', [
        { id: 'tags', label: 'Take 2 tags' },
        { id: 'net', label: 'Suffer 3 net damage' },
        { id: 'trash', label: 'The Corp trashes 1 installed card' },
      ], 'ends');
    },
    subroutines: [
      {
        label: 'Trash 1 installed Runner card.',
        resolve: ctx => {
          const cards = installedRunnerCards(ctx.state);
          if (cards.length > 0) askCards(ctx, 'corp', 'Cloud Eater: trash 1 installed Runner card.', ids(cards), 1, 1, 'trash');
        },
      },
      tagSub(2),
      netDamageSub(3),
    ],
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'ends' && answer.kind === 'effect_choice') {
      if (answer.optionId === 'tags') giveTags(state, 2);
      else if (answer.optionId === 'net') dealNetDamage(state, 3);
      else askCards(ctx, 'corp', 'Cloud Eater: trash 1 installed Runner card.', ids(installedRunnerCards(state)), 1, 1, 'trash');
    } else if (source.step === 'trash') {
      const target = installedRunnerCards(state).find(c => c.instanceId === picked(answer)[0]);
      if (target) {
        trashInstalledRunnerCard(state, target);
        addLog(state, 'corp', `Cloud Eater trashed ${title(target)}.`);
      }
    }
  },
};

// Tributary (Code Gate): The first time each turn a run begins, you may move this ice to the
// outermost position protecting the attacked server. Subroutines: You may draw 1 card. You may
// install 1 piece of ice from HQ protecting another server, ignoring all costs. / Each piece of ice
// gets +2 strength for the remainder of this run.
export const tributary: CardScript = {
  triggers: {
    run_begins: (ctx, e) => {
      if (!useOncePerTurn(ctx.state, `run-begins:${ctx.card.instanceId}`)) return;
      const server = ctx.state.corp.servers[e.server];
      if (!server || server.ice[server.ice.length - 1]?.instanceId === ctx.card.instanceId) return;
      askChoice(ctx, 'corp', 'Tributary: move it to the outermost position protecting the attacked server?', yesNo('Move it'), 'move');
    },
  },
  ice: {
    subroutines: [
      {
        label: 'You may draw 1 card. You may install 1 piece of ice from HQ protecting another server, ignoring all costs.',
        resolve: ctx => {
          if (ctx.state.corp.rd.length > 0) askChoice(ctx, 'corp', 'Tributary: draw 1 card?', yesNo('Draw 1 card'), 'draw');
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
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    if (source.step === 'move' && said(answer)) {
      const run = state.activeRun;
      const from = serverOf(state, card);
      const to = run && state.corp.servers[run.server];
      if (!from || !to) return;
      removeCard(from.ice, card);
      to.ice.push(card);
      addLog(state, 'corp', `Tributary moved to the outermost position protecting ${to.name}.`);
    } else if (source.step === 'draw') {
      if (said(answer)) drawForEffect(state, 'corp', 1, 'Tributary');
      tributaryInstall(ctx);
    } else if (source.step === 'pick') {
      const id = picked(answer)[0];
      const ice = id && state.corp.hq.find(c => c.instanceId === id);
      const here = state.activeRun?.server;
      if (ice) askInstallAmong(ctx, id, 'server', corpInstallOptions(state, ice, { ignoreCosts: true }).filter(o => o.id !== here && o.id !== 'new'));
    } else if (source.step === 'server') {
      installCorpChoice(state, source, answer, { ignoreCosts: true });
    }
  },
};

function tributaryInstall(ctx: EffectContext): void {
  const here = ctx.state.activeRun?.server;
  const ice = ctx.state.corp.hq.filter(c => type(c) === 'ice');
  if (!Object.keys(ctx.state.corp.servers).some(id => id !== here)) return;
  // Asked even with no ice in HQ when the Corp's stops are on ALL (4.3.2, see askEvenIfNone)
  askEvenIfNone(
    ctx,
    'corp',
    ice.length > 0,
    () => askCards(ctx, 'corp', 'Tributary: you may install 1 piece of ice from HQ protecting another server, ignoring all costs.', ids(ice), 0, 1, 'pick'),
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
export const piranhas: CardScript = {
  payRez: liabilityRez.payRez,
  ice: {
    subroutines: [
      {
        label: 'You may draw 1 card.',
        resolve: ctx => {
          if (ctx.state.corp.rd.length > 0) askChoice(ctx, 'corp', 'Piranhas: draw 1 card?', yesNo('Draw 1 card'), 'draw');
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
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'rez_cost') liabilityRez.answer(ctx, answer, Number(source.data?.cost ?? 0));
    else if (source.step === 'draw' && said(answer)) drawForEffect(ctx.state, 'corp', 1, 'Piranhas');
  },
};

// Seraph (Sentry - AP - Observer - Deep Net): When the Runner encounters this ice, they lose 3
// credits unless they suffer 2 net damage or take 1 tag. Subroutines: The Runner loses 3 credits.
// Do 2 net damage. Give the Runner 1 tag.
export const seraph: CardScript = {
  ice: {
    onEncounter: ctx =>
      askChoice(ctx, 'runner', 'Seraph: lose 3 [credit], suffer 2 net damage, or take 1 tag?', [
        { id: 'credits', label: 'Lose 3 [credit]' },
        { id: 'net', label: 'Suffer 2 net damage' },
        { id: 'tag', label: 'Take 1 tag' },
      ], 'encounter'),
    subroutines: [loseCreditsSub(3), netDamageSub(2), tagSub(1)],
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'net') dealNetDamage(state, 2);
    else if (answer.optionId === 'tag') giveTags(state, 1);
    else addLog(state, 'corp', `The Runner lost ${loseCredits(state, 'runner', 3)} [credit] (Seraph).`);
  },
};

// Descent (Code Gate - Expendable): [click], 1 credit, reveal and trash this ice from HQ: Draw 1
// card. Reveal up to 2 agendas in HQ and/or Archives and shuffle them into R&D. When your turn
// begins, you may add this ice to HQ. Subroutine: End the run.
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
        askEvenIfNone(
          ctx,
          'corp',
          agendas.length > 0,
          () => askCards(ctx, 'corp', 'Descent: reveal up to 2 agendas in HQ and/or Archives to shuffle into R&D.', ids(agendas), 0, 2, 'shuffle'),
          'Descent: no agenda in HQ or Archives.',
        );
      },
    },
  ],
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side === 'corp' && serverOf(ctx.state, ctx.card)) askChoice(ctx, 'corp', 'Descent: add it to HQ?', yesNo('Add Descent to HQ'), 'return');
    },
  },
  ice: { subroutines: [endTheRunSub] },
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (source.step === 'return' && said(answer)) {
      if (returnInstalledToHQ(state, card)) addLog(state, 'corp', 'Corp added Descent to HQ.');
    } else if (source.step === 'shuffle' && picked(answer).length > 0) {
      for (const id of picked(answer)) {
        const agenda = [...state.corp.hq, ...archivesCards(state)].find(c => c.instanceId === id);
        if (!agenda) continue;
        takeFromCorpZone(state, agenda);
        state.corp.rd.push(agenda);
        addLog(state, 'corp', `Corp revealed ${title(agenda)} and shuffled it into R&D (Descent).`, agenda.cardCode);
      }
      shuffleRD(state);
    }
  },
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
    if (cards.length > 0) askCards(ctx, 'corp', `Hammer: ${label[0].toLowerCase()}${label.slice(1)}`, ids(cards), 1, 1, 'trash');
  },
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
  onPromptAnswer: ({ state }, _source, answer) => {
    const target = installedRunnerCards(state).find(c => c.instanceId === picked(answer)[0]);
    if (!target) return;
    trashInstalledRunnerCard(state, target);
    addLog(state, 'corp', `Hammer trashed ${title(target)}.`);
  },
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
