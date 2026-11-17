/**
 * ai-tag-loss-time (brief-tag-loss-time.md rev 2, "Pins and proof"): the slow decision found at the V-B B2 review
 * (Quick and Dirty v Bowel Movements, seed 104, the Corp's turn 18: 6 credits, 3 clicks, a rig of 11 cards with 4
 * resources, a Runner stack of 6), pinned as call counts, not wall time. About 68% of its time is the tag clock's
 * pricing of the rig (results.md: F, the flat 3 a tag, takes it from 34 s to 7 s in a container). Arm 0 does not fire
 * here (every board has resources and the Corp's credits), so its counts are the same before and after; the pin is
 * there so a change that multiplies the clock's work shows. Slow (about 35 s): one for the fast checks' slow list.
 *
 * Counted through module mocks, inside the clock (the pricing context's pricingTagLoss):
 *   - tag-clock prices: tagLoss's one trashedCardCost ask each (runs.ts);
 *   - rig values: runnerRigValue's one boardPlansWorth(…, 'runner') call each (cardPlans.ts; nothing else asks it);
 *   - rez budgets asked and hold counts started (iceValues.ts rezBudget, corp/hold.ts serverHold 'runnerTurn').
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { GameState, SideCode } from '../src/core';
import type { HoldOptions } from '../src/ai/corp/hold';

const probe = { prices: 0, rig: 0, rigIn: 0, rez: 0, hold: 0 };
let inClock = () => false;
vi.mock('../src/ai/cardPlans', async importOriginal => {
  const orig = await importOriginal<typeof import('../src/ai/cardPlans')>();
  return { ...orig, boardPlansWorth: (s: GameState, side: SideCode) => (side === 'runner' && (probe.rig++, inClock() && probe.rigIn++), orig.boardPlansWorth(s, side)) };
});
vi.mock('../src/ai/runs', async importOriginal => {
  const orig = await importOriginal<typeof import('../src/ai/runs')>();
  return { ...orig, trashedCardCost: (s: GameState) => (inClock() && probe.prices++, orig.trashedCardCost(s)) };
});
vi.mock('../src/ai/iceValues', async importOriginal => {
  const orig = await importOriginal<typeof import('../src/ai/iceValues')>();
  return { ...orig, rezBudget: (s: GameState) => (inClock() && probe.rez++, orig.rezBudget(s)) };
});
vi.mock('../src/ai/corp/hold', async importOriginal => {
  const orig = await importOriginal<typeof import('../src/ai/corp/hold')>();
  return { ...orig, serverHold: (s: GameState, server: string, opts: HoldOptions) => (opts.when === 'runnerTurn' && inClock() && probe.hold++, orig.serverHold(s, server, opts)) };
});
const { createAgent } = await import('../src/ai');
const { pricing } = await import('../src/ai/pricing');
const { clearHandCaches } = await import('../src/ai/handValues');
inClock = () => pricing().pricingTagLoss;

const saved = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/tag-loss-time/t18-corp.json', import.meta.url), 'utf8'));

describe('the slow tag-clock decision (seed 104, Corp turn 18) in call counts', () => {
  it('prices, rig values, rez budgets and hold counts inside the clock stay at their measured level', () => {
    clearHandCaches();
    Object.assign(probe, { prices: 0, rig: 0, rigIn: 0, rez: 0, hold: 0 });
    const action = createAgent('corp', 'normal').chooseAction(saved());
    expect(action).toEqual({ player: 'corp', type: 'DRAW_CARD' });
    // Measured on ai-tag-loss-time (beta 8e28403's clock): 25,222 tag-clock prices, 126,117 rig values inside the clock of
    // 133,173, 56,920 rez budgets asked and 6,242 hold counts started inside it. With ai-tag-loss-bp (a resource priced by
    // its own term plus its share of the plans: no rig value inside the clock): 10,914 prices, 0 inside of 7,044, 4,102
    // and 1,046 (the decision about 6 s, was about 45 s). The caps leave about 10% for valuation changes
    expect(probe.prices).toBeGreaterThan(0);
    expect(probe.prices).toBeLessThanOrEqual(PIN.prices);
    expect(probe.rigIn).toBeLessThanOrEqual(PIN.rigIn);
    expect(probe.rig).toBeLessThanOrEqual(PIN.rig);
    expect(probe.rez).toBeLessThanOrEqual(PIN.rez);
    expect(probe.hold).toBeLessThanOrEqual(PIN.hold);
  }, 240_000);
});

const PIN = { prices: 12_000, rigIn: 0, rig: 7_750, rez: 4_500, hold: 1_150 };
