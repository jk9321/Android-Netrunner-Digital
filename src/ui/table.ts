/**
 * The local table (multiplayer phase 1, chunk 2). It owns the real GameState
 * and hands the screen one Seat per viewer: what that viewer may see (their
 * GameView, rebuilt as a GameState by stateFromView), their legal actions in
 * their own ids, and act(). The screen never holds a GameState it isn't
 * allowed to see; the open table ('both') and a finished game get the real
 * state, because nothing is secret there (open table is for testing and is
 * never offered online).
 *
 * This is the only file under src/ui that runs the engine
 * (tests/uiBoundary.test.ts). The computer (AIClient) keeps receiving the
 * full state, exactly as before. No React here: the controller
 * (useGameController.ts) subscribes and draws.
 *
 * Phase 2 swaps the seat for one fed by the game server: `legal` comes in
 * with each view, and `can` keeps the same own-side probes.
 */
import {
  GameAction,
  GameSetup,
  GameState,
  GameView,
  PriorityWindow,
  SideCode,
  ViewIds,
  actingSide,
  TableCore,
  createInitialGameState,
  executeAction,
  getLegalActions,
  isLegalAction,
  stateFromView,
  toEngineAction,
  fromEngineAction,
  wantsStop,
} from '../core';
import type { TableViews } from '../core';
import type { AIClient } from '../ai/client';
import { rezCandidates } from '../ai/playout';
import type { Viewer } from './viewer';
import { installedCardsGained, installedCardsLost, isInstallAction, replacementMessage } from './installReplacements';

const SIDES: SideCode[] = ['corp', 'runner'];

/** One viewer's place at the table. */
export interface Seat {
  side: Viewer;
  /** The viewer's view; null on the open table. */
  view: GameView | null;
  /** stateFromView(view), or the real state for 'both' (and once the game is over). */
  state: GameState;
  /** The viewer's legal actions in their ids; [] when the viewer is not acting. On the open table, both sides'. */
  legal: GameAction[];
  /** Who the game is waiting on (public). */
  waitingOn: SideCode | null;
  /** Is this action (in the viewer's ids) legal now? From `legal`, plus own-side probes (seatCan). */
  can(action: GameAction): boolean;
  /** Why an action is not possible now, for a tooltip; null if it is. */
  reason(action: GameAction): string | null;
  act(action: GameAction): Promise<void>;
  /** Drops a held (uncommitted) choice. */
  cancel?(): void;
}

// --- Legality without the real state (the part phase 2 keeps) ---------------------

