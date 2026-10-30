/**
 * Comfort mode, toggled in the header. It sets data-comfort on <html>, which
 * index.css reads to drop the scanlines, text glow and colour split, stop every
 * looping animation and nudge the smallest text up a size, for long sessions
 * on lower-resolution screens. Saved in localStorage; with nothing saved it
 * follows the OS "reduce motion" setting.
 */

const STORAGE_KEY = 'netrunner.comfort';

export function savedComfort(): boolean {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'on') return true;
    if (saved === 'off') return false;
  } catch {
    // Storage blocked; fall back to the OS setting
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function applyComfort(on: boolean): void {
  if (on) document.documentElement.dataset.comfort = 'on';
  else delete document.documentElement.dataset.comfort;
}

export function setComfort(on: boolean): void {
  applyComfort(on);
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Not saved; the setting still applies for this page
  }
}
