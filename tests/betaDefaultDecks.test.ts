import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from '../src/data/cards';
import { BETA_DEFAULT_DECK_IDS, betaDefaultDecks, deckCodes } from '../src/data/decks';
import { IDENTITY_TEST_DECKS } from '../src/data/testDecks/identityDecks';
import { validateDeck } from '../src/core';

describe('beta default decks', () => {
  const decks = betaDefaultDecks();

  it('has exactly one deck for every identity in the game', () => {
    const identities = ALL_CARDS.filter(c => c.type_code === 'identity').map(c => c.title).sort();
    expect(decks.map(d => d.identity).sort()).toEqual(identities);
    expect(new Set(BETA_DEFAULT_DECK_IDS).size).toBe(BETA_DEFAULT_DECK_IDS.length);
  });

  it('uses NetrunnerDB lists except for the two starter-only identities', () => {
    expect(decks.filter(d => d.source !== 'netrunnerdb').map(d => d.id).sort()).toEqual(['catalyst-starter', 'syndicate-starter']);
  });

  for (const deck of IDENTITY_TEST_DECKS) {
    it(`${deck.name} is legal in its format and credits its NetrunnerDB list`, () => {
      expect(validateDeck(deckCodes(deck))).toEqual([]);
      expect(deck.credit).toMatch(/^By .+ on NetrunnerDB: .+ \(netrunnerdb\.com\/en\/decklist\/\d+\)$/);
    });
  }
});
