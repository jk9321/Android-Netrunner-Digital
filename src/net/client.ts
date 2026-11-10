/**
 * The online table (multiplayer phase 2, chunk 2c): what LocalTable
 * (src/ui/table.ts) gives the game controller, for one seat, fed by the game
 * server's room over a WebSocket. The browser never holds the real game: the
 * seat is built from the last `state` message (its view, its legal actions in
 * its own ids, who the game waits on), and `act` sends the action back.
 *
 * - No optimistic updates: after `act` the seat waits until the next `state`
 *   (or an error). The room may hold the mover's own state back at an
 *   unsettled point (docs/multiplayer-server.md), so waiting can last as long
 *   as the opponent thinks. A second click while waiting sends nothing.
 * - Reconnects on a closed socket after 1, 2, 4, 8, then every 15 s; the room
 *   sends `hello` and the last state again. Close code 4000: another tab or
 *   device took the seat (no retry); 4001: the room is gone.
 * - A `hello` (or a lobby) speaking another protocol than this build's asks
 *   for a refresh, and nothing more is sent.
 *
 * No React and no engine here (tests/uiBoundary.test.ts): legality comes from
 * the server's list and the own-side probes in src/ui/seatLegality.ts.
 */
import type { GameAction, GameState, GameView, SideCode } from '../core';
import { stateFromView } from '../core';
import { Seat, seatCan, seatReason } from '../ui/seatLegality';
import { PING, PROTOCOL_VERSION, SOCKET_ERROR_TEXT, parseRoomCode } from './protocol';
import type { ClientMessage, ServerMessage, SocketErrorCode, WaitingOn } from './protocol';

/** Close codes the room uses (server/gameRoom.ts). */
export const CLOSE_REPLACED = 4000;
export const CLOSE_ROOM_GONE = 4001;

/** Reconnect delays: 1, 2, 4, 8 s, then every 15 s. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000];
export const RECONNECT_EVERY_MS = 15_000;
export const KEEPALIVE_MS = 30_000;
/**
 * Sockets refused before hello, in a row, while the lobby says the room is
 * there: the room no longer knows this browser's token, so it stops trying
 * (about 15 s at the delays above).
 */
export const REFUSED_LIMIT = 4;

export type OnlineStatus =
  /** Opening the first socket. */
  | 'connecting'
  /** Connected; `hello` arrived. */
  | 'open'
  /** The socket closed; trying again. */
  | 'reconnecting'
  /** Another tab or device has this seat now (close code 4000). */
  | 'replaced'
  /** The server speaks another protocol: the page must be reloaded. */
  | 'refresh'
  /** The room no longer exists. */
  | 'gone'
  /** The room is there but keeps refusing this browser's token: the seat is lost. */
  | 'unseated';

/** What the browser keeps to come back to a game: never put in the address bar or a link. */
export interface OnlineSession {
  code: string;
  seat: SideCode;
  token: string;
  /** The host's game has not started yet: show the invite (dropped from the saved session at the first state). */
  inviting?: boolean;
}

/**
 * Does leaving this screen give up the seat (forget the saved session)? Not
 * from "open somewhere else": the other tab of this browser that plays the
 * game shares the saved session and needs it for its next reload.
 */
export function leavingForgetsSeat(status: OnlineStatus): boolean {
  return status !== 'replaced';
}

/** The little of a WebSocket the table uses (a browser WebSocket, or an in-memory pair in tests). */
export interface SocketLike {
  send(text: string): void;
  close(code?: number): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface OnlineTableOptions {
  /** Opens the seat's socket. */
  connect(session: OnlineSession): SocketLike;
  /** Shows a message to the person (an illegal action, a server error). */
  alert(message: string): void;
  /** Asked when a socket closed before `hello`: is the room still there? Resolves false when it is gone (404). */
  roomPresence?(code: string): Promise<'there' | 'gone' | 'unknown'>;
  timers?: Timers;
}

/** What the player saw before and after a new state (their reconstructions), for sounds, fates and accesses. */
export interface OnlineMove {
  prev: GameState;
  next: GameState;
}

type StateMessage = ServerMessage & { type: 'state' };

const browserTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: h => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: h => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
};

