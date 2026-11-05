import { describe, expect, it } from 'vitest';
import { createCardInstance, GameState } from '../src/core';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { runEventOptions } from '../src/ai/prompts';
import { runRestWorth, runScore } from '../src/ai/runs';
import { tuning } from '../src/ai/synergy';
import { giveCard, installIceForTest, newGame, startRunnerTurn } from './helpers';

/**
 * Run pricing (Jeff, 2026-11-05, thread "Find why AI card valuation misses cards"). The card-usage
 * report showed run events held on most turns they could be played: the whole-turn planner ended a
 * playout at the run a card starts, so the card's cost counted and its run never did, and a plain
 * run always looked better.
 */
const TAILGATE = '36012';
const JAILBREAK = '30028';
const CLEAN_GETAWAY = '35014';
const RED_TEAM = '30018';
const PALISADE = '30072';
const AGENDA = '30067';

function openHq(credits = 6): GameState {
  const s = newGame();
  startRunnerTurn(s);
  s.runner.credits = credits;
  s.corp.hq = Array.from({ length: 5 }, () => createCardInstance(s, AGENDA)); // 5 cards it can't see
  s.runner.grip = [];
  for (const filler of ['30013', '30034', '30022']) giveCard(s, 'runner', filler); // a normal grip
  return s;
}

const withPlan = <T>(key: string, on: boolean, f: () => T): T => {
  const plan = tuning.plan as Record<string, unknown>;
  const was = plan[key];
  plan[key] = on;
  try {
    return f();
  } finally {
    plan[key] = was;
  }
};

describe('run pricing', () => {
  for (const [name, code] of [['Tailgate', TAILGATE], ['Jailbreak', JAILBREAK], ['Clean Getaway', CLEAN_GETAWAY]] as const) {
    it(`the planner runs HQ with ${name} instead of a plain run (plan.plannerRunEvents)`, () => {
      const s = openHq();
      const id = giveCard(s, 'runner', code);
      const action = new HeuristicRunnerAI({ planner: true }).chooseAction(s);
      expect('cardInstanceId' in action && action.cardInstanceId).toBe(id);
    });
  }

  it('without plannerRunEvents the planner made the plain run (what the test guards)', () => {
    const s = openHq();
    giveCard(s, 'runner', TAILGATE);
    const action = withPlan('plannerRunEvents', false, () => new HeuristicRunnerAI({ planner: true }).chooseAction(s));
    expect(action.type).toBe('INITIATE_RUN');
  });

  it("Clean Getaway's 6 credits are worth more to a broke Runner than a rich one (plan.runCreditsSlide)", () => {
    const rider = (credits: number) => {
      const s = openHq(credits);
      return runScore(s, 'hq', runEventOptions(CLEAN_GETAWAY, s)) - runScore(s, 'hq');
    };
    expect(rider(2)).toBeGreaterThan(rider(25));
    expect(rider(2)).toBeGreaterThan(6);
  });

  it("Red Team's run takes 3 of its credits (rules: \"If successful, take 3 credits from this resource\")", () => {
    const s = openHq(2);
    const card = createCardInstance(s, RED_TEAM);
    card.tokens.credit = 12;
    s.runner.rig.resources.push(card);
    expect(runScore(s, 'hq', runEventOptions(RED_TEAM, s))).toBeGreaterThan(runScore(s, 'hq'));
  });

  it('a run in progress is worth its breach less the ice still ahead, nothing once that ice stops it (plan.runRest)', () => {
    const s = openHq();
    installIceForTest(s, PALISADE, 'hq'); // no breaker: it ends the run
    s.activeRun = { server: 'hq', phase: 'movement', icePosition: 1, isSuccessful: false, isJackedOut: false, cannotJackOut: false, accessQueue: [], encounter: null } as unknown as GameState['activeRun'];
    expect(runRestWorth(s)).toBe(0); // the Palisade at position 0 is still ahead
    s.activeRun!.icePosition = 0;
    s.activeRun!.phase = 'movement'; // past it now
    expect(runRestWorth(s)).toBeGreaterThan(0);
  });
});
