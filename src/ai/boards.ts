import { GameAction, GameState, executeAction } from '../core';
import { pricing } from './pricing';
import { freezeAsked } from './valueModel';

/**
 * Speed pass lever G (addendum-g.md rev 2; ruling-rev0.md "Lever G red team, ruled" and "G0, ruled"): the board after
 * (board object, action), built once and served again to the AI's own steps (simulate, the planner's step, iceFallback,
 * spareAfter, a rollout's GameRunner.apply); a real game's GameRunner builds its own. The engine reads only the board and
 * the action (randomness and the instance counter live in the state), so a served board is the board the engine would
 * build. The key is the action, its fields sorted, plus the asker's `frozen` flag and decision seed (G0: a memo whose key
 * leaves the frame out, F129's freeOrder, was served across them once the board was shared). A miss runs on G's own copy
 * of the action (finding 2: no served board holds a caller's action object). A board is read only once built (in the
 * tests freezeAsked freezes it, so a write throws). Past BOARDS_CAP boards held since the top-level decision began
 * (handValues.ts inDecision with no anchor), a board is built and not kept: the same board, so no value changes.
 */
const built = new WeakMap<GameState, Map<string, GameState>>();
export const BOARDS_CAP = 4096;
/** Boards kept since the top-level decision began; `hits` and `misses` are counted only with `on` (the speed pass scripts). */
export const boardCounts = { held: 0, on: false, hits: 0, misses: 0 };

const canon = (x: unknown): string =>
  x === null || typeof x !== 'object'
    ? (JSON.stringify(x) ?? 'u')
    : Array.isArray(x)
      ? `[${x.map(canon).join(',')}]`
      : `{${Object.keys(x)
          .filter(k => (x as Record<string, unknown>)[k] !== undefined)
          .sort()
          .map(k => `${JSON.stringify(k)}:${canon((x as Record<string, unknown>)[k])}`)
          .join(',')}}`;

/** A top-level decision begins: the boards it keeps are counted from 0 (handValues.ts inDecision). */
export function boardsTop(): void {
  boardCounts.held = 0;
}

/** The board after `action` on `state` (executeAction's), the same object for the same ask; throws as executeAction does. */
export function builtBoard(state: GameState, action: GameAction): GameState {
  const p = pricing();
  const key = `${p.frozen ? 'f' : ''}|${p.decisionSeed ?? ''}|${canon(action)}`;
  let boards = built.get(state);
  const hit = boards?.get(key);
  if (boardCounts.on) boardCounts[hit ? 'hits' : 'misses']++;
  if (hit) return hit;
  const next = executeAction(state, structuredClone(action));
  if (boardCounts.held >= BOARDS_CAP) return next;
  if (!boards) built.set(state, (boards = new Map()));
  boards.set(key, freezeAsked(next));
  boardCounts.held++;
  return next;
}
