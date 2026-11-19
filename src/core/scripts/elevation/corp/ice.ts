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
  loseCredits,
  purgeVirusCounters,
  rezCost,
  spendCredits,
  threatLevel,
  trashInstalledCard,
} from '../../../engine/cardEffects';
import { CardScript, EffectContext, Subroutine } from '../../types';
import { getCardScript } from '../../index';
import { advanceableInstalled, installCorpChoice } from '../../effects';
import { cards, CardsStep, cardsQuestion, choice, choiceQuestion, Flow, InstallData, NoData, prompts } from '../../steps';
import { archivesCards, ids, installable, keywords, serverOf, type } from './helpers';

const endTheRunSub: Subroutine = { label: 'End the run.', resolve: ({ state }) => endTheRun(state) };

const netDamageSub = (amount: number): Subroutine => ({ label: `Do ${amount} net damage.`, resolve: ({ state }) => void dealNetDamage(state, amount) });

/** "Trash 1 installed program" (the Corp chooses), asked under the ice's trashProgramStep. */
const trashProgramSub = (flow: Flow<{ trash_program: CardsStep<NoData> }>, label = 'Trash 1 installed program.'): Subroutine => ({
  label,
  resolve: ctx => {
    const programs = ctx.state.runner.rig.programs;
    if (programs.length === 0) return;
    flow.ask(ctx, 'trash_program', cardsQuestion('corp', `${cardDef(ctx.card).title}: trash 1 installed program.`, ids(programs), 1, 1));
  },
});

/** The step that answers trashProgramSub. */
const trashProgramStep = () =>
  cards(({ state }, a) => {
    const program = state.runner.rig.programs.find(p => p.instanceId === a.ids[0]);
    if (program) {
      trashInstalledRunnerCard(state, program);
      addLog(state, 'corp', `Corp trashed ${cardDef(program).title}.`);
    }
  });

// Bumi 1.0 (Sentry - Bioroid - AP - Destroyer): When you rez this ice during a run against
// this server, you may trash 1 installed trojan program. Lose click: Break 1 subroutine.
// Subroutine: Trash 1 installed program. Subroutine: Do 1 core damage.
const trojans = (state: GameState) => state.runner.rig.programs.filter(p => /trojan/i.test(keywords(p)));

const bumiFlow = prompts({ trash_program: trashProgramStep() });

export const bumi: CardScript = {
  ice: {
    subroutines: [trashProgramSub(bumiFlow), { label: 'Do 1 core damage.', resolve: ({ state }) => void dealCoreDamage(state, 1) }],
    onRezDuringRunOnServer: ctx => {
      const targets = trojans(ctx.state);
      if (targets.length > 0) bumiFlow.ask(ctx, 'trash_program', cardsQuestion('corp', 'Bumi 1.0: you may trash 1 installed trojan.', ids(targets), 0, 1));
    },
  },
  ...bumiFlow.script,
};

// Scatter Field (Code Gate): While this ice is the only piece of ice protecting this server,
// it gets +4 strength. Subroutine: You may install 1 card from HQ. Subroutine: End the run.
const scatterFlow = prompts({
  pick: cards((ctx, a) => {
    if (a.ids.length > 0) scatterFlow.corpInstall(ctx, a.ids[0], 'server');
  }),
  server: choice<InstallData>((ctx, a, _d, source) => void installCorpChoice(ctx.state, source, a.raw)),
});

export const scatterField: CardScript = {
  ice: {
    strengthModifier: (state, ice) => (serverOf(state, ice)?.ice.length === 1 ? 4 : 0),
    subroutines: [
      {
        label: 'You may install 1 card from HQ.',
        resolve: ctx => {
          const cards = installable(ctx.state, ctx.state.corp.hq);
          if (cards.length > 0) scatterFlow.ask(ctx, 'pick', cardsQuestion('corp', 'Scatter Field: you may install 1 card from HQ.', ids(cards), 0, 1));
        },
      },
      endTheRunSub,
    ],
  },
  ...scatterFlow.script,
};

// Empiricist (Sentry - AP - Observer): Subroutine: Draw 1 card. You may add 1 card from HQ
// to the top of R&D. Subroutine: Do 1 net damage. Give the Runner 1 tag. Subroutine: Do 2 net damage.
const empiricistFlow = prompts({
  top: cards(({ state }, a) => {
    const card = state.corp.hq.find(c => c.instanceId === a.ids[0]);
    if (!card) return;
    removeCard(state.corp.hq, card);
    state.corp.rd.unshift(card);
    addLog(state, 'corp', 'Corp added 1 card from HQ to the top of R&D (Empiricist).');
  }),
});

