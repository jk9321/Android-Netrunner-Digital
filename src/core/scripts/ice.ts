import { GameState } from '../types/state';
import { cardDef } from '../cards';
import { addLog } from '../engine/log';
import { dealDamage, dealNetDamage, giveTags, registerDamageFollowUp, installedRunnerCards, trashInstalledRunnerCard } from '../engine/damage';
import { endRun, endTheRun } from '../engine/runEnd';
import { availableCredits, spendCredits } from '../engine/cardEffects';
import { iceInsertedAt, runnerSawBeforeInstall } from '../engine/helpers';
import { CardScript, Subroutine } from './types';
import { installCorpChoice } from './effects';
import { cards, cardsQuestion, choice, choiceQuestion, InstallData, prompts } from './steps';

/** Ice from System Gateway. */

const endTheRunSub: Subroutine = { label: 'End the run.', resolve: ({ state }) => endTheRun(state) };

const giveTagSub: Subroutine = { label: 'Give the Runner 1 tag.', resolve: ({ state }) => giveTags(state, 1) };

const netDamageSub = (amount: number): Subroutine => ({
  label: `Do ${amount} net damage.`,
  resolve: ({ state }) => {
    dealNetDamage(state, amount);
  },
});

/** Cards the Corp can install from HQ or Archives (all but operations). */
function installableFromHqOrArchives(state: GameState, onlyIce: boolean): string[] {
  const { hq, archives } = state.corp;
  return [...hq, ...archives.faceUp, ...archives.faceDown]
    .filter(c => (onlyIce ? cardDef(c).type_code === 'ice' : cardDef(c).type_code !== 'operation'))
    .map(c => c.instanceId);
}

function zoneOf(state: GameState, instanceId: string) {
  const { hq, archives } = state.corp;
  return [hq, archives.faceUp, archives.faceDown].find(z => z.some(c => c.instanceId === instanceId))!;
}

// Palisade (Barrier): While this ice is protecting a remote server, it gets +2 strength.
// Subroutine: End the run.
const palisade: CardScript = {
  ice: {
    subroutines: [endTheRunSub],
    strengthModifier: (state, ice) =>
      Object.values(state.corp.servers).some(s => s.isRemote && s.ice.some(c => c.instanceId === ice.instanceId)) ? 2 : 0,
  },
};

// Ping (Barrier): When you rez this ice during a run against this server, give the Runner 1 tag.
// Subroutine: End the run.
const ping: CardScript = {
  ice: {
    subroutines: [endTheRunSub],
    onRezDuringRunOnServer: ({ state }) => giveTags(state, 1),
  },
};

// Pharos (Barrier): You can advance this ice. It gets +5 strength while there are 3 or more
// hosted advancement counters. Subroutines: Give the Runner 1 tag. End the run. End the run.
const pharos: CardScript = {
  ice: {
    subroutines: [giveTagSub, endTheRunSub, endTheRunSub],
    strengthModifier: (_state, ice) => (ice.advancementCounters >= 3 ? 5 : 0),
  },
};

// Whitespace (Code Gate): Subroutine: The Runner loses 3 credits.
// Subroutine: If the Runner has 6 credits or less, end the run.
const whitespace: CardScript = {
  ice: {
    subroutines: [
      {
        label: 'The Runner loses 3 credits.',
        resolve: ({ state }) => {
          state.runner.credits = Math.max(0, state.runner.credits - 3);
        },
      },
      {
        label: 'If the Runner has 6 credits or less, end the run.',
        resolve: ({ state }) => {
          if (state.runner.credits <= 6) endTheRun(state);
        },
      },
    ],
  },
};

// Tithe (Sentry - AP): Subroutine: Do 1 net damage. Subroutine: Gain 1 credit.
const tithe: CardScript = {
  ice: {
    subroutines: [
      netDamageSub(1),
      {
        label: 'Gain 1 credit.',
        resolve: ({ state }) => {
          state.corp.credits += 1;
        },
      },
    ],
  },
};

