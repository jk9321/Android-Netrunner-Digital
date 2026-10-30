import { describe, expect, it, vi } from 'vitest';
import { diagnoseLoad, installReloadWatch, noteReloadReason, reloadLog } from '../src/ui/reloadReason';

function storage() {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
    removeItem: (k: string) => void delete store[k],
  } as unknown as Storage;
}

/** One browser tab: sessionStorage survives reloads and crashes, each load is a new page. */
function tab() {
  const sessionStorage = storage();
  const localStorage = storage();
  const page = (opts: { discarded?: boolean; heap?: number } = {}) => {
    const handlers: Record<string, () => void> = {};
    const win = {
      sessionStorage,
      localStorage,
      document: { wasDiscarded: opts.discarded },
      performance: { memory: opts.heap ? { usedJSHeapSize: opts.heap * 1_048_576 } : undefined },
      addEventListener: (type: string, fn: () => void) => void (handlers[type] = fn),
      setInterval: vi.fn(),
    };
    return { win: win as never, unload: () => handlers.pagehide?.() };
  };
  return { page, localStorage };
}

describe('reload reasons', () => {
  it('says nothing on a first visit or after a normal reload', () => {
    const t = tab();
    const first = t.page();
    expect(diagnoseLoad(first.win)).toBeNull();
    installReloadWatch(first.win);
    first.unload();
    expect(diagnoseLoad(t.page().win)).toBeNull();
  });

  it('reports a reload the game made itself', () => {
    const t = tab();
    const p = t.page();
    installReloadWatch(p.win);
    noteReloadReason('a new version of the game was deployed', p.win);
    p.unload();
    expect(diagnoseLoad(t.page().win)).toMatch(/new version/);
  });

  it('reports a crashed tab, with its last memory reading', () => {
    const t = tab();
    installReloadWatch(t.page({ heap: 812 }).win);
    // no pagehide: the page died
    const message = diagnoseLoad(t.page().win);
    expect(message).toMatch(/crashed/);
    expect(message).toMatch(/812 MB/);
    expect(reloadLog({ localStorage: t.localStorage } as never)).toHaveLength(1);
  });

  it('reports a tab the browser unloaded to save memory', () => {
    const t = tab();
    installReloadWatch(t.page().win);
    expect(diagnoseLoad(t.page({ discarded: true }).win)).toMatch(/unloaded this tab/);
  });
});
