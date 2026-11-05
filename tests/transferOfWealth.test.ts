import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { runEventOptions } from '../src/ai/prompts';
import { tuning } from '../src/ai/synergy';

/**
 * Jeff (2026-11-04): Transfer of Wealth ("Run HQ. If successful, take 1 tag and the Corp loses 3 credits. Gain 2
 * credits for each credit lost this way.") was never played in 30 self-play games: its run was priced as a bare HQ run,
 * the credits it moves left out. plan.transferOfWealth counts them, less the tag.
 */
const position = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/runner-sure-gamble.json', import.meta.url), 'utf8'));

describe("Transfer of Wealth's run is worth the credits it moves (plan.transferOfWealth)", () => {
  it('values a successful run at the credits moved less the tag', () => {
    const s = position();
    s.corp.credits = 8;
    // The Corp's loss and the tag in successBonus, the Runner's gain in successCredits (plan.runCreditsSlide)
    const worth = (o: ReturnType<typeof runEventOptions>) => (o.successBonus ?? 0) + (o.successCredits ?? 0);
    const rich = worth(runEventOptions('35017', s));
    s.corp.credits = 1;
    const poor = worth(runEventOptions('35017', s));
    expect(rich).toBeGreaterThan(0);
    expect(rich).toBeGreaterThan(poor); // 3 credits the Corp loses and 6 the Runner gains, against 1 and 2
  });

  it('without the plan the run is a bare HQ run', () => {
    tuning.plan.transferOfWealth = false;
    try {
      expect(runEventOptions('35017', position()).successBonus).toBeUndefined();
    } finally {
      tuning.plan.transferOfWealth = true;
    }
  });
});
