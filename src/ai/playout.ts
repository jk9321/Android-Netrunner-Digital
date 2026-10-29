import { GameState, SideCode, executeAction } from '../core';
import { actingSide, corpRezWindow } from '../ui/viewer';
import { Agent } from './agent';

/**
 * Steps a game forward with an agent on each side, giving the Corp the same
 * rez windows a person gets (before the Runner continues past approached
 * ice, and when the Runner approaches the server). Used for AI-vs-AI games
 * and for the search AI's look-ahead.
 */
export class GameRunner {
  state: GameState;
  private runSerial = 0;
  private passed = new Set<string>();
  /** The last action applied (for the batch logs). */
  last: Parameters<typeof executeAction>[1] | null = null;

  constructor(
    state: GameState,
    private agents: Record<SideCode, Agent>
  ) {
    this.state = state;
  }

  /** The Corp declines the rez window that is open now (search AI: "don't rez"). */
  passRezWindow() {
    const window = corpRezWindow(this.state, this.runSerial);
    if (window) this.passed.add(window.key);
  }

  /** Plays one decision. Returns false when the game is over. */
  step(): boolean {
    const state = this.state;
    if (state.winner) return false;
    const window = corpRezWindow(state, this.runSerial);
    if (window && !this.passed.has(window.key)) {
      const rez = this.agents.corp.chooseRez?.(state, window.cards) ?? null;
      this.last = rez;
      if (rez) this.state = executeAction(state, rez);
      else this.passed.add(window.key);
      return true;
    }
    const side = actingSide(state, false);
    if (!side) return false;
    this.apply(this.agents[side].chooseAction(state));
    return true;
  }

  apply(action: Parameters<typeof executeAction>[1]) {
    this.last = action;
    const next = executeAction(this.state, action);
    if (!this.state.activeRun && next.activeRun) this.runSerial++;
    this.state = next;
  }
}
