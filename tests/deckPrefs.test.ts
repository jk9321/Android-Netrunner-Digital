import { afterEach, describe, expect, it, vi } from 'vitest';
import { favoritesFirst, loadFavoriteDecks, loadHiddenDecks, saveFavoriteDecks, saveHiddenDecks, toggleId } from '../src/data/deckPrefs';

function fakeStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    },
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe('deck favourites and hidden decks', () => {
  it('round-trips both lists through localStorage', () => {
    fakeStorage();
    expect(saveFavoriteDecks(['a', 'b'])).toBe(true);
    expect(saveHiddenDecks(['syndicate-starter'])).toBe(true);
    expect(loadFavoriteDecks()).toEqual(['a', 'b']);
    expect(loadHiddenDecks()).toEqual(['syndicate-starter']);
  });

  it('ignores corrupt or missing data', () => {
    fakeStorage({ 'netrunner.favoriteDecks.v1': '{bad', 'netrunner.hiddenDecks.v1': '["ok", 3, null]' });
    expect(loadFavoriteDecks()).toEqual([]);
    expect(loadHiddenDecks()).toEqual(['ok']);
  });

  it('reports blocked storage instead of throwing', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } });
    expect(loadFavoriteDecks()).toEqual([]);
    expect(saveFavoriteDecks(['a'])).toBe(false);
  });

  it('toggles an id', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('puts favourites first and keeps the rest in order', () => {
    const decks = ['a', 'b', 'c', 'd'].map(id => ({ id }));
    expect(favoritesFirst(decks, ['c', 'zzz'], d => d.id).map(d => d.id)).toEqual(['c', 'a', 'b', 'd']);
  });
});
