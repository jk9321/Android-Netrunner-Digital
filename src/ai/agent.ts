import { CardInstance, GameAction, GameState, SideCode } from '../core';

/**
 * A player the computer controls. The game asks it for an action whenever
 * it is that side's move: its own turn, a run in progress (Runner), or a
 * prompt it has to answer. Agents only return legal actions.
 */
export interface Agent {
  readonly side: SideCode;
  chooseAction(state: GameState): GameAction;
  /**
   * Corp only: the Runner is approaching ice or a server and these cards can
   * be rezzed. Returns a rez action, or null to let the Runner carry on.
   */
  chooseRez?(state: GameState, cards: CardInstance[]): GameAction | null;
}

/** An action with an AI's score for it (higher is better). */
export interface ScoredAction {
  action: GameAction;
  score: number;
}

/** Actions in a row that spend no click, before an AI stops taking them (guards against loops). */
const FREE_ACTION_LIMIT = 6;

/**
 * Counts an AI's actions in a row that spent no click, so it can't loop on
 * free actions. The count starts over whenever the turn or the click count changes.
 */
export class FreeActionGuard {
  private count = 0;
  private key = '';

  /** Actions that never count (END_TURN, and for the Runner a run, which is followed through). */
  constructor(private readonly exempt: GameAction['type'][]) {}

  /** Call before ranking moves, with the side's clicks left. */
  start(state: GameState, clicks: number) {
    const key = `${state.turnNumber}|${clicks}`;
    if (key !== this.key) {
      this.key = key;
      this.count = 0;
    }
  }

  played(action: GameAction) {
    if (!this.exempt.includes(action.type)) this.count++;
  }

  get exhausted(): boolean {
    return this.count >= FREE_ACTION_LIMIT;
  }
}
