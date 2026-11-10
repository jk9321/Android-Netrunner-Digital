/**
 * One online game (multiplayer phase 2, chunk 2b): the room's logic, with no
 * Cloudflare types, so it runs under vitest and the fuzzer. The Durable
 * Object (server/gameRoom.ts) persists what snapshot() returns and sends the
 * messages each call returns; nothing else.
 *
 * The real GameState, the held choice, the moves and both id maps are a
 * TableCore (src/core/table.ts), the same code the local table uses.
 *
 * What each seat is sent:
 * - The seat that sent an accepted action gets its new `state` at once,
 *   unless its move led into a decision of the other side's inside an R&D
 *   access (settledFor); then at the next settled point.
 * - The other seat gets a new `state` only at a settled point (settledFor)
 *   and only when what it would be sent changed. Its `seq` counts its own
 *   states, so neither the count nor the timing of messages says how many
 *   moves the other side made in between.
 * - A held (uncommitted) choice is shown to its player only; the other seat
 *   hears nothing until it is answered (one move) or cancelled (nothing).
 * - Errors are fixed wording (SOCKET_ERROR_TEXT), never engine text.
 */
import {
  GameAction,
  GameState,
  SideCode,
  TableCore,
  TableViews,
  ViewIds,
  actingSide,
  createInitialGameState,
  fromEngineAction,
  getCardDefinition,
  getLegalActions,
  isFormatId,
  toEngineAction,
  validateDeck,
} from '../src/core';
import type { FormatId } from '../src/core';
import { STARTER_DECKS, deckCodes } from '../src/data/decks';
import {
  DeckSubmission,
  LobbyInfo,
  ONLINE_FORMATS,
  PLAYER_ID,
  PROTOCOL_VERSION,
  SOCKET_ERROR_TEXT,
  ServerMessage,
  SocketErrorCode,
  ClientMessage,
  actionKey,
  sanitizeAction,
} from '../src/net/protocol';

const SIDES: SideCode[] = ['corp', 'runner'];
const other = (side: SideCode): SideCode => (side === 'corp' ? 'runner' : 'corp');

/** Delete a room this long after its last move, and this long after its game ended (spec rule 7). */
export const IDLE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const ENDED_LIFETIME_MS = 24 * 60 * 60 * 1000;

export interface SeatRecord {
  playerId: string;
  /** SHA-256 of the seat's token (server/tokens.ts); the token itself is never stored. */
  tokenHash: string;
}

/** Everything about a room except the game state and the move list (stored apart: they are the big values). */
export interface RoomMeta {
  v: 1;
  code: string;
  format: FormatId;
  visibility: 'invite';
  /** The server build the room was created with (spec rule 6). */
  build: string;
  protocol: number;
  createdAt: number;
  lastMoveAt: number;
  endedAt: number | null;
  host: SideCode;
  seed: number;
  seats: Record<SideCode, SeatRecord | null>;
  decks: Record<SideCode, DeckSubmission | null>;
  /** States sent to each seat so far; an `act` must carry the latest. */
  seq: Record<SideCode, number>;
  /** A hash of the last `state` each seat was sent, so an unchanged one is not sent again. */
  sent: Record<SideCode, string>;
  /** Both id maps after the committed state. */
  ids: Record<SideCode, ViewIds> | null;
  /** The held choice's action (engine ids), worked out again from the state on load. */
  held: { side: SideCode; action: GameAction } | null;
  over: { winner: SideCode | null; reason: string } | null;
}

export interface RoomSnapshot {
  meta: RoomMeta;
  state: GameState | null;
  moves: GameAction[];
  /**
   * The last `state` message each seat was sent, as sent (JSON). A seat that
   * connects again gets exactly this, never the state as it is now: at an
   * unsettled point that would show the moment withheld from it.
   */
  last?: Record<SideCode, string | null>;
}

/** What a room last wrote to storage, by reference (state and moves are replaced, never changed in place). */
export interface StoredRefs {
  state: GameState | null;
  moves: GameAction[];
  last: Record<SideCode, string | null>;
}

