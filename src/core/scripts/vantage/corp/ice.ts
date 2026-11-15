import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { shuffleRD } from '../../../engine/rdKnowledge';
import { addLog } from '../../../engine/log';
import { findInstalledCorpCard, removeCard, revealInHand } from '../../../engine/helpers';
import { dealNetDamage, giveTags, installedRunnerCards, trashInstalledRunnerCard, uninstallRunnerCard } from '../../../engine/damage';
import { endRun, endTheRun } from '../../../engine/runEnd';
import {
  addCounters,
  availableCredits,
  corpTrashFromHQ,
  counters,
  drawForEffect,
  gainFromCard,
  installedIce,
  loseCredits,
  purgeVirusCounters,
  spendCredits,
  swapIce,
  takeBadPublicity,
  trashInstalledCard,
} from '../../../engine/cardEffects';
import { CardScript, EffectContext, Subroutine } from '../../types';
import { arrangeNext, arrangeTop, askCards, askChoice, askCorpInstall, corpInstallOptions, installCorpChoice } from '../../effects';
import { archivesCards, ids, isCentral, isSelf, keywords, runOnServerOf, serverOf, takeFromCorpZone, title, type } from './helpers';

const endTheRunSub: Subroutine = { label: 'End the run.', resolve: ({ state }) => endTheRun(state) };

/** A subroutine "X unless the Runner pays N credits": the Runner chooses if they can pay. `step` names the answer. */
function unlessPays(ctx: EffectContext, amount: number, what: string, step: string, otherwise: () => void): void {
  if (availableCredits(ctx.state, 'runner') < amount) {
    otherwise();
    return;
  }
  askChoice(ctx, 'runner', `${title(ctx.card)}: pay ${amount} [credit], or ${what}?`, [
    { id: 'pay', label: `Pay ${amount} [credit]` },
    { id: 'no', label: what[0].toUpperCase() + what.slice(1) },
  ], step);
}

/** Answers an unlessPays() prompt: pays, or runs the consequence. */
function answerUnlessPays(state: GameState, amount: number, optionId: string, otherwise: () => void): void {
  if (optionId === 'pay' && availableCredits(state, 'runner') >= amount) spendCredits(state, 'runner', amount);
  else otherwise();
}

// --- Identities -------------------------------------------------------------

// Ansel 2.0 (Sentry - Bioroid - Destroyer): Lose click click: Break up to 2 subroutines on this
// ice. Only the Runner can use this ability. Subroutines: Trash 1 installed Runner card.
// Remove 1 card in the heap from the game. You may install 1 card from HQ or Archives. End the run.
const anselInstallable = (state: GameState) =>
  [...state.corp.hq, ...archivesCards(state)].filter(c => type(c) !== 'operation' && corpInstallOptions(state, c).length > 0);

