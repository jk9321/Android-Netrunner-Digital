import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { turnsLeft } from '../src/ai/cardProfiles';
import { tuning } from '../src/ai/synergy';

/**
 * plan.rdTurnsLeft (2026-11-07, thread "Find why self-play games end decked"): turns left stop where R&D runs out
 * (rules 4.2.7b, 5.6.1e). Position: self-play deal 2172, 6-6 (4 turns left by the points clock).
 */
const position = (rd: number): GameState => {
  const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/empty-grip-runner.json', import.meta.url), 'utf8'));
  const cards = [...s.corp.rd, ...s.corp.hq];
  return { ...s, corp: { ...s.corp, rd: cards.slice(0, rd) } };
};

describe('turns left are no more than R&D lasts (plan.rdTurnsLeft)', () => {
  it('a near-empty R&D cuts the points clock', () => {
    expect(turnsLeft(position(8))).toBe(4); // the points clock is shorter
    expect(turnsLeft(position(3))).toBe(3); // ceil(3 / 1.3)
    expect(turnsLeft(position(1))).toBe(1);
    expect(turnsLeft(position(0))).toBe(1);
  });

  it('without the plan only the score counts', () => {
    tuning.plan.rdTurnsLeft = false;
    try {
      expect(turnsLeft(position(1))).toBe(4);
    } finally {
      tuning.plan.rdTurnsLeft = true;
    }
  });
});
