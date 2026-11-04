import { CardInstance, GameAction, GameState, SideCode, actingSide, executeAction, isLegalAction, wantsStop } from '../core';
import { Agent } from './agent';

/**
 * Steps a game forward with an agent on each side. The computer players
 * stop at the paid ability windows they have always been asked about (stop
 * level 'ai'): the Corp's rez decisions during a run (approached ice, and
 * the server's root before the Runner approaches it), the Corp's window
 * before its turn begins, and the Runner's window at the end of the Corp's
 * action phase. Everywhere else the engine passes for them. Used for
 * AI-vs-AI games and for the search AI's look-ahead.
 */
export class GameRunner {
  state: GameState;
  /** The last action applied (for the batch logs). */
  last: GameAction | null = null;

  constructor(
    state: GameState,
    private agents: Record<SideCode, Agent>
  ) {
    // Both computer players stop where the computer always has, whatever a person chose in the game this came from
    this.state = state.stops?.corp === 'ai' && state.stops?.runner === 'ai' ? state : { ...state, stops: { corp: 'ai', runner: 'ai' } };
  }

  /** The Corp passes the rez window it holds now (search AI: "don't rez"). */
  passRezWindow() {
    if (this.state.priority?.holder === 'corp' && this.state.activePlayer === 'runner') this.apply({ type: 'PASS', player: 'corp' });
  }

  /** Plays one decision. Returns false when the game is over. */
  step(): boolean {
    const state = this.state;
    const side = actingSide(state);
    if (!side) return false;
    const window = state.priority;
    if (state.pendingPrompts.length === 0 && window && window.holder !== state.activePlayer) {
      // The other player's priority in the active player's window: asked for as long as there is something to do
      const pass: GameAction = { type: 'PASS', player: side };
      const ask = wantsStop(state, side, window);
      let choice: GameAction | null = null;
      if (ask && side === 'corp' && (window.step === 'approach_ice' || window.step === 'approach_server')) {
        choice = this.agents.corp.chooseRez?.(state, rezCandidates(state, window.step)) ?? null;
      } else if (ask && side === 'runner' && window.step === 'corp_action') {
        choice = this.agents.runner.chooseOffTurn?.(state) ?? null;
      }
      this.apply(choice ?? pass);
      return true;
    }
    this.apply(this.agents[side].chooseAction(state));
    return true;
  }

  apply(action: GameAction) {
    this.last = action;
    this.state = executeAction(this.state, action);
  }
}

/** The cards the Corp could rez in this rez window: the approached ice, or the unrezzed cards in the attacked server's root. */
export function rezCandidates(state: GameState, step: 'approach_ice' | 'approach_server'): CardInstance[] {
  const run = state.activeRun;
  const server = run ? state.corp.servers[run.server] : undefined;
  if (!run || !server) return [];
  const cards = step === 'approach_ice' ? (run.icePosition !== null && server.ice[run.icePosition] ? [server.ice[run.icePosition]] : []) : server.root;
  return cards.filter(c => !c.isRezzed && isLegalAction(state, { type: 'REZ_CARD', player: 'corp', cardInstanceId: c.instanceId }));
}
