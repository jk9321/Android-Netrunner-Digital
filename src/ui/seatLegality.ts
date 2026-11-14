/**
 * A seat at the table and its legality without the real state: the part the
 * local table (table.ts) and the online table (src/net/client.ts) share. A
 * seat has only its viewer's view; `can` answers from the legal list the
 * table (or the game server) gave it, plus the own-side probes below, run on
 * the viewer's own reconstruction.
 *
 * The one place besides table.ts that runs the engine (tests/uiBoundary.test.ts):
 * isLegalAction for the own-side probes, and executeAction for the reason
 * text of a blocked action, both on the viewer's reconstruction only.
 */
import { GameAction, GameState, GameView, SideCode, executeAction, isLegalAction } from '../core';
import type { Viewer } from './viewer';

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
 * "Any number of cards" prompts and discards down to hand size list at most
 * 256 answers (legalActions.ts), so a pick from the viewer's own prompt is
 * checked against the prompt itself: for a discard, exactly `count` different
 * cards of the viewer's own hand (rules 5.5.4c).
 */
function validCardsAnswer(state: GameState, action: GameAction): boolean {
  if (action.type !== 'RESOLVE_PROMPT') return false;
  if (action.choice.kind === 'discard') {
    const p = state.pendingPrompts[0];
    if (!p || p.id !== action.promptId || p.kind !== 'discard' || p.side !== action.player) return false;
    const ids = action.choice.cardInstanceIds;
    const hand = (p.side === 'corp' ? state.corp.hq : state.runner.grip).map(c => c.instanceId);
    return new Set(ids).size === ids.length && ids.length === p.count && ids.every(id => hand.includes(id));
  }
  if (action.choice.kind !== 'effect_cards' || action.choice.trashFirst?.length) return false;
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
export function probeReason(state: GameState, action: GameAction): string {
  try {
    executeAction(state, action);
    return 'Not possible right now';
  } catch (err) {
    return err instanceof Error ? err.message : 'Not possible right now';
  }
}

/** `reason` for a seat that has only its view: null when `can`, else the engine's wording on the viewer's reconstruction. */
export function seatReason(legal: GameAction[], side: SideCode, state: GameState, action: GameAction): string | null {
  if (seatCan(legal, side, state, action)) return null;
  return action.player === side ? probeReason(state, action) : 'Not your decision';
}
