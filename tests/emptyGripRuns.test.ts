import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, getLegalActions } from '../src/core';
import { HeuristicRunnerAI } from '../src/ai';
import { runScore } from '../src/ai/runs';
import { tuning } from '../src/ai/synergy';

/**
 * Thread "Find why self-play games end decked" (2026-11-06): with an empty grip the Runner priced the one net damage a
 * run might cost as a sure flatline, so every run scored below zero; with the Stack empty too it never ran again.
 *
 * Position: self-play deal 2172 (Peculiarity vs The Catalyst), the Runner's turn 23: 6-6, no cards in grip or Stack,
 * 20 credits, Cleaver, Unity and Carmen installed, two Proprionegations in HQ. Before the fix it clicked for credits every
 * turn until the Corp decked out.
 */
const position = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/empty-grip-runner.json', import.meta.url), 'utf8'));
const bestRun = (s: GameState) => Math.max(...Object.keys(s.corp.servers).map(id => runScore(s, id, { wary: tuning.wary })));

describe('a Runner with an empty grip still runs (plan.emptyGripRuns)', () => {
  it('some run is worth making, and the Runner makes one', () => {
    const s = position();
    expect(s.runner.grip.length).toBe(0);
    expect(bestRun(s)).toBeGreaterThan(0);
    const ranked = new HeuristicRunnerAI({ synergy: true }).rankMainActions(s, getLegalActions(s, 'runner'));
    expect(ranked[0].action.type).toBe('INITIATE_RUN');
  });

  it('without the plan every run scores below zero', () => {
    tuning.plan.emptyGripRuns = false;
    try {
      expect(bestRun(position())).toBe(-Infinity);
    } finally {
      tuning.plan.emptyGripRuns = true;
    }
  });
});
