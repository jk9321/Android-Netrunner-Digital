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
import { CLICK, cardRate } from '../src/ai/valueModel';
import { scoreOutcome, simulate } from '../src/ai/prompts';
import { runnerDecisionView } from '../src/ai/turnPlanner';
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
  const inRun = (grip: number, clicks: number) => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.grip = s.runner.grip.slice(0, grip);
    const run = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' } as GameAction);
    return { ...run, runner: { ...run.runner, clicks } };
  };
  it("damage taken in the Runner's own run is read with the clicks left to draw back (5.2.7c): a card, not a step toward a flatline", () => {
    const s = inRun(1, 3);
    // 1 card left: without draw-back the damage empties the grip; with it, a click draws the card back
    expect(damageWorth(s, 1, true)).toBeLessThan(damageWorth(s, 1));
    expect(damageWorth(s, 1, true)).toBeCloseTo(CLICK, 6);
    // No click left after the run: no draw-back, the flatline step counts again
    expect(damageWorth(inRun(1, 0), 1, true)).toBe(damageWorth(inRun(1, 0), 1));
  });
  it('a full grip does not make damage free: the clicks that draw back are paid (CLICK each), or the card is lost', () => {
    const s = inRun(5, 3);
    expect(damageWorth(s, 2, true)).toBeGreaterThanOrEqual(Math.min(2 * CLICK, 2 * cardRate(s, 'runner')) - 1e-9);
    expect(damageWorth(s, 2, true)).toBeLessThanOrEqual(damageWorth(s, 2));
  });
  it("only the Runner's own pricing of its run reads the draw-back: the Corp's view of the same subroutine does not", () => {
    const s = inRun(1, 3);
    const runner = asSide('runner', () => subroutineCost(s, 'Do 1 net damage.'));
    const corp = asSide('corp', () => subroutineCost(s, 'Do 1 net damage.'));
    expect(runner).toBeCloseTo(CLICK, 6);
    expect(corp).toBe(damageWorth(s, 1));
    expect(corp).toBeGreaterThan(runner);
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
  // Jeff's Teia game (report-28, turn 8; fixture vrcation-sure-gamble.json): 5 credits, 3 clicks, 4 cards. Remote-2 holds an
  // unseen card with 3 advancements, The Holo Man and Adrian Seis, behind a rezzed Empiricist (draw; 1 net damage and a tag;
  // 2 net damage; no end the run). Taking every subroutine costs no credits and leaves 1 card (rule 10.4.4: 3 damage
  // against 4 cards is survived). Counted as credits, the 23 of damage was over the 5-credit budget and the run was barred.
  it('runs a 3-advanced remote behind ice that cannot end the run', () => {
    const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/vrcation-sure-gamble.json', import.meta.url), 'utf8'));
    asSide('runner', () => {
      const price = icePrice(s, s.corp.servers['remote-2'].ice[0]);
      expect(price.credits).toBe(0);
      expect(price.value).toBeCloseTo(subroutineCost(s, 'Draw 1 card.') + subroutineCost(s, 'Do 1 net damage. Give the Runner 1 tag.') + subroutineCost(s, 'Do 2 net damage.'));
      expect(runScore(s, 'remote-2', { wary: true })).toBeGreaterThan(0);
    });
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

describe('the rest of the run once the breach has begun (rules 7.3.4, 7.3.5)', () => {
  const anoetic = () => JSON.parse(readFileSync(new URL('./fixtures/report-26-anoetic.json', import.meta.url), 'utf8')) as GameState;
  it("Jeff's game #26 (move 65): Anoetic Void for 1 credit is trashed", () => {
    const s = anoetic();
    const prompt = activePrompt(s)!;
    expect(prompt.kind).toBe('access_trash');
    const pick = createAgent('runner').chooseAction(structuredClone(s));
    expect(pick).toMatchObject({ type: 'RESOLVE_PROMPT', choice: { kind: 'access_trash', trash: true } });
  });
  it('the card a trash prompt is about is not in the rest of the run, trashed or not', () => {
    const s = anoetic();
    const prompt = activePrompt(s)!;
    const answer = (trash: boolean) => executeAction(structuredClone(s), { type: 'RESOLVE_PROMPT', player: 'runner', promptId: prompt.id, choice: { kind: 'access_trash', trash } } as GameAction);
    const left = answer(false);
    // Left in the root, the accessed card is no longer a candidate: the rest of the run does not price trashing it again
    expect(asSide('runner', () => runRestWorth(left))).toBeCloseTo(asSide('runner', () => runRestWorth(answer(true))), 6);
  });
  it('the Drone prompt (report-54 move 145) comes before the breach: no card is left out there', () => {
    const s = JSON.parse(readFileSync(new URL('./fixtures/report-54-drone.json', import.meta.url), 'utf8')) as GameState;
    // Breach abilities resolve before the breach begins (6.9.5b, 7.3.5b): the pin above ("use") reads the whole server
    expect(s.activeRun!.breached).toBe(false);
    expect(s.activeRun!.breach).toBeUndefined();
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

describe("prompts answered from the Runner's own view (rule 10.2.2a)", () => {
  // Jeff's game #22 (report-22, move 216): "Amanuensis: remove 1 power counter to draw 2 cards?"
  const amanuensis = () => JSON.parse(readFileSync(new URL('./fixtures/report-22-amanuensis.json', import.meta.url), 'utf8')) as GameState;
  it('an answer that draws scores the same with the stack reversed', () => {
    const s = amanuensis();
    const prompt = activePrompt(s)!;
    expect(prompt.message).toMatch(/^Amanuensis/);
    const draw = { type: 'RESOLVE_PROMPT', player: 'runner', promptId: prompt.id, choice: { kind: 'effect_choice', optionId: 'yes' } } as GameAction;
    const reversed = { ...s, runner: { ...s.runner, stack: [...s.runner.stack].reverse() } };
    asSide('runner', () => {
      const score = (x: GameState) => scoreOutcome(x, simulate(x, draw), 'runner');
      // On the real state the score reads the real next cards (the hole); the Runner's view deals the stack itself
      expect(score(s)).not.toBeCloseTo(score(reversed), 6);
      expect(score(runnerDecisionView(s))).toBeCloseTo(score(runnerDecisionView(reversed)), 9);
    });
    // The AI's answer is the same whichever way the stack lies
    const pick = (x: GameState) => createAgent('runner').chooseAction(structuredClone(x));
    expect(pick(reversed)).toEqual(pick(s));
  });
});
