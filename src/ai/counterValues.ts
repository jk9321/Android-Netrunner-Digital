import { CardInstance, GameState, cardDef } from '../core';
import { findCardAnywhere } from '../core';
import { counters } from '../core/engine/cardEffects';
import { RATES, logValue } from './valueModel';
import { PAYOUT_RISK } from './payoutRisk';
import { assetRisk, inIcedServer } from './cardProfiles';
import type { CounterType } from './cards';
import { CARDS, COUNTER_FORMULAS, COUNTER_WORTH } from './cards';
import { hostedTrojans, plannedSubroutines, unseenIcePool } from './runs';
import { mean, memo } from './valueModel';

/**
 * Value model step 3 (docs/ai-value-model-plan.md): a counter is worth
 * what it does on the card it sits on (Jeff), never a flat rate for its
 * type. Each entry prices one counter of one type on one card, in credits,
 * against the board it is on now. Cards not listed keep the step-1 rates.
 * tests/counterValues.test.ts checks each entry with a worked example.
 * The entries are each card's `counters` (and `counterFormulas`) in its
 * set's file in src/ai/cards/; the shared pieces stay here.
 */

/** Credits paid out a few at a time on the Corp's turn: a little under face value, since the Runner can trash the asset first. */
export const PAID_OUT = PAYOUT_RISK.wait;

/** By card code: built from the per-set card files (src/ai/cards/), entry `counters`. */
export { COUNTER_WORTH } from './cards';

/*
 * The last hand-set counter rates (Jeff, 2026-10-28; plan.counterFormulas):
 * each one worked out from what the counter turns into, in the model's
 * units, from the board and decklists. The old numbers stay for when the
 * switch is off. tests/counterValues.test.ts works each one through.
 */

/** Free credits paid out on the Corp's turn, at the asset's measured risk where it sits (V-B B3), floored at 0 (a domain bound). */
export const paidOut = (state: GameState, card: CardInstance): number => Math.max(0, 1 - 2 * assetRisk(state, inIcedServer(state, card)));

/** Average of a list, or a fallback for an empty one. */
export { mean } from './valueModel';

/** A recurring credit spent only on some costs: worth a credit if those costs come up before it refills (a turn). */
export const recurring = (uses: number): number => Math.min(1, uses / 2);


/** Average worth of `n` hosted credits taken 1 a turn: each turn of waiting costs 15%. */
export function paidOneATurn(n: number): number {
  let total = 0;
  for (let k = 1; k <= n; k++) total += PAID_OUT ** k;
  return n > 0 ? total / n : PAID_OUT;
}

/**
 * One of a trojan's counters on the ice it is hosted on: its entry's per-counter formula for a host (`worth`), read by
 * the one owner of a host's worth (B3b, brief runner-rework/briefs/b3-prompt-view.md rev 2, S3 and S4; issue #68). The
 * host prompt, the install action and the reply all read it through the board's own term.
 * - Input 1: a facedown host the Runner doesn't know (`!isRezzed && !runnerKnows`; rule 10.2.2a) is worth the formula
 *   averaged over the unseen ice pool (runs.ts unseenIcePool, the pool unrezzedDamageRisk reads), each pool card standing
 *   in for the host: one multiset, so the same on the real state and on any deal of the same knowledge. Worked out once
 *   per state and trojan code; the first such host asked stands for the place, as unrezzedDamageRisk does.
 * - Input 2: a later trojan's subroutine-breaking counters (holdFacts.breaksHostSubroutine) on a host that already
 *   holds such counters are worth the formula only up to the room the earlier ones leave in one encounter (the host's
 *   subroutine count; step 0 ruling, rulings 19), past that 0; the first one's counters keep the formula's worth. A later
 *   copy of an 'idle' trojan (runFacts.trojan.second) is worth 0. (Encounters per horizon, which would also price a lone
 *   trojan's counters kept for later encounters, is a debt for R-D.)
 * Not installed yet (in hand): on the best rezzed ice it could go on, else 0.5 (unchanged).
 */
