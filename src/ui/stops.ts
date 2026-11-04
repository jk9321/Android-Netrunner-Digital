import { StopLevel } from '../core';

/**
 * Where a person's game stops for paid ability windows (the top bar's
 * toggle): 'auto' where people usually act, 'full' at every window, 'none'
 * never (the player passes every window of the opponent's). Saved in
 * localStorage so the choice carries over; the computer always plays at 'ai'.
 */
const STORAGE_KEY = 'netrunner.stops';

export type PersonStops = Exclude<StopLevel, 'ai'>;

export function savedStops(): PersonStops {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === 'full' || saved === 'none' ? saved : 'auto';
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
      'Auto: your game stops only where you could act (rez windows during runs, before the Runner\'s turn, the end of the Corp\'s turn when you have an ability to use). Click to stop at every window.',
  },
  full: {
    short: 'ALL',
    title: 'All: your game stops at every paid ability window (rules 9.2.7) so you can use abilities or rez. Click to pass every window.',
  },
  none: {
    short: 'NONE',
    title:
      'None: you pass every window in the other player\'s turn and runs, so as the Corp you will not be asked to rez ice during runs. Your own moves still wait for you. Click for auto.',
  },
};

/** The toggle's order: auto, then every window, then none. */
export const nextStops = (level: PersonStops): PersonStops => (level === 'auto' ? 'full' : level === 'full' ? 'none' : 'auto');
