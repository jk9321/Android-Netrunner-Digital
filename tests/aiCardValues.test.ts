import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from '../src/core';
import { isIcebreaker } from '../src/core/engine/ice';
import { CARD_VALUES } from '../src/ai/cardValues';

describe('AI card values', () => {
  it('values every Corp asset and upgrade and every non-icebreaker Runner install', () => {
    const missing = ALL_CARDS.filter(def => {
      const entry = CARD_VALUES[def.code];
      if (def.side_code === 'corp' && def.type_code === 'asset') return entry?.keep === undefined;
      if (def.side_code === 'corp' && def.type_code === 'upgrade') return entry?.keep === undefined || !entry.upgrade;
      if (def.side_code === 'runner' && ['program', 'hardware', 'resource'].includes(def.type_code)) {
        return !isIcebreaker({ cardCode: def.code } as never) && entry?.rig === undefined;
      }
      return false;
    }).map(def => `${def.code} ${def.title}`);
    expect(missing).toEqual([]);
  });

  it('only lists cards in the pool', () => {
    const codes = new Set(ALL_CARDS.map(def => def.code));
    expect(Object.keys(CARD_VALUES).filter(code => !codes.has(code))).toEqual([]);
  });
});
