import { GameAction, GameState, activePrompt, cardDef, executeAction, findCardAnywhere, getLegalActions } from '../core';
import { answerPrompt } from './prompts';
import { cardSynergy } from './synergyTags';
import { knownIncome } from './countedScore';
import { scoreNowPlan } from './winNow';
import { tuning } from './synergy';

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

export const moneyStats = { ops: 0, abilities: 0 };

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

/** Where a card the Corp has installed sits, rezzed or not. */
const installed = (state: GameState, id: string) => Object.values(state.corp.servers).flatMap(v => [...v.root, ...v.ice]).find(c => c.instanceId === id);

/**
 * Which installed abilities are offered: none; one-click ones (M1c); or also those spending more clicks (Humanoid
 * Resources, three), each when the Corp's own pick is a draw, a credit, or a play the ability's own prompts also make.
 */
type Abilities = { one: boolean; multi: boolean; own?: GameAction | null; beat: number };

/**
 * The ability's line also makes the Corp's own pick: it installs from HQ the card the pick installs or one of its type
 * (ice for ice, an asset for an asset), or the operation the pick plays has left HQ.
 */
function subsumes(state: GameState, after: GameState, own?: GameAction | null): boolean {
  if (!own || own.type === 'DRAW_CARD' || own.type === 'GAIN_CREDIT') return true;
  if (own.type === 'INSTALL_CARD') {
    const card = state.corp.hq.find(c => c.instanceId === own.cardInstanceId);
    return !!card && state.corp.hq.some(c => cardDef(c).type_code === cardDef(card).type_code && !!installed(after, c.instanceId));
  }
  if (own.type === 'PLAY_OPERATION_OR_EVENT') return !after.corp.hq.some(c => c.instanceId === own.cardInstanceId);
  return false;
}

/**
 * Each legal econ operation with what it nets this turn (credits plus known turn-start income). With abilities (M1c),
 * also each paid ability of a rezzed installed card (rules 1.8.3a, 9.5.1; 5.2.6a: card abilities give actions beside
 * the basic ones) that nets more than `beat`, the credits the Corp's own pick nets: one-click ones in place of a draw or
 * a credit; with `multi`, ones spending more clicks, in place of a draw, a credit, or a play the ability's prompts
 * (answered as the Corp answers them) also make, and an unrezzed one through its rez first (rule 8.1.2; the rez is the
 * pick, a free action in the paid ability window, 5.6.2a, and the use follows at the next decision).
 */
function options(state: GameState, legal: GameAction[], ab: Abilities = { one: false, multi: false, beat: 0 }): Option[] {
  const out: Option[] = [];
  const before = worth(state);
  for (const a of legal) {
    const id = (a as { cardInstanceId?: string }).cardInstanceId ?? '';
    const there = installed(state, id);
    const ability = (ab.one || ab.multi) && a.type === 'USE_ABILITY' && !!there?.isRezzed;
    const rez = ab.multi && a.type === 'REZ_CARD' && !!there && !there.isRezzed && cardDef(there).type_code === 'asset';
    if (a.type !== 'PLAY_OPERATION_OR_EVENT' && !ability && !rez) continue;
    const card = there ?? state.corp.hq.find(c => c.instanceId === id);
    if (!card || (!ability && !rez && !((cardSynergy(cardDef(card)).gives?.econ ?? 0) > 0))) continue;
    let mid: GameState | null = state;
    let use: GameAction | undefined = a;
    if (rez) {
      mid = played(state, a);
      use = mid ? getLegalActions(mid, 'corp').find(x => x.type === 'USE_ABILITY' && x.cardInstanceId === id) : undefined;
    }
    const after = mid && use ? played(mid, use) : null;
    if (!after || !mid) continue;
    if (ability || rez) {
      const clicks = mid.corp.clicks - after.corp.clicks;
      if (clicks < 1 || (clicks === 1 ? !ab.one : !ab.multi)) continue;
      if (clicks === 1 ? !(ab.own?.type === 'DRAW_CARD' || ab.own?.type === 'GAIN_CREDIT') : !subsumes(state, after, ab.own)) continue;
    }
    // A play that also pays with something credits do not count is not money alone, so the Corp's own pick decides it:
    // a card from HQ (Hansei Review; an ability's install puts one on the board, which is no loss, 8.5), a rezzed card
    // derezzed (rule 8.1.3: turned facedown, its rez cost paid again to use it, 8.1.2), or bad publicity taken (rule
    // 10.6: credits for the Runner during its runs)
    const lost = (c: { instanceId: string }) => c.instanceId !== card.instanceId && !after.corp.hq.some(x => x.instanceId === c.instanceId) && !((ability || rez) && installed(after, c.instanceId));
    if (state.corp.hq.some(lost)) continue;
    if (derezzed(state, after) || after.corp.badPublicity > state.corp.badPublicity) continue;
    const net = worth(after) - before;
    if (net > (ability || rez ? ab.beat : 0)) out.push({ action: a, after, net });
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
  // M1c: an installed econ ability competes only for a click the Corp's own pick spends on a draw or a credit (rule
  // 5.2.6), or with more clicks for a play its own prompts also make, and must net more than that pick does; an
  // advance, a score or a held line's step keeps its click
  const one = tuning.plan.moneyAbility;
  const multi = tuning.plan.moneyAbilityMulti;
  const beat = (one || multi) && own ? Math.max(0, worth(played(state, own) ?? state) - worth(state)) : 0;
  const ops = options(state, getLegalActions(state, 'corp'), { one, multi, own, beat });
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
  if (ranked[0].o.action.type === 'USE_ABILITY' || ranked[0].o.action.type === 'REZ_CARD') moneyStats.abilities++;
  else moneyStats.ops++;
  return ranked[0].o.action;
}
