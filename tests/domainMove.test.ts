import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOVED_KEY, NEW_ORIGIN, OLD_HOST, handoffUrl, importHandoff, mergeHandoff, redirectFromOldHost } from '../src/ui/domainMove';

function memoryStorage(initial: Record<string, string> = {}): Storage & { store: Record<string, string> } {
  const store = { ...initial };
  return {
    store,
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
}

const deckA = { id: 'custom-a', name: 'Mine', side: 'corp', identity: 'X', cards: { Hedge: 3 } };
const deckB = { id: 'custom-b', name: 'Other', side: 'runner', identity: 'Y', cards: { Sure: 3 } };

function stubWindow(hostname: string, hash: string, storage: Storage) {
  const replace = vi.fn();
  const replaceState = vi.fn();
  vi.stubGlobal('window', {
    location: { hostname, pathname: '/', search: '', hash, replace },
    history: { replaceState },
    localStorage: storage,
  });
  return { replace, replaceState };
}

afterEach(() => vi.unstubAllGlobals());

describe('domain move', () => {
  it('carries decks and settings from the old address to stackheap.run, and they arrive intact', () => {
    const old = memoryStorage({
      'netrunner.customDecks.v1': JSON.stringify([deckA]),
      'netrunner.favoriteDecks.v1': JSON.stringify(['custom-a']),
      'netrunner.sound': 'off',
      'netrunner.reloadLog': 'diagnostics stay behind',
    });
    const { replace } = stubWindow(OLD_HOST, '', old);
    expect(redirectFromOldHost()).toBe(true);
    const url: string = replace.mock.calls[0][0];
    expect(url.startsWith(`${NEW_ORIGIN}/#import=`)).toBe(true);
    expect(old.store[MOVED_KEY]).toBe('1');

    const fresh = memoryStorage();
    const { replaceState } = stubWindow('stackheap.run', url.slice(url.indexOf('#')), fresh);
    importHandoff();
    expect(JSON.parse(fresh.store['netrunner.customDecks.v1'])).toEqual([deckA]);
    expect(fresh.store['netrunner.favoriteDecks.v1']).toBe('["custom-a"]');
    expect(fresh.store['netrunner.sound']).toBe('off');
    expect(fresh.store['netrunner.reloadLog']).toBeUndefined();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it('hands data over only once, so decks deleted on the new site do not come back', () => {
    const old = memoryStorage({ 'netrunner.customDecks.v1': JSON.stringify([deckA]), [MOVED_KEY]: '1' });
    expect(handoffUrl(old, { pathname: '/', search: '' })).toBe(`${NEW_ORIGIN}/`);
  });

  it('never redirects the beta preview or other addresses', () => {
    const { replace } = stubWindow('beta-android-netrunner-digital.jk9321.workers.dev', '', memoryStorage());
    expect(redirectFromOldHost()).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('merges without overwriting what the new site already has', () => {
    const here = memoryStorage({
      'netrunner.customDecks.v1': JSON.stringify([{ ...deckA, name: 'Edited here' }]),
      'netrunner.hiddenDecks.v1': JSON.stringify(['x']),
      'netrunner.sound': 'on',
      'netrunner.savedGame.v1': 'game here',
    });
    mergeHandoff(here, {
      'netrunner.customDecks.v1': JSON.stringify([deckA, deckB]),
      'netrunner.hiddenDecks.v1': JSON.stringify(['x', 'y']),
      'netrunner.sound': 'off',
      'netrunner.savedGame.v1': 'game there',
    });
    const decks = JSON.parse(here.store['netrunner.customDecks.v1']);
    expect(decks.map((d: { name: string }) => d.name)).toEqual(['Edited here', 'Other']);
    expect(JSON.parse(here.store['netrunner.hiddenDecks.v1'])).toEqual(['x', 'y']);
    expect(here.store['netrunner.sound']).toBe('on');
    expect(here.store['netrunner.savedGame.v1']).toBe('game here');
  });

  it('leaves a huge game in progress behind rather than build a link browsers refuse', () => {
    const old = memoryStorage({
      'netrunner.customDecks.v1': JSON.stringify([deckA]),
      'netrunner.savedGame.v1': 'x'.repeat(1_000_000),
    });
    const url = handoffUrl(old, { pathname: '/', search: '' });
    expect(url.length).toBeLessThan(10_000);
    expect(url).toContain('#import=');
  });

  it('ignores a garbled handoff link', () => {
    const fresh = memoryStorage();
    const { replaceState } = stubWindow('stackheap.run', '#import=!!notbase64', fresh);
    importHandoff();
    expect(fresh.store).toEqual({});
    expect(replaceState).toHaveBeenCalled();
  });
});
