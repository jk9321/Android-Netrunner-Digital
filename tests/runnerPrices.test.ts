/**
 * Runner AI price fixes (branch ai-runner-fixes; Runner audit 2026-11-14, /mnt/project-files/audits/2026-11-14-ai-runner/,
 * findings merged with Gemini's): each pin is one of report.md's guards or one of the merged report's bugs.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CardInstance, GameAction, GameState, activePrompt, createCardInstance, executeAction } from '../src/core';
import { createAgent } from '../src/ai';
import { BLOCK, bestBreakPlan, breachAccesses, icePrice, runRestWorth, runScore, serverValue, subroutineCost } from '../src/ai/runs';
import { damageWorth } from '../src/ai/effectValues';
import { scoreOutcome } from '../src/ai/prompts';
import { asSide } from '../src/ai/synergy';
import { installIceForTest, installProgramForTest, newGame, startRunnerTurn } from './helpers';

const TITHE = '30073';
const REGOLITH = '30071';
const DEVADATTA = '35031';

function bareRemote(state: GameState, card: CardInstance): void {
  state.corp.servers['remote-1'] = { id: 'remote-1', name: 'Server 1', isRemote: true, ice: [], root: [card] };
}

describe('R2 damage (rules 10.4.4, 5.2.7c)', () => {
  it('damage equal to the grip is survived; one more is a flatline (10.4.4: "more damage than the number of cards in their grip")', () => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.grip = s.runner.grip.slice(0, 2);
    expect(subroutineCost(s, 'Do 2 net damage.')).toBeLessThan(BLOCK);
    expect(subroutineCost(s, 'Do 3 net damage.')).toBe(BLOCK);
    expect(subroutineCost(s, 'End the run unless the Runner suffers 2 net damage.')).toBeLessThan(BLOCK);
  });
  it('in-run damage on the Runner\'s turn is read with the clicks left to draw back: a card, not a step toward a flatline', () => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.grip = s.runner.grip.slice(0, 5);
    const withClicks = damageWorth(s, 1);
    // No clicks left after the run: no draw-back, the flatline step counts again
    const spent = structuredClone(s);
    spent.runner.clicks = 1;
    expect(withClicks).toBeLessThan(damageWorth(spent, 1));
  });
  it('a 6-card HQ behind a rezzed Tithe is worth running at ordinary credits (the audit probe: -Infinity at 0-5 credits)', () => {
    for (const credits of [0, 3, 5]) {
      const s = newGame();
      startRunnerTurn(s);
      installIceForTest(s, TITHE, 'hq');
      while (s.corp.hq.length < 6 && s.corp.rd.length) s.corp.hq.push(s.corp.rd.shift()!);
      s.runner.credits = credits;
      expect(runScore(s, 'hq')).toBeGreaterThan(-Infinity);
    }
  });
});

describe('R1 credits apart from value (RUNNER-BUDGET-UNITS)', () => {
  it('a tanked subroutine costs no credits: a broke Runner can still run through it', () => {
    const s = newGame();
    startRunnerTurn(s);
    installIceForTest(s, TITHE, 'hq');
    s.runner.credits = 0;
    const price = icePrice(s, s.corp.servers.hq.ice[0]);
    expect(price.credits).toBe(0);
    expect(price.value).toBeGreaterThan(0);
  });
  it("a bioroid's click-break is priced only with the clicks left to pay it (rule 1.16.1: a cost that can't be paid in full can't be used)", () => {
    const priceAt = (clicks: number) => {
      const s = newGame();
      startRunnerTurn(s);
      s.runner.rig.programs = [];
      const bran = createCardInstance(s, '30039'); // Brân 1.0: Barrier - Bioroid, 3 subroutines, a click each to break
      bran.isRezzed = true;
      s.corp.servers.hq.ice = [bran];
      s.runner.clicks = clicks;
      return icePrice(s, bran);
    };
    // 4 clicks: the run's own click and 3 to break
    expect(priceAt(4)).toEqual({ credits: 0, value: 4.5 });
    // 3 clicks: after the run's click only 2 are left for 3 subroutines, and no breaker: no way past
    expect(priceAt(3).credits + priceAt(3).value).toBe(BLOCK);
  });
});

describe('R3 bare economy assets (RUNNER-ASSET-TRASH)', () => {
  it('a fresh Regolith (15 credits) alone on a remote is worth running and trashing when the Runner can pay', () => {
    for (const credits of [3, 5, 10]) {
      const s = newGame();
      startRunnerTurn(s);
      s.runner.credits = credits;
      const c = createCardInstance(s, REGOLITH);
      c.isRezzed = true;
      c.tokens = { credit: 15 };
      bareRemote(s, c);
      expect(serverValue(s, 'remote-1')).toBeGreaterThan(0.5);
      expect(runScore(s, 'remote-1')).toBeGreaterThan(0);
    }
  });
  it('a Regolith with 15 credits left is worth more to trash than one with 6', () => {
    const at = (load: number) => {
      const s = newGame();
      startRunnerTurn(s);
      s.runner.credits = 10;
      const c = createCardInstance(s, REGOLITH);
      c.isRezzed = true;
      c.tokens = { credit: load };
      bareRemote(s, c);
      return serverValue(s, 'remote-1');
    };
    expect(at(15)).toBeGreaterThan(at(6));
  });
});

describe('R4 breach-time extra accesses (RUNNER-BREACH-EXTRA-ACCESS; rules 7.3.5b, 7.4.7)', () => {
  it('a charged Devadatta Drone moves runScore on R&D and nowhere else', () => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.credits = 5;
    const before = { rd: runScore(s, 'rd'), hq: runScore(s, 'hq') };
    installProgramForTest(s, DEVADATTA);
    const drone = s.runner.rig.programs.find(p => p.cardCode === DEVADATTA)!;
    drone.tokens = { ...drone.tokens, power: 2 };
    expect(breachAccesses(s, 'rd').accesses).toBe(1);
    expect(breachAccesses(s, 'hq').accesses).toBe(0);
    expect(runScore(s, 'rd')).toBeGreaterThan(before.rd);
    expect(runScore(s, 'hq')).toBe(before.hq);
  });
  it('runRestWorth counts the run\'s extraAccesses', () => {
    const s = newGame();
    startRunnerTurn(s);
    const run = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'rd' } as GameAction);
    const more = { ...run, activeRun: { ...run.activeRun!, extraAccesses: run.activeRun!.extraAccesses + 1 } };
    expect(runRestWorth(more)).toBeGreaterThan(runRestWorth(run));
  });
  it("Jeff's game #54 (report-54, move 145): on its Overclock R&D breach the Runner uses the Drone", () => {
    const s = JSON.parse(readFileSync(new URL('./fixtures/report-54-drone.json', import.meta.url), 'utf8')) as GameState;
    const prompt = activePrompt(s)!;
    expect(prompt.side).toBe('runner');
    const pick = createAgent('runner').chooseAction(structuredClone(s));
    expect(pick).toMatchObject({ type: 'RESOLVE_PROMPT', choice: { kind: 'effect_choice', optionId: 'use' } });
  });
  it('scoreOutcome counts the rest of the run in full once the breach has begun (6.9.5b), 0.8 of it while ice is ahead', () => {
    const s = JSON.parse(readFileSync(new URL('./fixtures/report-54-drone.json', import.meta.url), 'utf8')) as GameState;
    const prompt = activePrompt(s)!;
    const use = executeAction(structuredClone(s), { type: 'RESOLVE_PROMPT', player: 'runner', promptId: prompt.id, choice: { kind: 'effect_choice', optionId: 'use' } } as GameAction);
    const atBreach = asSide('runner', () => scoreOutcome(s, use, 'runner'));
    const earlier = { ...s, activeRun: { ...s.activeRun!, phase: 'movement' as const } };
    const beforeIce = asSide('runner', () => scoreOutcome(earlier, use, 'runner'));
    const rest = asSide('runner', () => runRestWorth(use));
    expect(rest).toBeGreaterThan(0);
    expect(atBreach - beforeIce).toBeCloseTo(0.2 * rest, 6);
  });
});

describe('break plans keep counters out of credits (AI-RUNNER-NONCREDIT-BREAK-COST)', () => {
  it('BreakPlan.credits is real credits; counters and discards are value', () => {
    const s = newGame();
    startRunnerTurn(s);
    installIceForTest(s, '30072', 'hq'); // Palisade
    installProgramForTest(s, '30006'); // a barrier breaker
    const plan = bestBreakPlan(s, s.corp.servers.hq.ice[0], 1)!;
    expect(plan.value).toBe(0);
    expect(plan.credits).toBeGreaterThan(0);
  });
});
