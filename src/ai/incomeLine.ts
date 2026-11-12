import { CardInstance, GameAction, GameState, activePrompt, cardDef, executeAction, getLegalActions, isLegalAction } from '../core';
import { answerPrompt } from './prompts';
import { cardSynergy } from './synergyTags';
import { plan } from './pricing';
import { knownIncome } from './countedScore';
import { scoreNowPlan } from './winNow';

/**
 * Money step 5a, M1 and M1b (spec-money-generation.md; M0: econ operations sat playable in HQ 5.34 op-turns a game,
 * an econ ability was legal and unused on 1.50 Corp turns a game). The counted pick for money that costs no traded
 * click: an econ operation that nets credits (rule 5.2.6: playing an operation is a Corp action, a click), and an econ
 * ability that nets credits and costs no click. Nets: the Corp's credits after the play, its prompts answered as the
 * Corp answers them, plus the known turn-start income (countedScore knownIncome), against the same before (1.10).
 */

export const moneyStats = { ops: 0, freeAbilities: 0, clickAbilities: 0, owedPlayed: 0, owedDropped: 0 };

const isEcon = (c: CardInstance) => (cardSynergy(cardDef(c)).gives?.econ ?? 0) > 0;
const worth = (s: GameState) => s.corp.credits + knownIncome(s);
const installed = (s: GameState) => Object.values(s.corp.servers).flatMap(v => [...v.ice, ...v.root]);

/** The state after the action with its prompts answered as the Corp would answer them, or null when it does not settle on this Corp turn. */
function played(s: GameState, a: GameAction): GameState | null {
  try {
    let n = executeAction(s, a);
    for (let i = 0; i < 20 && activePrompt(n); i++) n = executeAction(n, answerPrompt(n, activePrompt(n)!.side, undefined, true));
    return activePrompt(n) || n.activePlayer !== 'corp' || n.turnNumber !== s.turnNumber || n.activeRun ? null : n;
  } catch {
    return null;
  }
}

interface Option { action: GameAction; after: GameState; net: number; clicks: number }

/** Each legal econ play of this kind with what it nets this turn (credits plus known turn-start income). */
function options(state: GameState, legal: GameAction[], kind: 'op' | 'ability'): Option[] {
  const out: Option[] = [];
  const before = worth(state);
  for (const a of legal) {
    const id = (a as { cardInstanceId?: string }).cardInstanceId;
    if (!id) continue;
    const card = kind === 'op'
      ? a.type === 'PLAY_OPERATION_OR_EVENT' ? state.corp.hq.find(c => c.instanceId === id) : undefined
      : a.type === 'USE_ABILITY' ? installed(state).find(c => c.instanceId === id) : undefined;
    if (!card || !isEcon(card)) continue;
    const after = played(state, a);
    if (!after) continue;
    const net = worth(after) - before;
    if (net > 0) out.push({ action: a, after, net, clicks: state.corp.clicks - after.corp.clicks });
  }
  return out;
}

/**
 * M1 (plan.moneyFirst): the econ operation to play now, or null. Several: the one whose gain makes another of them, or a
 * score this turn (winNow scoreNowPlan), affordable first; otherwise the largest net gain. M1b (plan.moneyAbility): an
 * econ ability that nets credits and costs no click, before the operations (it spends nothing the turn has).
 */
export function moneyPick(state: GameState): GameAction | null {
  if (state.activePlayer !== 'corp' || activePrompt(state) || state.activeRun || state.corp.clicks <= 0) return null;
  const legal = getLegalActions(state, 'corp');
  if (plan().moneyAbility) {
    const free = options(state, legal, 'ability').filter(o => o.clicks === 0).sort((a, b) => b.net - a.net)[0];
    if (free) {
      moneyStats.freeAbilities++;
      return free.action;
    }
  }
  if (!plan().moneyFirst) return null;
  const op = bestOp(state, legal);
  if (op) moneyStats.ops++;
  return op;
}

