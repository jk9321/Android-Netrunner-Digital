import { useEffect, useState } from 'react';
import { readStorage, writeStorage } from './storage';

/**
 * Pass-and-play (hotseat) board orientation preference toggled in the header settings menu.
 * Enabled by default so each player's own board sits on the bottom on their turn; disabling it
 * keeps Corp on top and Runner on bottom across turn handoffs for shared-screen play.
 */
const STORAGE_KEY = 'netrunner.flipHotseatBoards';
const listeners = new Set<() => void>();

export function flipHotseatBoardsEnabled(): boolean {
  return readStorage(STORAGE_KEY) !== 'off';
}

export function setFlipHotseatBoardsEnabled(on: boolean): void {
  writeStorage(STORAGE_KEY, on ? 'on' : 'off');
  listeners.forEach(fn => fn());
}

export function useFlipHotseatBoards(): boolean {
  const [enabled, setEnabled] = useState(flipHotseatBoardsEnabled);
  useEffect(() => {
    const sync = () => setEnabled(flipHotseatBoardsEnabled());
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);
  return enabled;
}
