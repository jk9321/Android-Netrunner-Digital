import { CardInstance, GameState, cardDef } from '../../core';
import { dividendsOf } from '../cards';
import { ablated, tuning } from '../synergy'; // (ablated: Step S, measurement only: every rule below reads as not applying)
import { iceStop } from '../iceValues';
import { iceCost } from '../runs';
import { iceAdvanceWorth } from '../effectValues';

/**
 * The Corp's card-specific rules (Step 4 Stage C4, spec-step4-corp-core.md 2.1; tuning ladder lever 5), moved word for
 * word from the ranking (corpAI.ts) with the card codes they already named. Each reads the Corp's own cards and the
 * public board only (10.2.2a). The list of exports may only shrink (tests/codeHealth.test.ts).
 */

const type = (c: CardInstance) => cardDef(c).type_code;
const PETTY_CASH = '35081';
const CLEARINGHOUSE = '30061';
const PHAROS = '35076';
const SYAILENDRA = '30063';

/** Petty Cash from HQ: playable only as the turn's first action. */
export const isPettyCash = (state: GameState, a: { type: string; cardInstanceId?: string }): boolean =>
  !ablated('cardRules') && a.type === 'PLAY_OPERATION_OR_EVENT' && state.corp.hq.find(c => c.instanceId === a.cardInstanceId)?.cardCode === PETTY_CASH;

/**
 * A scoreable Dividends agenda the Corp can still advance this turn: each extra counter becomes agenda counters when it
 * is scored. `reserve`: the credits kept back (the ranking passed rezReserve; the candidates pass rezMoney's keep).
 */
export function overAdvance(state: GameState, cardId: string, reserve: number): boolean {
  const corp = state.corp;
  const card = Object.values(corp.servers).flatMap(s => s.root).find(c => c.instanceId === cardId);
  if (ablated('cardRules') || !tuning.dividends || !card || type(card) !== 'agenda' || dividendsOf(card.cardCode) === 0) return false;
  const excess = card.advancementCounters - (cardDef(card).advancement_cost ?? 0);
  return excess >= 0 && excess < 2 && corp.clicks >= 1 && corp.credits >= 1 + reserve;
}

/**
 * plan.clearinghouseLethal (Gemini audit, 2026-11-01): Clearinghouse's meat damage is its counters, so it keeps going
 * toward a flatline (one more than the grip, at most 6) instead of stopping at 3; other traps stop at 3.
 */
export const trapAdvanceCap = (state: GameState, card: CardInstance): number =>
  card.cardCode === CLEARINGHOUSE && !ablated('cardRules') ? Math.min(6, Math.max(3, state.runner.grip.length + 1)) : 3;

/** Pharos (+5 strength at 3 counters) and Syailendra (places counters when encountered at 3): ice worth advancing. */
export const advancesAsIce = (card: CardInstance): boolean => !ablated('cardRules') && (card.cardCode === PHAROS || card.cardCode === SYAILENDRA);

/** What an advance on Pharos or Syailendra is worth (iceAdvanceWorth on the Runner's cost to get past it). */
export function iceAdvanceValue(state: GameState, card: CardInstance): number {
  const at = (n: number) => Math.min(iceStop(state), iceCost(state, { ...card, isRezzed: true, advancementCounters: n }));
  return iceAdvanceWorth(state, card, at);
}
