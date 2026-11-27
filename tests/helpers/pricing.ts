import type { GameState, SideCode } from '../../src/core';
import { inDecision as decisionFrame } from '../../src/ai/handValues';
import { asSide, withPricing } from '../../src/ai/pricing';

/**
 * Runs `fn` the way `side`'s AI prices a decision on `state` (review item 6):
 * its own plan (asSide), and the decision's frame with the hands and the
 * Runner's credits as it starts (src/ai/handValues.ts inDecision, B1b). A test
 * that wants the number the game would see wraps it in this, instead of
 * rebuilding the nesting by hand.
 */
export function inDecision<T>(state: GameState, side: SideCode, fn: () => T): T {
  return asSide(side, () => decisionFrame(state, side, fn));
}

/** inDecision with the hands frozen, as a planner's playout sees them (turnPlanner.ts planTurn). */
export function inPlayout<T>(state: GameState, side: SideCode, fn: () => T): T {
  return inDecision(state, side, () => withPricing({ frozen: true }, fn));
}
