import { CardInstance, GameAction, GameState, activePrompt, cardDef, executeAction, findCardAnywhere, getLegalActions } from '../core';
import { answerPrompt } from './prompts';
import { cardSynergy } from './synergyTags';
import { holdCost, knownIncome, scoringRemote } from './countedScore';
import { profileOf } from './cardProfiles';
import { plan } from './pricing';
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

/** A card rezzed before is installed and unrezzed after. */
function derezzed(before: GameState, after: GameState): boolean {
  const rezzed = new Set(Object.values(before.corp.servers).flatMap(v => [...v.root, ...v.ice]).filter(c => c.isRezzed).map(c => c.instanceId));
  return Object.values(after.corp.servers).some(v => [...v.root, ...v.ice].some(c => rezzed.has(c.instanceId) && !c.isRezzed));
}

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
    // A play that also pays with something credits do not count is not money alone, so the Corp's own pick decides it:
    // a card from HQ (Hansei Review), a rezzed card derezzed (rule 8.1.3: turned facedown, its rez cost paid again to
    // use it, 8.1.2), or bad publicity taken (rule 10.6: credits for the Runner during its runs)
    if (state.corp.hq.some(c => c.instanceId !== card.instanceId && !after.corp.hq.some(x => x.instanceId === c.instanceId))) continue;
    if (derezzed(state, after) || after.corp.badPublicity > state.corp.badPublicity) continue;
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
    // Only cards that were in HQ before the play: one the play drew is the real top of R&D, which the Corp does not know
    // ahead (plan.hiddenDraws)
    const held = new Set(state.corp.hq.map(c => c.instanceId));
    const now = options(o.after, getLegalActions(o.after, 'corp')).map(x => (x.action as { cardInstanceId: string }).cardInstanceId).filter(id => held.has(id));
    return now.some(id => !was.has(id)) || !!scoreNowPlan(o.after);
  };
  const ranked = ops.map(o => ({ o, first: enables(o) })).sort((a, b) => Number(b.first) - Number(a.first) || b.o.net - a.o.net);
  moneyStats.ops++;
  return ranked[0].o.action;
}

export const assetStats = { fired: 0, scoring: 0 };

/**
 * Money step A1 (temporary switches plan.assetFirst, plan.assetScoring; from H0: Jeff's Corp makes 8.4 credits by turn 10
 * from econ assets' abilities and drips against the AI's 3.7, and the AI draws 3.4 times by then against his 1.6). When
 * the Corp's own pick is a click for a credit or a draw (rule 5.2.6: basic actions), an econ asset in HQ whose card
 * entry pays back (profile: credits per payout, more loaded than its rez cost) is installed in its place, as a new
 * remote (rule 3.3.1: an asset goes only in a remote's root, one asset or agenda per root). plan.assetScoring: in the scoring remote's root instead
 * while that root is empty and the remote holds by the count (holdCost), else a new remote. Rezzing stays with the
 * Corp's rez rules (corpAI: rezzed when its drip starts or a click is left to use it). Never in place of an install,
 * advance, operation or anything else. Null: no change.
 */
export function assetPick(state: GameState, pick: GameAction): GameAction | null {
  const p = plan();
  if (!p.assetFirst && !p.assetScoring) return null;
  if (pick.type !== 'GAIN_CREDIT' && pick.type !== 'DRAW_CARD') return null;
  if (state.activePlayer !== 'corp' || activePrompt(state) || state.activeRun || state.corp.clicks <= 0) return null;
  const asset = state.corp.hq.filter(c => pays(c) > 0).sort((a, b) => pays(b) - pays(a))[0];
  if (!asset) return null;
  const legal = getLegalActions(state, 'corp').filter(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === asset.instanceId && !(a as { faceUp?: boolean }).faceUp);
  let install = legal.find(a => (a as { asNewRemote?: boolean }).asNewRemote);
  if (p.assetScoring) {
    const scoring = scoringRemote(state);
    const end = state.corp.credits + Math.max(0, state.corp.clicks - 1);
    const there = scoring && scoring.root.length === 0 && holdCost(state, scoring.ice, end) !== null ? legal.find(a => (a as { targetServerId?: string }).targetServerId === scoring.id) : undefined;
    if (there) {
      install = there;
      assetStats.scoring++;
    }
  }
  if (install) assetStats.fired++;
  return install ?? null;
}

/** An econ asset's payback: its profile's credits loaded over its rez cost, 0 for any other card. */
function pays(c: CardInstance): number {
  const pr = cardDef(c).type_code === 'asset' ? profileOf(c.cardCode) : undefined;
  return pr && pr.pay > 0 && pr.load > (cardDef(c).cost ?? 0) ? pr.load - (cardDef(c).cost ?? 0) : 0;
}