/** Actions a seat may send at any time, against no particular state (server/room.ts, rule 1). */
const anyTime = (action: GameAction) => action.type === 'SET_STOPS' || action.type === 'CONCEDE';

export class OnlineTable {
  readonly side: SideCode;
  status: OnlineStatus = 'connecting';
  opponentConnected = false;
  /** Sent an action and heard nothing back yet. */
  waiting = false;
  /** The result once the game is over (winner null: a draw, e.g. the server could no longer read the game). */
  over: { winner: SideCode | null; reason: string } | null = null;
  /**
   * The whole table at the end (chunk 2d: both hands, every card face up), when
   * the room sent it with `over`. From then on the seat shows it, as the local
   * table does once there is a winner. Null before the end, and after an end
   * with no table to show (an older server, a game the room could not read).
   */
  final: GameState | null = null;
  /** Bumped on every change, for React's useSyncExternalStore. */
  version = 0;

  private last: StateMessage | null = null;
  private shown: GameState | null = null;
  private seat: Seat | null = null;
  private socket: SocketLike | null = null;
  private helloSeen = false;
  private attempts = 0;
  /** Sockets refused before hello in a row with the room confirmed there. */
  private refused = 0;
  private retryTimer: unknown = null;
  private pingTimer: unknown = null;
  private disposed = false;
  private listeners = new Set<() => void>();
  private moveListeners = new Set<(move: OnlineMove) => void>();
  private readonly timers: Timers;

  constructor(
    readonly session: OnlineSession,
    private opts: OnlineTableOptions,
  ) {
    this.side = session.seat;
    this.timers = opts.timers ?? browserTimers;
  }

  /** Opens the socket (call once; reconnects happen on their own). */
  start() {
    // React's StrictMode starts, disposes and starts again
    this.disposed = false;
    if (!this.socket && this.retryTimer === null) this.open();
  }