/** A canonical form of an action for comparison: keys sorted, undefined left out, id sets sorted. */
function canonical(action: GameAction): string {
  const norm = structuredClone(action) as GameAction;
  if (norm.type === 'RESOLVE_PROMPT' && 'cardInstanceIds' in norm.choice) norm.choice.cardInstanceIds = [...norm.choice.cardInstanceIds].sort();
  return JSON.stringify(norm, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export const sameAction = (a: GameAction, b: GameAction) => canonical(a) === canonical(b);

/**
 * Own-side actions the legal list can't spell out, checked against the
 * viewer's own reconstruction: installs that trash cards first or go onto a
 * host (any subset of installed cards, rules 8.5.6), and prompt answers that
 * trash first. Everything they read is the viewer's own side.
 */
export function isProbeAction(action: GameAction): boolean {
  if (action.type === 'INSTALL_CARD') return !!action.trashFirst?.length || action.hostInstanceId !== undefined;
  if (action.type === 'RESOLVE_PROMPT') return 'trashFirst' in action.choice && !!action.choice.trashFirst?.length;
  return false;
}

/**
 * "Any number of cards" prompts list at most 256 answers (legalActions.ts), so
 * a pick from the viewer's own prompt is checked against the prompt itself.
 */
function validCardsAnswer(state: GameState, action: GameAction): boolean {
  if (action.type !== 'RESOLVE_PROMPT' || action.choice.kind !== 'effect_cards' || action.choice.trashFirst?.length) return false;
  const p = state.pendingPrompts[0];
  if (!p || p.id !== action.promptId || p.kind !== 'effect_cards' || p.side !== action.player) return false;
  const ids = action.choice.cardInstanceIds;
  return new Set(ids).size === ids.length && ids.length >= p.min && ids.length <= p.max && ids.every(id => p.candidateIds.includes(id));
}

/** `can` for a seat that has only its view: the legal list, then the own-side probes on the reconstruction. */
export function seatCan(legal: GameAction[], side: SideCode, state: GameState, action: GameAction): boolean {
  if (action.player !== side) return false;
  const key = canonical(action);
  if (legal.some(a => canonical(a) === key)) return true;
  if (legal.length === 0) return false;
  if (validCardsAnswer(state, action)) return true;
  if (!isProbeAction(action)) return false;
  try {
    return isLegalAction(state, action);
  } catch {
    return false;
  }
}

/** The engine's reason, on the viewer's own reconstruction: display text only, never legality. */
function probeReason(state: GameState, action: GameAction): string {
  try {
    executeAction(state, action);
    return 'Not possible right now';
  } catch (err) {
    return err instanceof Error ? err.message : 'Not possible right now';
  }
}

/** A new game's state (the table is the only place under src/ui that starts the engine). */
export const newTableState = (setup: GameSetup): GameState => createInitialGameState(setup);

// --- The table ----------------------------------------------------------------------

export interface TableHooks {
  /** Asks the person to confirm (the install-replacement dialog). */
  confirm(message: string, options: { title: string; confirmLabel: string; danger: boolean }): Promise<boolean>;
  alert(message: string, options: { title: string }): void;
}

/** What each viewer saw before and after a committed move (their reconstructions), for sounds, fates and accesses. */
export interface TableMove {
  action: GameAction;
  prev: Record<Viewer, GameState>;
  next: Record<Viewer, GameState>;
}

interface Shown {
  state: GameState;
  views: Record<SideCode, GameView>;
  recon: Record<SideCode, GameState>;
}

/** The table core's views with each side's reconstruction (what the screen draws). */
function withRecon(shown: TableViews): Shown {
  return { state: shown.state, views: shown.views, recon: { corp: stateFromView(shown.views.corp), runner: stateFromView(shown.views.runner) } };
}

export class LocalTable {
  /** The real state, the held choice, the moves and both id maps (shared with the game server, src/core/table.ts). */
  private core: TableCore;
  private committed: Shown;
  private heldShown: Shown | null = null;
  private listeners = new Set<() => void>();
  private moveListeners = new Set<(move: TableMove) => void>();
  private seats = new Map<Viewer, Seat>();
  /** Bumped on every change, for React's useSyncExternalStore. */
  version = 0;

  constructor(
    start: GameState,
    readonly aiSide: SideCode | null,
    private hooks: TableHooks,
    saved?: { moves?: GameAction[]; ids?: Record<SideCode, ViewIds> },
  ) {
    this.core = new TableCore(start, 'local', saved);
    this.committed = withRecon(this.core.committed);
  }

  /** The committed real state: for saving, bug reports and the computer, never for drawing. */
  get state(): GameState {
    return this.core.state;
  }

  get ids(): Record<SideCode, ViewIds> {
    return this.core.ids;
  }

  get moves(): GameAction[] {
    return this.core.moves;
  }

  /** Whose move the game waits on (public: every view says so). */
  get acting(): SideCode | null {
    return actingSide(this.core.shown);
  }

  get winner(): SideCode | null {
    return this.core.state.winner;
  }

  private get current(): Shown {
    return this.heldShown ?? this.committed;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onMove(fn: (move: TableMove) => void): () => void {
    this.moveListeners.add(fn);
    return () => this.moveListeners.delete(fn);
  }

  private changed() {
    this.seats.clear();
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** The seat for one viewer at the current state (the same object until the state changes). */
  seatFor(viewer: Viewer): Seat {
    let seat = this.seats.get(viewer);
    if (!seat) {
      seat = this.makeSeat(viewer);
      this.seats.set(viewer, seat);
    }
    return seat;
  }

  private makeSeat(viewer: Viewer): Seat {
    const shown = this.current;
    const waitingOn = actingSide(shown.state);
    const cancel = this.core.held ? () => this.cancel() : undefined;
    // Once the game is over nothing is secret any more (rule 1.7.1 ends the game; every card may be shown)
    if (viewer === 'both' || shown.state.winner) {
      const state = shown.state;
      const legal = SIDES.flatMap(s => getLegalActions(state, s));
      return {
        side: viewer,
        view: null,
        state,
        legal,
        waitingOn,
        can: a => (viewer === 'both' || a.player === viewer) && isLegalAction(state, a),
        reason: a => (isLegalAction(state, a) ? null : probeReason(state, a)),
        act: a => this.apply(a),
        cancel,
      };
    }
    const side = viewer;
    const ids = this.core.idsNow(side);
    const state = shown.recon[side];
    const legal = getLegalActions(shown.state, side).flatMap(a => {
      const mine = fromEngineAction(a, ids);
      return mine ? [mine] : [];
    });
    return {
      side,
      view: shown.views[side],
      state,
      legal,
      waitingOn,
      can: a => seatCan(legal, side, state, a),
      reason: a => (seatCan(legal, side, state, a) ? null : a.player === side ? probeReason(state, a) : 'Not your decision'),
      act: async a => {
        let engine: GameAction;
        try {
          engine = toEngineAction(a, this.core.idsNow(side));
        } catch (err) {
          this.hooks.alert(err instanceof Error ? err.message : 'Illegal action', { title: 'Action blocked' });
          return;
        }
        await this.apply(engine);
      },
      cancel,
    };
  }

  /** Dropping a held choice: the action was never applied, so the game is as it was. */
  cancel() {
    if (!this.core.cancel()) return;
    this.heldShown = null;
    this.changed();
  }

  /**
   * Applies an engine action. Answering a held choice applies the action and
   * the answer as one move, from the state before both (Conceding drops a held
   * choice instead).
   */
  async apply(action: GameAction): Promise<void> {
    const person = action.player !== this.aiSide;
    try {
      // The person's ability or event whose first step is their own choice (Red Team's server):
      // shown with the choice open, but not applied until they choose, so Cancel can drop it (uncommitted.ts)
      const step = this.core.step(action, person);
      // The game is over (rule 1.7.1): a move still on its way (the computer's, a click) is dropped quietly
      if (!step) return;
      if (step.kind === 'held') {
        this.heldShown = withRecon(this.core.hold(step.held));
        this.changed();
        return;
      }
      const { current, next } = step;
      // The person installing over their own cards confirms first, with Cancel as the safe default
      if (person && isInstallAction(current, action)) {
        const lost = installedCardsLost(current, next, action.player);
        if (lost.length > 0) {
          const ok = await this.hooks.confirm(replacementMessage(installedCardsGained(current, next, action.player), lost), {
            title: lost.length === 1 ? 'Replace installed card?' : 'Trash installed cards?',
            confirmLabel: 'Trash and install',
            danger: true,
          });
          // Nothing happens if cancelled, or if the game moved on while asking
          if (!ok || !this.core.isFresh(step)) return;
        }
      }
      const prev = this.committed;
      this.committed = withRecon(this.core.commit(step));
      this.heldShown = null;
      const move: TableMove = {
        action,
        prev: { corp: prev.recon.corp, runner: prev.recon.runner, both: prev.state },
        next: { corp: this.committed.recon.corp, runner: this.committed.recon.runner, both: next },
      };
      this.changed();
      for (const fn of this.moveListeners) fn(move);
    } catch (err) {
      this.hooks.alert(err instanceof Error ? err.message : 'Illegal action', { title: 'Action blocked' });
    }
  }

  // --- The computer (full state, as before) ---

  /**
   * Asks the computer for its move now, if it is the computer's to make: its
   * priority in the person's window (a rez decision, the end of the Corp's
   * turn), or its own move. `apply` then plays it unless the game moved on.
   */
  askComputer(ai: AIClient): { request: Promise<GameAction | null>; apply: (action: GameAction | null) => 'stale' | 'illegal' | 'none' | 'ok' } | null {
    const aiSide = this.aiSide;
    const state = this.core.state;
    if (!aiSide || this.core.held || state.winner || actingSide(state) !== aiSide) return null;
    const window: PriorityWindow | null =
      state.pendingPrompts.length === 0 && state.priority?.holder === aiSide && aiSide !== state.activePlayer ? state.priority : null;
    const asked = window && wantsStop(state, aiSide, window) ? window.step : null;
    const request: Promise<GameAction | null> = !window
      ? ai.chooseAction(state)
      : aiSide === 'corp' && (asked === 'approach_ice' || asked === 'approach_server')
        ? ai.chooseRez(state, rezCandidates(state, asked))
        : aiSide === 'runner' && asked === 'corp_action'
          ? ai.chooseOffTurn(state)
          : Promise.resolve(null);
    return {
      request,
      apply: action => {
        // The game moved on (or ended) since the computer was asked
        if (this.core.state !== state || this.core.held) return 'stale';
        if (action && !isLegalAction(state, action)) return 'illegal';
        if (action) void this.apply(action);
        else if (window) void this.apply({ type: 'PASS', player: aiSide });
        else return 'none';
        return 'ok';
      },
    };
  }
}
