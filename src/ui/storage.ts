/**
 * Safe browser localStorage helpers. Storage can be missing (SSR/tests), blocked
 * (private windows/sandboxes), or full; every helper catches storage and JSON
 * errors so callers can fall back to in-memory defaults without boilerplate.
 */

function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readStorage(key: string): string | null {
  try {
    return browserStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Returns false when storage is unavailable or refuses the write. */
export function writeStorage(key: string, value: string): boolean {
  try {
    const storage = browserStorage();
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key: string): void {
  try {
    browserStorage()?.removeItem(key);
  } catch {
    // Nothing saved, or storage blocked
  }
}

export function readStorageJson<T>(key: string): T | null {
  try {
    const raw = readStorage(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Returns false when serialization fails or storage refuses the write. */
export function writeStorageJson(key: string, value: unknown): boolean {
  try {
    return writeStorage(key, JSON.stringify(value));
  } catch {
    return false;
  }
}