  /** Closes the socket for good (leaving the game screen). */
  dispose() {
    this.disposed = true;
    this.stopTimers();
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      ws.onclose = null;
      try {
        ws.close(1000);
      } catch {
        // already closed
      }
    }
  }

  /** "Play here instead": take the seat back from the other tab or device. */
  takeOver() {
    if (this.status !== 'replaced' || this.disposed) return;
    this.attempts = 0;
    this.refused = 0;
    this.setStatus('connecting');
    this.open();
  }

  /** Has the first state arrived (the game has started)? */
  get started(): boolean {
    return this.last !== null || this.final !== null;
  }

  /** The last state message, for tests. */
  get lastState(): StateMessage | null {
    return this.last;
  }

  /** Whose move the game waits on (public: every view says so). */
  get acting(): WaitingOn {
    return this.over ? null : (this.last?.waitingOn ?? null);
  }

  get winner(): SideCode | null {
    return this.over?.winner ?? this.shown?.winner ?? null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onMove(fn: (move: OnlineMove) => void): () => void {
    this.moveListeners.add(fn);
    return () => this.moveListeners.delete(fn);
  }

  /** The player's seat at the last state (the same object until something changes). Only the own side has one. */
  seatFor(side: SideCode): Seat {
    if (side !== this.side) throw new Error(`This table is the ${this.side}'s seat`);
    if (this.final) return (this.seat ??= finalSeat(this.final));
    if (!this.last || !this.shown) throw new Error('No state yet');
    if (!this.seat) this.seat = this.makeSeat(this.last, this.shown);
    return this.seat;
  }

  private makeSeat(msg: StateMessage, state: GameState): Seat {
    const side = this.side;
    const view: GameView = msg.view;
    // While an action is on its way, nothing else is offered (no optimistic updates); after the end, nothing at all
    const legal = this.waiting || this.over ? [] : msg.legal;
    const seq = msg.seq;
    return {
      side,
      view,
      state,
      legal,
      waitingOn: this.over ? null : msg.waitingOn,
      can: a => seatCan(legal, side, state, a),
      reason: a => seatReason(legal, side, state, a),
      act: async a => this.act(a, seq),
      cancel: msg.held ? () => this.cancel(seq) : undefined,
    };
  }

  private act(action: GameAction, seq: number) {
    if (this.status !== 'open' || this.over) return;
    if (anyTime(action)) {
      this.send({ type: 'act', seq, action });
      return;
    }
    // A second click while waiting sends nothing
    if (this.waiting) return;
    this.waiting = true;
    this.send({ type: 'act', seq, action });
    this.changed();
  }

  private cancel(seq: number) {
    if (this.status !== 'open' || this.waiting || this.over) return;
    this.waiting = true;
    this.send({ type: 'cancel', seq });
    this.changed();
  }

  private send(msg: ClientMessage) {
    try {
      this.socket?.send(JSON.stringify(msg));
    } catch {
      // The socket is closing; the reconnect brings the state back and the person acts again
    }
  }

  private changed() {
    this.seat = null;
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private setStatus(status: OnlineStatus) {
    if (this.status === status) return;
    this.status = status;
    this.changed();
  }

  // --- The socket ----------------------------------------------------------------

  private open() {
    if (this.disposed) return;
    this.helloSeen = false;
    let ws: SocketLike;
    try {
      ws = this.opts.connect(this.session);
    } catch {
      this.closed(1006);
      return;
    }
    this.socket = ws;
    ws.onmessage = ev => {
      if (this.socket === ws) this.receive(ev.data);
    };
    ws.onclose = ev => {
      if (this.socket === ws) this.closed(ev.code);
    };
    ws.onerror = () => {
      // A close event follows
    };
  }

  private closed(code: number) {
    this.socket = null;
    this.stopTimers();
    if (this.disposed || this.status === 'refresh' || this.status === 'gone' || this.status === 'unseated') return;
    // Taking a waiting action back: the reconnect brings the last state, and the person acts again if it is still theirs
    if (this.waiting) {
      this.waiting = false;
      this.seat = null;
    }
    if (code === CLOSE_REPLACED) return this.setStatus('replaced');
    if (code === CLOSE_ROOM_GONE) return this.setStatus('gone');
    const neverOpened = !this.helloSeen;
    this.setStatus(this.status === 'connecting' && neverOpened && this.attempts === 0 ? 'connecting' : 'reconnecting');
    const delay = RECONNECT_DELAYS_MS[this.attempts] ?? RECONNECT_EVERY_MS;
    this.attempts++;
    // A socket refused before hello may be a room that no longer exists (it expired): ask the lobby
    if (neverOpened && this.opts.roomPresence) {
      this.opts.roomPresence(this.session.code).then(
        presence => {
          if (this.disposed || this.status === 'open' || this.status === 'replaced') return;
          // Unknown (offline, a busy lobby): no conclusion, keep trying
          if (presence === 'gone') {
            this.stopTimers();
            this.setStatus('gone');
          } else if (presence === 'there' && ++this.refused >= REFUSED_LIMIT) {
            this.stopTimers();
            this.setStatus('unseated');
          }
        },
        () => {
          // Unknown: keep trying
        },
      );
    }
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      if (this.status === 'reconnecting' || this.status === 'connecting') this.open();
    }, delay);
  }

  private stopTimers() {
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    if (this.pingTimer !== null) this.timers.clearInterval(this.pingTimer);
    this.retryTimer = null;
    this.pingTimer = null;
  }

  private receive(data: unknown) {
    if (typeof data !== 'string') return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (this.status === 'refresh') return;
    switch (msg.type) {
      case 'hello':
        return this.hello(msg);
      case 'state':
        return this.state(msg);
      case 'opponent':
        this.opponentConnected = msg.connected;
        return this.changed();
      case 'over':
        this.over = { winner: msg.winner, reason: msg.reason };
        // No move listener for the switch to the final table: its ids are the engine's, not this seat's, so a
        // before-and-after would show cards moving that did not move (sounds, fates, accesses)
        if (msg.final && typeof msg.final === 'object') this.final = msg.final;
        this.waiting = false;
        clearSession();
        return this.changed();
      case 'error':
        return this.error(msg.code);
      case 'pong':
        return;
    }
  }

  private hello(msg: ServerMessage & { type: 'hello' }) {
    if (msg.protocol !== PROTOCOL_VERSION) {
      // Another version of the game: send nothing more, and ask for a refresh
      this.stopTimers();
      const ws = this.socket;
      this.socket = null;
      if (ws) {
        ws.onclose = null;
        try {
          ws.close(1000);
        } catch {
          // already closed
        }
      }
      return this.setStatus('refresh');
    }
    this.helloSeen = true;
    this.attempts = 0;
    this.refused = 0;
    if (this.pingTimer === null) this.pingTimer = this.timers.setInterval(() => this.socket?.send(PING), KEEPALIVE_MS);
    this.setStatus('open');
  }

  private state(msg: StateMessage) {
    const prevMsg = this.last;
    // A reconnect sends the last state again: nothing changed
    if (prevMsg && msg.seq === prevMsg.seq) return;
    const prev = this.shown;
    const next = stateFromView(msg.view);
    this.last = msg;
    this.shown = next;
    if (!prevMsg && this.session.inviting) this.stopInviting();
    this.waiting = false;
    this.changed();
    if (prev) for (const fn of this.moveListeners) fn({ prev, next });
  }

  /** The game has started: a reload no longer shows the invite. */
  private stopInviting() {
    const saved = loadSession();
    if (saved && saved.code === this.session.code && saved.token === this.session.token && saved.inviting) saveSession({ ...saved, inviting: false });
  }

  private error(code: SocketErrorCode) {
    switch (code) {
      case 'not_your_turn':
        // The room holds this seat's state back (an unsettled point, or a reconnect showed the moment before):
        // keep waiting for the next state, quietly
        return;
      case 'stale':
        // The next state is already here or on its way
        if (this.waiting) {
          this.waiting = false;
          this.changed();
        }
        return;
      case 'over':
      case 'not_started':
      case 'nothing_held':
        if (this.waiting) {
          this.waiting = false;
          this.changed();
        }
        return;
      default:
        if (this.waiting) {
          this.waiting = false;
          this.changed();
        }
        this.opts.alert(SOCKET_ERROR_TEXT[code] ?? SOCKET_ERROR_TEXT.server);
    }
  }
}