export const ansel2: CardScript = {
  ice: {
    clickBreak: { clicks: 2, max: 2 },
    subroutines: [
      {
        label: 'Trash 1 installed Runner card.',
        resolve: ctx => {
          const cards = installedRunnerCards(ctx.state);
          if (cards.length > 0) askCards(ctx, 'corp', 'Ansel 2.0: trash 1 installed Runner card.', ids(cards), 1, 1, 'trash');
        },
      },
      {
        label: 'Remove 1 card in the heap from the game.',
        resolve: ctx => {
          const heap = ctx.state.runner.heap;
          if (heap.length > 0) askCards(ctx, 'corp', 'Ansel 2.0: remove 1 card in the heap from the game.', ids(heap), 1, 1, 'heap');
        },
      },
      {
        label: 'You may install 1 card from HQ or Archives.',
        resolve: ctx => {
          const cards = anselInstallable(ctx.state);
          if (cards.length > 0) askCards(ctx, 'corp', 'Ansel 2.0: you may install 1 card from HQ or Archives.', ids(cards), 0, 1, 'install');
        },
      },
      endTheRunSub,
    ],
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'trash' && answer.kind === 'effect_cards') {
      const card = installedRunnerCards(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!card) return;
      trashInstalledRunnerCard(state, card);
      addLog(state, 'corp', `Corp trashed ${title(card)} (Ansel 2.0).`);
    } else if (source.step === 'heap' && answer.kind === 'effect_cards') {
      const card = state.runner.heap.find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!card) return;
      removeCard(state.runner.heap, card);
      state.removedFromGame.push(card);
      addLog(state, 'corp', `Corp removed ${title(card)} in the heap from the game (Ansel 2.0).`);
    } else if (source.step === 'install' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      askCorpInstall(ctx, answer.cardInstanceIds[0], 'server');
    } else if (source.step === 'server') {
      installCorpChoice(state, source, answer);
    }
  },
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
export const sleipnir: CardScript = {
  ice: {
    subroutines: [
      {
        label: 'You may draw 1 card.',
        resolve: ctx =>
          askChoice(ctx, 'corp', 'Sleipnir: draw 1 card?', [
            { id: 'draw', label: 'Draw 1 card' },
            { id: 'no', label: 'No' },
          ], 'draw'),
      },
      {
        label: 'You may shuffle 1 card from HQ or Archives into R&D.',
        resolve: ctx => {
          const cards = [...ctx.state.corp.hq, ...archivesCards(ctx.state)];
          if (cards.length > 0) askCards(ctx, 'corp', 'Sleipnir: you may shuffle 1 card from HQ or Archives into R&D.', ids(cards), 0, 1, 'shuffle');
        },
      },
      endTheRunSub,
    ],
  },
  onPromptAnswer: ({ state }, source, answer) => {
    if (source.step === 'draw' && answer.kind === 'effect_choice' && answer.optionId === 'draw') {
      drawForEffect(state, 'corp', 1, 'Sleipnir');
    } else if (source.step === 'shuffle' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      const card = [...state.corp.hq, ...archivesCards(state)].find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!card) return;
      const visible = state.corp.archives.faceUp.includes(card);
      takeFromCorpZone(state, card);
      state.corp.rd.push(card);
      shuffleRD(state);
      addLog(state, 'corp', `Corp shuffled ${visible ? title(card) : 'a card'} into R&D (Sleipnir).`);
    }
  },
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
export const ezam: CardScript = {
  abilities: [
    {
      label: 'Swap this ice with another installed piece of ice.',
      clicks: 1,
      canUse: ({ state, card }) => (installedIce(state).some(c => c.instanceId !== card.instanceId) ? null : 'No other installed ice'),
      resolve: ctx =>
        askCards(ctx, 'corp', 'ezaM: swap it with which piece of ice?', ids(installedIce(ctx.state).filter(c => c.instanceId !== ctx.card.instanceId)), 1, 1, 'swap'),
    },
  ],
  ice: {
    subroutines: [
      {
        label: 'Look at the top card of R&D. You may add that card to the bottom of R&D.',
        resolve: ctx => {
          const top = ctx.state.corp.rd[0];
          if (!top) return;
          askChoice(ctx, 'corp', `ezaM: the top card of R&D is ${title(top)}. Add it to the bottom of R&D?`, [
            { id: 'bottom', label: 'Bottom of R&D' },
            { id: 'leave', label: 'Leave it on top' },
          ], 'top');
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
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (source.step === 'swap' && answer.kind === 'effect_cards') {
      swapIce(state, card.instanceId, answer.cardInstanceIds[0]);
    } else if (source.step === 'top' && answer.kind === 'effect_choice' && answer.optionId === 'bottom') {
      const top = state.corp.rd.shift();
      if (top) state.corp.rd.push(top);
      addLog(state, 'corp', 'Corp added the top card of R&D to the bottom (ezaM).');
    }
  },
};

// Knowledge Seeker (Code Gate): Whenever an encounter with this ice ends, if it has 3 or more
// hosted virus counters, purge virus counters and derez this ice. Subroutines: Place 1 virus
// counter on this ice. Look at the top 4 cards of R&D and arrange them in any order. End the run.
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
        resolve: ctx => arrangeTop(ctx, ids(ctx.state.corp.rd.slice(0, 4)), 'arrange'),
      },
      endTheRunSub,
    ],
  },
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'arrange' && answer.kind === 'effect_cards') arrangeNext(ctx, source.data, answer.cardInstanceIds[0], 'arrange');
  },
};

