import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/core';
import { DECKS, deckGameSetup } from '../src/data/decks';
import { buildTarget, creditSlide, pointValue } from '../src/ai/valueModel';

describe('value model rates', () => {
  it('credits slide against a need: dear when broke, 1 at the need, fading above it', () => {
    const marginal = (c: number) => creditSlide(c + 1, 15) - creditSlide(c, 15);
    expect(marginal(0)).toBeCloseTo(1.77, 1);
    expect(marginal(14)).toBeCloseTo(1.0, 1);
    expect(marginal(20)).toBeCloseTo(0.55, 1);
    expect(marginal(30)).toBeCloseTo(0.33, 1);
    // No cap: more is always a little better
    expect(creditSlide(60, 15)).toBeGreaterThan(creditSlide(50, 15));
  });

  it('points are worth more the closer they take a side to 7', () => {
    const step = (s: number) => pointValue(s) - pointValue(s - 1);
    expect([1, 2, 3, 4, 5, 6].map(step)).toEqual([8, 8, 9, 10, 12, 15]);
  });

  it('build targets come from the decklists and land around 12-15 credits', () => {
    const corp = DECKS.find(d => d.side === 'corp')!;
    const runner = DECKS.find(d => d.side === 'runner')!;
    const state = createInitialGameState(deckGameSetup(1, corp, runner));
    for (const side of ['corp', 'runner'] as const) {
      expect(buildTarget(state, side)).toBeGreaterThan(6);
      expect(buildTarget(state, side)).toBeLessThan(25);
    }
  });
});
