/**
 * Stage D item 1 (brief rev 2, 4.6): branch ai-hold-facts adds facts beside the Runner's run prices (breakPlans, the
 * subroutine rules' `blocks`, subroutineFacts) and must change no price. The golden table (scripts/stage-d/golden-prices.ts)
 * hashes subroutineCost, icePrice, iceCreditNeed and bestBreakPlan for every ice of the four sets against every
 * icebreaker on fixed boards; the fixture was written on beta 0920319, before the branch.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GOLDEN_FILE, goldenHashes } from '../scripts/stage-d/golden-prices';

describe('run prices: golden table', () => {
  it('every ice prices as on beta 0920319', () => {
    const want = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8'));
    expect(goldenHashes()).toEqual(want);
  });
});
