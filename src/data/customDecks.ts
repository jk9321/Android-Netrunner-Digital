import { DeckList, deckCodes } from './decks';
import { isFormatId } from '../core/formats';

/**
 * Player-built decks, saved in this browser's localStorage. Storage can be
 * missing or blocked (private windows, previews), so every access is
 * guarded and the app works without it: decks then last for the session.
 */

const STORAGE_KEY = 'netrunner.customDecks.v1';

function isDeckList(value: unknown): value is DeckList {
  const d = value as DeckList;
  if (!d || typeof d !== 'object') return false;
  if (typeof d.id !== 'string' || typeof d.name !== 'string' || typeof d.identity !== 'string') return false;
  if (d.side !== 'corp' && d.side !== 'runner') return false;
  if (!d.cards || typeof d.cards !== 'object') return false;
  if (!Object.values(d.cards).every(n => Number.isInteger(n) && n > 0)) return false;
  try {
    deckCodes(d); // every title must still be a known card
    return true;
  } catch {
    return false;
  }
}

export function loadCustomDecks(): DeckList[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isDeckList)
      // A format this version doesn't know falls back to casual
      .map(d => ({
        ...d,
        format: isFormatId(d.format) ? d.format : undefined,
        missing: Array.isArray(d.missing) && d.missing.every(m => typeof m?.title === 'string' && Number.isInteger(m.count)) && d.missing.length > 0 ? d.missing : undefined,
        source: 'custom' as const,
      }));
  } catch {
    return [];
  }
}

/** Returns false when the browser would not store the decks. */
export function saveCustomDecks(decks: DeckList[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
    if (decks.length > 0) requestPersistentStorage();
    return true;
  } catch {
    return false;
  }
}

/**
 * Asks the browser to keep this site's storage instead of clearing it when
 * the device runs low on space. Chrome decides on its own for sites people
 * come back to; Firefox asks the player once and remembers the answer. It
 * can't stop a player clearing their own browser data.
 */
export function requestPersistentStorage(): void {
  try {
    const storage = navigator.storage;
    if (!storage?.persist || !storage.persisted) return;
    void storage
      .persisted()
      .then(already => (already ? true : storage.persist()))
      .catch(() => undefined);
  } catch {
    // Not supported
  }
}

/** True when this browser has player-built decks saved. */
export function hasSavedCustomDecks(): boolean {
  try {
    return parseSavedLength(window.localStorage.getItem(STORAGE_KEY)) > 0;
  } catch {
    return false;
  }
}

function parseSavedLength(raw: string | null): number {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
}

export function newCustomDeckId(): string {
  return `custom-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
