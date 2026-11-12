import { GameAction, GameState, activePrompt, cardDef, executeAction, findCardAnywhere, getLegalActions } from '../core';
import { answerPrompt } from './prompts';
import { cardSynergy } from './synergyTags';
import { knownIncome } from './countedScore';
import { scoreNowPlan } from './winNow';

/**
 * Money step 5a, M1 (spec-money-generation.md; M0: econ operations sat playable in HQ 5.34 op-turns a game). The
 * counted pick for an econ operation that nets credits (rule 5.2.6: playing an operation is a Corp action, a click).
 * Nets: the Corp's credits after the play, its prompts answered as the Corp answers them, plus the known turn-start
 * income (countedScore knownIncome), against the same before (1.10); an operation that also costs a card from HQ is left to
 * the Corp's own pick. Measured and not kept: econ abilities the same way
 * (never fired: the Corp never clicks for a credit while one is legal, run 43168471217), the operation ordered around
 * the Corp's own pick (-1.8 ± 2.1, run 43175743297), and only in place of a click for a credit or a draw (+0.9 ± 1.5,
 * run 43175972281).
 */

export const moneyStats = { ops: 0 };

const worth = (s: GameState) => s.corp.credits + knownIncome(s);

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

interface Option { action: GameAction; after: GameState; net: number }

/** Each legal econ operation with what it nets this turn (credits plus known turn-start income). */
function options(state: GameState, legal: GameAction[]): Option[] {
  const out: Option[] = [];
  const before = worth(state);
  for (const a of legal) {
    if (a.type !== 'PLAY_OPERATION_OR_EVENT') continue;
    const card = state.corp.hq.find(c => c.instanceId === a.cardInstanceId);
    if (!card || !((cardSynergy(cardDef(card)).gives?.econ ?? 0) > 0)) continue;
    const after = played(state, a);
    if (!after) continue;
    // A play that also costs a card from HQ (Hansei Review) is not money alone: the card is not counted in credits, so
    // the Corp's own pick decides it
    if (state.corp.hq.some(c => c.instanceId !== card.instanceId && !after.corp.hq.some(x => x.instanceId === c.instanceId))) continue;
    const net = worth(after) - before;
    if (net > 0) out.push({ action: a, after, net });
  }
  return out;
}

/** The action installs an agenda or advances an installed agenda (rule 1.17.3a: an agenda is scored once its advancement counters meet its requirement). */
export function agendaStep(state: GameState, a: GameAction): boolean {
  if (a.type !== 'INSTALL_CARD' && a.type !== 'ADVANCE_CARD') return false;
  const card = a.type === 'INSTALL_CARD' ? state.corp.hq.find(c => c.instanceId === a.cardInstanceId) : findCardAnywhere(state, a.cardInstanceId);
  return !!card && cardDef(card).type_code === 'agenda';
}

/**
 * M1: the econ operation to play now, or null. Several: the one whose gain makes another of them, or a
 * score this turn (winNow scoreNowPlan), affordable first; otherwise the largest net gain.
 */
export function moneyPick(state: GameState, own?: GameAction | null): GameAction | null {
  if (state.activePlayer !== 'corp' || activePrompt(state) || state.activeRun || state.corp.clicks <= 0) return null;
  // The Corp's own pick moves an agenda toward a score (installs or advances one): that click belongs to the agenda's
  // line, not to money (bug report #15: Hedge Fund and Greasing the Palm took the clicks that move Offworld Office out of HQ)
  if (own && agendaStep(state, own)) return null;
  const ops = options(state, getLegalActions(state, 'corp'));
  if (!ops.length) return null;
  const enables = (o: Option): boolean => {
    if (ops.length < 2) return false;
    const was = new Set(ops.map(x => (x.action as { cardInstanceId: string }).cardInstanceId));
    const now = options(o.after, getLegalActions(o.after, 'corp'));
    return now.some(x => !was.has((x.action as { cardInstanceId: string }).cardInstanceId)) || !!scoreNowPlan(o.after);
  };
  const ranked = ops.map(o => ({ o, first: enables(o) })).sort((a, b) => Number(b.first) - Number(a.first) || b.o.net - a.o.net);
  moneyStats.ops++;
  return ranked[0].o.action;
}