export function trojanHostWorth(state: GameState, card: CardInstance, worth: (host: CardInstance) => number): number {
  const host = card.hostedOnId ? findCardAnywhere(state, card.hostedOnId) : undefined;
  if (host) {
    const known = (h: CardInstance) => worth(h) * hostShare(state, card, host, plannedSubroutines(state, h).length);
    if (host.isRezzed || host.runnerKnows) return known(host);
    const pool = unseenHostPool(state, card.cardCode, host, worth);
    return pool.length ? mean(pool.map(p => p.worth * hostShare(state, card, host, p.subroutines)), 0) : known(host);
  }
  // Not installed yet (in hand): on the best rezzed ice it could go on
  const rezzed = Object.values(state.corp.servers).flatMap(s => s.ice).filter(i => i.isRezzed);
  return rezzed.length ? Math.max(...rezzed.map(worth)) : 0.5;
}

/**
 * Input 1's read for one trojan code on this state: for each ice card of the unseen pool (sorted by code), the formula's
 * worth and the subroutine count of that card standing in for `host` (its own id: the subroutine and strength caches
 * are keyed by instance). Once per state and trojan code.
 */
function unseenHostPool(state: GameState, code: string, host: CardInstance, worth: (host: CardInstance) => number): { worth: number; subroutines: number }[] {
  return memo(state, `unseenHostPool:${code}`, () => {
    const byCode = new Map<string, { worth: number; subroutines: number }>();
    return unseenIcePool(state)
      .map(c => c.cardCode)
      .sort()
      .map(c => {
        let v = byCode.get(c);
        if (!v) {
          const as: CardInstance = { ...host, instanceId: `${host.instanceId}~${c}`, cardCode: c };
          v = { worth: worth(as), subroutines: plannedSubroutines(state, as).length };
          byCode.set(c, v);
        }
        return v;
      });
  });
}

/** Input 2: the share of `card`'s counters on `host` worth the formula, when the host has `subroutines` to spend them on
 * and earlier trojans' breaking counters are there first. */
function hostShare(state: GameState, card: CardInstance, host: CardInstance, subroutines: number): number {
  const facts = CARDS[card.cardCode];
  if (facts?.runFacts?.trojan?.second === 'idle' && hostedTrojans(state, host, card.cardCode)[0]?.instanceId !== card.instanceId) return 0;
  const breaks = facts?.holdFacts?.breaksHostSubroutine;
  if (!breaks) return 1;
  // The breaking counters of the trojans installed on this host before this one (the rig's order)
  const on = state.runner.rig.programs.filter(c => c.hostedOnId === host.instanceId);
  const mine = on.findIndex(c => c.instanceId === card.instanceId);
  const used = on.slice(0, mine < 0 ? on.length : mine).reduce((n, c) => {
    const b = CARDS[c.cardCode]?.holdFacts?.breaksHostSubroutine;
    return b ? n + counters(c, b.counter) : n;
  }, 0);
  if (used === 0) return 1;
  const room = Math.max(0, subroutines - used);
  const n = counters(card, breaks.counter);
  return n > 0 ? Math.min(n, room) / n : room > 0 ? 1 : 0;
}

/** Step-1 rates, for cards without an entry: the owner's default (counterWorth, and counterWorthOf for a card not installed; V-B B6). */
export function defaultWorth(card: CardInstance, type: CounterType): number {
  switch (type) {
    case 'credit':
      return RATES.counters.hostedCredit; // Smartware Distributor's own entry is read first (counterWorth)
    case 'virus':
      return RATES.counters.virus; // Fermenter's own entry is read first (counterWorth)
    case 'agenda':
      return RATES.counters.scoredAgenda;
    case 'power':
      return cardDef(card).type_code === 'identity' ? RATES.counters.identityPower : 0;
  }
}

/** Worth of one counter of `type` on `card` (either side prices it the same since plan.counterEffects was folded). Owner of a counter (registry). */
export function counterWorth(state: GameState, card: CardInstance, type: CounterType): number {
  const entry = COUNTER_FORMULAS[card.cardCode]?.[type] ?? COUNTER_WORTH[card.cardCode]?.[type];
  return logValue('counter', 'counterWorth', state, entry ? entry(state, card) : defaultWorth(card, type), card, type);
}

/** Worth of all the counters of `type` on `card`. With type credit, owner of hosted credits on a card (registry). */
export const countersWorth = (state: GameState, card: CardInstance, type: CounterType): number => {
  const n = counters(card, type);
  return n > 0 ? n * counterWorth(state, card, type) : 0;
};
