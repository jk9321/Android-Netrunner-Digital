/**
 * The table core (multiplayer phase 2, chunk 2b): the part of a table that
 * owns the real GameState, shared by the local table (src/ui/table.ts) and
 * the game server's room (server/room.ts). It applies engine actions, holds
 * an uncommitted choice (engine/uncommitted.ts) until it is answered or
 * cancelled, keeps the move list, and chains both viewers' id maps through
 * every state either of them is shown (view.ts: a card's trip through a
 * hidden place must be noticed, rules 1.12.3).
 *
 * No screen, no confirm dialogs, no sockets: callers do those around step()
 * and commit().
 */
import type { SideCode } from './types/card';
import type { GameAction } from './types/actions';
import type { GameState } from './types/state';
import { executeAction } from './engine/gameEngine';
import { uncommittedChoice } from './engine/uncommitted';
import { viewFor, newViewIds } from './view';
import type { GameView, ViewIds } from './view';

export const TABLE_SIDES: SideCode[] = ['corp', 'runner'];

/** A choice shown but not applied: Cancel drops it, answering applies `action` and the answer as one move. */
export interface TableHeld {
  base: GameState;
  next: GameState;
  action: GameAction;
  ids: Record<SideCode, ViewIds>;
}

/** Both sides' views of one state, and the id maps after them. */
export interface TableViews {
  state: GameState;
  views: Record<SideCode, GameView>;
  ids: Record<SideCode, ViewIds>;
}

/** What an action would do, worked out without changing the table. */
export type TableStep =
  | { kind: 'held'; held: TableHeld }
  | { kind: 'move'; action: GameAction; base: GameState; current: GameState; next: GameState; hold: TableHeld | null };

/** Views of `state` for both sides, chained from `ids`. */
export function viewsOf(state: GameState, ids: Record<SideCode, ViewIds>, gameId: string): TableViews {
  const views = {} as Record<SideCode, GameView>;
  const next = {} as Record<SideCode, ViewIds>;
  for (const side of TABLE_SIDES) {
    const res = viewFor(state, side, ids[side], gameId);
    views[side] = res.view;
    next[side] = res.ids;
  }
  return { state, views, ids: next };
}

export class TableCore {
  state: GameState;
  held: TableHeld | null = null;
  /** The id maps after the committed state's views. */
  ids: Record<SideCode, ViewIds>;
  moves: GameAction[];
  /** The committed state's views (`committed.state === state`). */
  committed: TableViews;
  /** The held state's views, while a choice is held. */
  heldViews: TableViews | null = null;

  constructor(
    start: GameState,
    readonly gameId: string,
    saved?: { moves?: GameAction[]; ids?: Record<SideCode, ViewIds> },
  ) {
    this.state = start;
    this.moves = saved?.moves ?? [];
    this.committed = viewsOf(start, saved?.ids ?? { corp: newViewIds(), runner: newViewIds() }, gameId);
    this.ids = this.committed.ids;
  }

  /** The state the players are shown: the held one while a choice is held. */
  get shown(): GameState {
    return this.held?.next ?? this.state;
  }

  /** The views the players are shown now. */
  get current(): TableViews {
    return this.heldViews ?? this.committed;
  }

  /** A side's id map for the state it is shown now (actions it sends are in these ids). */
  idsNow(side: SideCode): ViewIds {
    return this.held ? this.held.ids[side] : this.ids[side];
  }

  /**
   * What `action` (engine ids) would do. Answering a held choice applies the
   * action and the answer as one move, from the state before both (Conceding
   * drops a held choice instead). With `mayHold`, an ability or event whose
   * first step is its own player's choice is held instead of applied
   * (uncommitted.ts). Null once the game is over (rule 1.7.1). Throws the
   * engine's error when the action is illegal.
   */
  step(action: GameAction, mayHold: boolean): TableStep | null {
    const hold = action.type === 'CONCEDE' ? null : this.held;
    const base = hold?.base ?? this.state;
    const current = hold?.next ?? base;
    if (current.winner) return null;
    const uncommitted = !hold && mayHold ? uncommittedChoice(current, action) : null;
    if (uncommitted) return { kind: 'held', held: { base: current, next: uncommitted.next, action, ids: this.ids } };
    return { kind: 'move', action, base, current, next: executeAction(current, action), hold };
  }

  /** Is a move still the table's next one (nothing was applied or cancelled while it was being confirmed)? */
  isFresh(step: TableStep & { kind: 'move' }): boolean {
    return this.state === step.base && this.held === step.hold;
  }

  /** Shows a held choice (the id maps chain through it, and are kept if it is answered). */
  hold(held: TableHeld): TableViews {
    this.heldViews = viewsOf(held.next, held.ids, this.gameId);
    this.held = { ...held, ids: this.heldViews.ids };
    return this.heldViews;
  }

  /** Applies a move worked out by step(). */
  commit(step: TableStep & { kind: 'move' }): TableViews {
    const ids = step.hold ? step.hold.ids : this.ids;
    this.moves = [...this.moves, ...(step.hold ? [step.hold.action] : []), step.action];
    this.state = step.next;
    this.held = null;
    this.heldViews = null;
    this.committed = viewsOf(step.next, ids, this.gameId);
    this.ids = this.committed.ids;
    return this.committed;
  }

  /** Drops a held choice: the action was never applied, so the game is as it was. */
  cancel(): boolean {
    if (!this.held) return false;
    this.held = null;
    this.heldViews = null;
    return true;
  }
}
