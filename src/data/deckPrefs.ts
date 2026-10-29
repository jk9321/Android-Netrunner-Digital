/**
 * Which decks the player starred as favourites and which premade decks they
 * hid from the deck picker, saved in localStorage. Premade decks ship with
 * the game, so they are hidden rather than deleted and can be restored.
 * Storage access is guarded like the custom decks: without it the choices
 * last for the session.
 */

const FAVORITES_KEY = 'netrunner.favoriteDecks.v1';
const HIDDEN_KEY = 'netrunner.hiddenDecks.v1';

function loadIds(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Returns false when the browser would not store the list. */
function saveIds(key: string, ids: string[]): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}

export const loadFavoriteDecks = () => loadIds(FAVORITES_KEY);
export const saveFavoriteDecks = (ids: string[]) => saveIds(FAVORITES_KEY, ids);
export const loadHiddenDecks = () => loadIds(HIDDEN_KEY);
export const saveHiddenDecks = (ids: string[]) => saveIds(HIDDEN_KEY, ids);

/** Adds the id if missing, removes it if present. */
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
}

/** Favourites first; otherwise keeps the given order. */
export function favoritesFirst<T>(items: T[], favorites: string[], idOf: (item: T) => string): T[] {
  const fav = new Set(favorites);
  return [...items.filter(d => fav.has(idOf(d))), ...items.filter(d => !fav.has(idOf(d)))];
}
