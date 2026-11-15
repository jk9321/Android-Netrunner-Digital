import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { addLog } from '../../../engine/log';
import { removeCard } from '../../../engine/helpers';
import { completeRez } from '../../../engine/actions/corp';
import { dealNetDamage, dealCoreDamage, giveTags, trashInstalledRunnerCard } from '../../../engine/damage';
import { endTheRun } from '../../../engine/runEnd';
import {
  availableCredits,
  drawForEffect,
  forfeitable,
  forfeitAgenda,
  installedIce,
  purgeVirusCounters,
  rezCost,
  spendCredits,
  threatLevel,
  trashInstalledCard,
} from '../../../engine/cardEffects';
import { CardScript, EffectContext, Subroutine } from '../../types';
import { getCardScript } from '../../index';
import { advanceableInstalled, askCards, askEvenIfNone, askChoice, askCorpInstall, installCorpChoice } from '../../effects';
import { archivesCards, ids, installable, keywords, serverOf, type } from './helpers';

const endTheRunSub: Subroutine = { label: 'End the run.', resolve: ({ state }) => endTheRun(state) };

const netDamageSub = (amount: number): Subroutine => ({ label: `Do ${amount} net damage.`, resolve: ({ state }) => void dealNetDamage(state, amount) });

/** "Trash 1 installed program" (the Corp chooses). */
const trashProgramSub = (label = 'Trash 1 installed program.'): Subroutine => ({
  label,
  resolve: ctx => {
    const programs = ctx.state.runner.rig.programs;
    if (programs.length === 0) return;
    askCards(ctx, 'corp', `${cardDef(ctx.card).title}: trash 1 installed program.`, ids(programs), 1, 1, 'trash_program');
  },
});

/** onPromptAnswer for trashProgramSub. */
const trashProgramAnswer = (state: GameState, answer: Parameters<NonNullable<CardScript['onPromptAnswer']>>[2]) => {
  if (answer.kind !== 'effect_cards') return;
  const program = state.runner.rig.programs.find(p => p.instanceId === answer.cardInstanceIds[0]);
  if (program) {
    trashInstalledRunnerCard(state, program);
    addLog(state, 'corp', `Corp trashed ${cardDef(program).title}.`);
  }
};

// Bumi 1.0 (Sentry - Bioroid - AP - Destroyer): When you rez this ice during a run against
// this server, you may trash 1 installed trojan program. Lose click: Break 1 subroutine.
// Subroutine: Trash 1 installed program. Subroutine: Do 1 core damage.
const trojans = (state: GameState) => state.runner.rig.programs.filter(p => /trojan/i.test(keywords(p)));

export const bumi: CardScript = {
  ice: {
    subroutines: [trashProgramSub(), { label: 'Do 1 core damage.', resolve: ({ state }) => void dealCoreDamage(state, 1) }],
    onRezDuringRunOnServer: ctx => {
      const targets = trojans(ctx.state);
      if (targets.length > 0) askCards(ctx, 'corp', 'Bumi 1.0: you may trash 1 installed trojan.', ids(targets), 0, 1, 'trash_program');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => trashProgramAnswer(state, answer),
};

// Scatter Field (Code Gate): While this ice is the only piece of ice protecting this server,
// it gets +4 strength. Subroutine: You may install 1 card from HQ. Subroutine: End the run.
export const scatterField: CardScript = {
  ice: {
    strengthModifier: (state, ice) => (serverOf(state, ice)?.ice.length === 1 ? 4 : 0),
    subroutines: [
      {
        label: 'You may install 1 card from HQ.',
        resolve: ctx => {
          const cards = installable(ctx.state, ctx.state.corp.hq);
          if (cards.length > 0) askCards(ctx, 'corp', 'Scatter Field: you may install 1 card from HQ.', ids(cards), 0, 1, 'pick');
        },
      },
      endTheRunSub,
    ],
  },
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'pick' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) askCorpInstall(ctx, answer.cardInstanceIds[0], 'server');
    else if (source.step === 'server') installCorpChoice(ctx.state, source, answer);
  },
};

