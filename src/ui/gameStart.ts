import { SideCode } from '../core';
import { DECKS, DEFAULT_CORP_DECK, DEFAULT_RUNNER_DECK } from '../data/decks';
import { loadCustomDecks } from '../data/customDecks';
import { GameConfig, SavedGame, loadSavedGame } from './savedGame';
import { ViewMode } from './viewer';

export const VIEW_MODE_KEY = 'netrunner.viewMode';

/** The view mode last used in a two-player game. */
export function savedViewMode(): ViewMode {
  try {
    const v = window.localStorage.getItem(VIEW_MODE_KEY);
    if (v === 'open' || v === 'hotseat' || v === 'corp' || v === 'runner') return v;
  } catch {
    // Storage blocked: use the default
  }
  return 'open';
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/**
 * `?seed=123&corp=<deck id>&runner=<deck id>` starts that exact game (to
 * replay a deal), and `&ai=corp` or `&ai=runner` hands one side to the
 * computer (`&difficulty=hard` for the search AI); without a seed the app opens on the deck picker.
 */
function configFromUrl(): GameConfig | null {
  const params = new URLSearchParams(window.location.search);
  const seed = Number(params.get('seed'));
  if (!Number.isInteger(seed) || seed <= 0) return null;
  const decks = [...DECKS, ...loadCustomDecks()];
  const find = (id: string | null, side: SideCode, fallback: string) =>
    decks.find(d => d.id === id && d.side === side) ?? decks.find(d => d.id === fallback)!;
  return {
    seed,
    corpDeck: find(params.get('corp'), 'corp', DEFAULT_CORP_DECK),
    runnerDeck: find(params.get('runner'), 'runner', DEFAULT_RUNNER_DECK),
    ai: params.get('ai') === 'corp' || params.get('ai') === 'runner' ? (params.get('ai') as SideCode) : null,
    difficulty: params.get('difficulty') === 'hard' ? 'hard' : 'normal',
  };
}

/**
 * The game to open on: a `?seed=` link, or else the game in progress before
 * the page reloaded. A saved game resumes a link only if it is that same deal.
 */
export function startingGame(): { config: GameConfig | null; saved: SavedGame | null } {
  const fromUrl = configFromUrl();
  const saved = loadSavedGame();
  if (fromUrl) {
    const same =
      saved &&
      saved.config.seed === fromUrl.seed &&
      saved.config.corpDeck.id === fromUrl.corpDeck.id &&
      saved.config.runnerDeck.id === fromUrl.runnerDeck.id &&
      saved.config.ai === fromUrl.ai;
    return { config: fromUrl, saved: same ? saved : null };
  }
  return { config: saved?.config ?? null, saved };
}
