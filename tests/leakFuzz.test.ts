import { describe, expect, it } from 'vitest';
import { ALL_DECKS } from '../scripts/nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../src/data/testDecks/nrdb';
import { fuzzGame } from '../scripts/leak-check';

// Leak fuzzer, short version (the full one is scripts/leak-fuzz.ts): random legal moves on fixed
// seeds, both players' views checked after every action (src/core/view.ts, multiplayer phase 1).
const decks = [...ALL_DECKS, ...NRDB_TEST_DECKS];
const corps = decks.filter(d => d.side === 'corp');
const runners = decks.filter(d => d.side === 'runner');

describe('Leak fuzzer', () => {
  it('12 random games: no view holds a card its side may not see', () => {
    const failures = [];
    for (let g = 0; g < 12; g++) {
      const res = fuzzGame(700 + g, corps[(g * 7) % corps.length], runners[(g * 5 + 3) % runners.length], 'random', 300);
      failures.push(...res.failures);
    }
    expect(failures).toEqual([]);
  }, 60_000);
});
