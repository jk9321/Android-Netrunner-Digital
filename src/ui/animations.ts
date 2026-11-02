import { useEffect, useState } from 'react';

/**
 * UI animation preference toggled in the header settings menu. Disabling
 * animations sets data-animations="off" on <html> (read by index.css) and
 * turns off JS/Framer Motion transitions across the board. Saved in
 * localStorage so the choice carries over.
 */

const STORAGE_KEY = 'netrunner.animations';
const listeners = new Set<() => void>();

export function animationsEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function applyAnimations(enabled: boolean): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.animations = enabled ? 'on' : 'off';
  }
}

export function setAnimationsEnabled(on: boolean): void {
  applyAnimations(on);
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Not saved; the toggle still works for this page
  }
  listeners.forEach(fn => fn());
}

/** True when either the settings toggle or OS prefers-reduced-motion disables animations. */
export function shouldReduceMotion(): boolean {
  if (!animationsEnabled()) return true;
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

export function useAnimationsEnabled(): boolean {
  const [enabled, setEnabled] = useState(animationsEnabled);
  useEffect(() => {
    const sync = () => setEnabled(animationsEnabled());
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);
  return enabled;
}