// Lionsmane (Sentry - AP): Subroutines: Do 2 net damage. Do 2 net damage unless the Runner pays
// 3 credits. Do 2 net damage unless the Runner jacks out.
export const lionsmane: CardScript = {
  ice: {
    subroutines: [
      { label: 'Do 2 net damage.', resolve: ({ state }) => void dealNetDamage(state, 2) },
      {
        label: 'Do 2 net damage unless the Runner pays 3 [credit].',
        resolve: ctx => unlessPays(ctx, 3, 'take 2 net damage', 'pay', () => dealNetDamage(ctx.state, 2)),
      },
      {
        label: 'Do 2 net damage unless the Runner jacks out.',
        resolve: ctx =>
          askChoice(ctx, 'runner', 'Lionsmane: jack out, or take 2 net damage?', [
            { id: 'jack', label: 'Jack out' },
            { id: 'damage', label: 'Take 2 net damage' },
          ], 'jack'),
      },
    ],
  },
  onPromptAnswer: ({ state }, source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (source.step === 'pay') {
      answerUnlessPays(state, 3, answer.optionId, () => dealNetDamage(state, 2));
    } else if (source.step === 'jack') {
      if (answer.optionId === 'jack' && state.activeRun) {
        state.activeRun.isJackedOut = true;
        addLog(state, 'runner', 'Runner jacked out.');
        endRun(state);
      } else {
        dealNetDamage(state, 2);
      }
    }
  },
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
const grubberSub = (i: number): Subroutine => ({
  label: 'End the run unless the Runner pays 3 [credit].',
  resolve: ctx => unlessPays(ctx, 3, 'end the run', `pay${i}`, () => endTheRun(ctx.state)),
});

export const grubber: CardScript = {
  triggers: {
    rezzed: (ctx, e) => {
      if (!isSelf(ctx, e.card)) return;
      const server = serverOf(ctx.state, ctx.card);
      if (server && isCentral(server.id)) takeBadPublicity(ctx.state, 1);
    },
  },
  ice: { subroutines: [grubberSub(0), grubberSub(1)] },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind === 'effect_choice') answerUnlessPays(state, 3, answer.optionId, () => endTheRun(state));
  },
};

// Lethe (Sentry - Observer): Whenever the Runner bypasses or fully breaks this ice, give them
// 1 tag. Subroutines: You may add 1 card from Archives to the top or bottom of R&D. Add 1
// installed Runner card to the grip.
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
          if (cards.length > 0) askCards(ctx, 'corp', 'Lethe: you may add 1 card from Archives to R&D.', ids(cards), 0, 1, 'archives');
        },
      },
      {
        label: 'Add 1 installed Runner card to the grip.',
        resolve: ctx => {
          const cards = installedRunnerCards(ctx.state);
          if (cards.length > 0) askCards(ctx, 'corp', 'Lethe: add 1 installed Runner card to the grip.', ids(cards), 1, 1, 'grip');
        },
      },
    ],
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'archives' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      askChoice(ctx, 'corp', 'Lethe: top or bottom of R&D?', [
        { id: 'top', label: 'Top of R&D' },
        { id: 'bottom', label: 'Bottom of R&D' },
      ], 'where', { cardId: answer.cardInstanceIds[0] });
    } else if (source.step === 'where' && answer.kind === 'effect_choice') {
      const card = archivesCards(state).find(c => c.instanceId === source.data?.cardId);
      if (!card) return;
      const visible = state.corp.archives.faceUp.includes(card);
      takeFromCorpZone(state, card);
      if (answer.optionId === 'top') state.corp.rd.unshift(card);
      else state.corp.rd.push(card);
      addLog(state, 'corp', `Corp added ${visible ? title(card) : 'a card'} from Archives to the ${answer.optionId} of R&D (Lethe).`);
    } else if (source.step === 'grip' && answer.kind === 'effect_cards') {
      const card = installedRunnerCards(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!card) return;
      uninstallRunnerCard(state, card, 'grip');
      addLog(state, 'corp', `${title(card)} was added to the grip (Lethe).`);
    }
  },
};

