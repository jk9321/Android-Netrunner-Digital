import { afterEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadForNewBuild } from '../src/ui/chunkReload';

function fakeWindow() {
  const store: Record<string, string> = {};
  const reload = vi.fn();
  vi.stubGlobal('window', {
    location: { reload },
    sessionStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    },
  });
  return reload;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('stale build recovery', () => {
  it('recognises lazy chunk load failures from each browser', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/DeckBuilder-De0sByD2.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'cards')"))).toBe(false);
  });

  it('reloads once, then not again within the cooldown', () => {
    vi.useFakeTimers();
    const reload = fakeWindow();
    expect(reloadForNewBuild()).toBe(true);
    expect(reloadForNewBuild()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(31_000);
    expect(reloadForNewBuild()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
