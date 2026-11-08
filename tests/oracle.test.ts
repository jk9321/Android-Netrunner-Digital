import { afterEach, describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { tuning } from '../src/ai/synergy';
import { runnerView } from '../src/ai/threatModel';
import { corpSeenGrip } from '../src/ai/oracle';
import { newGame } from './helpers';
import { inDecision } from './helpers/pricing';

/**
 * Tuning pass round 2, phase 1 (spec-round2.md): the measurement oracles. Each is off by default; on, it gives the
 * Corp one piece of hidden information (rules 10.2.2a-b: the grip, R&D order and facedown cards are hidden) for a
 * batch. These pin that each does what it says when on and nothing when off.
 */

const saved = structuredClone(tuning.plan.oracle);
afterEach(() => {
  tuning.plan.oracle = structuredClone(saved);
});
const ids = (cards: { instanceId: string }[]) => cards.map(c => c.instanceId).sort();

describe('oracle.grip', () => {
  const start = (): GameState => newGame(3);

  it('off: the Corp counts none of an unrevealed grip as seen, and guesses the grip from the unseen pool', () => {
    const s = start();
    const seen = inDecision(s, 'corp', () => corpSeenGrip(s));
    expect(seen.size).toBe(0);
    // The threat's grip is a deal from grip + stack in instance order: not the real grip
    const guessed = inDecision(s, 'corp', () => runnerView(s).runner.grip);
    expect(ids(guessed)).not.toEqual(ids(s.runner.grip));
  });

  it('on: the whole grip counts as seen, so the threat plays the real grip (the stack stays a guess)', () => {
    tuning.plan.oracle.grip = true;
    const s = start();
    const seen = inDecision(s, 'corp', () => corpSeenGrip(s));
    expect([...seen].sort()).toEqual(ids(s.runner.grip));
    const view = inDecision(s, 'corp', () => runnerView(s));
    expect(ids(view.runner.grip)).toEqual(ids(s.runner.grip));
    expect(ids(view.runner.stack)).toEqual(ids(s.runner.stack));
  });

  it('is off for the Runner deciding (sideOff.runner): it never tells the Runner anything', () => {
    tuning.plan.oracle.grip = true;
    const s = start();
    expect(inDecision(s, 'runner', () => corpSeenGrip(s)).size).toBe(0);
  });
});