/** The netting econ operation to play first among those legal now (moneyPick's order), or null. */
function bestOp(state: GameState, legal: GameAction[]): GameAction | null {
  const ops = options(state, legal, 'op');
  if (!ops.length) return null;
  const enables = (o: Option): boolean => {
    if (ops.length < 2) return false;
    const was = new Set(ops.map(x => (x.action as { cardInstanceId: string }).cardInstanceId));
    const now = options(o.after, getLegalActions(o.after, 'corp'), 'op');
    return now.some(x => !was.has((x.action as { cardInstanceId: string }).cardInstanceId)) || !!scoreNowPlan(o.after);
  };
  const ranked = ops.map(o => ({ o, first: enables(o) })).sort((a, b) => Number(b.first) - Number(a.first) || b.o.net - a.o.net);
  return ranked[0].o.action;
}

/** M1' (a): the Corp's own pick put after the operation that took its click, to be played on the next decision of the same turn. */
export interface OwedPick { game: string; turn: number; action: GameAction }

/**
 * M1' (plan.moneyOrder, a; plan.moneyCheap, b): the operation is ordered around the Corp's own pick (its planner's, run as
 * usual) instead of taking the click from it. M0's diagnosis of M1: the pick it displaced was played later the same turn
 * 17 times in 67 (agenda installs 0 of 10). (a) The operation goes first while the clicks left after it still cover the
 * pick (its click cost, 5.2.6; a purge is 3), and the pick is owed to the next decision; otherwise the pick stands and the
 * operation waits. (b) No ordering: the operation replaces the pick only when the pick is a click for a credit or a draw
 * (a legal pick's credit cost is always covered, so the spec's "cost not covered" case does not arise).
 */
export function moneyOrderPick(state: GameState, pick: GameAction, owed: OwedPick | null): { action: GameAction; owed: OwedPick | null } {
  if ((!plan().moneyOrder && !plan().moneyCheap) || state.activePlayer !== 'corp' || activePrompt(state) || state.activeRun || state.corp.clicks <= 0)
    return { action: pick, owed: null };
  // The pick owed from this turn's earlier decision, while still legal
  if (owed && owed.game === state.id && owed.turn === state.turnNumber) {
    if (isLegalAction(state, owed.action)) {
      moneyStats.owedPlayed++;
      return { action: owed.action, owed: null };
    }
    moneyStats.owedDropped++;
  }
  if (pick.type === 'PLAY_OPERATION_OR_EVENT' || pick.type === 'END_TURN') return { action: pick, owed: null };
  if (plan().moneyCheap) {
    if (pick.type !== 'GAIN_CREDIT' && pick.type !== 'DRAW_CARD') return { action: pick, owed: null };
    const op = bestOp(state, getLegalActions(state, 'corp'));
    if (op) moneyStats.ops++;
    return { action: op ?? pick, owed: null };
  }
  let cost: number;
  try {
    cost = Math.max(0, state.corp.clicks - executeAction(state, pick).corp.clicks);
  } catch {
    return { action: pick, owed: null };
  }
  if (state.corp.clicks - 1 < cost) return { action: pick, owed: null };
  const op = bestOp(state, getLegalActions(state, 'corp'));
  if (!op) return { action: pick, owed: null };
  moneyStats.ops++;
  // A click for a credit or a draw is not owed: the operation took its place
  const owe = pick.type === 'GAIN_CREDIT' || pick.type === 'DRAW_CARD' ? null : { game: state.id, turn: state.turnNumber, action: pick };
  return { action: op, owed: owe };
}

/** M1b (plan.moneyAbility): in place of the Corp's click for a credit, an econ ability that spends that one click and nets more than the credit. */
export function moneyForCredit(state: GameState, pick: GameAction): GameAction | null {
  if (!plan().moneyAbility || pick.type !== 'GAIN_CREDIT') return null;
  const best = options(state, getLegalActions(state, 'corp'), 'ability').filter(o => o.clicks === 1 && o.net > 1).sort((a, b) => b.net - a.net)[0];
  if (!best) return null;
  moneyStats.clickAbilities++;
  return best.action;
}
