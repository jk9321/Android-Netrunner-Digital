import { CardInstance, GameAction, GameState, activePrompt, cardDef, executeAction, getLegalActions } from '../core';
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

export const moneyStats = { ops: 0, freeAbilities: 0, clickAbilities: 0 };

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
  const ops = options(state, legal, 'op');
  if (!ops.length) return null;
  const enables = (o: Option): boolean => {
    if (ops.length < 2) return false;
    const was = new Set(ops.map(x => (x.action as { cardInstanceId: string }).cardInstanceId));
    const now = options(o.after, getLegalActions(o.after, 'corp'), 'op');
    return now.some(x => !was.has((x.action as { cardInstanceId: string }).cardInstanceId)) || !!scoreNowPlan(o.after);
  };
  const ranked = ops.map(o => ({ o, first: enables(o) })).sort((a, b) => Number(b.first) - Number(a.first) || b.o.net - a.o.net);
  moneyStats.ops++;
  return ranked[0].o.action;
}

/** M1b (plan.moneyAbility): in place of the Corp's click for a credit, an econ ability that spends that one click and nets more than the credit. */
export function moneyForCredit(state: GameState, pick: GameAction): GameAction | null {
  if (!plan().moneyAbility || pick.type !== 'GAIN_CREDIT') return null;
  const best = options(state, getLegalActions(state, 'corp'), 'ability').filter(o => o.clicks === 1 && o.net > 1).sort((a, b) => b.net - a.net)[0];
  if (!best) return null;
  moneyStats.clickAbilities++;
  return best.action;
}
