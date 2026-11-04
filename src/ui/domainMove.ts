/**
 * Moves players from the old workers.dev address to stackheap.run without
 * losing what this browser saved. Saved data lives in localStorage, which a
 * browser keeps per address, so the new site can't read the old site's copy.
 * The old site reads it and hands it over in the link's #fragment, which the
 * browser never sends to a server, so it never shows up in logs.
 *
 * Only the old production address redirects. The beta preview, other branch
 * previews and local dev have different hostnames and are left alone.
 */

export const OLD_HOST = 'android-netrunner-digital.jk9321.workers.dev';
export const NEW_ORIGIN = 'https://stackheap.run';

const HANDOFF_PREFIX = '#import=';
/** Set on the old site once its data has been handed over. */
export const MOVED_KEY = 'netrunner.movedToStackheap';
const SAVED_GAME_KEY = 'netrunner.savedGame.v1';
const CUSTOM_DECKS_KEY = 'netrunner.customDecks.v1';
const LIST_KEYS = ['netrunner.favoriteDecks.v1', 'netrunner.hiddenDecks.v1'];
/** Settings: copied only where the new site has none yet. */
const SETTING_KEYS = [
  'netrunner.animations',
  'netrunner.cardSize',
  'netrunner.viewMode',
  'netrunner.music',
  'netrunner.music.volume',
  'netrunner.sound',
  'netrunner.opponent',
  'netrunner.difficulty',
];
/** Everything the handoff carries. Reload diagnostics stay behind. */
export const HANDOFF_KEYS = [CUSTOM_DECKS_KEY, ...LIST_KEYS, SAVED_GAME_KEY, ...SETTING_KEYS];

// Browsers cap link length (Firefox at about 1 MB), so a game in progress
// that would push the link past this is left behind. Decks are about 1 KB each.
const MAX_FRAGMENT_CHARS = 900_000;

type Handoff = Record<string, string>;

function encode(data: Handoff): string {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(text: string): Handoff | null {
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: Handoff = {};
    for (const key of HANDOFF_KEYS) {
      const v = (parsed as Record<string, unknown>)[key];
      if (typeof v === 'string') out[key] = v;
    }
    return out;
  } catch {
    return null;
  }
}

/** The link to send this browser to, carrying its saved data the first time. */
export function handoffUrl(storage: Storage, loc: Pick<Location, 'pathname' | 'search'>): string {
  const base = NEW_ORIGIN + loc.pathname + loc.search;
  if (storage.getItem(MOVED_KEY)) return base;
  const data: Handoff = {};
  for (const key of HANDOFF_KEYS) {
    const v = storage.getItem(key);
    if (v !== null) data[key] = v;
  }
  if (Object.keys(data).length === 0) return base;
  let payload = encode(data);
  if (payload.length > MAX_FRAGMENT_CHARS) {
    delete data[SAVED_GAME_KEY];
    payload = encode(data);
  }
  if (payload.length > MAX_FRAGMENT_CHARS) return base;
  return base + HANDOFF_PREFIX + payload;
}

/**
 * On the old address: sends the player to stackheap.run and returns true, so
 * the caller skips starting the app. Anywhere else returns false.
 */
export function redirectFromOldHost(): boolean {
  if (window.location.hostname !== OLD_HOST) return false;
  let url = NEW_ORIGIN + window.location.pathname + window.location.search;
  try {
    url = handoffUrl(window.localStorage, window.location);
    // Hand over once. Sending it again on later visits would bring back
    // decks the player has since deleted on the new site.
    window.localStorage.setItem(MOVED_KEY, '1');
  } catch {
    // Storage blocked: nothing to carry, just redirect
  }
  window.location.replace(url);
  return true;
}

function parseList(raw: string | null): unknown[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Merges handed-over data into this site's storage. Nothing already saved
 * here is overwritten: decks are joined by id (this site's copy wins),
 * favorite and hidden lists are joined, and a game in progress or a
 * setting is copied only where this site has none.
 */
export function mergeHandoff(storage: Storage, data: Handoff): void {
  for (const [key, value] of Object.entries(data)) {
    if (key === CUSTOM_DECKS_KEY) {
      const here = parseList(storage.getItem(key));
      const ids = new Set(here.map(d => (d as { id?: unknown })?.id));
      const added = parseList(value).filter(d => !ids.has((d as { id?: unknown })?.id));
      if (added.length > 0) storage.setItem(key, JSON.stringify([...here, ...added]));
    } else if (LIST_KEYS.includes(key)) {
      const here = parseList(storage.getItem(key));
      const joined = [...new Set([...here, ...parseList(value)])];
      if (joined.length > here.length) storage.setItem(key, JSON.stringify(joined));
    } else if (storage.getItem(key) === null) {
      storage.setItem(key, value);
    }
  }
}

/** Reads a handoff from the link, if there is one, and clears it from the address bar. */
export function importHandoff(): void {
  const hash = window.location.hash;
  if (!hash.startsWith(HANDOFF_PREFIX)) return;
  const data = decode(hash.slice(HANDOFF_PREFIX.length));
  try {
    if (data) mergeHandoff(window.localStorage, data);
  } catch {
    // Storage full or blocked: the player starts fresh here
  }
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}
