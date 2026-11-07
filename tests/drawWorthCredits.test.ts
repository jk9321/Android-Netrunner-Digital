import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { tuning } from '../src/ai/synergy';
import { clickWorth } from '../src/ai/handValues';

/**
 * plan.drawWorthCredits (code audit, 2026-11-06): the average card a draw brings is worth more when the side can pay
 * for what it draws (heldWorth: a card it can afford is played sooner). The cache kept the first credit count of the
 * turn: the same turn at 3 credits was priced as at 0, and so was a click (clickWorth: at least a draw), and
 * tests/brokeCorp.test.ts passed alone and failed after another.
 */
const turn17 = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/bug-report-2-turn17.json', import.meta.url), 'utf8'));
const at = (credits: number, id: string): GameState => {
  const s = turn17();
  s.corp.credits = credits;
  s.id = id;
  return s;
};

describe('a draw is priced on the credits the side has now (plan.drawWorthCredits)', () => {
  // At 5 credits (Hedge Fund playable): plan.oneCurrency prices Anthill Excavation Contract a little lower, so at 3 the
  // best play no longer clears a draw's floor of 1 and both counts read 1
  it('the same turn at 5 credits is priced as a fresh look at 5 credits', () => {
    const fresh = clickWorth(at(5, 'fresh-5'), 'corp');
    expect(fresh).not.toBeCloseTo(clickWorth(at(0, 'fresh-0'), 'corp'));
    clickWorth(at(0, 'same'), 'corp');
    expect(clickWorth(at(5, 'same'), 'corp')).toBeCloseTo(fresh);
  });

  it('off, the first credit count of the turn sticks', () => {
    tuning.plan.drawWorthCredits = false;
    try {
      const zero = clickWorth(at(0, 'old'), 'corp');
      expect(clickWorth(at(3, 'old'), 'corp')).toBeCloseTo(zero);
    } finally {
      tuning.plan.drawWorthCredits = true;
    }
  });
});
