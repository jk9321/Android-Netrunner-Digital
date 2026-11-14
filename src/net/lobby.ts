/**
 * The lobby calls (multiplayer phase 2, chunk 2c): host a game, look one up
 * by its code, join it. Plain fetch, no React. Each failure comes back as the
 * fixed wording the start screen shows (a 422 with the server's reasons about
 * the sender's own deck).
 */
import type { FormatId, SideCode } from '../core';
import { DeckList, deckCodes } from '../data/decks';
import { checkDeck } from '../../server/room';
import { PROTOCOL_VERSION, displayRoomCode, parseRoomCode } from './protocol';
import type { CreateGameRequest, CreateGameResponse, DeckSubmission, HttpError, JoinGameResponse, LobbyInfo } from './protocol';
import type { OnlineSession } from './client';

export const LOBBY_ERROR_TEXT = {
  not_found: 'No game with that code',
  full: 'That game already has two players',
  rate_limited: 'Too many tries, wait a minute',
  over: 'That game is already over',
  network: "Couldn't reach the server. Check your connection and try again.",
  server: 'Something went wrong on the server. Please try again.',
  bad_request: 'The server could not read that request.',
} as const;

export type LobbyFailure = { ok: false; message: string; reasons?: string[]; refresh?: boolean };
export type LobbyResult<T> = ({ ok: true } & T) | LobbyFailure;

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: Fetch = (input, init) => fetch(input, init);

export const submission = (deck: DeckList): DeckSubmission => {
  const spec = deckCodes(deck);
  return { identity: spec.identity, cards: spec.cards };
};

/**
 * Why a deck can't be played online in this format on this side (empty: it
 * can). The same test the server runs when a game is hosted or joined
 * (checkDeck in server/room.ts): validateDeck with that format; the starter
 * identities only with their System Gateway starter deck as it comes (rule 1.4.1a).
 */
export function onlineDeckProblems(deck: DeckList, format: FormatId, side: SideCode): string[] {
  let check;
  try {
    check = checkDeck(submission(deck), format, side);
  } catch {
    return ['The deck could not be read.'];
  }
  return check.ok ? [] : check.reasons;
}

async function failure(res: Response): Promise<LobbyFailure> {
  const body = (await res.json().catch(() => null)) as HttpError | null;
  if (res.status === 404) return { ok: false, message: LOBBY_ERROR_TEXT.not_found };
  if (res.status === 409) return { ok: false, message: LOBBY_ERROR_TEXT.full };
  if (res.status === 429) return { ok: false, message: LOBBY_ERROR_TEXT.rate_limited };
  if (res.status === 422 || body?.error === 'illegal_deck') {
    const reasons = body?.reasons?.filter(r => typeof r === 'string').slice(0, 20) ?? [];
    return { ok: false, message: 'That deck is not legal for this game', reasons };
  }
  if (res.status === 400) return { ok: false, message: LOBBY_ERROR_TEXT.bad_request, reasons: body?.reasons };
  return { ok: false, message: LOBBY_ERROR_TEXT.server };
}

async function call(f: Fetch, url: string, init?: RequestInit): Promise<Response | LobbyFailure> {
  try {
    return await f(url, init);
  } catch {
    return { ok: false, message: LOBBY_ERROR_TEXT.network };
  }
}

const postJson = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** POST /api/games: hosts a game; the session to save and connect with. */
export async function createGame(
  input: { side: SideCode; deck: DeckList; format: FormatId; playerId: string },
  f: Fetch = defaultFetch,
): Promise<LobbyResult<{ session: OnlineSession }>> {
  const body: CreateGameRequest = { side: input.side, deck: submission(input.deck), format: input.format, visibility: 'invite', playerId: input.playerId };
  const res = await call(f, '/api/games', postJson(body));
  if (!(res instanceof Response)) return res;
  if (res.status !== 201 && !res.ok) return failure(res);
  const made = (await res.json().catch(() => null)) as CreateGameResponse | null;
  if (!made || typeof made.code !== 'string' || typeof made.token !== 'string' || (made.seat !== 'corp' && made.seat !== 'runner')) {
    return { ok: false, message: LOBBY_ERROR_TEXT.server };
  }
  return { ok: true, session: { code: made.code, seat: made.seat, token: made.token } };
}

/** GET /api/games/:code: the host's side, identity and format (never the decklist). */
export async function lookupGame(code: string, f: Fetch = defaultFetch): Promise<LobbyResult<{ lobby: LobbyInfo }>> {
  const res = await call(f, `/api/games/${code}`);
  if (!(res instanceof Response)) return res;
  if (!res.ok) return failure(res);
  const lobby = (await res.json().catch(() => null)) as LobbyInfo | null;
  if (!lobby || typeof lobby.hostIdentity !== 'string' || (lobby.hostSide !== 'corp' && lobby.hostSide !== 'runner')) {
    return { ok: false, message: LOBBY_ERROR_TEXT.server };
  }
  if (lobby.protocol !== PROTOCOL_VERSION) return { ok: false, message: 'A new version is available', refresh: true };
  if (lobby.over) return { ok: false, message: LOBBY_ERROR_TEXT.over };
  if (!lobby.open) return { ok: false, message: LOBBY_ERROR_TEXT.full };
  return { ok: true, lobby };
}

/** POST /api/games/:code/join: takes the open seat; the game starts at once. */
export async function joinGame(code: string, input: { deck: DeckList; playerId: string }, f: Fetch = defaultFetch): Promise<LobbyResult<{ session: OnlineSession }>> {
  const res = await call(f, `/api/games/${code}/join`, postJson({ deck: submission(input.deck), playerId: input.playerId }));
  if (!(res instanceof Response)) return res;
  if (!res.ok) return failure(res);
  const joined = (await res.json().catch(() => null)) as JoinGameResponse | null;
  if (!joined || typeof joined.token !== 'string' || (joined.seat !== 'corp' && joined.seat !== 'runner')) return { ok: false, message: LOBBY_ERROR_TEXT.server };
  return { ok: true, session: { code, seat: joined.seat, token: joined.token } };
}

/**
 * Is the room still there? 'there' only when the lobby answered 200 for it,
 * 'gone' on a 404; anything else (offline, 429, 5xx) is 'unknown': keep trying.
 */
export type RoomPresence = 'there' | 'gone' | 'unknown';

export async function roomPresence(code: string, f: Fetch = defaultFetch): Promise<RoomPresence> {
  try {
    const res = await f(`/api/games/${code}`);
    if (res.status === 404) return 'gone';
    return res.ok ? 'there' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The invite link for a room: `<origin>/play/K7QM-2X` (the code only, never a token). */
export const inviteLink = (code: string, origin: string = window.location.origin) => `${origin}/play/${displayRoomCode(code)}`;

/** The room code in an invite link's path (/play/K7QM-2X), or null. */
export function codeFromPath(pathname: string): string | null {
  const m = /^\/play\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  try {
    return parseRoomCode(decodeURIComponent(m[1]));
  } catch {
    return null;
  }
}
