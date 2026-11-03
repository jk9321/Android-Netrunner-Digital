import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from '../src/core';
import { CARDS } from '../src/ai/cards';
import { ELEVATION } from '../src/ai/cards/elevation';
import { SYSTEM_GATEWAY } from '../src/ai/cards/systemGateway';
import { VANTAGE_POINT } from '../src/ai/cards/vantagePoint';

describe('AI card files (src/ai/cards/)', () => {
  it('list only cards in the pool, each in its own set file', () => {
    const pack = new Map(ALL_CARDS.map(def => [def.code, def.pack_code]));
    const misplaced = [
      ...Object.keys(SYSTEM_GATEWAY).filter(code => pack.get(code) !== 'sg'),
      ...Object.keys(ELEVATION).filter(code => pack.get(code) !== 'elev'),
      ...Object.keys(VANTAGE_POINT).filter(code => pack.get(code) !== 'vp'),
    ];
    expect(misplaced).toEqual([]);
  });

  it('give every entry something to price', () => {
    expect(Object.entries(CARDS).filter(([, entry]) => Object.keys(entry).length === 0).map(([code]) => code)).toEqual([]);
  });
});