// Diviner (Code Gate - AP): Subroutine: Do 1 net damage. If you trash a card this way with a
// printed play or install cost that is an odd number, end the run. (0 is not odd.)
registerDamageFollowUp('diviner', (state, [trashed]) => {
  if (trashed && (cardDef(trashed).cost ?? 0) % 2 === 1) endTheRun(state);
});
const diviner: CardScript = {
  ice: {
    subroutines: [
      {
        label: 'Do 1 net damage. If the trashed card has an odd cost, end the run.',
        resolve: ({ state }) => {
          dealDamage(state, 'net', 1, true, { then: 'diviner' });
        },
      },
    ],
  },
};

// Karunā (Sentry - AP): Subroutine: Do 2 net damage. The Runner may jack out.
// Subroutine: Do 2 net damage.
const karunaFlow = prompts({
  jack_out: choice(({ state }, a) => {
    if (a.optionId === 'jack') {
      addLog(state, 'runner', 'Runner jacked out.');
      endRun(state);
    }
  }),
});

const karuna: CardScript = {
  ice: {
    subroutines: [
      {
        label: 'Do 2 net damage. The Runner may jack out.',
        resolve: ctx => {
          dealNetDamage(ctx.state, 2);
          if (ctx.state.winner) return;
          karunaFlow.choice(ctx, 'jack_out', choiceQuestion('runner', 'Karunā: jack out?', [
            { id: 'jack', label: 'Jack out' },
            { id: 'stay', label: 'Continue the run' },
          ]));
        },
      },
      netDamageSub(2),
    ],
  },
  ...karunaFlow.script,
};

// Funhouse (Code Gate): When the Runner encounters this ice, end the run unless the Runner
// takes 1 tag. Subroutine: Give the Runner 1 tag unless they pay 4 credits.
/** Funhouse's answers: the tag, the payment, or (only on encounter) the end of the run. */
const funhouseAnswer = (onEncounter: boolean) =>
  choice(({ state }, a) => {
    if (a.optionId === 'tag') giveTags(state, 1);
    else if (a.optionId === 'pay') spendCredits(state, 'runner', 4);
    else if (a.optionId === 'end' && onEncounter) endTheRun(state);
  });
const funhouseFlow = prompts({ encounter: funhouseAnswer(true), sub: funhouseAnswer(false) });

const funhouse: CardScript = {
  ice: {
    onEncounter: ctx =>
      funhouseFlow.choice(ctx, 'encounter', choiceQuestion('runner', 'Funhouse: take 1 tag, or the run ends.', [
        { id: 'tag', label: 'Take 1 tag' },
        { id: 'end', label: 'End the run' },
      ])),
    subroutines: [
      {
        label: 'Give the Runner 1 tag unless they pay 4 credits.',
        resolve: ctx => {
          if (availableCredits(ctx.state, 'runner') < 4) {
            giveTags(ctx.state, 1);
            return;
          }
          funhouseFlow.choice(ctx, 'sub', choiceQuestion('runner', 'Funhouse: pay 4 credits or take 1 tag?', [
            { id: 'pay', label: 'Pay 4 credits' },
            { id: 'tag', label: 'Take 1 tag' },
          ]));
        },
      },
    ],
  },
  ...funhouseFlow.script,
};

// Ballista (Sentry - Destroyer): Subroutine: Trash 1 installed program or end the run.
const ballistaFlow = prompts({
  choose: choice(({ state }, a) => {
    if (a.optionId === 'end') {
      endTheRun(state);
      return;
    }
    const program = state.runner.rig.programs.find(p => p.instanceId === a.optionId);
    if (program) {
      trashInstalledRunnerCard(state, program);
      addLog(state, 'corp', `Ballista trashed ${cardDef(program).title}.`);
    }
  }),
});

const ballista: CardScript = {
  ice: {
    subroutines: [
      {
        label: 'Trash 1 installed program or end the run.',
        resolve: ctx => {
          const programs = ctx.state.runner.rig.programs;
          if (programs.length === 0) {
            endTheRun(ctx.state);
            return;
          }
          ballistaFlow.choice(ctx, 'choose', choiceQuestion('corp', 'Ballista: trash a program or end the run?', [
            ...programs.map(p => ({ id: p.instanceId, label: `Trash ${cardDef(p).title}` })),
            { id: 'end', label: 'End the run' },
          ]));
        },
      },
    ],
  },
  ...ballistaFlow.script,
};

