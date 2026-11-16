/**
 * ai-breaker-price-depth (brief rev 2 + red team rulings, 2026-11-16): a breaker's played worth is the rig with it less
 * the rig without it (playedWorth, handValues.ts), and the rig walks its hosted breakers through the same branch. Before
 * the fix every other hosted breaker nested one level deeper, R(k) = 1 + 2k R(k-1) rig values for k hosted breakers
 * (1, 3, 13, 79, 633): deal 3061 turn 16 (Madani hosting Echelon and three Mayfly) took minutes for one Corp decision.
 * Now a breaker met while any breaker is priced takes the rule-based worth: 1 + 2k rig values (depth 1).
 * The state is the saved hang state, cut down to k hosted breakers (Devadatta Drone stays hosted: not a breaker).
 * Calls are counted through the module mock, so they include the top-level call these tests make and every nested one
 * from handValues; calls evaluate.ts makes to its own function (tagsWorth's rig values) are not counted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CardInstance, GameState } from '../src/core';
import { clearHandCaches, playedWorth } from '../src/ai/handValues';
import { HOSTED_BREAKERS, hangState } from '../scripts/breaker-price-depth/time-state-lib';

const calls = { n: 0 };
vi.mock('../src/ai/evaluate', async importOriginal => {
  const orig = await importOriginal<typeof import('../src/ai/evaluate')>();
  return { ...orig, runnerRigValue: (s: GameState) => (calls.n++, orig.runnerRigValue(s)) };
});
const { runnerRigValue, tagsWorth } = await import('../src/ai/evaluate');

const madani = (s: GameState) => s.runner.rig.hardware.find(c => c.cardCode === '35028')!;
/** A fourth Mayfly in the grip, beside k hosted breakers. */
function gripMayfly(k: number): [GameState, CardInstance] {
  const s = hangState(k);
  const mayfly = { ...structuredClone(madani(hangState(4)).hostedCards!.find(h => h.instanceId === 'inst-92')!), instanceId: 'inst-900' };
  s.runner.grip.push(mayfly);
  return [s, mayfly];
}
function counted<T>(fn: () => T): [T, number] {
  calls.n = 0;
  const v = fn();
  return [v, calls.n];
}

beforeEach(() => clearHandCaches());

describe('a hosted breaker is priced at most one level deep', () => {
  it('one rig value costs 1 + 2k rig values for k hosted breakers (beta: 1, 3, 13, 79, 633)', () => {
    const counts = [0, 1, 2, 3, 4].map(k => (clearHandCaches(), counted(() => runnerRigValue(hangState(k)))[1]));
    expect(counts).toEqual([1, 3, 5, 7, 9]);
  });

  it('with at most one breaker priced this way, the values are beta\'s exactly', () => {
    expect(runnerRigValue(hangState(0))).toBe(53.51356564066562);
    clearHandCaches();
    expect(runnerRigValue(hangState(1))).toBe(54.46956564066562);
    clearHandCaches();
    // the one hosted Mayfly's own played worth
    const s = hangState(1);
    expect(playedWorth(s, madani(s).hostedCards!.find(h => h.instanceId === 'inst-92')!)).toBe(0.1157142857142901);
    clearHandCaches();
    // a Mayfly in the grip, nothing hosted beside it: two rig values, as on beta
    const [g, m] = gripMayfly(0);
    expect(counted(() => playedWorth(g, m))).toEqual([0.1157142857142901, 2]);
  });

  it('a breaker in the grip beside a hosted one prices the rig twice, the hosted one rule-based (beta: 6 calls)', () => {
    const [g, m] = gripMayfly(1);
    const [v, n] = counted(() => playedWorth(g, m));
    expect(n).toBe(2);
    // the same worth as with nothing hosted (a hosted breaker is rule-based on both sides of the difference)
    expect(v).toBeCloseTo(0.1157142857142901, 10);
  });

  it('two and four hosted breakers: finite, the same on a second call, whatever the host order', () => {
    for (const k of [2, 4]) {
      const first = runnerRigValue(hangState(k));
      expect(Number.isFinite(first)).toBe(true);
      clearHandCaches();
      expect(runnerRigValue(hangState(k))).toBe(first);
      clearHandCaches();
      const reversed = hangState(k);
      madani(reversed).hostedCards!.reverse();
      expect(runnerRigValue(reversed)).toBe(first);
      clearHandCaches();
    }
    // and a breaker added to the host never lowers the rig (beta: the third lowered it, 57.42 -> 56.90)
    const values = [2, 3, 4].map(k => (clearHandCaches(), runnerRigValue(hangState(k))));
    expect(values[1]).toBeGreaterThan(values[0]);
    expect(values[2]).toBeGreaterThan(values[1]);
  });

  it('the hang path: one tag price on the saved state nests 8 rig values a rig value (beta: 2,528)', () => {
    expect(HOSTED_BREAKERS).toHaveLength(4);
    // Until ai-tag-loss-bp, tagsWorth -> tagClock priced the rig and the rig without each of its 3 resources (evaluate.ts,
    // not counted), each of those 4 rig values pricing the 4 hosted breakers at 2 counted rig values each: 32. The clock
    // now prices a resource by its own term (Madani is hardware, so no hosted breaker is priced in there): 0
    const [v, n] = counted(() => tagsWorth(hangState(4), 'corp', 1));
    expect(n).toBe(0);
    expect(Number.isFinite(v)).toBe(true);
    // the depth this file pins, on the same state: one rig value prices the 4 hosted breakers at 2 rig values each
    const [, m] = counted(() => runnerRigValue(hangState(4)));
    expect(m).toBe(1 + 8);
  });
});
