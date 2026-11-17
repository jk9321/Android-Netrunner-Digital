/**
 * ai-hold-reentry (brief rev 2, AI Coordinator 2026-11-16): the hold count (corp/hold.ts holdRunnerTurn, registry row
 * "what holds a server") prices every rez set of a server on a new view, and those prices reach the rez budget
 * (iceValues.ts countRezBudget) through a Runner card worth that reads runSuccess (Red Team's credits here). The rez
 * budget's Stage B5 order read the hold count again (corpPorts.holdingRezIds), so the count ran inside itself, 2^n sets
 * a level: deal 2138, the Corp's first decision of turn 11 (five unrezzed ice on Remote 3, two Red Teams), did not
 * finish on beta (3 deep, 130,000 hold counts in 180 s). Now the rez budget keeps its stop order while a hold count is
 * open (the pricing context's countingHold), and the hold count skips the sets it would price and then throw away.
 * The rules the count models are cited in hold.ts (Comprehensive Rules 3.4.3a, 6.4.3, 6.9.2b: ice is rezzed as it is
 * approached; 6.5.8a: a bypassed ice's subroutines never resolve); nothing here changes them.
 *
 * Hold counts and rez sets are counted through module mocks: every serverHold 'runnerTurn' call from another module
 * (rezMoney, candidates, placement, lines) and every runBypasses call made while one is open.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameState } from '../src/core';
import type { HoldOptions } from '../src/ai/corp/hold';

const probe = { depth: 0, maxDepth: 0, counts: 0, sets: 0 };
vi.mock('../src/ai/corp/hold', async importOriginal => {
  const orig = await importOriginal<typeof import('../src/ai/corp/hold')>();
  return {
    ...orig,
    serverHold: (s: GameState, server: string, opts: HoldOptions) => {
      if (opts.when !== 'runnerTurn') return orig.serverHold(s, server, opts);
      probe.counts++;
      probe.maxDepth = Math.max(probe.maxDepth, ++probe.depth);
      try {
        return orig.serverHold(s, server, opts);
      } finally {
        probe.depth--;
      }
    },
  };
});
vi.mock('../src/ai/runs', async importOriginal => {
  const orig = await importOriginal<typeof import('../src/ai/runs')>();
  return { ...orig, runBypasses: (...args: Parameters<typeof orig.runBypasses>) => (probe.depth > 0 && probe.sets++, orig.runBypasses(...args)) };
});
const { createAgent } = await import('../src/ai');
const { REZ_NEXT_SHARE, REZ_NOW_SHARE, rezBudget } = await import('../src/ai/iceValues');
const { asSide } = await import('../src/ai/synergy');
const { pricing, withPricing } = await import('../src/ai/pricing');
const { corpPorts } = await import('../src/ai/corpPorts');

const saved = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/hold-reentry/deal2138-T11-corp.json', import.meta.url), 'utf8'));
const reset = () => Object.assign(probe, { depth: 0, maxDepth: 0, counts: 0, sets: 0 });
afterEach(() => vi.restoreAllMocks());

describe('the hold count never runs inside itself (deal 2138)', () => {
  it('the saved decision finishes with every hold count at depth 1, in a bounded number of counts and rez sets', () => {
    reset();
    const action = createAgent('corp', 'normal').chooseAction(saved());
    expect(action).not.toBeNull();
    expect(probe.maxDepth).toBe(1);
    // Measured on the branch (scripts/hold-reentry/saved-state.ts): 3,271 hold counts and 50,043 rez sets priced in the
    // mask loop (commit 1 alone: 3,273 and 73,024; beta: no finish, 145,757 counts and 4.4 million sets in 180 s). The
    // caps leave room for valuation changes, not for a level of nesting or the discarded sets coming back
    expect(probe.counts).toBeLessThanOrEqual(4000);
    expect(probe.sets).toBeLessThanOrEqual(62000);
  }, 120_000);
});

/**
 * The guard itself, on the saved board (27 credits, 9 unrezzed ice: the ice competes for the money, so the order is
 * read). The port is spied on so the owner's order is a known one: the stop order reversed.
 */
describe('countingHold: the rez budget keeps its stop order inside an open hold count', () => {
  const shares = (m: Map<string, number>) => [...m.entries()].sort();
  const credits = (s: GameState, n: number): GameState => ({ ...s, corp: { ...s.corp, credits: n } });

  it('outside a hold count the Corp reads the owner\'s order; inside one it reads the stop order, and never asks the hold count', () => {
    const s = credits(saved(), 4);
    const stopOrder = asSide('runner', () => rezBudget(s));
    const ids = Object.values(s.corp.servers).flatMap(v => v.ice).filter(c => !c.isRezzed).map(c => c.instanceId);
    const spy = vi.spyOn(corpPorts, 'holdingRezIds').mockReturnValue({ owner: [...ids].reverse() });
    asSide('corp', () => {
      const inside = withPricing({ countingHold: true }, () => rezBudget(s));
      expect(spy).not.toHaveBeenCalled();
      expect(shares(inside)).toEqual(shares(stopOrder));
      const outside = rezBudget(s);
      expect(spy).toHaveBeenCalled();
      // the owner's order (the last ice first) gives other shares here: the guard is what kept the stop order above
      expect(shares(outside)).not.toEqual(shares(stopOrder));
      expect([...outside.values()].every(v => v === REZ_NOW_SHARE || v === REZ_NEXT_SHARE)).toBe(true);
    });
  });

  it('a rez budget memoised under the guard is not served outside it, nor the other way round', () => {
    const s = credits(saved(), 4);
    const ids = Object.values(s.corp.servers).flatMap(v => v.ice).filter(c => !c.isRezzed).map(c => c.instanceId);
    const spy = vi.spyOn(corpPorts, 'holdingRezIds').mockReturnValue({ owner: [...ids].reverse() });
    asSide('corp', () => {
      const inside = withPricing({ countingHold: true }, () => rezBudget(s));
      expect(spy).not.toHaveBeenCalled();
      const outside = rezBudget(s); // same state object: a memo hit across the guard would hand back `inside`
      expect(spy).toHaveBeenCalled(); // (the stops' own prices ask the budget on other boards too)
      expect(shares(outside)).not.toEqual(shares(inside));
      const asked = spy.mock.calls.length;
      expect(shares(withPricing({ countingHold: true }, () => rezBudget(s)))).toEqual(shares(inside));
      expect(shares(rezBudget(s))).toEqual(shares(outside));
      expect(spy).toHaveBeenCalledTimes(asked); // both served from their own memo entries
    });
    expect(pricing().countingHold).toBe(false);
  });
});
