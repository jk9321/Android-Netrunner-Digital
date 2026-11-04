import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { asSide, tuning } from '../src/ai/synergy';

/**
 * Self-play (2026-11-04, the credit-card audit): with a full grip the Runner spent its last click drawing a 6th card and
 * discarded one at the end of the turn. Against Corp damage a card over the hand size soaks up a hit in a run this turn,
 * so the damage clock counted it as life (+5.8), but with no click left there is no run to take damage in
 * (rules 4.3.6 and 5.5.1: the Runner discards down to its maximum hand size at the end of its turn). plan.spareLastClick.
 *
 * Position: self-play deal 1001, the Runner's turn 9, 5 cards (its hand size), 1 click left.
 */
function ranks(): { draw: number; credit: number } {
  const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/runner-sure-gamble.json', import.meta.url), 'utf8'));
  s.runner.clicks = 1;
  const rk = asSide('runner', () => new HeuristicRunnerAI({ synergy: true, planner: false }).rankMainActions(s));
  const score = (type: string) => rk.find(r => r.action.type === type)!.score;
  return { draw: score('DRAW_CARD'), credit: score('GAIN_CREDIT') };
}

describe('no drawing past the hand size with the last click (plan.spareLastClick)', () => {
  it('clicks for a credit rather than draw a card it must discard', () => {
    const r = ranks();
    expect(r.credit).toBeGreaterThan(r.draw);
  });

  it('without the plan the draw scores as a damage buffer', () => {
    tuning.plan.spareLastClick = false;
    try {
      const r = ranks();
      expect(r.draw).toBeGreaterThan(r.credit + 3);
    } finally {
      tuning.plan.spareLastClick = true;
    }
  });
});
