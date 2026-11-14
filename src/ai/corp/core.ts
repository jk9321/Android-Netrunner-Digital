import { GameAction, GameState, activePrompt, cardDef, getLegalActions } from '../../core';
import { ScoredAction } from '../agent';
import { keepsScore, scoreNowPlan, winNowAction } from '../winNow';
import { answerPrompt } from '../prompts';
import { logNudge } from '../synergy';
import { decisionContext } from '../handValues';
import { plan } from '../pricing';
import { assetPartner, centralIce, iceRedirect, scoreInTwoPick } from '../countedScore';
import { HeldLine, heldLaterStep } from './lines';
import { tally } from '../diagnostics';
import { moneyPick } from '../incomeLine';

/**
 * Step 4 Stage B1 (spec-step4-corp-core.md 1.2, 1.3): the Corp's decision pipeline, Q0 to Q7, one function for the
 * Normal Corp (corpAI.ts HeuristicCorpAI, its look-ahead the turn planner), the Hard Corp (search.ts SearchAI, its
 * look-ahead the search) and the planner's rollouts (no look-ahead, no counted questions). Before this the Hard Corp
 * kept its own copy of the order by hand.
 *
 *   Q1 win now (winNow.ts) · Q3 score now (scoreNowPlan; a pick that keeps the score stands, keepsScore) · Q0 a prompt
 *   (prompts.ts) · Q7 the ranking (the caller's rankMainActions) with the look-ahead over it, skipped once a counted
 *   question has the click · Q6 money (incomeLine.ts moneyPick) · Q4/Q5 the held line's step or a two-turn line begun
 *   (scoreInTwoPick) · the placement rewriters (countedScore.ts; Stage B4 moves them into corp/placement.ts).
 *
 * Q2 (the turn-start window, rule 5.6.1b) is the ranking's own today (rezzes ranked at corp_turn_start): Stage B2.
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
  /** Q7's ranking: main-phase actions, best first. */
  rank(state: GameState, legal: GameAction[]): ScoredAction[];
  /** Q7's look-ahead over the ranking (the turn planner or the Hard search); null: the ranking's first. */
  lookahead?(state: GameState, ranked: ScoredAction[]): GameAction | null;
  /** The action played (the caller's loop guard). */
  note(action: GameAction): void;
  /** The reverse bluff was played: an agenda into a new remote it cannot be scored from this turn. */
  bluffed(): void;
  /** Count the ice redirects in the diagnostics (the deciding Normal Corp only). */
  countRedirects?: boolean;
  debug?: boolean;
}

const PETTY_CASH = '35081';
/** Petty Cash from HQ: playable only as the turn's first action (plan.pettyCashFirst). */
export const isPettyCash = (state: GameState, a: GameAction): boolean => a.type === 'PLAY_OPERATION_OR_EVENT' && state.corp.hq.find(c => c.instanceId === a.cardInstanceId)?.cardCode === PETTY_CASH;

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
  // is then the rule ranking's, kept while it keeps the score (keepsScore), the line's action otherwise. A held two-turn
  // line on a later turn (Q4): its step (advance or score, heldLaterStep) does not depend on the pick, and scoreInTwoPick
  // below plays it.
  const later = ctx.counted && !!heldLaterStep(state, ctx.memory.heldLine);
  const decided = !!score || later;
  const turnStart = state.turnStep?.kind === 'corp_turn_start';
  const planned = ctx.lookahead && !turnStart && !decided ? ctx.lookahead(state, ranked) : null;
  // Q6. Money step M1 (incomeLine.ts): an econ operation that nets credits is the counted pick for its click, ahead of
  // the Corp's own; a score this turn, a held two-turn line's step, or the Corp's own pick moving an agenda keeps the click
  const money = !decided && ctx.counted && !turnStart ? moneyPick(state, planned ?? ranked[0]?.action) : null;
  let chosen = money ?? planned ?? (ranked[0]?.score > -Infinity ? ranked[0].action : legal.find(a => a.type === 'END_TURN') ?? legal[0]);
  // plan.pettyCashFirst: a click for a credit while Petty Cash can still be played is a click for 2 thrown away (the
  // planner valued Petty Cash held in HQ as the money it will make, though it is playable only as the turn's first action)
  if (chosen.type === 'GAIN_CREDIT' && ctx.synergy && plan().pettyCashFirst) chosen = ranked.find(r => isPettyCash(state, r.action) && r.score > -Infinity)?.action ?? chosen;
  // plan.tagFirst: the planner's leaf counts a tag kept as a trash still to come, but the Runner clears it on its turn
  if (ctx.synergy && plan().tagFirst && ranked[0]?.action.type === 'TRASH_RESOURCE' && ranked[0].tagFirst) chosen = ranked[0].action;
  let picked = chosen;
  if (score && !keepsScore(state, picked, score)) picked = score.first;
  // Q4, Q5. plan.scoreInTwo (counted scoring C2): a held two-turn score line's step, or the pick vetoed while it would
  // spend the line's rez money
  if (!score && ctx.counted) {
    const two = scoreInTwoPick(state, picked, ctx.memory.heldLine);
    ctx.memory.heldLine = two.held;
    picked = two.action;
  }
  // Ice redirect (step 4 G3', countedScore.ts iceRedirect): the Corp's own remote ice install goes to the scoring remote
  // until it holds; nothing while a counted two-turn line is held (its ice goes where the line puts it; skipping only
  // the line's own ice played the same 663 games, run 43158341651)
  const held = ctx.memory.heldLine && ctx.memory.heldLine.game === state.id ? ctx.memory.heldLine : null;
  if (!score && picked === chosen && ctx.synergy && !held) {
    // Central ice (countedScore.ts centralIce): a central with no ice takes the ice first
    const central = centralIce(state, picked);
    const redirect = central ?? iceRedirect(state, picked);
    if (central) picked = central;
    else if (redirect) {
      if (ctx.countRedirects) tally('iceRedirect', 'fired');
      picked = redirect;
    } else picked = assetPartner(state, picked) ?? picked; // plan.assetPartner (countedScore.ts)
  }
  // The reverse bluff: at most once a game, used up only by the install actually played (a pick the counted layer
  // rewrote put no agenda in a new remote)
  const bluff = picked;
  if (bluff.type === 'INSTALL_CARD' && bluff.asNewRemote) {
    const card = state.corp.hq.find(c => c.instanceId === bluff.cardInstanceId && cardDef(c).type_code === 'agenda');
    if (card && (cardDef(card).advancement_cost ?? 0) > state.corp.clicks - 1) ctx.bluffed();
  }
  ctx.note(picked);
  if (ctx.debug) logNudge(state, 'corp', picked);
  return picked;
}