// Ansel 1.0 (Sentry - Bioroid - Destroyer): [Lose click]: Break 1 subroutine on this ice.
// Subroutine: Trash 1 installed Runner card.
// Subroutine: You may install 1 card from HQ or Archives.
// Subroutine: The Runner cannot steal or trash Corp cards for the remainder of this run.
const anselFlow = prompts({
  trash: cards(({ state }, a) => {
    const card = installedRunnerCards(state).find(c => c.instanceId === a.ids[0]);
    if (card) {
      trashInstalledRunnerCard(state, card);
      addLog(state, 'corp', `Ansel 1.0 trashed ${cardDef(card).title}.`);
    }
  }),
  pick_install: cards((ctx, a) => {
    if (a.ids.length === 1) anselFlow.corpInstall(ctx, a.ids[0], 'server');
  }),
  server: choice<InstallData>((ctx, a, _d, source) => void installCorpChoice(ctx.state, source, a.raw)),
});

const ansel: CardScript = {
  ice: {
    subroutines: [
      {
        label: 'Trash 1 installed Runner card.',
        resolve: ctx => {
          const targets = installedRunnerCards(ctx.state).map(c => c.instanceId);
          if (targets.length > 0) anselFlow.cards(ctx, 'trash', cardsQuestion('corp', 'Ansel 1.0: trash 1 installed Runner card.', targets, 1, 1));
        },
      },
      {
        label: 'You may install 1 card from HQ or Archives.',
        resolve: ctx => {
          const options = installableFromHqOrArchives(ctx.state, false);
          if (options.length > 0) {
            anselFlow.cards(ctx, 'pick_install', cardsQuestion('corp', 'Ansel 1.0: you may install 1 card from HQ or Archives.', options, 0, 1));
          }
        },
      },
      {
        label: 'The Runner cannot steal or trash Corp cards for the remainder of this run.',
        resolve: ({ state }) => {
          if (state.activeRun) state.activeRun.cannotStealOrTrash = true;
        },
      },
    ],
  },
  ...anselFlow.script,
};

// Brân 1.0 (Barrier - Bioroid): [Lose click]: Break 1 subroutine on this ice.
// Subroutine: You may install 1 piece of ice from HQ or Archives directly inward from this ice,
// ignoring all costs. Subroutine: End the run. Subroutine: End the run.
const branFlow = prompts({
  install: cards(({ state, card: bran }, a) => {
    if (a.ids.length === 0) return;
    const server = Object.values(state.corp.servers).find(s => s.ice.some(c => c.instanceId === bran.instanceId));
    if (!server) return;
    const id = a.ids[0];
    const zone = zoneOf(state, id);
    const ice = zone.find(c => c.instanceId === id)!;
    if (runnerSawBeforeInstall(state, ice, zone)) ice.runnerKnows = true;
    else delete ice.runnerKnows;
    zone.splice(zone.indexOf(ice), 1);
    ice.isRezzed = false;
    // Index 0 is innermost: "directly inward" takes Brân's current index.
    const branIndex = server.ice.findIndex(c => c.instanceId === bran.instanceId);
    server.ice.splice(branIndex, 0, ice);
    iceInsertedAt(state, server, branIndex); // the Runner is still at Brân, now one position further out

    addLog(state, 'corp', `Corp installed a piece of ice inward from Brân 1.0 in ${server.name}.`, undefined, 'install');
  }),
});

const bran: CardScript = {
  ice: {
    subroutines: [
      {
        label: 'You may install 1 piece of ice from HQ or Archives directly inward from this ice, ignoring all costs.',
        resolve: ctx => {
          const options = installableFromHqOrArchives(ctx.state, true);
          if (options.length > 0) {
            branFlow.cards(ctx, 'install', cardsQuestion('corp', 'Brân 1.0: you may install 1 ice inward from this ice, ignoring all costs.', options, 0, 1));
          }
        },
      },
      endTheRunSub,
      endTheRunSub,
    ],
  },
  ...branFlow.script,
};

export const iceScripts: Record<string, CardScript> = {
  '30038': ansel,
  '30039': bran,
  '30046': diviner,
  '30047': karuna,
  '30054': funhouse,
  '30055': ping,
  '30062': ballista,
  '30063': pharos,
  '30072': palisade,
  '30073': tithe,
  '30074': whitespace,
};
