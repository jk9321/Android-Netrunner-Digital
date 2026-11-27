/**
 * ai-breaker-guard-key (brief rev 2, phase 2; ruling in audit-fixes/breaker-guard-key/results.md): the deal 3061 depth
 * guard (a breaker priced by the rig it joins: every breaker met inside takes the rule-based worth, handValues.ts
 * playedWorth) is the pricing context's `pricingBreaker`, set with withPricing and part of pricingKey while averaging is
 * off. Before, it was a Set changed in place and outside the key, so a value memoised on a board with the guard up was
 * served with it down, and the other way round (phase 1: 4.8 million such reads on beta, one value different, a Runner
 * tagLoss). The deck averages' keys leave it out: their values are worked out under averaging, where the guard is never
 * read. No rules change: what a breaker can break is unchanged (Comprehensive Rules 3.9.5e-h: an icebreaker's interface
 * abilities, on ice of the subtype they name, at strength at least the ice's); only which cached price is served.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CardInstance, GameState } from '../src/core';
import { clearHandCaches, playedWorth } from '../src/ai/handValues';
import { memo } from '../src/ai/valueModel';
import { frameKeys, pricing, withPricing } from '../src/ai/pricing';
import { hangState } from '../scripts/breaker-price-depth/time-state-lib';

const pricingKey = () => frameKeys().pricing;
const deckPricingKey = () => frameKeys().deck;

/** A Mayfly in the grip, nothing hosted beside it (as breakerPriceDepth.test.ts). */
function gripMayfly(): [GameState, CardInstance] {
  const s = hangState(0);
  const madani = hangState(4).runner.rig.hardware.find(c => c.cardCode === '35028')!;
  const mayfly = { ...structuredClone(madani.hostedCards!.find(h => h.instanceId === 'inst-92')!), instanceId: 'inst-900' };
  s.runner.grip.push(mayfly);
  return [s, mayfly];
}
const guarded = <T>(fn: () => T): T => withPricing({ pricingBreaker: true }, fn);

beforeEach(() => clearHandCaches());

describe('the breaker guard is in the memo key', () => {
  it('a value memoised under the guard is not served outside it, nor the other way round (same state object)', () => {
    const work = () => (pricing().pricingBreaker ? 'inside' : 'outside');
    const s = hangState(1);
    expect(guarded(() => memo(s, 'guardKeyTest', work))).toBe('inside');
    expect(memo(s, 'guardKeyTest', work)).toBe('outside');
    const t = hangState(1);
    expect(memo(t, 'guardKeyTest', work)).toBe('outside');
    expect(guarded(() => memo(t, 'guardKeyTest', work))).toBe('inside');
    expect(pricing().pricingBreaker).toBe(false);
  });

  it('a breaker\'s played worth memoised on the board: the rig difference outside, the rule-based worth inside, both ways', () => {
    const [s, m] = gripMayfly();
    const played = () => playedWorth(s, m);
    const rig = played(); // two rig values (breakerPriceDepth.test.ts: 0.1157142857142901)
    const rule = guarded(played);
    expect(rule).not.toBeCloseTo(rig, 6);
    expect(guarded(() => memo(s, 'mayfly', played))).toBe(rule);
    expect(memo(s, 'mayfly', played)).toBe(rig);
    clearHandCaches();
    const [t, n] = gripMayfly();
    const again = () => playedWorth(t, n);
    expect(memo(t, 'mayfly', again)).toBe(rig);
    expect(guarded(() => memo(t, 'mayfly', again))).toBe(rule);
  });

  it('the key carries the guard only while averaging is off; the deck averages\' key never does', () => {
    const outside = pricingKey();
    expect(outside.endsWith(':b')).toBe(false);
    guarded(() => {
      expect(pricingKey().endsWith(':b')).toBe(true);
      expect(deckPricingKey()).toBe(outside);
      withPricing({ averaging: true }, () => {
        expect(pricingKey().endsWith(':b')).toBe(false);
        expect(deckPricingKey()).toBe(pricingKey());
      });
    });
    expect(pricingKey()).toBe(outside);
  });
});
