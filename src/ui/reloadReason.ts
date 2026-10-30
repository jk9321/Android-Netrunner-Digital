/**
 * Explains, after the page comes back, why it went away. The game resumes from
 * its autosave on every load, so a reload looks the same whatever caused it:
 * this tells the player (and us) which it was.
 *
 * - We reloaded on purpose (a new deploy, see chunkReload.ts): the reason is
 *   stashed in sessionStorage just before the reload.
 * - The browser unloaded the tab to save memory (Chrome's Memory Saver):
 *   document.wasDiscarded is set on the new page.
 * - The tab crashed (usually out of memory): the old page never got its
 *   pagehide event, so its "alive" mark is still in sessionStorage, which the
 *   browser keeps for the tab across a crash.
 *
 * Each explanation is also kept in a short log in localStorage.
 */

const REASON_KEY = 'netrunner.reloadReason';
const ALIVE_KEY = 'netrunner.pageAlive';
const LOG_KEY = 'netrunner.reloadLog';
const LOG_SIZE = 10;
const HEARTBEAT_MS = 15_000;

interface AliveMark {
  /** When the page last checked in. */
  at: number;
  /** JS memory in use then (Chrome only). */
  heapMb?: number;
}

export interface ReloadLogEntry {
  at: number;
  message: string;
}

type Win = Pick<Window, 'sessionStorage' | 'localStorage' | 'addEventListener' | 'setInterval'> & {
  document: { wasDiscarded?: boolean };
  performance: { memory?: { usedJSHeapSize: number } };
};

const read = <T>(storage: () => Storage, key: string): T | null => {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const write = (storage: () => Storage, key: string, value: unknown) => {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, JSON.stringify(value));
  } catch {
    // No storage (private mode or full): nothing is explained after a reload
  }
};

/** Call right before reloading the page ourselves, with why. */
export function noteReloadReason(reason: string, win: Pick<Window, 'sessionStorage'> = window): void {
  write(() => win.sessionStorage, REASON_KEY, reason);
}

/** Recent explanations, newest last. */
export function reloadLog(win: Pick<Window, 'localStorage'> = window): ReloadLogEntry[] {
  return read<ReloadLogEntry[]>(() => win.localStorage, LOG_KEY) ?? [];
}

/** Adds a line to the log (also used for problems that don't reload, like the AI worker failing). */
export function logReloadEvent(message: string, win: Pick<Window, 'localStorage'> = window): void {
  write(() => win.localStorage, LOG_KEY, [...reloadLog(win), { at: Date.now(), message }].slice(-LOG_SIZE));
}

const ago = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)} min`);

/**
 * Works out why the previous page in this tab went away, or null if it closed
 * normally (a first visit, or the player pressing reload). Clears the marks it
 * reads, so call it once per load, before installReloadWatch.
 */
export function diagnoseLoad(win: Win = window as unknown as Win): string | null {
  const ss = () => win.sessionStorage;
  const reason = read<string>(ss, REASON_KEY);
  const alive = read<AliveMark>(ss, ALIVE_KEY);
  write(ss, REASON_KEY, null);
  write(ss, ALIVE_KEY, null);

  let message: string | null = null;
  if (reason) {
    message = `Reloaded: ${reason}. Any game in progress was restored.`;
  } else if (win.document.wasDiscarded) {
    message = 'Your browser unloaded this tab to save memory while it was in the background. Any game in progress was restored.';
  } else if (alive) {
    const heap = alive.heapMb ? `, using ${alive.heapMb} MB of memory ${ago(Date.now() - alive.at)} before` : '';
    message = `The browser tab crashed (most likely out of memory${heap}). Any game in progress was restored.`;
  }
  if (message) logReloadEvent(message, win);
  return message;
}

/** Marks this page alive until it closes normally, refreshing its memory reading now and then. */
export function installReloadWatch(win: Win = window as unknown as Win): void {
  const mark = () => {
    const used = win.performance.memory?.usedJSHeapSize;
    write(() => win.sessionStorage, ALIVE_KEY, { at: Date.now(), heapMb: used ? Math.round(used / 1_048_576) : undefined } satisfies AliveMark);
  };
  mark();
  win.setInterval(mark, HEARTBEAT_MS);
  // pagehide fires on every normal unload (reload, close, navigate, back/forward cache)
  win.addEventListener('pagehide', () => write(() => win.sessionStorage, ALIVE_KEY, null));
  win.addEventListener('pageshow', mark);
}
