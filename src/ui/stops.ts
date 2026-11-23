import { StopLevel } from '../core';
import { readStorage, writeStorage } from './storage';

/**
 * Where a person's game stops for paid ability windows (the top bar's
 * toggle): 'auto' where people usually act, 'full' at every window. Saved in
 * localStorage so the choice carries over; the computer always plays at 'ai'.
 * There is no 'none' for people any more (issue #63, Jeff 2026-11-23): it
 * passed the Corp's rez windows (rule 6.4.3), and AUTO already skips every
 * window with nothing to do. A saved 'none' reads as 'auto'. The engine keeps
 * 'none' in StopLevel so older saved games and bug-report snapshots load.
 */
const STORAGE_KEY = 'netrunner.stops';

export type PersonStops = Extract<StopLevel, 'auto' | 'full'>;

export function savedStops(): PersonStops {
  const saved = readStorage(STORAGE_KEY);
  return saved === 'full' ? 'full' : 'auto';
}

export function saveStops(level: PersonStops): void {
  writeStorage(STORAGE_KEY, level);
}

export const STOP_LABELS: Record<PersonStops, { short: string; title: string }> = {
  auto: {
    short: 'AUTO',
    title:
      'Auto: your game stops only where you could act (rez windows during runs, before the Runner\'s turn, the end of the Corp\'s turn when you have an ability to use). Online, a pause can tell your opponent you have something you can use there; All stops every time and gives nothing away. Click to stop at every window.',
  },
  full: {
    short: 'ALL',
    title: 'All: your game stops at every paid ability window (rules 9.2.7) so you can use abilities or rez. Click for auto.',
  },
};

/** The toggle: auto and every window. */
export const nextStops = (level: PersonStops): PersonStops => (level === 'auto' ? 'full' : 'auto');
