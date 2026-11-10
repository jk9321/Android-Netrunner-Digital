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
import type { PromptChoice } from '../core/types/prompts';
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
    if (!isSeq(msg.seq)) return null;
    const action = sanitizeAction(msg.action);
    return action ? { type: 'act', seq: msg.seq, action } : null;
  }
  return null;
}

// --- Actions ----------------------------------------------------------------------
//
// Nothing a client sends may reach a view or the stored moves unless it was
// checked here: every action is rebuilt from its known keys, each value of
// a known shape (viewer ids, server ids, prompt ids, option ids, enums,
// bounded integers and arrays). Extra keys are dropped; a value of the wrong
// shape refuses the message. The room then checks it against the seat's
// legal actions (server/room.ts) and the engine has the last word.

const VIEWER_ID = /^[cr]\d{1,6}$/;
const SERVER_ID = /^(hq|rd|archives|new|remote-\d{1,3})$/;
const PROMPT_ID = /^prompt-\d{1,7}$/;
/** Engine option ids: server ids, words, viewer ids, card codes ('steal', 'remote-2', 'c12', '30037'). */
const OPTION_ID = /^[A-Za-z0-9_:.-]{1,40}$/;
const STOP_LEVELS = ['auto', 'full', 'none'] as const;
const MAX_LIST = 60;

type Raw = Record<string, unknown>;
class Bad extends Error {}

const id = (v: unknown): string => {
  if (typeof v !== 'string' || !VIEWER_ID.test(v)) throw new Bad();
  return v;
};
const ids = (v: unknown): string[] => {
  if (!Array.isArray(v) || v.length > MAX_LIST) throw new Bad();
  return v.map(id);
};
const match = (v: unknown, re: RegExp): string => {
  if (typeof v !== 'string' || !re.test(v)) throw new Bad();
  return v;
};
const int = (v: unknown, max: number): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) throw new Bad();
  return v;
};
const ints = (v: unknown, max: number): number[] => {
  if (!Array.isArray(v) || v.length > MAX_LIST) throw new Bad();
  return v.map(x => int(x, max));
};
const bool = (v: unknown): boolean => {
  if (typeof v !== 'boolean') throw new Bad();
  return v;
};
/** Optional keys: left out when missing, checked when present. */
const opt = <T>(raw: Raw, key: string, check: (v: unknown) => T): Partial<Record<string, T>> => (raw[key] === undefined ? {} : { [key]: check(raw[key]) });

function choiceOf(v: unknown): PromptChoice {
  if (!isObject(v)) throw new Bad();
  switch (v.kind) {
    case 'mulligan':
      return { kind: 'mulligan', mulligan: bool(v.mulligan) };
    case 'discard':
      return { kind: 'discard', cardInstanceIds: ids(v.cardInstanceIds) };
    case 'access_trash':
      return { kind: 'access_trash', trash: bool(v.trash), ...opt(v, 'alternativeId', x => match(x, OPTION_ID)) };
    case 'access_order':
      return { kind: 'access_order', optionId: match(v.optionId, OPTION_ID) };
    case 'effect_choice':
      return { kind: 'effect_choice', optionId: match(v.optionId, OPTION_ID), ...opt(v, 'trashFirst', ids) };
    case 'effect_cards':
      return { kind: 'effect_cards', cardInstanceIds: ids(v.cardInstanceIds), ...opt(v, 'trashFirst', ids) };
    default:
      throw new Bad();
  }
}

/** A client's action rebuilt from its known keys with checked values, or null. */
export function sanitizeAction(raw: unknown): GameAction | null {
  if (!isObject(raw) || (raw.player !== 'corp' && raw.player !== 'runner')) return null;
  const player = raw.player as SideCode;
  try {
    const a = raw;
    switch (a.type) {
      case 'GAIN_CREDIT':
      case 'DRAW_CARD':
      case 'PURGE_VIRUS':
      case 'CONTINUE_RUN':
      case 'JACK_OUT':
      case 'REMOVE_TAG':
      case 'END_TURN':
      case 'START_TURN':
      case 'CONCEDE':
        return { type: a.type, player };
      case 'PASS':
        return { type: 'PASS', player, ...opt(a, 'restOfRun', bool) };
      case 'SET_STOPS':
        if (!STOP_LEVELS.includes(a.level as (typeof STOP_LEVELS)[number])) return null;
        return { type: 'SET_STOPS', player, level: a.level as (typeof STOP_LEVELS)[number] };
      case 'INSTALL_CARD':
        return {
          type: 'INSTALL_CARD',
          player,
          cardInstanceId: id(a.cardInstanceId),
          ...opt(a, 'targetServerId', x => match(x, SERVER_ID)),
          ...opt(a, 'asNewRemote', bool),
          ...opt(a, 'hostInstanceId', id),
          ...opt(a, 'faceUp', bool),
          ...opt(a, 'trashFirst', ids),
        };
      case 'PLAY_OPERATION_OR_EVENT':
      case 'SCORE_AGENDA':
      case 'REZ_CARD':
      case 'TRASH_RESOURCE':
        return { type: a.type, player, cardInstanceId: id(a.cardInstanceId) };
      case 'ADVANCE_CARD':
        return { type: 'ADVANCE_CARD', player, cardInstanceId: id(a.cardInstanceId), serverId: match(a.serverId, SERVER_ID) };
      case 'INITIATE_RUN':
        return { type: 'INITIATE_RUN', player, targetServerId: match(a.targetServerId, SERVER_ID) };
      case 'BREAK_SUBROUTINE':
        return { type: 'BREAK_SUBROUTINE', player, breakerInstanceId: id(a.breakerInstanceId), subroutineIndices: ints(a.subroutineIndices, 30) };
      case 'BOOST_BREAKER':
        return { type: 'BOOST_BREAKER', player, breakerInstanceId: id(a.breakerInstanceId) };
      case 'BIOROID_BREAK':
        return { type: 'BIOROID_BREAK', player, subroutineIndex: int(a.subroutineIndex, 30), ...opt(a, 'subroutineIndices', x => ints(x, 30)) };
      case 'USE_ABILITY':
        return { type: 'USE_ABILITY', player, cardInstanceId: id(a.cardInstanceId), abilityIndex: int(a.abilityIndex, 20) };
      case 'RESOLVE_PROMPT':
        return { type: 'RESOLVE_PROMPT', player, promptId: match(a.promptId, PROMPT_ID), choice: choiceOf(a.choice) };
      default:
        return null;
    }
  } catch (err) {
    if (err instanceof Bad) return null;
    throw err;
  }
}

/** A canonical form of an action for comparison (keys sorted, undefined left out). */
export function actionKey(action: GameAction): string {
  return JSON.stringify(action, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : v,
  );
}
