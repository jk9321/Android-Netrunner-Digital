/**
 * The online game protocol (multiplayer phase 2, chunk 2b), shared by the
 * game server (server/) and, from chunk 2c, the browser. Plain types and
 * small pure helpers only: nothing here runs the engine.
 *
 * Design rules (Jeff, 2026-11-09): no accounts yet, invite links only, no
 * chat ever. So there is no free-text field anywhere in the protocol (no
 * names, no messages), a seat is an opaque `playerId` plus a token (later
 * the id can be an account id without changing the room), and a room's
 * `visibility` only accepts 'invite' for now.
 */
import type { SideCode } from '../core/types/card';
import type { GameAction } from '../core/types/actions';
import type { FormatId } from '../core/formats';
import type { GameView } from '../core/view';

/** Bumped whenever a message shape or the meaning of a field changes. */
export const PROTOCOL_VERSION = 1;

/** Room codes: 6 characters with no 0/O or 1/I, shown as K7QM-2X. */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 6;

/** Formats a game can be hosted in online. Casual only with the System Gateway starter decks (rules 1.4.1a). */
export const ONLINE_FORMATS: FormatId[] = ['startup', 'standard', 'casual'];

/** K7QM2X -> K7QM-2X. */
export function displayRoomCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** What a person typed or a link carried, as a room code; null if it can't be one. */
export function parseRoomCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  return [...code].every(ch => ROOM_CODE_ALPHABET.includes(ch)) ? code : null;
}

/** A player id: opaque, kept in the browser for now (an account id later). */
export const PLAYER_ID = /^[A-Za-z0-9_-]{8,64}$/;

// --- HTTP ------------------------------------------------------------------------

/** A deck as card codes: the identity and one entry per copy. */
export interface DeckSubmission {
  identity: string;
  cards: string[];
}

export interface CreateGameRequest {
  side: SideCode;
  deck: DeckSubmission;
  format: FormatId;
  /** Only 'invite' today: nothing lists rooms. */
  visibility?: 'invite';
  playerId?: string;
}

export interface CreateGameResponse {
  code: string;
  seat: SideCode;
  token: string;
}

export interface JoinGameRequest {
  deck: DeckSubmission;
  playerId?: string;
}

export interface JoinGameResponse {
  seat: SideCode;
  token: string;
}

/** GET /api/games/:code: what someone with the link may know before joining (never the decklist). */
export interface LobbyInfo {
  code: string;
  format: FormatId;
  hostSide: SideCode;
  hostIdentity: string;
  open: boolean;
  over: boolean;
  build: string;
  protocol: number;
}

export type HttpErrorCode = 'bad_request' | 'not_found' | 'full' | 'illegal_deck' | 'rate_limited' | 'unauthorized' | 'server';

export interface HttpError {
  error: HttpErrorCode;
  /** Deck problems (validateDeck's wording, about the sender's own deck only). */
  reasons?: string[];
}

// --- WebSocket ------------------------------------------------------------------

/** The game waits on this side; null when it waits on nobody (the game is over). */
export type WaitingOn = SideCode | null;

export type ServerMessage =
  | { type: 'hello'; seat: SideCode; build: string; protocol: number }
  /**
   * The seat's view. `seq` counts the states sent to this seat (each seat has
   * its own count, so it never says how many moves the other side made);
   * `act` must carry the latest one. `legal` is the seat's legal actions in
   * its own ids, empty when it isn't acting. `held`: the seat is looking at a
   * choice it may still cancel.
   */
  | { type: 'state'; seq: number; view: GameView; legal: GameAction[]; waitingOn: WaitingOn; held: boolean }
  | { type: 'opponent'; connected: boolean }
  | { type: 'error'; code: SocketErrorCode; message: string }
  | { type: 'over'; winner: SideCode | null; reason: string }
  | { type: 'pong' };

export type SocketErrorCode = 'bad_message' | 'stale' | 'not_your_turn' | 'illegal' | 'nothing_held' | 'not_started' | 'over' | 'server';

/** Fixed wording per error: never engine text, which could name a hidden card. */
export const SOCKET_ERROR_TEXT: Record<SocketErrorCode, string> = {
  bad_message: 'That message could not be read.',
  stale: 'The game has moved on. Please try again.',
  not_your_turn: "It isn't your decision right now.",
  illegal: "That isn't possible right now.",
  nothing_held: 'There is nothing to cancel.',
  not_started: 'Waiting for the second player.',
  over: 'The game is over.',
  server: 'Something went wrong on the server.',
};

export type ClientMessage =
  /** An action in the sender's viewer ids, against the state numbered `seq`. */
  | { type: 'act'; seq: number; action: GameAction }
  /** Drops the held (uncommitted) choice. */
  | { type: 'cancel'; seq: number }
  | { type: 'ping' };

/** The keep-alive the server answers without waking the room (Hibernation API auto-response). */
export const PING = JSON.stringify({ type: 'ping' });
export const PONG = JSON.stringify({ type: 'pong' });

/** Largest client message accepted (an action is a few hundred bytes). */
export const MAX_CLIENT_MESSAGE = 16_000;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isSeq = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * A client message, checked for shape; null if it isn't one. The action's
 * contents are checked by the engine (toEngineAction, executeAction).
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'string' || raw.length > MAX_CLIENT_MESSAGE) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(msg)) return null;
  if (msg.type === 'ping') return { type: 'ping' };
  if (msg.type === 'cancel') return isSeq(msg.seq) ? { type: 'cancel', seq: msg.seq } : null;
  if (msg.type === 'act') {
    const a = msg.action;
    if (!isSeq(msg.seq) || !isObject(a) || typeof a.type !== 'string' || (a.player !== 'corp' && a.player !== 'runner')) return null;
    return { type: 'act', seq: msg.seq, action: a as unknown as GameAction };
  }
  return null;
}
