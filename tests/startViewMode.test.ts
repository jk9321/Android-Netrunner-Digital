import { afterEach, describe, expect, it, vi } from 'vitest';
import { VIEW_MODE_KEY, startViewMode } from '../src/ui/gameStart';

// Issue #74: "Pass and play" from the menu opened on Open table, so the Runner saw the Corp's facedown cards.
describe('startViewMode (issue #74)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const withSaved = (mode: string) => {
    const store = new Map([[VIEW_MODE_KEY, mode]]);
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null } });
  };

  it('a new two-player game opens in pass and play, even after Open table was used', () => {
    withSaved('open');
    expect(startViewMode(null, false)).toBe('hotseat');
  });

  it('a resumed two-player game keeps the mode last used', () => {
    withSaved('open');
    expect(startViewMode(null, true)).toBe('open');
  });

  it('a resumed two-player game with nothing saved hides secrets', () => {
    expect(startViewMode(null, true)).toBe('hotseat');
  });

  it('against the computer the person sees their own side', () => {
    expect(startViewMode('runner', false)).toBe('corp');
    expect(startViewMode('corp', true)).toBe('runner');
  });
});
