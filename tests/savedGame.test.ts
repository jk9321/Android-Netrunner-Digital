import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialGameState } from '../src/core';
import { playAIGame } from '../src/ai';
import { DECKS, deckGameSetup } from '../src/data/decks';
import { GameConfig, SAVE_VERSION, clearSavedGame, loadSavedGame, saveGame } from '../src/ui/savedGame';

function fakeStorage() {
  const store: Record<string, string> = {};
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    },
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

const corpDeck = DECKS.find(d => d.side === 'corp')!;
const runnerDeck = DECKS.find(d => d.side === 'runner')!;
const config: GameConfig = { seed: 4242, corpDeck, runnerDeck, ai: 'corp', difficulty: 'normal' };
const table = { runSerial: 3, passedRezWindows: ['a'], hotseatSide: 'runner' as const, accessed: ['30001'] };

describe('saved game', () => {
  it('resumes a game mid-play exactly where it was', () => {
    fakeStorage();
    const start = createInitialGameState(deckGameSetup(config.seed, corpDeck, runnerDeck));
    const mid = playAIGame(start, 80).state;
    expect(mid.winner).toBeFalsy();
    expect(saveGame({ config, state: mid, table })).toBe(true);

    const loaded = loadSavedGame()!;
    expect(loaded.config).toEqual(config);
    expect(loaded.table).toEqual(table);
    expect(loaded.state).toEqual(JSON.parse(JSON.stringify(mid)));

    // The reloaded game plays on identically to the one that never left memory
    const a = playAIGame(mid, 150).state;
    const b = playAIGame(loaded.state, 150).state;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('drops finished games, corrupt data and cleared saves', () => {
    const store = fakeStorage();
    const start = createInitialGameState(deckGameSetup(config.seed, corpDeck, runnerDeck));
    saveGame({ config, state: { ...start, winner: 'corp' }, table });
    expect(loadSavedGame()).toBeNull();
    store['netrunner.savedGame.v1'] = '{not json';
    expect(loadSavedGame()).toBeNull();
    saveGame({ config, state: start, table });
    expect(loadSavedGame()).not.toBeNull();
    clearSavedGame();
    expect(loadSavedGame()).toBeNull();
  });

  it('drops saves written with another save version', () => {
    const store = fakeStorage();
    const start = createInitialGameState(deckGameSetup(config.seed, corpDeck, runnerDeck));
    saveGame({ config, state: start, table });
    const raw = JSON.parse(store['netrunner.savedGame.v1']);
    expect(raw.version).toBe(SAVE_VERSION);
    store['netrunner.savedGame.v1'] = JSON.stringify({ ...raw, version: SAVE_VERSION + 1 });
    expect(loadSavedGame()).toBeNull();
  });

  it('works without storage', () => {
    vi.stubGlobal('window', {});
    expect(saveGame({ config, state: {} as never, table })).toBe(false);
    expect(loadSavedGame()).toBeNull();
    expect(() => clearSavedGame()).not.toThrow();
  });
});
