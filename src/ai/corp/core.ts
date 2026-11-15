import { GameAction, GameState, activePrompt, getLegalActions } from '../../core';
import { ScoredAction } from '../agent';
import { keepsScore, scoreNowPlan, winNowAction } from '../winNow';
import { answerPrompt } from '../prompts';
import { decisionContext } from '../handValues';
import { plan } from '../pricing';
import { tally } from '../diagnostics';
import { HeldLine, heldLaterStep } from './lines';
import { moneyPick } from '../incomeLine';
import { lineStep, scoreInTwoPick } from './placement';
import { rule } from './candidates';

/**
 * Step 4 Stage B1 (spec-step4-corp-core.md 1.2, 1.3): the Corp's decision pipeline, Q0 to Q7, one function for the
 * Normal Corp (corpAI.ts HeuristicCorpAI, its look-ahead the turn planner), the Hard Corp (search.ts SearchAI, its
 * look-ahead the search) and the planner's rollouts (no look-ahead, no counted questions). Before this the Hard Corp
 * kept its own copy of the order by hand.
 *
 *   Q1 win now (winNow.ts) · Q3 score now (scoreNowPlan; a pick that keeps the score stands, keepsScore) · Q0 a prompt
 *   (prompts.ts) · Q7 the order (corp/candidates.ts, the caller's rank) with the look-ahead over it, skipped once a
 *   counted question has the click · Q6 money (incomeLine.ts moneyPick) · Q4/Q5 the held line's step or a two-turn line
 *   begun (scoreInTwoPick, corp/placement.ts). Placement is inside the candidates: each install is already at place's
 *   server, so nothing rewrites the pick.
 *
 * Q2 (the turn-start window, rule 5.6.1b) is the order's (the rez candidates at corp_turn_start, line 4).
 */

export interface CorpMemory {
  /** plan.scoreInTwo (counted scoring C2): the two-turn score line this Corp holds, keyed by game id (corp/lines.ts). */
  heldLine: HeldLine | null;
}

export interface CorpContext {
  /** Deck-aware rules (synergy.ts); off: the AI as it was before them. */
  synergy: boolean;
  /** The counted questions (Q1, Q3 to Q6): the deciding Corp, Normal or Hard; off in the planner's rollouts. */
  counted: boolean;
  memory: CorpMemory;
  /** Q7's order: main-phase actions, first first (corp/candidates.ts asRanked). */
  rank(state: GameState, legal: GameAction[]): ScoredAction[];
  /** Q7's look-ahead over the order (the turn planner or the Hard search); null: the order's first. */
  lookahead?(state: GameState, ranked: ScoredAction[]): GameAction | null;
  /** The action played (the caller's loop guard). */
  note(action: GameAction): void;
  debug?: boolean;
}

export { isPettyCash } from './candidates';

/** The Corp's action at `state` (see the file comment). */
export function corpDecide(state: GameState, ctx: CorpContext): GameAction {
  decisionContext(state, 'corp');
  // Q1. plan.winNow (bug report #33): a line that wins the game this turn is played before any judgement (winNow.ts)
  if (ctx.counted) {
    const win = winNowAction(state);
    if (win) {
      ctx.note(win);
      return win;
    }
  }
  // Q3. plan.scoreNow (counted scoring C1): a line that scores an agenda this turn, the same search (winNow.ts); the
  // Corp's own pick stands while it keeps the score (keepsScore), the line's action is played otherwise
  const score = ctx.counted ? scoreNowPlan(state) : null;
  if (score && activePrompt(state)) {
    ctx.note(score.first);
    return score.first;
  }
  // Q0. A prompt
  if (activePrompt(state)) return answerPrompt(state, 'corp', undefined, ctx.synergy);
  const legal = getLegalActions(state, 'corp');
  const ranked = ctx.rank(state, legal);
  // Planner speed P1: the count has decided this click, so the look-ahead is not run. A scoreNow line: the Corp's pick
  // is then the order's first, kept while it keeps the score (keepsScore), the line's action otherwise. A held two-turn
  // line on a later turn (Q4): its step (advance or score, heldLaterStep) does not depend on the pick, and scoreInTwoPick
  // below plays it.
  // The planner's rollouts and the reply's Corp ask Q4 and Q5 too (begin a two-turn line, play a held line's steps;
  // c0-rulings 04:25Z (a)), and nothing else they do not ask
  const later = !!heldLaterStep(state, ctx.memory.heldLine);
  // Spec 1.3 authority 2: the step a two-turn line plays now is the line's, asked before the look-ahead and never weighed
  // by it; scoreInTwoPick below plays it and keeps the line
  const lineFirst = !score && !later ? lineStep(state, ctx.memory.heldLine ? structuredClone(ctx.memory.heldLine) : null) : null;
  const decided = !!score || later || !!lineFirst;
  const turnStart = state.turnStep?.kind === 'corp_turn_start';
  const planned = ctx.lookahead && !turnStart && !decided ? ctx.lookahead(state, ranked) : null;
  // Q6. Money step M1 (incomeLine.ts): an econ operation that nets credits is the counted pick for its click, ahead of
  // the Corp's own; a score this turn, a held two-turn line's step, or the Corp's own pick moving an agenda keeps the click
  const money = !decided && ctx.counted && !turnStart ? moneyPick(state, planned ?? ranked[0]?.action) : null;
  let chosen = lineFirst ?? money ?? planned ?? (ranked[0]?.score > -Infinity ? ranked[0].action : legal.find(a => a.type === 'END_TURN') ?? legal[0]);
  // plan.tagFirst: the planner's leaf counts a tag kept as a trash still to come, but the Runner clears it on its turn
  if (!lineFirst && ctx.synergy && plan().tagFirst && ranked[0]?.action.type === 'TRASH_RESOURCE' && ranked[0].tagFirst && rule('tagFirstPick', true)) chosen = ranked[0].action;
  let picked = chosen;
  if (score && !keepsScore(state, picked, score)) picked = score.first;
  // Q4, Q5. plan.scoreInTwo (counted scoring C2): a held two-turn score line's step, or the pick vetoed while it would
  // spend the line's rez money
  if (!score) {
    const two = scoreInTwoPick(state, picked, ctx.memory.heldLine);
    ctx.memory.heldLine = two.held;
    if (!ctx.counted) {
      tally('scoreInTwo', 'rolloutDecisions');
      if (lineFirst || two.action !== chosen) tally('scoreInTwo', 'rolloutTaken');
    }
    picked = two.action;
  }
  ctx.note(picked);
  return picked;
}
