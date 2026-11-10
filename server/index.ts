/**
 * The game Worker (multiplayer phase 2, chunk 2b): `netrunner-games`, and
 * `netrunner-games-staging` for beta and branch previews. It has no public
 * URL (workers_dev and preview_urls are off in wrangler.games.jsonc): the
 * site Worker forwards /api/games/* to it through a service binding
 * (server/forward.ts), so the browser only ever talks to its own origin.
 *
 *   POST /api/games                      { side, deck, format, visibility?, playerId? } -> { code, seat, token }
 *   POST /api/games/:code/join           { deck, playerId? } -> { seat, token } | 404 | 409 | 422 { reasons }
 *   GET  /api/games/:code                -> LobbyInfo
 *   GET  /api/games/:code/ws?token=...   WebSocket (protocol in src/net/protocol.ts)
 *   POST /internal/games/:code/report?token=...  the room's report attachment, for the site Worker only
 *
 * One Durable Object per game (GameRoom, server/gameRoom.ts), by idFromName(code).
 */
import { PLAYER_ID, PROTOCOL_VERSION, parseRoomCode } from '../src/net/protocol';
import type { CreateGameRequest, CreateGameResponse, HttpError, JoinGameRequest, JoinGameResponse } from '../src/net/protocol';
import type { CreateInput, JoinInput } from './room';
import type { DurableObjectNamespace, RateLimiter } from './cf';
import { hashToken, newRoomCode, newSeed, newToken } from './tokens';
import { json, readJson } from './http';

export { GameRoom } from './gameRoom';

export interface GamesEnv {
  ROOMS: DurableObjectNamespace;
  /** The commit this Worker was deployed from (set by the deploy command); 'dev' otherwise. */
  BUILD_ID?: string;
  /** Room creation per address (spec: rate-limited like the bug reporter). */
  GAME_CREATE_LIMITER?: RateLimiter;
  /** Lobby lookups, joins and socket connects per address (room codes can't be guessed by brute force). */
  GAME_LOOKUP_LIMITER?: RateLimiter;
}

const fail = (error: HttpError['error'], status: number, reasons?: string[]) => json({ error, ...(reasons && { reasons }) } satisfies HttpError, status);

/** A player id for a seat: the one the browser keeps, or a fresh one. */
const playerIdOf = (raw: unknown) => (typeof raw === 'string' && PLAYER_ID.test(raw) ? raw : newToken().slice(0, 22));

const room = (env: GamesEnv, code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));
const roomRequest = (path: string, init?: RequestInit) => new Request(`https://room${path}`, init);
const post = (path: string, body: unknown) => roomRequest(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

async function limited(limiter: RateLimiter | undefined, request: Request): Promise<boolean> {
  if (!limiter) return false;
  const key = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  return !(await limiter.limit({ key })).success;
}

/** Passes a room's answer on, keeping only the fields meant for the browser. */
async function relay(res: Response): Promise<Response> {
  const body = (await res.json().catch(() => ({ error: 'server' }))) as Record<string, unknown>;
  return json(body, res.status);
}

async function create(request: Request, env: GamesEnv): Promise<Response> {
  if (await limited(env.GAME_CREATE_LIMITER, request)) return fail('rate_limited', 429);
  const body = (await readJson(request)) as Partial<CreateGameRequest> | null;
  if (!body || typeof body !== 'object') return fail('bad_request', 400);
  if (body.visibility !== undefined && body.visibility !== 'invite') return fail('bad_request', 400);
  const token = newToken();
  const base: Omit<CreateInput, 'code' | 'now'> = {
    side: body.side as CreateInput['side'],
    deck: body.deck as CreateInput['deck'],
    format: body.format as CreateInput['format'],
    playerId: playerIdOf(body.playerId),
    tokenHash: await hashToken(token),
    build: env.BUILD_ID || 'dev',
    seed: newSeed(),
  };
  // A new code until one is free (32^6 codes: a collision is rare)
  for (let tries = 0; tries < 5; tries++) {
    const code = newRoomCode();
    const res = await room(env, code).fetch(post('/create', { ...base, code }));
    if (res.status === 409) continue;
    if (res.status !== 201) return relay(res);
    return json({ code, seat: base.side, token } satisfies CreateGameResponse, 201);
  }
  return fail('server', 503);
}

async function join(request: Request, env: GamesEnv, code: string): Promise<Response> {
  const body = (await readJson(request)) as Partial<JoinGameRequest> | null;
  if (!body || typeof body !== 'object') return fail('bad_request', 400);
  const token = newToken();
  const input: Omit<JoinInput, 'now'> = { deck: body.deck as JoinInput['deck'], playerId: playerIdOf(body.playerId), tokenHash: await hashToken(token) };
  const res = await room(env, code).fetch(post('/join', input));
  if (!res.ok) return relay(res);
  const { seat } = (await res.json()) as { seat: JoinGameResponse['seat'] };
  return json({ seat, token } satisfies JoinGameResponse);
}

export async function handleGames(request: Request, env: GamesEnv): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.pathname === '/api/games' || url.pathname === '/api/games/') {
    return request.method === 'POST' ? create(request, env) : fail('bad_request', 405);
  }
  // /internal/games/:code/report: reached only through the site Worker's binding (no public URL)
  if (parts[0] === 'internal' && parts[1] === 'games' && parts[3] === 'report' && parts.length === 4 && request.method === 'POST') {
    const code = parseRoomCode(parts[2]);
    if (!code) return fail('not_found', 404);
    return room(env, code).fetch(roomRequest(`/report?token=${encodeURIComponent(url.searchParams.get('token') ?? '')}`, { method: 'POST' }));
  }
  if (parts[0] !== 'api' || parts[1] !== 'games' || parts.length < 3 || parts.length > 4) return fail('not_found', 404);
  const code = parseRoomCode(parts[2]);
  if (!code) return fail('not_found', 404);
  if (await limited(env.GAME_LOOKUP_LIMITER, request)) return fail('rate_limited', 429);
  const sub = parts[3] ?? '';
  if (sub === '' && request.method === 'GET') return relay(await room(env, code).fetch(roomRequest('/lobby')));
  if (sub === 'join' && request.method === 'POST') return join(request, env, code);
  if (sub === 'ws' && request.method === 'GET') {
    // The upgrade goes to the room as it came (headers included); only the path changes
    return room(env, code).fetch(new Request(`https://room/ws?token=${encodeURIComponent(url.searchParams.get('token') ?? '')}`, request));
  }
  return fail('not_found', 404);
}

export default {
  fetch(request: Request, env: GamesEnv): Promise<Response> {
    return handleGames(request, env).catch(err => {
      console.error('games', err);
      return fail('server', 500);
    });
  },
};

/** For tests: the protocol version this Worker speaks. */
export const SERVER_PROTOCOL = PROTOCOL_VERSION;
