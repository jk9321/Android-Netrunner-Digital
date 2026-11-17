import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { corpSeesRd, shuffleRD } from '../../../engine/rdKnowledge';
import { addLog } from '../../../engine/log';
import { findInstalledCorpCard, removeCard, revealInHand } from '../../../engine/helpers';
import { dealNetDamage, giveTags, installedRunnerCards, trashInstalledRunnerCard, uninstallRunnerCard } from '../../../engine/damage';
import { endRun, endTheRun } from '../../../engine/runEnd';
import {
  addCounters,
  corpTrashFromHQ,
  counters,
  drawForEffect,
  gainFromCard,
  installedIce,
  loseCredits,
  purgeVirusCounters,
  swapIce,
  takeBadPublicity,
  trashInstalledCard,
} from '../../../engine/cardEffects';
import { CardScript, EffectContext, Subroutine } from '../../types';
import { corpInstallOptions, answerUnlessPays, installCorpChoice, unlessPaysQuestion } from '../../effects';
import { ArrangeData, cards, cardsQuestion, choice, choiceQuestion, CardsQuestion, InstallData, prompts } from '../../steps';
import { archivesCards, ids, isCentral, isSelf, keywords, runOnServerOf, serverOf, takeFromCorpZone, title, type } from './helpers';

const endTheRunSub: Subroutine = { label: 'End the run.', resolve: ({ state }) => endTheRun(state) };

// --- Identities -------------------------------------------------------------

// Ansel 2.0 (Sentry - Bioroid - Destroyer): Lose click click: Break up to 2 subroutines on this
// ice. Only the Runner can use this ability. Subroutines: Trash 1 installed Runner card.
// Remove 1 card in the heap from the game. You may install 1 card from HQ or Archives. End the run.
const anselInstallable = (state: GameState) =>
  [...state.corp.hq, ...archivesCards(state)].filter(c => type(c) !== 'operation' && corpInstallOptions(state, c).length > 0);

const anselFlow = prompts({
  trash: cards(({ state }, a) => {
    const card = installedRunnerCards(state).find(c => c.instanceId === a.ids[0]);
    if (!card) return;
    trashInstalledRunnerCard(state, card);
    addLog(state, 'corp', `Corp trashed ${title(card)} (Ansel 2.0).`);
  }),
  heap: cards(({ state }, a) => {
    const card = state.runner.heap.find(c => c.instanceId === a.ids[0]);
    if (!card) return;
    removeCard(state.runner.heap, card);
    state.removedFromGame.push(card);
    addLog(state, 'corp', `Corp removed ${title(card)} in the heap from the game (Ansel 2.0).`);
  }),
  install: cards((ctx, a) => {
    if (a.ids.length > 0) anselFlow.corpInstall(ctx, a.ids[0], 'server');
  }),
  server: choice<InstallData>((ctx, a, _d, source) => void installCorpChoice(ctx.state, source, a.raw)),
});

export const ansel2: CardScript = {
  ice: {
    clickBreak: { clicks: 2, max: 2 },
    subroutines: [
      {
        label: 'Trash 1 installed Runner card.',
        resolve: ctx => {
          const cards = installedRunnerCards(ctx.state);
          if (cards.length > 0) anselFlow.cards(ctx, 'trash', cardsQuestion('corp', 'Ansel 2.0: trash 1 installed Runner card.', ids(cards), 1, 1));
        },
      },
      {
        label: 'Remove 1 card in the heap from the game.',
        resolve: ctx => {
          const heap = ctx.state.runner.heap;
          if (heap.length > 0) anselFlow.cards(ctx, 'heap', cardsQuestion('corp', 'Ansel 2.0: remove 1 card in the heap from the game.', ids(heap), 1, 1));
        },
      },
      {
        label: 'You may install 1 card from HQ or Archives.',
        resolve: ctx => {
          const cards = anselInstallable(ctx.state);
          if (cards.length > 0) anselFlow.cards(ctx, 'install', cardsQuestion('corp', 'Ansel 2.0: you may install 1 card from HQ or Archives.', ids(cards), 0, 1));
        },
      },
      endTheRunSub,
    ],
  },
  ...anselFlow.script,
};

