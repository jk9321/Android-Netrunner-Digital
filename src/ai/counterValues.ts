import { CardInstance, GameState, SideCode, cardDef } from '../core';
import { findCardAnywhere } from '../core';
import { counters, rezCost } from '../core/engine/cardEffects';
import { tuning } from './synergy';
import { RATES } from './valueModel';
import { bestBreakPlan } from './runs';

/**
 * Value model step 3 (docs/ai-value-model-plan.md): a counter is worth
 * what it does on the card it sits on (Jeff), never a flat rate for its
 * type. Each entry prices one counter of one type on one card, in credits,
 * against the board it is on now. Cards not listed keep the step-1 rates.
 * tests/counterValues.test.ts checks each entry with a worked example.
 */
type CounterType = 'credit' | 'virus' | 'power' | 'agenda';
type CounterWorth = (state: GameState, card: CardInstance) => number;

/** Credits paid out a few at a time on the Corp's turn: a little under face value, since the Runner can trash the asset first. */
const PAID_OUT = 0.85;

export const COUNTER_WORTH: Record<string, Partial<Record<CounterType, CounterWorth>>> = {
  // ---- Corp ----
  '30037': { credit: () => PAID_OUT }, // Nico Campaign: 3 a turn, no click
  '35040': { credit: () => PAID_OUT }, // Otto Campaign: 2 a turn, no click
  '35072': { credit: () => PAID_OUT }, // Anthill Excavation Contract: 4 a turn and a card
  '30071': { credit: () => 1 - RATES.click / 3 }, // Regolith Mining License: 3 credits per click
  '35082': { credit: () => 0.8 }, // Mahkota Langit Grid: recurring, only for rezzes in its server
  '35051': { power: () => 1.5 }, // Phật Gioan Baotixita: 1 net damage each, when an agenda is scored or stolen
  '35046': { power: () => 1.5 }, // AU Co.: 2 counters look at 3, keep 2 of them
  // Agenda counters in the score area, by what spending one does
  '35038': { agenda: () => 3 }, // Project Ingatan: install a card from Archives for free
  '35049': { agenda: () => 4 }, // Sericulture Expansion: 2 advancement counters (2 clicks and 2 credits)
  '35059': { agenda: () => 1.5 }, // Embedded Reporting: an operation to the top of R&D
  '35071': { agenda: () => 3.5 }, // Off the Books: fetch any card, installed for free
  '35060': { agenda: () => 3 }, // Next Big Thing: a click for 4 cards and a reshuffle
  '35048': { agenda: () => 3 }, // Proprionegation: sends a run back to Archives once
  // ---- Runner ----
  '30033': { credit: () => 0.75 }, // Smartware Distributor: 1 a turn
  '35029': { credit: () => 0.8 }, // Azimat: recurring, only for trash costs
  '30007': { virus: () => 2 - RATES.click / 4 }, // Fermenter: 2 credits each, for a click and the card (cashed at about 4)
  '30008': { virus: () => 0.9 }, // Leech: -1 strength on an encounter, about a credit of boosting
  '35008': { virus: () => 1 }, // Hantu: +2 strength for a boost
  '30024': { virus: () => 1.2 }, // Conduit: 1 more card accessed on each Conduit run
  '35031': { power: () => 1.2 }, // Devadatta Drone: 1 more card accessed on an R&D breach
  '35010': { power: () => 1.2 }, // Cacophony: 2 counters sabotage 3
  // Botulus: each counter breaks 1 subroutine on its host, worth what breaking one costs (3 if nothing breaks it)
  '30004': { virus: (state, card) => trojanHostWorth(state, card, host => Math.min(3, bestBreakPlan(state, host, 1)?.credits ?? 3)) },
  // Tranquilizer: 3 counters derez its host, a third of the rez cost each
  '30017': { virus: (state, card) => trojanHostWorth(state, card, host => (host.isRezzed ? rezCost(state, host) / 3 : 0.3)) },
};

function trojanHostWorth(state: GameState, card: CardInstance, worth: (host: CardInstance) => number): number {
  const host = card.hostedOnId ? findCardAnywhere(state, card.hostedOnId) : undefined;
  return host ? worth(host) : 0;
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

/** Worth of one counter of `type` on `card`, as `viewer` prices it. */
export function counterWorth(state: GameState, card: CardInstance, type: CounterType, viewer: SideCode): number {
  const entry = tuning.plan.counterEffects?.[viewer] ? COUNTER_WORTH[card.cardCode]?.[type] : undefined;
  return entry ? entry(state, card) : defaultWorth(card, type);
}

/** Worth of all the counters of `type` on `card`. */
export const countersWorth = (state: GameState, card: CardInstance, type: CounterType, viewer: SideCode): number => {
  const n = counters(card, type);
  return n > 0 ? n * counterWorth(state, card, type, viewer) : 0;
};
