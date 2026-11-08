import { GameAction, GameState, SideCode, ViewIds } from '../core';
import type { Difficulty } from '../ai';
import type { DeckList } from '../data/decks';

/**
 * The game in progress, saved in this browser's localStorage after every
 * move so that a page reload resumes it. Browsers reload background tabs
 * on their own (Chrome's Memory Saver discards idle tabs, and the Vite dev
 * server reloads the page when it reconnects), which used to drop the
 * player back on the deck picker. Storage can be missing or full, so every
 * access is guarded: the game then simply isn't saved.
 */

const STORAGE_KEY = 'netrunner.savedGame.v1';

/**
 * Bump this whenever GameState (or SavedTable) changes shape in a way an
 * older save can't be loaded into. Saves with another version are dropped
 * rather than resumed into a game the new code can't draw.
 */
export const SAVE_VERSION = 2;

export interface GameConfig {
  seed: number;
  corpDeck: DeckList;
  runnerDeck: DeckList;
  /** The side the computer plays, or null for two people. */
  ai: SideCode | null;
  difficulty: Difficulty;
}

/** A card the Runner accessed in the latest run, as one viewer saw it; no code: the viewer may not see it (an R&D access seen by the Corp, rules 7.1.2). */
export interface AccessedCard {
  code?: string;
}

/** Table state outside the engine that a resumed game should keep. */
export interface SavedTable {
  runSerial: number;
  passedRezWindows: string[];
  hotseatSide: SideCode;
  /** The latest run's accesses as each viewer saw them (their own view's log). */
  accessed: Record<SideCode | 'both', AccessedCard[]>;
  /** Each side's viewer ids (core/view.ts), so a resumed game keeps the ids its views were built with. */
  ids: Record<SideCode, ViewIds>;
  /** Every move of the game so far, both sides', in order (missing in games saved before 2026-11-05). */
  moves?: GameAction[];
  /** The stops the game started with (moves replay from them). */
  startStops?: GameState['stops'];
}

export interface SavedGame {
  version: number;
  config: GameConfig;
  state: GameState;
  table: SavedTable;
}

function isSavedGame(value: unknown): value is SavedGame {
  const s = value as SavedGame;
  return (
    !!s &&
    s.version === SAVE_VERSION &&
    !!s.config &&
    Number.isInteger(s.config.seed) &&
    !!s.config.corpDeck &&
    !!s.config.runnerDeck &&
    !!s.state &&
    !!s.state.corp &&
    !!s.state.runner &&
    !!s.state.rng &&
    !!s.table &&
    Array.isArray(s.table.passedRezWindows) &&
    !!s.table.ids &&
    !!s.table.accessed
  );
}

export function loadSavedGame(): SavedGame | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSavedGame(parsed) || parsed.state.winner) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Returns false when the browser would not store the game. */
export function saveGame(game: Omit<SavedGame, 'version'>): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SAVE_VERSION, ...game }));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedGame(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing saved, or storage blocked
  }
}
