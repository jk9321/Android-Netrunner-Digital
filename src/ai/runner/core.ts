import { GameAction, GameState, activePrompt, getLegalActions } from '../../core';
import type { ScoredAction } from '../agent';
import type { RunnerMemory } from '../runs';
import { inDecision } from '../handValues';
import { logNudge } from '../synergy';
import { runAction } from './run';

/**
 * R-B B1 (runner-rework briefs/b1-core.md rev 1): the Runner's order of questions, one function for every caller, as
 * corp/core.ts is the Corp's. The callers build a RunnerContext: the agent (runnerAI.ts HeuristicRunnerAI.runnerContext:
 * the Normal Runner, the planner's rollout, the reply's Runner, the Hard search's playout Runners, the oracle playout's
 * Runner) and the Hard Runner (search.ts SearchAI). The bodies (the ranking, the prompt answer, the memory, the planner)
 * stay methods of the agent and are reached through the context's callbacks; the decision during a run is runner/run.ts's
 * (R-B B2), the same for every caller. Nothing here prices anything.
 *
 *   runnerDecide   the decision context; [Hard: a prompt, a run under way or the Corp's turn-start step go to the base
 *                  Runner whole]; the memory brought up to date; a prompt; a run under way (its answer, else the first
 *                  legal action); the counted slot (a full Read-Write Share, after the run step: its ability costs no
 *                  click and is legal in a run); the ranking; the look-ahead over it; the pick (the look-ahead's, else
 *                  the ranking's first above minus infinity, else END_TURN, else the first legal action); the loop
 *                  guard's note; the debug log.
 *   runnerOffTurn  the Corp's turn (a paid ability, Madani): the decision context; the memory; the off-turn scores (no
 *                  nudge, no make-room installs, savingFor and digForBreakers read as the last ranking left them); the
 *                  best above minus infinity, noted, or null.
 *
 * The side scope is the callers' written rule, not a field: the agent's chooseAction and chooseOffTurn (and the Hard
 * Runner's chooseAction) run inside asSide('runner'); the ranking does not enter it itself (red team finding 4).
 * No field repeats a field of pricing.ts's context (side, frozen, decisionSeed, known, anchor): those are B1b's.
 */

/** A look-ahead's pick and what the order does with it: note it in the loop guard, log it. */
export interface RunnerPick {
  action: GameAction;
  note: boolean;
  log: boolean;
}

export interface RunnerContext {
  /**
   * The state the bodies read: 'dealt', the deciding Runner's own deal (turnPlanner.ts runnerDecisionView), or 'given',
   * the state as handed in; today the agent's planner flag (ownView), named apart from the look-ahead. No reader in src:
   * read by B3's prompt answer; until then the handle of table (a) in tests/runnerCore.test.ts (R-B B2, red team finding 3).
   */
  view: 'dealt' | 'given';
  /**
   * The live map of the Corp's cards the Runner has seen (knownCards()). No reader in src: read by B3's prompt answer;
   * until then the handle of table (a) in tests/runnerCore.test.ts (R-B B2, red team finding 3).
   */
  memory: RunnerMemory;
  /** Brings `memory` up to date with what the engine marks (runnerAI.ts remember; the Hard Runner's observe). */
  remember(state: GameState): void;
  /** Hard only: the base Runner's whole decision, for a prompt, a run under way and the Corp's turn-start step. */
  base?(state: GameState): GameAction;
  prompt(state: GameState): GameAction;
  /** The counted slot: what exists today and nothing else, a full Read-Write Share (r-b.md decision 1). */
  counted(state: GameState, legal: GameAction[]): GameAction | undefined;
  /** Whether the counted pick is noted in the loop guard (the agent: yes; the Hard Runner: no, as before B1). */
  noteCounted: boolean;
  rank(state: GameState, legal: GameAction[]): ScoredAction[];
  /** The look-ahead over the ranking (the turn planner, the Hard search); absent or null: the ranking's own pick. */
  lookahead?(state: GameState, ranked: ScoredAction[]): RunnerPick | null;
  /** The off-turn question's scores, best first (the agent's own; not the ranking). */
  offTurnRank(state: GameState): ScoredAction[];
  /** The action played (the loop guard's count). */
  note(action: GameAction): void;
  debug: boolean;
}

/** The Runner's action at `state` (see the file comment). */
export function runnerDecide(state: GameState, ctx: RunnerContext): GameAction {
  return inDecision(state, 'runner', () => decide(state, ctx));
}

function decide(state: GameState, ctx: RunnerContext): GameAction {
  if (ctx.base && (activePrompt(state) || state.activeRun || state.turnStep?.kind === 'corp_turn_start')) return ctx.base(state);
  ctx.remember(state);
  if (activePrompt(state)) return ctx.prompt(state);
  const legal = getLegalActions(state, 'runner');
  if (state.activeRun) return runAction(state, legal) ?? legal[0];
  const full = ctx.counted(state, legal);
  if (full) {
    if (ctx.noteCounted) ctx.note(full);
    return full;
  }
  const ranked = ctx.rank(state, legal);
  const pick = ctx.lookahead?.(state, ranked) ?? {
    action: ranked[0]?.score > -Infinity ? ranked[0].action : legal.find(a => a.type === 'END_TURN') ?? legal[0],
    note: true,
    log: true,
  };
  if (pick.note) ctx.note(pick.action);
  if (pick.log && ctx.debug) logNudge(state, 'runner', pick.action);
  return pick.action;
}

/** The Runner's paid ability on the Corp's turn, or null (see the file comment). */
export function runnerOffTurn(state: GameState, ctx: RunnerContext): GameAction | null {
  return inDecision(state, 'runner', () => offTurn(state, ctx));
}

function offTurn(state: GameState, ctx: RunnerContext): GameAction | null {
  ctx.remember(state);
  const best = ctx.offTurnRank(state)[0];
  if (!best || best.score === -Infinity) return null;
  ctx.note(best.action);
  if (ctx.debug) logNudge(state, 'runner', best.action);
  return best.action;
}
