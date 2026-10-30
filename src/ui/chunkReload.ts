import { noteReloadReason } from './reloadReason';

/**
 * Recovers from a new deploy while the page is open. Each build gives its lazy
 * chunks new hashed names and the old files are gone from the server, so a tab
 * opened before the deploy fails the first time it opens a lazy screen (the
 * deck builder, deck import, the AI) with "Failed to fetch dynamically imported
 * module". Reloading fetches the new index.html and its chunks; the game in
 * progress resumes from its autosave.
 */

const RELOAD_KEY = 'netrunner.chunkReloadAt';
// A second chunk failure this soon after a reload isn't a stale tab (the
// server or network is down), so show the error instead of reloading forever.
const RELOAD_COOLDOWN_MS = 30_000;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
    message,
  );
}

/** Reloads the page once to pick up the new build. False if it just did. */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // No sessionStorage (private mode): reload anyway, the browser caps loops
  }
  noteReloadReason('a new version of the game was deployed');
  window.location.reload();
  return true;
}

/** Vite fires vite:preloadError when a lazy import or its CSS fails to load. */
export function installChunkReload(): void {
  window.addEventListener('vite:preloadError', event => {
    if (reloadForNewBuild()) event.preventDefault();
  });
}
