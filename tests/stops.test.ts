/**
 * The person's stops toggle has AUTO and ALL only (issue #63, Jeff 2026-11-23). NONE passed the Corp's
 * rez windows, the paid ability window when ice is approached and the only normal time to rez ice
 * (Comprehensive Rules 6.4.3, step 6.9.2b), so a player who left it on NONE never got to rez.
 * A NONE saved by an older version reads as AUTO.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextStops, savedStops, STOP_LABELS } from '../src/ui/stops';

function withSaved(value: string | null) {
  const store = new Map<string, string>();
  if (value !== null) store.set('netrunner.stops', value);
  vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } });
}

describe('stops toggle (rule 6.4.3, issue #63)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('switches between auto and full only', () => {
    expect(nextStops('auto')).toBe('full');
    expect(nextStops('full')).toBe('auto');
    expect(Object.keys(STOP_LABELS).sort()).toEqual(['auto', 'full']);
  });

  it('reads a saved NONE as AUTO, and keeps a saved ALL', () => {
    withSaved('none');
    expect(savedStops()).toBe('auto');
    withSaved('full');
    expect(savedStops()).toBe('full');
    withSaved(null);
    expect(savedStops()).toBe('auto');
  });
});
