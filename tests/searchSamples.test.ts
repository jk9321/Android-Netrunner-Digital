import { afterEach, describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, createInitialGameState, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from '../scripts/nsg-sample-decks';
import { GameRunner, createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';
import { REPLY } from '../src/ai/runnerReply';
import { plannerStats } from '../src/ai/turnPlanner';
import fixture from './fixtures/search-hold-no-window.json';

/**
 * The positions plan.searchLines (spec-search S2) was pinned on, after step 2 deleted it (spec-step2-delete-redundant.md:
 * off -0.3 ± 1.0 at games=3, run 42875007030). Its held line decided the question counted scoring (plan.scoreInTwo) now
 * answers: hold the agenda in HQ and build its remote, or install it. Deal 1491 T1 keeps the move through the count.
 * Deal 1031 T9 (Brân 1.0 on a new remote for an agenda in HQ) is lost: the count sees no two-turn score there (the new
 * ice can't be rezzed with the 4 credits a score would leave), so it is listed in the step 2 report as a candidate input.
 * Plus plan.searchSamples (S3, parked OFF), which re-samples close candidate lines.
 */
const SEED = 1491;

function turnOne(): GameState {
  const corp = ALL_DECKS.filter(d => d.side === 'corp');
  const runner = ALL_DECKS.filter(d => d.side === 'runner');
  const pairing = (SEED - 1001) / 10;
  const gr = new GameRunner(createInitialGameState(deckGameSetup(SEED, corp[Math.floor(pairing / runner.length)], runner[pairing % runner.length])), { corp: createAgent('corp'), runner: createAgent('runner') });
  for (let i = 0; i < 50; i++) {
    const s = gr.state;
    if (s.activePlayer === 'corp' && s.turnNumber === 1 && s.corp.clicks === 3 && !s.activeRun && s.pendingPrompts.length === 0 && !(s.priority && s.priority.holder !== 'corp') && s.turnStep?.kind !== 'corp_turn_start') return structuredClone(s);
    gr.step();
  }
  throw new Error('Corp turn 1 not reached');
}

const describeAction = (s: GameState, a: GameAction) => {
  const card = 'cardInstanceId' in a && a.cardInstanceId ? findCardAnywhere(s, a.cardInstanceId) : undefined;
  const where = 'asNewRemote' in a && a.asNewRemote ? ' @new remote' : 'targetServerId' in a && a.targetServerId ? ' @' + a.targetServerId : '';
  return `${a.type}${card ? ' ' + cardDef(card).type_code : ''}${where}`;
};

const saved = { samples: tuning.plan.searchSamples, now: tuning.plan.scoreNow, two: tuning.plan.scoreInTwo };
afterEach(() => {
  tuning.plan.searchSamples = saved.samples;
  tuning.plan.scoreNow = saved.now;
  tuning.plan.scoreInTwo = saved.two;
});

/** The planner's own pick: counted scoring sits above it and is off here. */
const plannerPick = (s: GameState) => {
  tuning.plan.scoreNow = false;
  tuning.plan.scoreInTwo = false;
  return createAgent('corp').chooseAction(structuredClone(s));
};

describe('the held-line positions after plan.searchLines (step 2), and plan.searchSamples', () => {
  it('searchSamples is parked off', () => expect(saved.samples).toBe(false));

  it('deal 1491 turn 1: the Corp ices a new remote for the agenda in HQ (counted scoring begins its two-turn line)', () => {
    const s = turnOne();
    expect(s.corp.hq.some(c => cardDef(c).type_code === 'agenda')).toBe(true);
    expect(describeAction(s, createAgent('corp').chooseAction(structuredClone(s)))).toBe('INSTALL_CARD ice @new remote');
  }, 60000);

  it('searchSamples at deal 1491 T1: on a close call both lines get the extra samples and the pick is the better mean', () => {
    const calls: Parameters<NonNullable<typeof plannerStats.onClose>>[] = [];
    plannerStats.onClose = (top, chosen) => calls.push([top, chosen]);
    try {
      tuning.plan.searchSamples = true;
      const s = turnOne();
      const chosen = plannerPick(s);
      for (const [top, picked] of calls) {
        expect(top.length).toBe(2);
        for (const t of top) expect(t.samples).toBe(2 + REPLY.extra);
        expect(picked).toBe(top.reduce((a, b) => (b.value > a.value ? b : a)).action);
      }
      if (calls.length) expect(chosen).toEqual(calls[calls.length - 1][1]);
    } finally {
      plannerStats.onClose = undefined;
    }
  }, 60000);

  it('searchSamples on top does not flip the pick at deal 1491 T2', () => {
    const s = fixture.state as unknown as GameState;
    tuning.plan.searchSamples = false;
    const plain = JSON.stringify(plannerPick(s));
    tuning.plan.searchSamples = true;
    expect(JSON.stringify(plannerPick(s))).toBe(plain);
  }, 120000);
});