export const empiricist: CardScript = {
  ice: {
    subroutines: [
      {
        label: 'Draw 1 card. You may add 1 card from HQ to the top of R&D.',
        resolve: ctx => {
          drawForEffect(ctx.state, 'corp', 1, 'Empiricist');
          if (ctx.state.winner || ctx.state.corp.hq.length === 0) return;
          empiricistFlow.ask(ctx, 'top', cardsQuestion('corp', 'Empiricist: you may add 1 card from HQ to the top of R&D.', ids(ctx.state.corp.hq), 0, 1));
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
  ...empiricistFlow.script,
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

const mycowebFlow = prompts({
  install: cards((ctx, a) => {
    if (a.ids.length > 0) mycowebFlow.corpInstall(ctx, a.ids[0], 'server', { ignoreCosts: true });
  }),
  server: choice<InstallData>((ctx, a, _d, source) => void installCorpChoice(ctx.state, source, a.raw, { ignoreCosts: true })),
  rez: cards(({ state }, a) => {
    if (a.ids.length === 0) return;
    const ice = installedIce(state).find(c => c.instanceId === a.ids[0]);
    if (!ice) return;
    const cost = Math.max(0, rezCost(state, ice) - 2);
    spendCredits(state, 'corp', cost, { kind: 'rez', card: ice });
    addLog(state, 'corp', `Corp spent ${cost} [credit] to rez ${cardDef(ice).title} (Mycoweb).`, undefined, 'rez');
    completeRez(state, ice);
  }),
  borrow_ice: cards((ctx, a) => {
    const ice = installedIce(ctx.state).find(c => c.instanceId === a.ids[0]);
    const subs = ice ? (getScript(ice)?.ice?.subroutines ?? []) : [];
    if (!ice || subs.length === 0) return;
    mycowebFlow.ask(ctx, 'borrow_sub', choiceQuestion('corp', `Mycoweb: resolve which subroutine on ${cardDef(ice).title}?`, subs.map((s, i) => ({ id: String(i), label: s.label }))), {
      iceId: ice.instanceId,
    });
  }),
  borrow_sub: choice<{ iceId: string }>(({ state }, a, data) => {
    const ice = installedIce(state).find(c => c.instanceId === data.iceId);
    const sub = ice && getScript(ice)?.ice?.subroutines[Number(a.optionId)];
    if (!ice || !sub) return;
    addLog(state, 'corp', `Mycoweb resolves a subroutine on ${cardDef(ice).title}: ${sub.label}`);
    sub.resolve({ state, card: ice, side: 'corp' });
  }),
});

export const mycoweb: CardScript = {
  ice: {
    subroutines: [
      {
        label: 'You may install 1 piece of ice from Archives, ignoring all costs.',
        resolve: ctx => {
          const ice = archivesIce(ctx.state);
          // Facedown Archives cards are hidden from the Runner (4.4.6c): asked even with no ice when the Corp's stops are on ALL
          mycowebFlow.evenIfNone(
            ctx,
            'corp',
            ice.length > 0,
            () => mycowebFlow.ask(ctx, 'install', cardsQuestion('corp', 'Mycoweb: you may install 1 ice from Archives, ignoring all costs.', ids(ice), 0, 1)),
            'Mycoweb: no ice in Archives to install.',
          );
        },
      },
      {
        label: 'You may rez 1 installed piece of ice, paying 2 credits less.',
        resolve: ctx => {
          const ice = mycowebRezTargets(ctx.state);
          // Whether an unrezzed ice is affordable says what it is (4.6.3): asked even with none when the Corp's stops are on ALL
          mycowebFlow.evenIfNone(
            ctx,
            'corp',
            ice.length > 0,
            () => mycowebFlow.ask(ctx, 'rez', cardsQuestion('corp', 'Mycoweb: you may rez 1 installed ice, paying 2 credits less.', ids(ice), 0, 1)),
            'Mycoweb: no installed ice you can rez.',
          );
        },
      },
      {
        label: 'Resolve 1 subroutine on a rezzed sentry.',
        resolve: ctx => {
          const ice = rezzedOfSubtype(ctx.state, 'sentry');
          if (ice.length > 0) mycowebFlow.ask(ctx, 'borrow_ice', cardsQuestion('corp', 'Mycoweb: choose a rezzed sentry.', ids(ice), 1, 1));
        },
      },
      {
        label: 'Resolve 1 subroutine on another rezzed code gate.',
        resolve: ctx => {
          const ice = rezzedOfSubtype(ctx.state, 'code gate', ctx.card);
          if (ice.length > 0) mycowebFlow.ask(ctx, 'borrow_ice', cardsQuestion('corp', 'Mycoweb: choose another rezzed code gate.', ids(ice), 1, 1));
        },
      },
    ],
  },
  ...mycowebFlow.script,
};

// Semak-samun (Barrier - AP): The Runner cannot break the printed subroutine on this ice
// except using a fracter. Subroutine: End the run unless the Runner suffers 3 net damage.
const semakFlow = prompts({
  choice: choice(({ state }, a) => {
    if (a.optionId === 'damage') dealNetDamage(state, 3);
    else endTheRun(state);
  }),
});

export const semakSamun: CardScript = {
  ice: {
    fracterOnly: true,
    subroutines: [
      {
        label: 'End the run unless the Runner suffers 3 net damage.',
        resolve: ctx =>
          semakFlow.ask(
            ctx,
            'choice',
            choiceQuestion('runner', 'Semak-samun: suffer 3 net damage, or the run ends.', [
              { id: 'damage', label: 'Suffer 3 net damage' },
              { id: 'end', label: 'End the run' },
            ]),
          ),
      },
    ],
  },
  ...semakFlow.script,
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
    biawakFlow.ask(
      ctx,
      'trash_or_end',
      choiceQuestion('corp', `Biawak: trash a ${kind} or end the run?`, [
        ...cards.map(c => ({ id: c.instanceId, label: `Trash ${cardDef(c).title}` })),
        { id: 'end', label: 'End the run' },
      ]),
    );
  },
});

const biawakFlow = prompts({
  rez_cost: choice<{ cost: number }>(({ state, card }, a, data) => {
    const cost = Number(data.cost ?? 0);
    if (a.optionId === 'pay') {
      spendCredits(state, 'corp', cost, { kind: 'rez', card });
    } else {
      const agenda = forfeitable(state).find(c => c.instanceId === a.optionId);
      if (!agenda) return;
      forfeitAgenda(state, agenda);
      spendCredits(state, 'corp', Math.max(0, cost - 10), { kind: 'rez', card });
    }
    addLog(state, 'corp', 'Corp rezzed Biawak.', undefined, 'rez');
    completeRez(state, card);
  }),
  trash_or_end: choice(({ state }, a) => {
    if (a.optionId === 'end') return endTheRun(state);
    const target = [...state.runner.rig.programs, ...state.runner.rig.resources].find(c => c.instanceId === a.optionId);
    if (target) {
      trashInstalledRunnerCard(state, target);
      addLog(state, 'corp', `Biawak trashed ${cardDef(target).title}.`);
    }
  }),
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
    biawakFlow.ask(ctx, 'rez_cost', choiceQuestion('corp', 'Biawak: how do you pay its rez cost?', options), { cost });
  },
  ice: { subroutines: [orEndTheRun('program'), orEndTheRun('resource'), endTheRunSub] },
  ...biawakFlow.script,
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
  if (targets.length > 0) syailendraFlow.ask(ctx, 'advance', cardsQuestion('corp', 'Syailendra: you may place 1 advancement counter on an installed card you can advance.', ids(targets), 0, 1));
};

const syailendraFlow = prompts({
  advance: cards(({ state }, a) => {
    const target = advanceableInstalled(state).find(c => c.instanceId === a.ids[0]);
    if (!target) return;
    target.advancementCounters += 1;
    addLog(state, 'corp', 'Corp placed 1 advancement counter (Syailendra).');
  }),
});

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
          loseCredits(state, 'runner', 2);
        },
      },
      netDamageSub(1),
    ],
  },
  ...syailendraFlow.script,
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
const lamplighterFlow = prompts({
  tag: choice(({ state }, a) => {
    if (a.optionId === 'pay') spendCredits(state, 'runner', 3);
    else giveTags(state, 1);
  }),
});

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
          lamplighterFlow.ask(
            ctx,
            'tag',
            choiceQuestion('runner', 'Lamplighter: pay 3 credits or take 1 tag?', [
              { id: 'pay', label: 'Pay 3 credits' },
              { id: 'tag', label: 'Take 1 tag' },
            ]),
          );
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
  ...lamplighterFlow.script,
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
