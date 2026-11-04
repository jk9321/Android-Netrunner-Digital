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

/**
 * Auto fit: each scrolling board area (Corp servers, Runner rig) shrinks its
 * cards, down to a floor, until its contents fit without scrolling. On by
 * default; the header's Fit button turns it off. See useAutoFit.ts.
 */
const AUTO_FIT_KEY = 'netrunner.autoFit';
export const AUTO_FIT_EVENT = 'netrunner:autofit';

export function savedAutoFit(): boolean {
  try {
    return window.localStorage.getItem(AUTO_FIT_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function isAutoFitOn(): boolean {
  return document.documentElement.dataset.autoFit !== 'off';
}

export function applyAutoFit(on: boolean): void {
  document.documentElement.dataset.autoFit = on ? 'on' : 'off';
  window.dispatchEvent(new Event(AUTO_FIT_EVENT));
}

export function setAutoFit(on: boolean): void {
  applyAutoFit(on);
  try {
    window.localStorage.setItem(AUTO_FIT_KEY, on ? 'on' : 'off');
  } catch {
    // Not saved; the setting still applies for this page
  }
}