// Empiricist (Sentry - AP - Observer): Subroutine: Draw 1 card. You may add 1 card from HQ
// to the top of R&D. Subroutine: Do 1 net damage. Give the Runner 1 tag. Subroutine: Do 2 net damage.
export const empiricist: CardScript = {
  ice: {
    subroutines: [
      {
        label: 'Draw 1 card. You may add 1 card from HQ to the top of R&D.',
        resolve: ctx => {
          drawForEffect(ctx.state, 'corp', 1, 'Empiricist');
          if (ctx.state.winner || ctx.state.corp.hq.length === 0) return;
          askCards(ctx, 'corp', 'Empiricist: you may add 1 card from HQ to the top of R&D.', ids(ctx.state.corp.hq), 0, 1, 'top');
        },
      },
      {
        label: 'Do 1 net damage. Give the Runner 1 tag.',
        resolve: ({ state }) => {
          dealNetDamage(state, 1);
          if (!state.winner) giveTags(state, 1);
        },
      },
      netDamageSub(2),
    ],
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards' || answer.cardInstanceIds.length === 0) return;
    const card = state.corp.hq.find(c => c.instanceId === answer.cardInstanceIds[0]);
    if (!card) return;
    removeCard(state.corp.hq, card);
    state.corp.rd.unshift(card);
    addLog(state, 'corp', 'Corp added 1 card from HQ to the top of R&D (Empiricist).');
  },
};

// Mycoweb (Code Gate): Subroutine: You may install 1 piece of ice from Archives, ignoring all
// costs. Subroutine: You may rez 1 installed piece of ice, paying 2 credits less.
// Subroutine: Resolve 1 subroutine on a rezzed sentry. Subroutine: Resolve 1 subroutine on another rezzed code gate.
const archivesIce = (state: GameState) => installable(state, archivesCards(state).filter(c => type(c) === 'ice'), { ignoreCosts: true });

const mycowebRezTargets = (state: GameState) =>
  installedIce(state).filter(c => !c.isRezzed && state.corp.credits >= Math.max(0, rezCost(state, c) - 2) && !hasRezHooks(c));

const hasRezHooks = (card: CardInstance) => !!(getScript(card)?.rezBlocker || getScript(card)?.payRez);

const rezzedOfSubtype = (state: GameState, subtype: string, except?: CardInstance) =>
  installedIce(state).filter(c => c.isRezzed && c !== except && new RegExp(subtype, 'i').test(keywords(c)) && (getScript(c)?.ice?.subroutines.length ?? 0) > 0);