// Reverb (Barrier - Harmonic): The rez cost of this ice is lowered by 1 credit for each other
// unrezzed piece of ice. Subroutines: End the run. End the run.
const otherUnrezzedIce = (state: GameState, self: CardInstance) => installedIce(state).filter(c => !c.isRezzed && c.instanceId !== self.instanceId).length;

export const reverb: CardScript = {
  ownRezCostModifier: (state, self) => -otherUnrezzedIce(state, self),
  liveValue: (state, self) => `Rez cost now ${Math.max(0, 4 - otherUnrezzedIce(state, self))}[credit]`,
  ice: { subroutines: [endTheRunSub, endTheRunSub] },
};

// Sleipnir (Code Gate): Subroutines: You may draw 1 card. You may shuffle 1 card from HQ or
// Archives into R&D. End the run.
const sleipnirFlow = prompts({
  draw: choice(({ state }, a) => {
    if (a.optionId === 'draw') drawForEffect(state, 'corp', 1, 'Sleipnir');
  }),
  shuffle: cards(({ state }, a) => {
    if (a.ids.length === 0) return;
    const card = [...state.corp.hq, ...archivesCards(state)].find(c => c.instanceId === a.ids[0]);
    if (!card) return;
    const visible = state.corp.archives.faceUp.includes(card);
    takeFromCorpZone(state, card);
    state.corp.rd.push(card);
    shuffleRD(state);
    addLog(state, 'corp', `Corp shuffled ${visible ? title(card) : 'a card'} into R&D (Sleipnir).`);
  }),
});

export const sleipnir: CardScript = {
  ice: {
    subroutines: [
      {
        label: 'You may draw 1 card.',
        resolve: ctx =>
          sleipnirFlow.choice(ctx, 'draw', choiceQuestion('corp', 'Sleipnir: draw 1 card?', [
            { id: 'draw', label: 'Draw 1 card' },
            { id: 'no', label: 'No' },
          ])),
      },
      {
        label: 'You may shuffle 1 card from HQ or Archives into R&D.',
        resolve: ctx => {
          const cards = [...ctx.state.corp.hq, ...archivesCards(ctx.state)];
          if (cards.length > 0) sleipnirFlow.cards(ctx, 'shuffle', cardsQuestion('corp', 'Sleipnir: you may shuffle 1 card from HQ or Archives into R&D.', ids(cards), 0, 1));
        },
      },
      endTheRunSub,
    ],
  },
  ...sleipnirFlow.script,
};

// Vertigo (Code Gate): When the Runner passes this ice, if they have no click remaining, they
// cannot steal or trash Corp cards for the remainder of this run. Subroutine: The Runner loses click.
export const vertigo: CardScript = {
  ice: {
    onPass: ({ state }) => {
      if (!state.activeRun || state.runner.clicks > 0) return;
      state.activeRun.cannotStealOrTrash = true;
      addLog(state, 'corp', 'Vertigo: the Runner cannot steal or trash Corp cards this run.');
    },
    subroutines: [
      {
        label: 'The Runner loses [click].',
        resolve: ({ state }) => {
          if (state.runner.clicks > 0) state.runner.clicks -= 1;
        },
      },
    ],
  },
};

// ezaM (Code Gate): click: Swap this ice with another installed piece of ice. Subroutines: Look
// at the top card of R&D. You may add that card to the bottom of R&D. Each piece of ice gets +1
// strength for the remainder of this run.
const ezamFlow = prompts({
  swap: cards(({ state, card }, a) => swapIce(state, card.instanceId, a.ids[0])),
  top: choice(({ state }, a) => {
    if (a.optionId !== 'bottom') return;
    const top = state.corp.rd.shift();
    if (top) state.corp.rd.push(top);
    addLog(state, 'corp', 'Corp added the top card of R&D to the bottom (ezaM).');
  }),
});

