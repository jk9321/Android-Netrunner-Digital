import { StopLevel } from '../core';

/**
 * Where a person's game stops for paid ability windows (the top bar's
 * toggle): 'auto' where people usually act, 'full' at every window. Saved in
 * localStorage so the choice carries over; the computer always plays at 'ai'.
 */
const STORAGE_KEY = 'netrunner.stops';

export type PersonStops = Exclude<StopLevel, 'ai'>;

export function savedStops(): PersonStops {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'full' ? 'full' : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveStops(level: PersonStops): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // Not saved; the choice still applies to this game
  }
}

export const STOP_LABELS: Record<PersonStops, { short: string; title: string }> = {
  auto: {
    short: 'AUTO',
    title:
      'Auto-skip: your game stops only where players usually act (rez windows during runs, before the Runner\'s turn, the end of the Corp\'s turn). Click for full control.',
  },
  full: {
    short: 'ALL',
    title: 'Full control: your game stops at every paid ability window (rules 9.2.7) so you can use abilities or rez. Click for auto-skip.',
  },
};