export const mycoweb: CardScript = {
  ice: {
    subroutines: [
      {
        label: 'You may install 1 piece of ice from Archives, ignoring all costs.',
        resolve: ctx => {
          const ice = archivesIce(ctx.state);
          // Facedown Archives cards are hidden from the Runner (4.4.6c): asked even with no ice when the Corp's stops are on ALL
          askEvenIfNone(ctx, 'corp', ice.length > 0, () => askCards(ctx, 'corp', 'Mycoweb: you may install 1 ice from Archives, ignoring all costs.', ids(ice), 0, 1, 'install'), 'Mycoweb: no ice in Archives to install.');
        },
      },
      {
        label: 'You may rez 1 installed piece of ice, paying 2 credits less.',
        resolve: ctx => {
          const ice = mycowebRezTargets(ctx.state);
          // Whether an unrezzed ice is affordable says what it is (4.6.3): asked even with none when the Corp's stops are on ALL
          askEvenIfNone(ctx, 'corp', ice.length > 0, () => askCards(ctx, 'corp', 'Mycoweb: you may rez 1 installed ice, paying 2 credits less.', ids(ice), 0, 1, 'rez'), 'Mycoweb: no installed ice you can rez.');
        },
      },
      {
        label: 'Resolve 1 subroutine on a rezzed sentry.',
        resolve: ctx => {
          const ice = rezzedOfSubtype(ctx.state, 'sentry');
          if (ice.length > 0) askCards(ctx, 'corp', 'Mycoweb: choose a rezzed sentry.', ids(ice), 1, 1, 'borrow_ice');
        },
      },
      {
        label: 'Resolve 1 subroutine on another rezzed code gate.',
        resolve: ctx => {
          const ice = rezzedOfSubtype(ctx.state, 'code gate', ctx.card);
          if (ice.length > 0) askCards(ctx, 'corp', 'Mycoweb: choose another rezzed code gate.', ids(ice), 1, 1, 'borrow_ice');
        },
      },
    ],
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'install' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      askCorpInstall(ctx, answer.cardInstanceIds[0], 'server', { ignoreCosts: true });
    } else if (source.step === 'server') {
      installCorpChoice(state, source, answer, { ignoreCosts: true });
    } else if (source.step === 'rez' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      const ice = installedIce(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!ice) return;
      const cost = Math.max(0, rezCost(state, ice) - 2);
      spendCredits(state, 'corp', cost, { kind: 'rez', card: ice });
      addLog(state, 'corp', `Corp spent ${cost} [credit] to rez ${cardDef(ice).title} (Mycoweb).`, undefined, 'rez');
      completeRez(state, ice);
    } else if (source.step === 'borrow_ice' && answer.kind === 'effect_cards') {
      const ice = installedIce(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      const subs = ice ? getScript(ice)?.ice?.subroutines ?? [] : [];
      if (!ice || subs.length === 0) return;
      askChoice(ctx, 'corp', `Mycoweb: resolve which subroutine on ${cardDef(ice).title}?`, subs.map((s, i) => ({ id: String(i), label: s.label })), 'borrow_sub', {
        iceId: ice.instanceId,
      });
    } else if (source.step === 'borrow_sub' && answer.kind === 'effect_choice') {
      const ice = installedIce(state).find(c => c.instanceId === source.data?.iceId);
      const sub = ice && getScript(ice)?.ice?.subroutines[Number(answer.optionId)];
      if (!ice || !sub) return;
      addLog(state, 'corp', `Mycoweb resolves a subroutine on ${cardDef(ice).title}: ${sub.label}`);
      sub.resolve({ state, card: ice, side: 'corp' });
    }
  },
};

// Semak-samun (Barrier - AP): The Runner cannot break the printed subroutine on this ice
// except using a fracter. Subroutine: End the run unless the Runner suffers 3 net damage.
export const semakSamun: CardScript = {
  ice: {
    fracterOnly: true,
    subroutines: [
      {
        label: 'End the run unless the Runner suffers 3 net damage.',
        resolve: ctx =>
          askChoice(ctx, 'runner', 'Semak-samun: suffer 3 net damage, or the run ends.', [
            { id: 'damage', label: 'Suffer 3 net damage' },
            { id: 'end', label: 'End the run' },
          ], 'choice'),
      },
    ],
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'damage') dealNetDamage(state, 3);
    else endTheRun(state);
  },
};

// Doomscroll (Sentry - AP - Observer): Subroutine: Give the Runner 1 tag.
// Subroutine: Do 1 net damage. Subroutine: Do 2 net damage if the Runner has at least 2 tags.
export const doomscroll: CardScript = {
  ice: {
    subroutines: [
      { label: 'Give the Runner 1 tag.', resolve: ({ state }) => giveTags(state, 1) },
      netDamageSub(1),
      {
        label: 'Do 2 net damage if the Runner has at least 2 tags.',
        resolve: ({ state }) => {
          if (state.runner.tags >= 2) dealNetDamage(state, 2);
        },
      },
    ],
  },
};