export const ezam: CardScript = {
  abilities: [
    {
      label: 'Swap this ice with another installed piece of ice.',
      clicks: 1,
      canUse: ({ state, card }) => (installedIce(state).some(c => c.instanceId !== card.instanceId) ? null : 'No other installed ice'),
      resolve: ctx =>
        ezamFlow.cards(ctx, 'swap', cardsQuestion('corp', 'ezaM: swap it with which piece of ice?', ids(installedIce(ctx.state).filter(c => c.instanceId !== ctx.card.instanceId)), 1, 1)),
    },
  ],
  ice: {
    subroutines: [
      {
        label: 'Look at the top card of R&D. You may add that card to the bottom of R&D.',
        resolve: ctx => {
          const top = ctx.state.corp.rd[0];
          if (!top) return;
          corpSeesRd(ctx.state, [top]); // the Corp looks at it (10.2.2b); it follows the card to the bottom if moved
          ezamFlow.choice(ctx, 'top', choiceQuestion('corp', `ezaM: the top card of R&D is ${title(top)}. Add it to the bottom of R&D?`, [
            { id: 'bottom', label: 'Bottom of R&D' },
            { id: 'leave', label: 'Leave it on top' },
          ]));
        },
      },
      {
        label: 'Each piece of ice gets +1 strength for the remainder of this run.',
        resolve: ({ state }) => {
          if (state.activeRun) state.activeRun.iceStrengthBonus = (state.activeRun.iceStrengthBonus ?? 0) + 1;
        },
      },
    ],
  },
  ...ezamFlow.script,
};

// Knowledge Seeker (Code Gate): Whenever an encounter with this ice ends, if it has 3 or more
// hosted virus counters, purge virus counters and derez this ice. Subroutines: Place 1 virus
// counter on this ice. Look at the top 4 cards of R&D and arrange them in any order. End the run.
const seekerFlow = prompts({
  arrange: cards<ArrangeData>((ctx, a, data) => seekerFlow.arrangeNext(ctx, 'arrange', data, a.ids[0])),
});

export const knowledgeSeeker: CardScript = {
  ice: {
    onEncounterEnds: ({ state, card }) => {
      if (counters(card, 'virus') < 3 || !card.isRezzed) return;
      const purged = purgeVirusCounters(state);
      card.isRezzed = false;
      addLog(state, 'corp', `Knowledge Seeker purged ${purged} virus counter(s) and was derezzed.`);
    },
    subroutines: [
      { label: 'Place 1 virus counter on this ice.', resolve: ({ card }) => addCounters(card, 'virus', 1) },
      {
        label: 'Look at the top 4 cards of R&D and arrange them in any order.',
        resolve: ctx => seekerFlow.arrangeTop(ctx, 'arrange', ids(ctx.state.corp.rd.slice(0, 4))),
      },
      endTheRunSub,
    ],
  },
  ...seekerFlow.script,
};

// Lionsmane (Sentry - AP): Subroutines: Do 2 net damage. Do 2 net damage unless the Runner pays
// 3 credits. Do 2 net damage unless the Runner jacks out.
const lionsmaneFlow = prompts({
  pay: choice(({ state }, a) => answerUnlessPays(state, 3, a.optionId, () => dealNetDamage(state, 2))),
  jack: choice(({ state }, a) => {
    if (a.optionId === 'jack' && state.activeRun) {
      state.activeRun.isJackedOut = true;
      addLog(state, 'runner', 'Runner jacked out.');
      endRun(state);
    } else {
      dealNetDamage(state, 2);
    }
  }),
});

export const lionsmane: CardScript = {
  ice: {
    subroutines: [
      { label: 'Do 2 net damage.', resolve: ({ state }) => void dealNetDamage(state, 2) },
      {
        label: 'Do 2 net damage unless the Runner pays 3 [credit].',
        resolve: ctx => {
          if (!lionsmaneFlow.askIf(ctx, 'pay', unlessPaysQuestion(ctx, 3, 'take 2 net damage'))) dealNetDamage(ctx.state, 2);
        },
      },
      {
        label: 'Do 2 net damage unless the Runner jacks out.',
        resolve: ctx =>
          lionsmaneFlow.choice(ctx, 'jack', choiceQuestion('runner', 'Lionsmane: jack out, or take 2 net damage?', [
            { id: 'jack', label: 'Jack out' },
            { id: 'damage', label: 'Take 2 net damage' },
          ])),
      },
    ],
  },
  ...lionsmaneFlow.script,
};

