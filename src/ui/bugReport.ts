import type { GameState } from '../core';
import type { DeckList } from '../data/decks';
import { GameConfig, SavedTable, loadSavedGame } from './savedGame';

/**
 * Builds what the "Report a bug" button sends to /api/bug-report (see
 * worker/bugReport.ts, which checks and trims every field again). Reports
 * become public, so nothing here identifies the player: from a game it is
 * the deck lists, the log, the seed and a snapshot of the game; anywhere
 * else only the description, the screen and the app version.
 */

export const MAX_DESCRIPTION = 1000;
export const MIN_DESCRIPTION = 10;
export const BUG_REPORT_URL = '/api/bug-report';

export type ReportScreen = 'game' | 'deck picker' | 'deck builder' | 'decklist' | 'crash screen';

export interface GameForReport {
  config: GameConfig;
  state: GameState;
  table?: SavedTable;
}

export interface ReportPayload {
  description: string;
  screen: ReportScreen;
  version: string;
  website: string;
  game?: {
    seed: number;
    format: string;
    opponent: string;
    turn: string;
    replay: string;
    corpDeck: string;
    runnerDeck: string;
    log: string;
    snapshot?: string;
  };
  crash?: { message: string; stack?: string };
}

/** The table state autosaved for this game (rez windows passed, accesses shown), if there is one. */
export function savedTableFor(seed: number): SavedTable | undefined {
  const saved = loadSavedGame();
  return saved && saved.config.seed === seed ? saved.table : undefined;
}

export const appVersion = (): string => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev');

const formatName = (deck: DeckList) => deck.format ?? 'casual';

export function deckText(deck: DeckList): string {
  const lines = Object.entries(deck.cards)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, n]) => `${n}x ${title}`);
  return [`${deck.name} [${deck.source}, ${formatName(deck)}]`, deck.identity, '', ...lines].join('\n');
}

/** The whole log, one line per entry, including lines one side couldn't see (the report is for fixing bugs). */
export function logText(state: GameState): string {
  return state.log.map(e => `T${e.turnNumber} ${e.player}: ${e.message}`).join('\n');
}

export function replayQuery(config: GameConfig): string {
  const ai = config.ai ? `&ai=${config.ai}&difficulty=${config.difficulty}` : '';
  return `?seed=${config.seed}&corp=${config.corpDeck.id}&runner=${config.runnerDeck.id}${ai}`;
}

function turnText(state: GameState): string {
  const side = state.activePlayer === 'corp' ? 'Corp' : 'Runner';
  const over = state.winner ? `, game over (${state.winner} won)` : '';
  return `turn ${state.turnNumber}, ${side} active, phase ${state.phase}${state.activeRun ? ' (run in progress)' : ''}${over}; score ${state.corp.score}-${state.runner.score}`;
}

/** gzip then base64, or undefined where the browser can't compress. */
export async function compress(text: string): Promise<string | undefined> {
  if (typeof CompressionStream === 'undefined') return undefined;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  } catch {
    return undefined;
  }
}

export async function gameReport(game: GameForReport): Promise<NonNullable<ReportPayload['game']>> {
  const { config, state, table } = game;
  return {
    seed: config.seed,
    format: `Corp deck ${formatName(config.corpDeck)}, Runner deck ${formatName(config.runnerDeck)}`,
    opponent: config.ai ? `computer plays the ${config.ai} (${config.difficulty})` : 'two players',
    turn: turnText(state),
    replay: replayQuery(config),
    corpDeck: deckText(config.corpDeck),
    runnerDeck: deckText(config.runnerDeck),
    log: logText(state),
    snapshot: await compress(JSON.stringify({ config, state, table })),
  };
}

export async function buildReport(input: {
  description: string;
  screen: ReportScreen;
  website?: string;
  game?: GameForReport | null;
  crash?: { message: string; stack?: string };
}): Promise<ReportPayload> {
  const payload: ReportPayload = {
    description: input.description.trim().slice(0, MAX_DESCRIPTION),
    screen: input.screen,
    version: appVersion(),
    website: input.website ?? '',
  };
  if (input.game) payload.game = await gameReport(input.game);
  if (input.crash) payload.crash = input.crash;
  return payload;
}

/** Sends the report; resolves to null when it went through, or the message to show. */
export async function sendReport(payload: ReportPayload): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(BUG_REPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  let body: { ok?: boolean; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    // Not our endpoint (the local dev server, for one)
  }
  if (response.ok && body.ok) return null;
  return body.error ?? 'The report could not be sent. Please try again later.';
}
