/**
 * Board card size picked in the header. Large sets data-card-size on <html>,
 * which index.css reads to raise --card-w (and with it --card-h) for every
 * card on the table. Saved in localStorage so the choice carries over.
 */

export type CardSize = 'normal' | 'large';

const STORAGE_KEY = 'netrunner.cardSize';

export function savedCardSize(): CardSize {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'large' ? 'large' : 'normal';
  } catch {
    return 'normal';
  }
}

export function applyCardSize(size: CardSize): void {
  document.documentElement.dataset.cardSize = size;
}

export function setCardSize(size: CardSize): void {
  applyCardSize(size);
  try {
    window.localStorage.setItem(STORAGE_KEY, size);
  } catch {
    // Not saved; the size still applies for this page
  }
}