// Vicsek (Trap - AP - Observer): Subroutines: Do X net damage and give the Runner X tags. X is
// equal to the number of tags the Runner has. Give the Runner 1 tag. Trash this ice.
export const vicsek: CardScript = {
  liveValue: state => `X = ${state.runner.tags}`,
  ice: {
    subroutines: [
      {
        label: 'Do X net damage and give the Runner X tags (X = the Runner\'s tags).',
        resolve: ({ state }) => {
          const x = state.runner.tags;
          if (x === 0) return;
          dealNetDamage(state, x);
          if (!state.winner) giveTags(state, x);
        },
      },
      {
        label: 'Give the Runner 1 tag. Trash this ice.',
        resolve: ({ state, card }) => {
          giveTags(state, 1);
          if (findInstalledCorpCard(state, card.instanceId)) {
            trashInstalledCard(state, card);
            addLog(state, 'corp', 'Vicsek was trashed.');
          }
        },
      },
    ],
  },
};

// Grubber (Barrier - Liability): When you rez this ice, if it is protecting a central server,
// take 1 bad publicity. Subroutines: End the run unless the Runner pays 3 credits (twice).
const grubberSub = (step: 'pay0' | 'pay1'): Subroutine => ({
  label: 'End the run unless the Runner pays 3 [credit].',
  resolve: ctx => {
    if (!grubberFlow.askIf(ctx, step, unlessPaysQuestion(ctx, 3, 'end the run'))) endTheRun(ctx.state);
  },
});

const grubberPay = choice(({ state }, a) => answerUnlessPays(state, 3, a.optionId, () => endTheRun(state)));
const grubberFlow = prompts({ pay0: grubberPay, pay1: grubberPay });

export const grubber: CardScript = {
  triggers: {
    rezzed: (ctx, e) => {
      if (!isSelf(ctx, e.card)) return;
      const server = serverOf(ctx.state, ctx.card);
      if (server && isCentral(server.id)) takeBadPublicity(ctx.state, 1);
    },
  },
  ice: { subroutines: [grubberSub('pay0'), grubberSub('pay1')] },
  ...grubberFlow.script,
};

// Lethe (Sentry - Observer): Whenever the Runner bypasses or fully breaks this ice, give them
// 1 tag. Subroutines: You may add 1 card from Archives to the top or bottom of R&D. Add 1
// installed Runner card to the grip.
const letheFlow = prompts({
  archives: cards((ctx, a) => {
    if (a.ids.length === 0) return;
    letheFlow.choice(ctx, 'where', choiceQuestion('corp', 'Lethe: top or bottom of R&D?', [
      { id: 'top', label: 'Top of R&D' },
      { id: 'bottom', label: 'Bottom of R&D' },
    ]), { cardId: a.ids[0] });
  }),
  where: choice<{ cardId: string }>(({ state }, a, data) => {
    const card = archivesCards(state).find(c => c.instanceId === data.cardId);
    if (!card) return;
    const visible = state.corp.archives.faceUp.includes(card);
    takeFromCorpZone(state, card);
    if (a.optionId === 'top') state.corp.rd.unshift(card);
    else state.corp.rd.push(card);
    addLog(state, 'corp', `Corp added ${visible ? title(card) : 'a card'} from Archives to the ${a.optionId} of R&D (Lethe).`);
  }),
  grip: cards(({ state }, a) => {
    const card = installedRunnerCards(state).find(c => c.instanceId === a.ids[0]);
    if (!card) return;
    uninstallRunnerCard(state, card, 'grip');
    addLog(state, 'corp', `${title(card)} was added to the grip (Lethe).`);
  }),
});

