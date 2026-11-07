import { describe, expect, it } from 'vitest';
import '../src/ai'; // registers the deck-average hook (handValues.ts)
import { cardRate } from '../src/ai/valueModel';
import { asSide, pricing, pricingKey, withPricing } from '../src/ai/pricing';
import { newGame } from './helpers';

/**
 * The pricing context (review item 6). Caches are keyed by it: a value worked out under one context (ice being
 * priced, the threat model at work) is never served under another. Before the keys, the deck's average card was
 * cached by plan side only, so whichever context asked first set it for every other, and a game's moves depended on
 * which games had played before it in the same process (when a cache filled and cleared).
 */
describe('pricing context', () => {
  it('withPricing restores what it set, thrown or not', () => {
    expect(pricing().pricingIce).toBe(false);
    expect(() => withPricing({ pricingIce: true }, () => {
      expect(pricing().pricingIce).toBe(true);
      throw new Error('x');
    })).toThrow();
    expect(pricing().pricingIce).toBe(false);
  });

  it('pricingKey changes with the context and comes back with it', () => {
    const outside = pricingKey();
    const corp = asSide('corp', pricingKey);
    expect(corp).not.toBe(outside);
    expect(asSide('corp', () => withPricing({ pricingIce: true }, pricingKey))).not.toBe(corp);
    expect(asSide('corp', pricingKey)).toBe(corp);
    expect(pricingKey()).toBe(outside);
  });

  it("the deck's average card priced while ice is priced is not served outside it, nor the other way", () => {
    // The Runner's deck: its run cards read run odds, which are the flat guesses while ice is being priced
    const plain = asSide('runner', () => cardRate(newGame(), 'runner'));
    const guarded = asSide('runner', () => withPricing({ pricingIce: true }, () => cardRate(newGame(), 'runner')));
    expect(guarded).not.toBe(plain);
    const s = newGame();
    expect(asSide('runner', () => withPricing({ pricingIce: true }, () => cardRate(s, 'runner')))).toBe(guarded);
    // Context A after context B on the same position: A's own number, then B's again
    expect(asSide('runner', () => cardRate(s, 'runner'))).toBe(plain);
    expect(asSide('runner', () => withPricing({ pricingIce: true }, () => cardRate(s, 'runner')))).toBe(guarded);
  });
});
