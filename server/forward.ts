/**
 * The site Worker's side of the game server (used by worker/index.ts): it
 * forwards /api/games/* (HTTP and WebSocket upgrades) to the game Worker
 * through a service binding, so the browser only talks to its own origin.
 * The production hosts use GAMES (netrunner-games, built from main); every
 * other host (the beta preview, branch previews) uses GAMES_STAGING.
 *
 * Bug reports from an online game (POST /api/games/:code/report?token=...)
 * stop here: the site asks the room for its attachment, adds it to the
 * player's description and files the report through the usual bug-report
 * path, and the browser gets only a status, never the attachment (spec rule 9).
 */
import { handleBugReport } from '../worker/bugReport';
import type { BugReportEnv } from '../worker/bugReport';
import { parseRoomCode } from '../src/net/protocol';
import type { Fetcher } from './cf';
import type { RoomReport } from './room';
import { json, readJson } from './http';

export interface ForwardEnv extends BugReportEnv {
  GAMES?: Fetcher;
  GAMES_STAGING?: Fetcher;
}

export const PRODUCTION_HOSTS = ['stackheap.run', 'www.stackheap.run', 'android-netrunner-digital.jk9321.workers.dev'];

export const isGamesPath = (pathname: string) => pathname === '/api/games' || pathname.startsWith('/api/games/');

export function gamesBinding(env: ForwardEnv, host: string): Fetcher | undefined {
  return PRODUCTION_HOSTS.includes(host) ? env.GAMES : env.GAMES_STAGING;
}

export async function forwardGames(request: Request, env: ForwardEnv): Promise<Response> {
  const url = new URL(request.url);
  const games = gamesBinding(env, url.host);
  if (!games) return json({ error: 'server' }, 503);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 4 && parts[3] === 'report') return gameReport(request, env, games, parts[2], url.searchParams.get('token') ?? '');
  return games.fetch(request);
}

/** gzip then base64 (CompressionStream exists in Workers and in Node). */
async function compress(text: string): Promise<string | undefined> {
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

const deckText = (deck: { identity: string; cards: string[] } | null | undefined) => (deck ? [deck.identity, ...deck.cards].join('\n') : '');

/**
 * The report the bug-report path files: the player's own fields, with the
 * room's attachment as the game. While the game is on the attachment is the
 * reporter's own view (issues are public, and the real state would show the
 * opponent's hand); once it is over, the real state and moves.
 */
export async function onlineReportBody(client: Record<string, unknown>, att: RoomReport): Promise<Record<string, unknown>> {
  const log = att.full ? (att.state?.log ?? []).map(e => `${e.turnNumber} ${e.player}: ${e.message}`) : (att.view?.log ?? []).map(e => `${e.turnNumber} ${e.player}: ${e.message}`);
  const snapshot = await compress(
    JSON.stringify({
      config: { online: att.code, format: att.format, build: att.build, seat: att.seat, seed: att.seed, decks: att.decks },
      state: att.full ? att.state : null,
      view: att.full ? null : att.view,
      table: { moves: att.moves, moveCount: att.moveCount },
    }),
  );
  return {
    description: client.description,
    screen: client.screen,
    version: client.version,
    website: client.website,
    game: {
      seed: att.seed ?? 0,
      format: att.format,
      opponent: `online (reporter: ${att.seat})`,
      turn: `move ${att.moveCount}${att.over ? ', game over' : ''}`,
      replay: `online room ${att.code}${att.full ? '' : ' (game in progress: reporter view only)'}`,
      corpDeck: att.full ? deckText(att.decks?.corp) : '',
      runnerDeck: att.full ? deckText(att.decks?.runner) : '',
      log: log.join('\n'),
      snapshot,
    },
  };
}

async function gameReport(request: Request, env: ForwardEnv, games: Fetcher, rawCode: string, token: string): Promise<Response> {
  const code = parseRoomCode(rawCode);
  if (request.method !== 'POST' || !code) return new Response(null, { status: 404 });
  const client = await readJson(request);
  if (!client || typeof client !== 'object') return new Response(null, { status: 400 });
  const res = await games.fetch(new Request(`https://games/internal/games/${code}/report?token=${encodeURIComponent(token)}`, { method: 'POST' }));
  if (!res.ok) return new Response(null, { status: res.status === 401 ? 401 : 404 });
  const body = await onlineReportBody(client as Record<string, unknown>, (await res.json()) as RoomReport);
  // Filed like any other report (origin check, limits, the issue), from the same request's headers
  const headers = new Headers(request.headers);
  headers.delete('Content-Length');
  const filed = await handleBugReport(new Request(new URL('/api/bug-report', request.url), { method: 'POST', headers, body: JSON.stringify(body) }), env);
  // The browser hears only whether it worked
  return new Response(null, { status: filed.ok ? 204 : filed.status });
}
