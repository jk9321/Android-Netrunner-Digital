import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { GameAction, GameState, getLegalActions } from '../src/core';
import { HeuristicRunnerAI } from '../src/ai';
import { planWith, tuning } from '../src/ai/synergy';
import { runShortfall } from '../src/ai/runs';

interface Pressed {
  pressureRun(s: GameState, legal: GameAction[]): GameAction | null;
}

/**
 * plan.pressureRunner, the step 4 test opponent (spec-step4-placement.md, Jeff 2026-11-11): the Runner at the table runs
 * any server it can pay through by what it sees, HQ and R&D or a root holding a card it hasn't seen, once per server a
 * turn (rules 6.1: a run is a click action on any server; 7.4.1: HQ is accessed at random, so it is always worth a look).
 * Position: deal 2172's Runner turn 23 (empty grip, 20 credits), as in emptyGripRuns.test.ts.
 */
const position = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/empty-grip-runner.json', import.meta.url), 'utf8'));
const saved = tuning.plan;
afterEach(() => {
  tuning.plan = saved;
});

describe('the pressure Runner test opponent (plan.pressureRunner)', () => {
  it('runs a server it can pay through, and not one it already ran this turn', () => {
    tuning.plan = planWith(tuning.plan, ['+pressureRunner']);
    const s = position();
    const press = (x: GameState) => (new HeuristicRunnerAI({ synergy: true }) as unknown as Pressed).pressureRun(x, getLegalActions(x, 'runner'));
    const first = press(s);
    expect(first?.type).toBe('INITIATE_RUN');
    const target = (first as { targetServerId: string }).targetServerId;
    expect(runShortfall(s, target)).not.toBeNull();
    expect(new HeuristicRunnerAI({ synergy: true }).chooseAction(s)).toEqual(first);
    const ran = structuredClone(s);
    ran.runsThisTurn = [...ran.runsThisTurn, { server: target, successful: true }];
    expect((press(ran) as { targetServerId?: string } | null)?.targetServerId).not.toBe(target);
    // Broke: only a server with nothing to pay on the way in
    const broke = structuredClone(s);
    broke.runner.credits = 0;
    const free = press(broke) as { targetServerId: string } | null;
    if (free) expect(broke.corp.servers[free.targetServerId].ice.every(i => i.isRezzed && (runShortfall(broke, free.targetServerId) ?? 1) <= 0)).toBe(true);
  }, 60_000);

  it('leaves the playout copies (planner off) as the normal Runner', () => {
    tuning.plan = planWith(tuning.plan, ['+pressureRunner']);
    const s = position();
    const pressed = new HeuristicRunnerAI({ synergy: true, planner: false }).chooseAction(s);
    tuning.plan = saved;
    const normal = new HeuristicRunnerAI({ synergy: true, planner: false }).chooseAction(s);
    expect(pressed).toEqual(normal);
  }, 60_000);
});