/** The storage keys a room keeps, one row each. */
export const STORAGE_KEYS = ['meta', 'state', 'moves', 'last:corp', 'last:runner'] as const;

/**
 * The values to write after a change: meta always, the rest only when it
 * changed since `prev` (null: everything). The free plan allows 100,000 rows
 * written a day, so a move writes 2-4 rows instead of 5 (state and moves only
 * on a committed move, a seat's last state only when it was sent one).
 */
export function storageWrites(prev: StoredRefs | null, snap: RoomSnapshot): { put: Record<string, unknown>; refs: StoredRefs } {
  const last = { corp: snap.last?.corp ?? null, runner: snap.last?.runner ?? null };
  const put: Record<string, unknown> = { meta: snap.meta };
  if (!prev || prev.state !== snap.state) put.state = snap.state;
  if (!prev || prev.moves !== snap.moves) put.moves = snap.moves;
  for (const side of ['corp', 'runner'] as const) if (!prev || prev.last[side] !== last[side]) put[`last:${side}`] = last[side];
  return { put, refs: { state: snap.state, moves: snap.moves, last } };
}

/** `text`: the message as JSON when it was already serialised (state messages), so the socket sends it without a second stringify. */
export type Outbox = { to: SideCode; msg: ServerMessage; text?: string }[];

export interface RoomResult {
  out: Outbox;
  /** Something changed that must be stored before `out` is sent. */
  persist: boolean;
}

export type DeckCheck = { ok: true } | { ok: false; reasons: string[] };

const STARTER_SPECS = STARTER_DECKS.map(d => deckCodes(d));
const sameCards = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Is the deck legal online in this format? Casual only with a System Gateway starter deck as it comes (rules 1.4.1a). */
export function checkDeck(deck: unknown, format: FormatId, side: SideCode): DeckCheck {
  if (!deck || typeof deck !== 'object') return { ok: false, reasons: ['The deck could not be read.'] };
  const d = deck as Record<string, unknown>;
  if (typeof d.identity !== 'string' || !Array.isArray(d.cards) || d.cards.length > 200 || !d.cards.every(c => typeof c === 'string' && c.length <= 10)) {
    return { ok: false, reasons: ['The deck could not be read.'] };
  }
  const spec = { identity: d.identity, cards: d.cards as string[] };
  if (format === 'casual') {
    const starter = STARTER_SPECS.find(s => s.identity === spec.identity && sameCards(s.cards, spec.cards));
    if (starter && identitySide(spec.identity) !== side) return { ok: false, reasons: [`That deck is not a ${side === 'corp' ? 'Corp' : 'Runner'} deck.`] };
    return starter ? { ok: true } : { ok: false, reasons: ['Casual games online are for the System Gateway starter decks only. Pick Startup or Standard for other decks.'] };
  }
  let problems: string[];
  try {
    problems = validateDeck({ ...spec, format });
  } catch {
    problems = ['The deck could not be read.'];
  }
  // validateDeck checks the cards against the identity; the identity must also be this seat's side
  if (problems.length === 0 && identitySide(spec.identity) !== side) problems = [`That deck is not a ${side === 'corp' ? 'Corp' : 'Runner'} deck.`];
  return problems.length ? { ok: false, reasons: problems } : { ok: true };
}

function identitySide(code: string): string | null {
  try {
    return getCardDefinition(code).side_code;
  } catch {
    return null;
  }
}

/** A short, stable hash of a string (cyrb53), to tell whether a message changed without storing it. */
export function quickHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Does the R&D access in progress hide this moment from `viewer`? While the
 * Runner decides something inside the access of a card from R&D (a trash
 * prompt, a steal cost, a "when accessed" choice), the Corp must not learn
 * that there is a decision at all: whether there is one can say what the card
 * is (rules 4.2.2, 7.1.2; audit finding LEAK-ACCESS-PAUSE). So the other seat
 * is sent nothing until the game no longer waits on a decision of the acting
 * side inside such an access. "Inside the access of a card from R&D": the
 * card most recently accessed this run was not accessed in Archives and is
 * still in R&D (once it is stolen or trashed, where it went is public).
 *
 * Settled for the viewer = the game waits on the viewer, or on nobody, or not
 * on a prompt of the other side's inside an R&D access.
 */
