import { CardInstance, GameState, cardDef } from '../core';
import { findCardAnywhere } from '../core';
import { counters } from '../core/engine/cardEffects';
import { RATES } from './valueModel';
import { PAYOUT_RISK } from './payoutRisk';
import type { CounterType } from './cards';
import { COUNTER_FORMULAS, COUNTER_WORTH } from './cards';

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

/** Free credits paid out on the Corp's turn: each turn's payout survives the Runner trashing the asset first. */
export const paidOut = (): number => 1 - 2 * PAYOUT_RISK.corpBare;

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

export function trojanHostWorth(state: GameState, card: CardInstance, worth: (host: CardInstance) => number): number {
  const host = card.hostedOnId ? findCardAnywhere(state, card.hostedOnId) : undefined;
  if (host) return worth(host);
  // Not installed yet (in hand): on the best rezzed ice it could go on
  const rezzed = Object.values(state.corp.servers).flatMap(s => s.ice).filter(i => i.isRezzed);
  return rezzed.length ? Math.max(...rezzed.map(worth)) : 0.5;
}

/** Step-1 rates, for cards without an entry. */
function defaultWorth(card: CardInstance, type: CounterType): number {
  switch (type) {
    case 'credit':
      return card.cardCode === '30033' ? RATES.counters.smartwareCredit : RATES.counters.hostedCredit;
    case 'virus':
      return card.cardCode === '30007' ? RATES.counters.fermenterVirus : RATES.counters.virus;
    case 'agenda':
      return RATES.counters.scoredAgenda;
    case 'power':
      return cardDef(card).type_code === 'identity' ? RATES.counters.identityPower : 0;
  }
}

/** Worth of one counter of `type` on `card` (either side prices it the same since plan.counterEffects was folded). */
export function counterWorth(state: GameState, card: CardInstance, type: CounterType): number {
  const entry = COUNTER_FORMULAS[card.cardCode]?.[type] ?? COUNTER_WORTH[card.cardCode]?.[type];
  return entry ? entry(state, card) : defaultWorth(card, type);
}

/** Worth of all the counters of `type` on `card`. */
export const countersWorth = (state: GameState, card: CardInstance, type: CounterType): number => {
  const n = counters(card, type);
  return n > 0 ? n * counterWorth(state, card, type) : 0;
};