// Paywall (Barrier): When the Runner encounters this ice, they lose 1 credit. Subroutine: End
// the run unless the Runner pays 1 credit.
export const paywall: CardScript = {
  ice: {
    onEncounter: ({ state }) => {
      const lost = loseCredits(state, 'runner', 1);
      if (lost > 0) addLog(state, 'corp', 'Paywall: the Runner lost 1 [credit].');
    },
    subroutines: [
      {
        label: 'End the run unless the Runner pays 1 [credit].',
        resolve: ctx => unlessPays(ctx, 1, 'end the run', 'pay', () => endTheRun(ctx.state)),
      },
    ],
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind === 'effect_choice') answerUnlessPays(state, 1, answer.optionId, () => endTheRun(state));
  },
};

// Event Horizon (Sentry - Destroyer): trash: End the run. Use this ability only during a run
// against this server. Subroutines: Trash 1 installed program unless the Runner pays 3
// credits. End the run unless the Runner pays 3 credits.
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
          unlessPays(ctx, 3, 'the Corp trashes 1 program', 'program', () => askProgramTrash(ctx));
        },
      },
      {
        label: 'End the run unless the Runner pays 3 [credit].',
        resolve: ctx => unlessPays(ctx, 3, 'end the run', 'etr', () => endTheRun(ctx.state)),
      },
    ],
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'program' && answer.kind === 'effect_choice') {
      answerUnlessPays(state, 3, answer.optionId, () => askProgramTrash(ctx));
    } else if (source.step === 'etr' && answer.kind === 'effect_choice') {
      answerUnlessPays(state, 3, answer.optionId, () => endTheRun(state));
    } else if (source.step === 'trash' && answer.kind === 'effect_cards') {
      const program = state.runner.rig.programs.find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!program) return;
      trashInstalledRunnerCard(state, program);
      addLog(state, 'corp', `Corp trashed ${title(program)} (Event Horizon).`);
    }
  },
};

function askProgramTrash(ctx: EffectContext): void {
  const programs = ctx.state.runner.rig.programs;
  if (programs.length > 0) askCards(ctx, 'corp', `${title(ctx.card)}: trash 1 installed program.`, ids(programs), 1, 1, 'trash');
}

// Flywheel (Sentry): Subroutines (twice): Gain 1 credit. You may draw 1 card.
const flywheelSub: Subroutine = {
  label: 'Gain 1 [credit]. You may draw 1 card.',
  resolve: ctx => {
    gainFromCard(ctx.state, 'corp', 1, ctx.card);
    askChoice(ctx, 'corp', 'Flywheel: draw 1 card?', [
      { id: 'draw', label: 'Draw 1 card' },
      { id: 'no', label: 'No' },
    ], 'draw');
  },
};

export const flywheel: CardScript = {
  ice: { subroutines: [flywheelSub, flywheelSub] },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind === 'effect_choice' && answer.optionId === 'draw') drawForEffect(state, 'corp', 1, 'Flywheel');
  },
};

// Tocsin (Code Gate - Expendable): click, 1 credit, reveal and trash this ice from HQ: Search
// R&D for up to 1 barrier and up to 1 sentry and reveal them. Add those cards to HQ.
// Subroutines: The Runner loses 2 credits. End the run. End the run.
const iceOfType = (state: GameState, subtype: string) =>
  state.corp.rd.filter(c => type(c) === 'ice' && new RegExp(`\\b${subtype}\\b`, 'i').test(keywords(c)));

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
        askCards(ctx, 'corp', 'Tocsin: search R&D for up to 1 barrier.', ids(iceOfType(state, 'barrier')), 0, 1, 'barrier');
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
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (answer.kind !== 'effect_cards') return;
    for (const id of answer.cardInstanceIds) {
      const found = state.corp.rd.find(c => c.instanceId === id);
      if (!found) continue;
      removeCard(state.corp.rd, found);
      state.corp.hq.push(found);
      revealInHand(state, 'corp', [found]);
      addLog(state, 'corp', `Corp revealed ${title(found)} and added it to HQ (Tocsin).`);
    }
    if (source.step === 'barrier') {
      askCards(ctx, 'corp', 'Tocsin: search R&D for up to 1 sentry.', ids(iceOfType(state, 'sentry')), 0, 1, 'sentry');
    } else {
      shuffleRD(state);
    }
  },
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