// N-Pot (Code Gate): 3 credits: Break 1 subroutine on this ice. Only the Runner can use this
// ability. Subroutine: End the run. Subroutine: If the threat level is 2 or greater, end the
// run. Subroutine: If the threat level is 4 or greater, end the run.
const threatEtr = (level: number): Subroutine => ({
  label: `If the threat level is ${level} or greater, end the run.`,
  resolve: ({ state }) => {
    if (threatLevel(state) >= level) endTheRun(state);
  },
});

export const nPot: CardScript = {
  ice: { runnerBreakCost: 3, subroutines: [endTheRunSub, threatEtr(2), threatEtr(4)] },
};

// Biawak (Sentry - Destroyer): You can forfeit 1 agenda as you rez this ice to pay for 10
// credits of its rez cost. Subroutine: Trash 1 installed program or end the run.
// Subroutine: Trash 1 installed resource or end the run. Subroutine: End the run.
const orEndTheRun = (kind: 'program' | 'resource'): Subroutine => ({
  label: `Trash 1 installed ${kind} or end the run.`,
  resolve: ctx => {
    const cards = kind === 'program' ? ctx.state.runner.rig.programs : ctx.state.runner.rig.resources;
    if (cards.length === 0) return endTheRun(ctx.state);
    askChoice(ctx, 'corp', `Biawak: trash a ${kind} or end the run?`, [
      ...cards.map(c => ({ id: c.instanceId, label: `Trash ${cardDef(c).title}` })),
      { id: 'end', label: 'End the run' },
    ], 'trash_or_end');
  },
});

export const biawak: CardScript = {
  rezBlocker: (state, card, cost) => {
    const credits = availableCredits(state, 'corp', { kind: 'rez', card });
    if (credits >= cost) return null;
    return forfeitable(state).length > 0 && credits >= cost - 10 ? null : 'Not enough credits to rez';
  },
  payRez: (ctx, cost) => {
    const { state, card } = ctx;
    const canPay = availableCredits(state, 'corp', { kind: 'rez', card }) >= cost;
    const options = [
      ...(canPay ? [{ id: 'pay', label: `Pay ${cost} credits` }] : []),
      ...(availableCredits(state, 'corp', { kind: 'rez', card }) >= cost - 10
        ? forfeitable(state).map(a => ({ id: a.instanceId, label: `Forfeit ${cardDef(a).title} and pay ${Math.max(0, cost - 10)}` }))
        : []),
    ];
    askChoice(ctx, 'corp', 'Biawak: how do you pay its rez cost?', options, 'rez_cost', { cost });
  },
  ice: { subroutines: [orEndTheRun('program'), orEndTheRun('resource'), endTheRunSub] },
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (source.step === 'rez_cost') {
      const cost = Number(source.data?.cost ?? 0);
      if (answer.optionId === 'pay') {
        spendCredits(state, 'corp', cost, { kind: 'rez', card });
      } else {
        const agenda = forfeitable(state).find(a => a.instanceId === answer.optionId);
        if (!agenda) return;
        forfeitAgenda(state, agenda);
        spendCredits(state, 'corp', Math.max(0, cost - 10), { kind: 'rez', card });
      }
      addLog(state, 'corp', 'Corp rezzed Biawak.', undefined, 'rez');
      completeRez(state, card);
      return;
    }
    if (answer.optionId === 'end') return endTheRun(state);
    const target = [...state.runner.rig.programs, ...state.runner.rig.resources].find(c => c.instanceId === answer.optionId);
    if (target) {
      trashInstalledRunnerCard(state, target);
      addLog(state, 'corp', `Biawak trashed ${cardDef(target).title}.`);
    }
  },
};

// Kessleroid (Barrier): The Runner cannot trash this ice (while it is rezzed).
// Subroutine: End the run. Subroutine: End the run.
export const kessleroid: CardScript = { runnerCannotTrash: true, ice: { subroutines: [endTheRunSub, endTheRunSub] } };

