import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from '../src/core';
import { COUNTERS_PRICED_ELSEWHERE, handSetOnly, unpricedCards, valueSources } from '../src/ai/valueAudit';

describe('every-card value audit (Jeff)', () => {
  it('prices every card in the pool on purpose, counters included', () => {
    expect(unpricedCards(ALL_CARDS)).toEqual([]);
  });

  it('every card has a value source', () => {
    expect(ALL_CARDS.filter(def => valueSources(def).length === 0).map(def => def.title)).toEqual([]);
  });

  it('no card is left on a hand-set number alone', () => {
    expect(handSetOnly(ALL_CARDS)).toEqual([]);
  });

  it('only exempts cards in the pool', () => {
    const codes = new Set(ALL_CARDS.map(def => def.code));
    expect(Object.keys(COUNTERS_PRICED_ELSEWHERE).filter(code => !codes.has(code))).toEqual([]);
  });
});
