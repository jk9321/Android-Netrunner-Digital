/**
 * The local table (multiplayer phase 1, chunk 2). It owns the real GameState
 * and hands the screen one Seat per viewer: what that viewer may see (their
 * GameView, rebuilt as a GameState by stateFromView), their legal actions in
 * their own ids, and act(). The screen never holds a GameState it isn't
 * allowed to see; the open table ('both') and a finished game get the real
 * state, because nothing is secret there (open table is for testing and is
 * never offered online).
 *
 * The only file under src/ui that runs the engine on a real state
 * (tests/uiBoundary.test.ts; seatLegality.ts runs the own-side probes on a
 * reconstruction). The computer (AIClient) keeps receiving the full state,
 * exactly as before. No React here: the controller (useGameController.ts)
 * subscribes and draws.
 *
 * Online, the seat comes from the game server instead (src/net/client.ts,
 * OnlineTable): `legal` comes in with each view, and `can` uses the same
 * own-side probes (seatLegality.ts).
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
import { Seat, probeReason, seatCan, seatReason } from './seatLegality';

export type { Seat } from './seatLegality';
// scripts/leak-check-recon.ts reads these from here
export { isProbeAction, seatCan } from './seatLegality';

const SIDES: SideCode[] = ['corp', 'runner'];

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
      reason: a => seatReason(legal, side, state, a),
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