// Syailendra (Code Gate - AP): You can advance this ice. When the Runner encounters this ice,
// if it has 3 or more hosted advancement counters, you may place 1 advancement counter on an
// installed card you can advance. Subroutine: You may place 1 advancement counter on an
// installed card you can advance. Subroutine: The Runner loses 2 credits. Subroutine: Do 1 net damage.
const askAdvanceOne = (ctx: EffectContext) => {
  const targets = advanceableInstalled(ctx.state);
  if (targets.length > 0) askCards(ctx, 'corp', 'Syailendra: you may place 1 advancement counter on an installed card you can advance.', ids(targets), 0, 1, 'advance');
};

export const syailendra: CardScript = {
  ice: {
    onEncounter: ctx => {
      if (ctx.card.advancementCounters >= 3) askAdvanceOne(ctx);
    },
    subroutines: [
      { label: 'You may place 1 advancement counter on an installed card you can advance.', resolve: askAdvanceOne },
      {
        label: 'The Runner loses 2 credits.',
        resolve: ({ state }) => {
          state.runner.credits = Math.max(0, state.runner.credits - 2);
        },
      },
      netDamageSub(1),
    ],
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards' || answer.cardInstanceIds.length === 0) return;
    const target = advanceableInstalled(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
    if (!target) return;
    target.advancementCounters += 1;
    addLog(state, 'corp', 'Corp placed 1 advancement counter (Syailendra).');
  },
};

// Flyswatter (Code Gate): When you rez this ice during a run against this server, purge
// virus counters. Subroutine: End the run.
export const flyswatter: CardScript = {
  ice: {
    subroutines: [endTheRunSub],
    onRezDuringRunOnServer: ({ state }) => {
      const removed = purgeVirusCounters(state);
      addLog(state, 'corp', `Flyswatter purged virus counters (${removed} removed).`);
    },
  },
};

// Lamplighter (Sentry - Observer): When an agenda is scored or stolen from this server or its
// root, trash this ice. Subroutine: Give the Runner 1 tag unless they pay 3 credits.
// Subroutine: End the run if the Runner is tagged.
export const lamplighter: CardScript = {
  triggers: {
    agenda_scored: (ctx, e) => {
      if (serverOf(ctx.state, ctx.card)?.id === e.serverId) trashInstalledCard(ctx.state, ctx.card);
    },
    agenda_stolen: ctx => {
      const run = ctx.state.activeRun;
      if (run && serverOf(ctx.state, ctx.card)?.id === run.server) trashInstalledCard(ctx.state, ctx.card);
    },
  },
  ice: {
    subroutines: [
      {
        label: 'Give the Runner 1 tag unless they pay 3 credits.',
        resolve: ctx => {
          if (availableCredits(ctx.state, 'runner') < 3) return giveTags(ctx.state, 1);
          askChoice(ctx, 'runner', 'Lamplighter: pay 3 credits or take 1 tag?', [
            { id: 'pay', label: 'Pay 3 credits' },
            { id: 'tag', label: 'Take 1 tag' },
          ], 'tag');
        },
      },
      {
        label: 'End the run if the Runner is tagged.',
        resolve: ({ state }) => {
          if (state.runner.tags > 0) endTheRun(state);
        },
      },
    ],
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'pay') spendCredits(state, 'runner', 3);
    else giveTags(state, 1);
  },
};

// --- Operations -------------------------------------------------------------------

const getScript = (card: CardInstance) => getCardScript(card.cardCode);

export const elevationCorpIceScripts: Record<string, CardScript> = {
  '35041': bumi,
  '35042': scatterField,
  '35052': empiricist,
  '35053': mycoweb,
  '35054': semakSamun,
  '35063': doomscroll,
  '35064': nPot,
  '35074': biawak,
  '35075': kessleroid,
  '35076': syailendra,
  '35079': flyswatter,
  '35080': lamplighter,
};