export function settledFor(state: GameState, viewer: SideCode): boolean {
  const acting = actingSide(state);
  if (acting === null || acting === viewer) return true;
  if (!state.pendingPrompts.some(p => p.side !== viewer)) return true;
  return !rdAccessInProgress(state);
}

export function rdAccessInProgress(state: GameState): boolean {
  const run = state.activeRun;
  const last = run?.accessed[run.accessed.length - 1];
  if (!last || last.inArchives) return false;
  return state.corp.rd.some(c => c.instanceId === last.id);
}

/** How every state message's JSON starts (stateMessage puts type, then seq, first). */
const STATE_PREFIX = '{"type":"state","seq":';

const error = (to: SideCode, code: SocketErrorCode): Outbox => [{ to, msg: { type: 'error', code, message: SOCKET_ERROR_TEXT[code] } }];

export interface CreateInput {
  code: string;
  side: SideCode;
  deck: DeckSubmission;
  format: FormatId;
  playerId: string;
  tokenHash: string;
  build: string;
  seed: number;
  now: number;
}

export interface JoinInput {
  deck: DeckSubmission;
  playerId: string;
  tokenHash: string;
  now: number;
}

/** Why a room couldn't be created or joined; reasons are about the sender's own deck only. */
export type RoomRefusal = { error: 'bad_request' | 'full' | 'illegal_deck'; reasons?: string[] };

/**
 * actionKey with the card lists that are sets sorted: cards discarded down to
 * hand size and cards trashed first are offered once per set, in one order,
 * and a client may send them in any order.
 */
function unorderedKey(action: GameAction): string {
  if (action.type === 'INSTALL_CARD' && action.trashFirst) return actionKey({ ...action, trashFirst: [...action.trashFirst].sort() });
  if (action.type !== 'RESOLVE_PROMPT') return actionKey(action);
  const c = action.choice;
  const sorted = { ...c } as Record<string, unknown>;
  if (c.kind === 'discard') sorted.cardInstanceIds = [...c.cardInstanceIds].sort();
  if ('trashFirst' in c && c.trashFirst) sorted.trashFirst = [...c.trashFirst].sort();
  return actionKey({ ...action, choice: sorted as typeof c });
}

export class RoomCore {
  meta: RoomMeta;
  private table: TableCore | null;
  /** Server-side log of engine errors (never sent to a client). */
  readonly errors: string[] = [];

  /** The last state message each seat was sent (RoomSnapshot.last). */
  private last: Record<SideCode, string | null> = { corp: null, runner: null };

  private constructor(meta: RoomMeta, table: TableCore | null, last?: Record<SideCode, string | null>) {
    this.meta = meta;
    this.table = table;
    if (last) this.last = { ...last };
  }

  // --- Creating, joining, loading -------------------------------------------------

  static create(input: CreateInput): RoomCore | RoomRefusal {
    if (!isFormatId(input.format) || !ONLINE_FORMATS.includes(input.format)) return { error: 'bad_request', reasons: ['That format is not offered online.'] };
    if (input.side !== 'corp' && input.side !== 'runner') return { error: 'bad_request' };
    if (!PLAYER_ID.test(input.playerId)) return { error: 'bad_request' };
    const deck = checkDeck(input.deck, input.format, input.side);
    if (!deck.ok) return { error: 'illegal_deck', reasons: deck.reasons };
    const seats: RoomMeta['seats'] = { corp: null, runner: null };
    const decks: RoomMeta['decks'] = { corp: null, runner: null };
    seats[input.side] = { playerId: input.playerId, tokenHash: input.tokenHash };
    decks[input.side] = { identity: input.deck.identity, cards: [...input.deck.cards] };
    return new RoomCore(
      {
        v: 1,
        code: input.code,
        format: input.format,
        visibility: 'invite',
        build: input.build,
        protocol: PROTOCOL_VERSION,
        createdAt: input.now,
        lastMoveAt: input.now,
        endedAt: null,
        host: input.side,
        seed: input.seed,
        seats,
        decks,
        seq: { corp: 0, runner: 0 },
        sent: { corp: '', runner: '' },
        ids: null,
        held: null,
        over: null,
      },
      null,
    );
  }