/**
 * The seat once the room sent the final table: the open table's seat (view
 * null, as on the local table at the end), with nothing to do and nothing to
 * send.
 */
function finalSeat(state: GameState): Seat {
  return { side: 'both', view: null, state, legal: [], waitingOn: null, can: () => false, reason: () => SOCKET_ERROR_TEXT.over, act: async () => {} };
}

// --- The browser's socket ------------------------------------------------------------

/** The seat's socket on this site's origin (the site forwards /api/games/* to the game Worker). */
export function socketUrl(session: OnlineSession, origin: { protocol: string; host: string } = window.location): string {
  const scheme = origin.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${origin.host}/api/games/${session.code}/ws?token=${encodeURIComponent(session.token)}`;
}

export const browserSocket = (session: OnlineSession): SocketLike => new WebSocket(socketUrl(session)) as unknown as SocketLike;

// --- Session and player id -------------------------------------------------------------

export const SESSION_KEY = 'netrunner.online';
export const PLAYER_ID_KEY = 'netrunner.playerId';

/** The online game this browser is seated at, if any (a reload or a closed tab resumes it). */
export function loadSession(): OnlineSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<OnlineSession>;
    if (typeof s.code !== 'string' || parseRoomCode(s.code) !== s.code) return null;
    if (s.seat !== 'corp' && s.seat !== 'runner') return null;
    if (typeof s.token !== 'string' || s.token.length < 8 || s.token.length > 200) return null;
    return { code: s.code, seat: s.seat, token: s.token, ...(s.inviting === true ? { inviting: true } : {}) };
  } catch {
    return null;
  }
}

export function saveSession(session: OnlineSession): void {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ code: session.code, seat: session.seat, token: session.token, ...(session.inviting ? { inviting: true } : {}) }));
  } catch {
    // Not saved: a reload loses the seat, the game itself goes on
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clear
  }
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** 22 URL-safe random characters. */
export function newPlayerId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(22));
  return [...bytes].map(b => ID_ALPHABET[b & 63]).join('');
}

/** This browser's player id, made once and kept (an account id later). */
export function playerId(): string {
  try {
    const saved = window.localStorage.getItem(PLAYER_ID_KEY);
    if (saved && /^[A-Za-z0-9_-]{22}$/.test(saved)) return saved;
    const id = newPlayerId();
    window.localStorage.setItem(PLAYER_ID_KEY, id);
    return id;
  } catch {
    return newPlayerId();
  }
}