export const lethe: CardScript = {
  triggers: {
    ice_fully_broken: (ctx, e) => isSelf(ctx, e.ice) && giveTags(ctx.state, 1),
  },
  ice: {
    onBypassed: ({ state }) => giveTags(state, 1),
    subroutines: [
      {
        label: 'You may add 1 card from Archives to the top or bottom of R&D.',
        resolve: ctx => {
          const cards = archivesCards(ctx.state);
          if (cards.length > 0) letheFlow.cards(ctx, 'archives', cardsQuestion('corp', 'Lethe: you may add 1 card from Archives to R&D.', ids(cards), 0, 1));
        },
      },
      {
        label: 'Add 1 installed Runner card to the grip.',
        resolve: ctx => {
          const cards = installedRunnerCards(ctx.state);
          if (cards.length > 0) letheFlow.cards(ctx, 'grip', cardsQuestion('corp', 'Lethe: add 1 installed Runner card to the grip.', ids(cards), 1, 1));
        },
      },
    ],
  },
  ...letheFlow.script,
};

// Paywall (Barrier): When the Runner encounters this ice, they lose 1 credit. Subroutine: End
// the run unless the Runner pays 1 credit.
const paywallFlow = prompts({
  pay: choice(({ state }, a) => answerUnlessPays(state, 1, a.optionId, () => endTheRun(state))),
});

export const paywall: CardScript = {
  ice: {
    onEncounter: ({ state }) => {
      const lost = loseCredits(state, 'runner', 1);
      if (lost > 0) addLog(state, 'corp', 'Paywall: the Runner lost 1 [credit].');
    },
    subroutines: [
      {
        label: 'End the run unless the Runner pays 1 [credit].',
        resolve: ctx => {
          if (!paywallFlow.askIf(ctx, 'pay', unlessPaysQuestion(ctx, 1, 'end the run'))) endTheRun(ctx.state);
        },
      },
    ],
  },
  ...paywallFlow.script,
};

// Event Horizon (Sentry - Destroyer): trash: End the run. Use this ability only during a run
// against this server. Subroutines: Trash 1 installed program unless the Runner pays 3
// credits. End the run unless the Runner pays 3 credits.
function programTrashQuestion(ctx: EffectContext): CardsQuestion | null {
  const programs = ctx.state.runner.rig.programs;
  return programs.length > 0 ? cardsQuestion('corp', `${title(ctx.card)}: trash 1 installed program.`, ids(programs), 1, 1) : null;
}

const horizonFlow = prompts({
  program: choice((ctx, a) => answerUnlessPays(ctx.state, 3, a.optionId, () => void horizonFlow.askIf(ctx, 'trash', programTrashQuestion(ctx)))),
  etr: choice(({ state }, a) => answerUnlessPays(state, 3, a.optionId, () => endTheRun(state))),
  trash: cards(({ state }, a) => {
    const program = state.runner.rig.programs.find(c => c.instanceId === a.ids[0]);
    if (!program) return;
    trashInstalledRunnerCard(state, program);
    addLog(state, 'corp', `Corp trashed ${title(program)} (Event Horizon).`);
  }),
});

export const eventHorizon: CardScript = {
  abilities: [
    {
      label: 'End the run.',
      trashSelf: true,
      canUse: ({ state, card }) => (runOnServerOf(state, card) ? null : 'Only during a run against this server'),
      resolve: ({ state }) => endTheRun(state),
    },
  ],
  ice: {
    subroutines: [
      {
        label: 'Trash 1 installed program unless the Runner pays 3 [credit].',
        resolve: ctx => {
          if (ctx.state.runner.rig.programs.length === 0) return;
          if (!horizonFlow.askIf(ctx, 'program', unlessPaysQuestion(ctx, 3, 'the Corp trashes 1 program'))) horizonFlow.askIf(ctx, 'trash', programTrashQuestion(ctx));
        },
      },
      {
        label: 'End the run unless the Runner pays 3 [credit].',
        resolve: ctx => {
          if (!horizonFlow.askIf(ctx, 'etr', unlessPaysQuestion(ctx, 3, 'end the run'))) endTheRun(ctx.state);
        },
      },
    ],
  },
  ...horizonFlow.script,
};


