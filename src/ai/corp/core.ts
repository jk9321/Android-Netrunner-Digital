import { GameAction, GameState, activePrompt, getLegalActions } from '../../core';
import { ScoredAction } from '../agent';
import { keepsScore, scoreNowPlan, winNowAction } from '../winNow';
import { answerPrompt } from '../prompts';
import { decisionContext } from '../handValues';
import { plan } from '../pricing';
import { note, tally, unsunk } from '../diagnostics';
import { HeldLine, heldLaterStep } from './lines';
import { moneyPick } from '../incomeLine';
import { lineStep, scoreInTwoPick } from './placement';

/**
 * Step 4 Stage B1 (spec-step4-corp-core.md 1.2, 1.3): the Corp's decision pipeline, Q0 to Q7, one function for the
 * Normal Corp (corpAI.ts HeuristicCorpAI, its look-ahead the turn planner), the Hard Corp (search.ts SearchAI, its
 * look-ahead the search) and the planner's rollouts (no look-ahead, no counted questions). Before this the Hard Corp
 * kept its own copy of the order by hand.
 *
 *   Q1 win now (winNow.ts) · Q3 score now (scoreNowPlan; a pick that keeps the score stands, keepsScore) · Q0 a prompt
 *   (prompts.ts) · Q7 the order (corp/candidates.ts, the caller's rank) with the look-ahead over it, skipped once a
 *   counted question has the click · Q6 money (incomeLine.ts moneyPick) · Q4/Q5 the held line's step or a two-turn line
 *   begun (scoreInTwoPick, corp/placement.ts; lineAsk, which the planner's playouts ask too: playoutLine). Placement is inside the candidates: each install is already at place's
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
  const turnStart = state.turnStep?.kind === 'corp_turn_start';
  // Planner speed P1: the count has decided this click, so the look-ahead is not run. A scoreNow line: the Corp's pick
  // is then the order's first, kept while it keeps the score (keepsScore), the line's action otherwise. A held two-turn
  // line on a later turn (Q4): its step (advance or score, heldLaterStep) does not depend on the pick, and scoreInTwoPick
  // plays it (lineAsk). Spec 1.3 authority 2: the step a two-turn line plays now (Q5) is the line's, asked before the
  // look-ahead and never weighed by it.
  const choose = (decided: boolean, lineFirst: GameAction | null): GameAction => {
    const planned = ctx.lookahead && !turnStart && !decided ? ctx.lookahead(state, ranked) : null;
    // Q6. Money step M1 (incomeLine.ts): an econ operation that nets credits is the counted pick for its click, ahead of
    // the Corp's own; a score this turn, a held two-turn line's step, or the Corp's own pick moving an agenda keeps the click
    const money = !decided && ctx.counted && !turnStart ? moneyPick(state, planned ?? ranked[0]?.action) : null;
    let chosen = lineFirst ?? money ?? planned ?? (ranked[0]?.score > -Infinity ? ranked[0].action : legal.find(a => a.type === 'END_TURN') ?? legal[0]);
    // plan.tagFirst: the planner's leaf counts a tag kept as a trash still to come, but the Runner clears it on its turn
    if (!lineFirst && ctx.synergy && plan().tagFirst && ranked[0]?.action.type === 'TRASH_RESOURCE' && ranked[0].tagFirst) chosen = ranked[0].action;
    return chosen;
  };
  if (score) {
    let picked = choose(true, null);
    if (!keepsScore(state, picked, score)) picked = score.first;
    ctx.note(picked);
    return picked;
  }
  // Q4, Q5. plan.scoreInTwo (counted scoring C2): a held two-turn score line's step, or the pick vetoed while it would
  // spend the line's rez money (lineAsk, shared with the planner's playouts: playoutLine)
  const two = lineAsk(state, ctx.memory.heldLine, (lineFirst, later) => choose(later || !!lineFirst, lineFirst));
  ctx.memory.heldLine = two.held;
  if (!ctx.counted) {
    tally('scoreInTwo', 'rolloutDecisions');
    if (two.lineFirst || two.action !== two.chosen) tally('scoreInTwo', 'rolloutTaken');
  }
  const picked = two.action!;
  ctx.note(picked);
  return picked;
}

/**
 * Q4 and Q5, the one sequence (A1, brief-playout-lines.md fix 3), for corpDecide and the planner's playouts (playoutLine):
 * a held line's later-turn step (Q4), else the step a held or new two-turn line plays now (Q5, lineStep on a copy); then
 * `choose` picks the click (null: none), and scoreInTwoPick plays the line's step, keeps the line (`held` is changed in
 * place, the line to keep is the result's) and vetoes a spare click that would spend the line's rez money.
 */
export function lineAsk(state: GameState, held: HeldLine | null, choose: (lineFirst: GameAction | null, later: boolean) => GameAction | null) {
  const later = !!heldLaterStep(state, held);
  const lineFirst = !later ? lineStep(state, held ? structuredClone(held) : null) : null;
  const chosen = choose(lineFirst, later);
  const two = chosen ? scoreInTwoPick(state, chosen, held) : { action: null, held };
  return { ...two, lineFirst, chosen, later };
}

/**
 * A1 (c0-rulings 04:25Z): the Corp of one planner playout. It holds `held` (a copy of the deciding Corp's line, one per
 * playout, so nothing reaches the real memory or another playout), its order reads it, the first action (the planner's
 * candidate, never replaced) only brings it up to date, and each later main-phase step with clicks asks lineAsk on the
 * order's first open entry, after a score (Q3's precedence, which playouts do not ask: red team 7). Its scoreInTwo
 * counts go to the playoutLine group.
 */
export function playoutLine(held: HeldLine | null, rank: (state: GameState, held: HeldLine | null) => ScoredAction[]) {
  let line = held;
  return {
    rank: (state: GameState) => rank(state, line),
    first: (state: GameState, action: GameAction) => void (line = unsunk(() => scoreInTwoPick(state, action, line)).held),
    step(state: GameState, pick: GameAction | null): GameAction | null {
      if (pick?.type === 'SCORE_AGENDA') return (tally('playoutLine', 'scoreFirst'), pick);
      const two = unsunk(() => lineAsk(state, line, lineFirst => lineFirst ?? pick));
      tally('playoutLine', two.later ? 'q4Asks' : 'q5Asks');
      const why = two.later ? 'q4Takes' : (`${two.held?.line.kind === 'asset' ? 'asset' : 'q5'}${two.lineFirst ? 'Steps' : 'Vetoes'}` as const);
      if (two.action && two.action !== pick) {
        tally('playoutLine', why);
        note(d => d.onPlayoutLine?.(pick, two.action!, why));
      }
      line = two.held;
      return two.action;
    },
  };
}