  /**
   * A stored room. A state that can't be used any more (a deploy changed the
   * engine under it) ends the game as a draw instead of throwing (spec rule 8).
   */
  static load(snapshot: RoomSnapshot, now: number): RoomCore {
    const meta = snapshot.meta;
    if (!snapshot.state) return new RoomCore(meta, null);
    try {
      // Both views are worked out here (TableCore), which proves the state still reads with this engine; legal
      // actions wait until a state is sent (most wakes are a move that sends one anyway)
      const table = new TableCore(snapshot.state, meta.code, { moves: snapshot.moves, ids: meta.ids ?? undefined });
      const room = new RoomCore(meta, table, snapshot.last);
      if (meta.held) {
        const step = table.step(meta.held.action, true);
        if (step?.kind === 'held') table.hold(step.held);
        else meta.held = null;
      }
      return room;
    } catch (err) {
      const room = new RoomCore({ ...meta, held: null }, null);
      room.errors.push(`load failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!meta.over) room.end({ winner: null, reason: 'server update' }, now);
      return room;
    }
  }

  snapshot(): RoomSnapshot {
    return { meta: this.meta, state: this.table?.state ?? null, moves: this.table?.moves ?? [], last: { ...this.last } };
  }

  get started(): boolean {
    return this.table !== null;
  }

  /** The real state, for bug reports and the fuzzer only (never sent). */
  get realState(): GameState | null {
    return this.table?.state ?? null;
  }

  get moves(): GameAction[] {
    return this.table?.moves ?? [];
  }

  /** For tests and the fuzzer: the real state a seat is shown now (the held one for its holder) and its id map. Never sent. */
  inspect(side: SideCode): { state: GameState; ids: ViewIds } | null {
    return this.table ? { state: this.viewsFor(side).state, ids: this.idsFor(side) } : null;
  }

  /** The seat a token hash belongs to, or null. */
  seatOf(tokenHash: string): SideCode | null {
    return SIDES.find(s => this.meta.seats[s]?.tokenHash === tokenHash) ?? null;
  }

  lobby(): LobbyInfo {
    const host = this.meta.decks[this.meta.host]!;
    return {
      code: this.meta.code,
      format: this.meta.format,
      hostSide: this.meta.host,
      hostIdentity: host.identity,
      open: this.meta.seats[other(this.meta.host)] === null && !this.meta.over,
      over: !!this.meta.over,
      build: this.meta.build,
      protocol: this.meta.protocol,
    };
  }

  /** The second player takes the open seat; the game starts at once. Returns the seat, or why not. */
  join(input: JoinInput): { seat: SideCode; out: Outbox } | RoomRefusal {
    const seat = other(this.meta.host);
    if (this.meta.seats[seat] || this.meta.over) return { error: 'full' };
    if (!PLAYER_ID.test(input.playerId)) return { error: 'bad_request' };
    const deck = checkDeck(input.deck, this.meta.format, seat);
    if (!deck.ok) return { error: 'illegal_deck', reasons: deck.reasons };
    this.meta.seats[seat] = { playerId: input.playerId, tokenHash: input.tokenHash };
    this.meta.decks[seat] = { identity: input.deck.identity, cards: [...input.deck.cards] };
    const corp = this.meta.decks.corp!;
    const runner = this.meta.decks.runner!;
    const start = createInitialGameState({ seed: this.meta.seed, corpIdentity: corp.identity, corpDeck: corp.cards, runnerIdentity: runner.identity, runnerDeck: runner.cards });
    this.table = new TableCore(start, this.meta.code);
    this.meta.ids = this.table.ids;
    this.meta.lastMoveAt = input.now;
    // Both seats get the first state (the host may already be connected)
    return { seat, out: SIDES.flatMap(s => this.stateFor(s, true)) };
  }

  // --- Sockets ----------------------------------------------------------------------

  /**
   * What a seat's socket gets when it connects or reconnects (spec rule 5):
   * hello, then the last state it was sent (never the state as it is now,
   * which at an unsettled point would show it the withheld moment), then the
   * result if the game is over.
   */
  connect(side: SideCode): ServerMessage[] {
    return this.connectTexts(side).map(t => JSON.parse(t) as ServerMessage);
  }

  /** connect() as JSON strings, for the socket. */
  connectTexts(side: SideCode): string[] {
    const out = [JSON.stringify({ type: 'hello', seat: side, build: this.meta.build, protocol: this.meta.protocol } satisfies ServerMessage)];
    // A room stored before seats' last states were kept (or built for a test) has none: the current state, if settled
    const last = this.last[side] ?? (this.table && settledFor(this.viewsFor(side).state, side) ? JSON.stringify(this.stateMessage(side)) : null);
    if (last) out.push(last);
    if (this.meta.over) out.push(this.overMessage().text);
    return out;
  }

  /** A message from a seat's socket. */
  receive(side: SideCode, msg: ClientMessage | null, now: number): RoomResult {
    if (!msg) return { out: error(side, 'bad_message'), persist: false };
    if (msg.type === 'ping') return { out: [{ to: side, msg: { type: 'pong' } }], persist: false };
    if (this.meta.over) return { out: error(side, 'over'), persist: false };
    const table = this.table;
    if (!table) return { out: error(side, 'not_started'), persist: false };

    if (msg.type === 'cancel') {
      if (msg.seq !== this.meta.seq[side]) return { out: error(side, 'stale'), persist: false };
      if (this.meta.held?.side !== side || !table.cancel()) return { out: error(side, 'nothing_held'), persist: false };
      this.meta.held = null;
      return { out: this.stateFor(side, true), persist: true };
    }

    // Rebuilt from known keys even when the caller parsed it already (parseClientMessage does the same)
    const action = sanitizeAction(msg.action);
    if (!action) return { out: error(side, 'bad_message'), persist: false };
    if (action.player !== side) return { out: error(side, 'not_your_turn'), persist: false };
    // Rule 1: only the acting seat acts; stops and conceding are one's own business at any time
    const anyTime = action.type === 'SET_STOPS' || action.type === 'CONCEDE';
    if (!anyTime && msg.seq !== this.meta.seq[side]) return { out: error(side, 'stale'), persist: false };
    if (!anyTime && actingSide(this.viewsFor(side).state) !== side) return { out: error(side, 'not_your_turn'), persist: false };

    // Review R2: only what the seat was offered, or an own-side choice the legal list can't spell out
    if (!anyTime && !this.offered(side, action)) return this.illegal(side, new Error(`not offered: ${action.type}`));
    let engine: GameAction;
    try {
      engine = toEngineAction(action, this.idsFor(side));
    } catch (err) {
      return this.illegal(side, err);
    }
    // Stops changed while a choice is held: applied to the committed state, the held choice kept on top of it
    if (engine.type === 'SET_STOPS' && this.meta.held) return this.stopsUnderHold(side, engine, now);

    let step;
    try {
      step = table.step(engine, true);
    } catch (err) {
      return this.illegal(side, err);
    }
    if (!step) return { out: error(side, 'over'), persist: false };
    if (step.kind === 'held') {
      table.hold(step.held);
      this.meta.held = { side, action: engine };
      return { out: this.stateFor(side, true), persist: true };
    }
    const heldBy = this.meta.held?.side ?? null;
    table.commit(step);
    this.meta.held = null;
    return { out: this.afterMove(side, heldBy, now), persist: true };
  }

  private illegal(side: SideCode, err: unknown): RoomResult {
    // The engine's wording can name a hidden card: it stays in the server's log (spec, "Errors to a client")
    this.errors.push(`${side}: ${err instanceof Error ? err.message : String(err)}`);
    if (this.errors.length > 50) this.errors.shift();
    return { out: error(side, 'illegal'), persist: false };
  }

  private stopsUnderHold(side: SideCode, action: GameAction, now: number): RoomResult {
    const table = this.table!;
    const held = this.meta.held!;
    table.cancel();
    this.meta.held = null;
    let step;
    try {
      step = table.step(action, false);
    } catch (err) {
      // Put the held choice back as it was
      const again = table.step(held.action, true);
      if (again?.kind === 'held') {
        table.hold(again.held);
        this.meta.held = held;
      }
      return this.illegal(side, err);
    }
    if (!step || step.kind !== 'move') return { out: error(side, 'over'), persist: false };
    table.commit(step);
    const again = table.step(held.action, true);
    if (again?.kind === 'held') {
      table.hold(again.held);
      this.meta.held = held;
    }
    const out = this.afterMove(side, null, now);
    // The holder's screen changed too (the stops, or the choice is gone)
    if (held.side !== side && !out.some(o => o.to === held.side && o.msg.type === 'state')) out.push(...this.stateFor(held.side, true));
    return { out, persist: true };
  }

  /** After a committed move by `side`: the mover always gets its state, the other seat at settled points; then the end. */
  private afterMove(side: SideCode, heldBy: SideCode | null, now: number): Outbox {
    this.meta.ids = this.table!.ids;
    this.meta.lastMoveAt = now;
    const state = this.table!.state;
    // The mover hears back at once, unless its move led into a decision of the other side's inside an R&D access
    // (the Corp passing priority as the Runner approaches R&D): then at the next settled point, like the other seat
    const out: Outbox = settledFor(state, side) || state.winner ? [...this.stateFor(side, true)] : [];
    const opp = other(side);
    // A choice the opponent held was dropped by this move (conceding): its screen must change
    const force = heldBy === opp || !!state.winner;
    if (force || settledFor(state, opp)) out.push(...this.stateFor(opp, force));
    if (state.winner && !this.meta.over) {
      this.end({ winner: state.winner, reason: state.winReason ?? 'game over' }, now);
      const { msg, text } = this.overMessage();
      for (const s of SIDES) out.push({ to: s, msg, text });
    }
    return out;
  }

  /**
   * The `over` message, the same for both seats. Once the game has a winner
   * nothing is hidden any more (rule 1.7.1 ends the game), so it carries the
   * whole final table (chunk 2d): the committed real state, built from what
   * the room already stores (no second copy). A game the room could not read
   * (winner null, "server update") has no table to show. Serialised once.
   */
  private overMessage(): { msg: ServerMessage & { type: 'over' }; text: string } {
    const over = this.meta.over!;
    // A held choice is never on top at the end (a committed move ended the game), and `state` is the committed one anyway
    const final = over.winner !== null && this.table?.state.winner ? this.table.state : undefined;
    const msg: ServerMessage & { type: 'over' } = { type: 'over', ...over, ...(final ? { final } : {}) };
    return { msg, text: JSON.stringify(msg) };
  }

  private end(over: { winner: SideCode | null; reason: string }, now: number) {
    this.meta.over = over;
    this.meta.endedAt = now;
  }

  /** The seat's legal actions in its own ids (empty unless it is acting). Cheap to ask twice: the engine caches legality per state. */
  private legalFor(side: SideCode): GameAction[] {
    const shown = this.viewsFor(side).state;
    if (actingSide(shown) !== side) return [];
    const ids = this.idsFor(side);
    return getLegalActions(shown, side).flatMap(a => {
      const mine = fromEngineAction(a, ids);
      return mine ? [mine] : [];
    });
  }

  /**
   * Was the seat offered this action? Its legal list, or, as on the local
   * table (src/ui/table.ts seatCan), the own-side choices that list can't
   * spell out: installs that trash cards first or go onto a host (rules
   * 8.5.6), a prompt answer that trashes first (the same answer without it
   * must be offered), and an "any number of cards" answer to the seat's own
   * prompt (at most 256 answers are listed). The engine judges those.
   */
  private offered(side: SideCode, action: GameAction): boolean {
    const legal = this.legalFor(side);
    const keys = new Set(legal.map(unorderedKey));
    if (keys.has(unorderedKey(action))) return true;
    if (legal.length === 0) return false;
    if (action.type === 'INSTALL_CARD') return !!action.trashFirst?.length || action.hostInstanceId !== undefined;
    if (action.type !== 'RESOLVE_PROMPT') return false;
    const prompt = this.viewsFor(side).views[side].pendingPrompts[0];
    if (!prompt || prompt.id !== action.promptId) return false;
    const c = action.choice;
    if ('trashFirst' in c && c.trashFirst?.length) {
      const base = { ...action, choice: { ...c, trashFirst: undefined } } as GameAction;
      return keys.has(unorderedKey(base)) || c.kind === 'effect_cards';
    }
    return c.kind === 'effect_cards';
  }

  /** What a seat is shown: the held choice only to its holder (spec rule 3), the committed state to everyone else. */
  private viewsFor(side: SideCode): TableViews {
    const table = this.table!;
    return this.meta.held && this.meta.held.side !== side ? table.committed : table.current;
  }

  /** The id map of what a seat is shown (its actions are in these ids). */
  private idsFor(side: SideCode): ViewIds {
    const table = this.table!;
    return this.meta.held && this.meta.held.side !== side ? table.ids[side] : table.idsNow(side);
  }

  /** The `state` message for a seat now, numbered by the seat's count (bumped only when actually sent). */
  private stateMessage(side: SideCode): ServerMessage & { type: 'state' } {
    const views = this.viewsFor(side);
    const acting = actingSide(views.state);
    const legal = this.legalFor(side);
    return { type: 'state', seq: this.meta.seq[side], view: views.views[side], legal, waitingOn: acting, held: this.meta.held?.side === side };
  }

  /**
   * A new state for a seat, unless what it would show is what it was last
   * sent (then nothing, unless `force`: the mover always hears back).
   */
  private stateFor(side: SideCode, force: boolean): Outbox {
    if (!this.table) return [];
    const draft = this.stateMessage(side);
    // One stringify for the hash, the socket and the stored copy: the seq is spliced in front
    const body = JSON.stringify({ ...draft, seq: 0 });
    const hash = quickHash(body);
    if (!force && hash === this.meta.sent[side]) return [];
    this.meta.sent[side] = hash;
    this.meta.seq[side]++;
    const text = STATE_PREFIX + this.meta.seq[side] + body.slice(STATE_PREFIX.length + 1);
    this.last[side] = text;
    return [{ to: side, msg: { ...draft, seq: this.meta.seq[side] }, text }];
  }

  // --- Lifetime and reports -------------------------------------------------------

  /** When the room should be deleted (spec rule 7). */
  expiresAt(): number {
    return this.meta.endedAt !== null ? this.meta.endedAt + ENDED_LIFETIME_MS : this.meta.lastMoveAt + IDLE_LIFETIME_MS;
  }

  /**
   * What a bug report from `side` attaches: the real state, the moves, the
   * seed and both decks, also while the game is on. The issue goes to a
   * public repository, so it does show the opponent's hidden cards; Jeff
   * chose that for its use in bug fixing (2026-11-09: "we can change it
   * later"). The browser never gets it (server/forward.ts).
   */
  reportFor(side: SideCode): RoomReport {
    const table = this.table;
    const base = { code: this.meta.code, format: this.meta.format, build: this.meta.build, seat: side, moveCount: table?.moves.length ?? 0, over: this.meta.over };
    if (!table) return { ...base, full: false, view: null, seed: null, state: null, moves: null, decks: null };
    return { ...base, full: true, view: null, seed: this.meta.seed, state: table.state, moves: table.moves, decks: this.meta.decks };
  }
}

export interface RoomReport {
  code: string;
  format: FormatId;
  build: string;
  seat: SideCode;
  moveCount: number;
  over: RoomMeta['over'];
  /** True when the real state and moves are attached (always, once the game has started). */
  full: boolean;
  view: import('../src/core').GameView | null;
  seed: number | null;
  state: GameState | null;
  moves: GameAction[] | null;
  decks: RoomMeta['decks'] | null;
}