// Flywheel (Sentry): Subroutines (twice): Gain 1 credit. You may draw 1 card.
const flywheelSub: Subroutine = {
  label: 'Gain 1 [credit]. You may draw 1 card.',
  resolve: ctx => {
    gainFromCard(ctx.state, 'corp', 1, ctx.card);
    flywheelFlow.choice(ctx, 'draw', choiceQuestion('corp', 'Flywheel: draw 1 card?', [
      { id: 'draw', label: 'Draw 1 card' },
      { id: 'no', label: 'No' },
    ]));
  },
};

const flywheelFlow = prompts({
  draw: choice(({ state }, a) => {
    if (a.optionId === 'draw') drawForEffect(state, 'corp', 1, 'Flywheel');
  }),
});

export const flywheel: CardScript = {
  ice: { subroutines: [flywheelSub, flywheelSub] },
  ...flywheelFlow.script,
};

// Tocsin (Code Gate - Expendable): click, 1 credit, reveal and trash this ice from HQ: Search
// R&D for up to 1 barrier and up to 1 sentry and reveal them. Add those cards to HQ.
// Subroutines: The Runner loses 2 credits. End the run. End the run.
const iceOfType = (state: GameState, subtype: string) =>
  state.corp.rd.filter(c => type(c) === 'ice' && new RegExp(`\\b${subtype}\\b`, 'i').test(keywords(c)));

/** Tocsin's search: adds the chosen ice to HQ, then searches for a sentry (after the barrier) or shuffles R&D. */
const tocsinFound = (ctx: EffectContext, picked: string[], after: 'sentry' | 'shuffle') => {
  const { state } = ctx;
  for (const id of picked) {
    const found = state.corp.rd.find(c => c.instanceId === id);
    if (!found) continue;
    removeCard(state.corp.rd, found);
    state.corp.hq.push(found);
    revealInHand(state, 'corp', [found]);
    addLog(state, 'corp', `Corp revealed ${title(found)} and added it to HQ (Tocsin).`);
  }
  if (after === 'sentry') {
    tocsinFlow.cards(ctx, 'sentry', cardsQuestion('corp', 'Tocsin: search R&D for up to 1 sentry.', ids(iceOfType(state, 'sentry')), 0, 1));
  } else {
    shuffleRD(state);
  }
};

const tocsinFlow = prompts({
  barrier: cards((ctx, a) => tocsinFound(ctx, a.ids, 'sentry')),
  sentry: cards((ctx, a) => tocsinFound(ctx, a.ids, 'shuffle')),
});

export const tocsin: CardScript = {
  abilities: [
    {
      label: 'Reveal and trash this ice from HQ: search R&D for up to 1 barrier and up to 1 sentry.',
      fromHQ: true,
      clicks: 1,
      credits: 1,
      resolve: ctx => {
        const { state, card } = ctx;
        corpTrashFromHQ(state, [card.instanceId], true);
        addLog(state, 'corp', 'Corp revealed and trashed Tocsin from HQ.');
        tocsinFlow.cards(ctx, 'barrier', cardsQuestion('corp', 'Tocsin: search R&D for up to 1 barrier.', ids(iceOfType(state, 'barrier')), 0, 1));
      },
    },
  ],
  ice: {
    subroutines: [
      {
        label: 'The Runner loses 2 [credit].',
        resolve: ({ state }) => {
          const lost = loseCredits(state, 'runner', 2);
          addLog(state, 'corp', `The Runner lost ${lost} [credit] (Tocsin).`);
        },
      },
      endTheRunSub,
      endTheRunSub,
    ],
  },
  ...tocsinFlow.script,
};

// --- Operations -------------------------------------------------------------

export const vantageCorpIceScripts: Record<string, CardScript> = {
  '36028': ansel2,
  '36029': reverb,
  '36030': sleipnir,
  '36031': vertigo,
  '36039': ezam,
  '36040': knowledgeSeeker,
  '36041': lionsmane,
  '36042': vicsek,
  '36050': grubber,
  '36051': lethe,
  '36052': paywall,
  '36058': eventHorizon,
  '36059': flywheel,
  '36060': tocsin,
};
