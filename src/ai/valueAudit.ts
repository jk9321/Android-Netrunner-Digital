import { CardDefinition } from '../core';
import { isIcebreaker } from '../core/engine/ice';
import { CARD_PROFILES } from './cardProfiles';
import { CARD_VALUES } from './cardValues';
import { COUNTER_WORTH } from './counterValues';
import { moneyOpGain } from './corpAI';
import { EFFECT_CODES } from './effectValues';

/**
 * The every-card value audit (Jeff, docs/ai-value-model-plan.md): how the
 * AI prices each card in the pool. tests/valueAudit.test.ts fails for any
 * card nothing prices on purpose, and scripts/print-card-values.ts prints
 * the table for review.
 */
export type ValueSource =
  | 'agenda: points, counters, advancement'
  | "ice: the Runner's cost to get past it"
  | 'icebreaker: the stops it saves'
  | 'payout profile'
  | 'counters by effect'
  | 'effect formula'
  | 'hand-set number'
  | 'money operation (from its text)'
  | 'simulated play'
  | 'identity: constant, abilities played by the engine';

/** Wording that puts credits or counters on the card itself. */
const HOLDS_COUNTERS = /(load \d+ credits? onto (it|this)|place \d+ (virus|power|agenda|credit)s?(?: counters?)? on (it|this)|place \d+ credits? on this|hosted (virus|power|agenda) counter|recurring credits)/i;

/**
 * Cards that hold counters but whose counters are priced by the logic that
 * uses them, not the board: advancement counters on assets and ice (the
 * Corp's advance and rez choices), and cards that put counters on other
 * cards. Each with the reason.
 */
export const COUNTERS_PRICED_ELSEWHERE: Record<string, string> = {
  '30045': 'Urtica Cipher: advancement counters, priced by the Corp advance choice and the Runner trap caution',
  '30061': 'Clearinghouse: advancement counters, priced by the Corp advance and rez choices',
  '35061': 'Idiosyncresis: advancement counters, priced by the Corp advance and rez choices',
  '30063': 'Pharos: advancement counters on ice, priced by the Corp advance choice',
  '35076': 'Syailendra: advancement counters on ice, priced by the Corp advance choice',
  '30009': 'Cookbook: puts its counter on another virus program, priced there',
  '30029': 'Overclock: its 5 credits last only for the run it starts, priced by playing it out',
};

export function valueSources(def: CardDefinition): ValueSource[] {
  const sources: ValueSource[] = [];
  const code = def.code;
  switch (def.type_code) {
    case 'agenda':
      sources.push('agenda: points, counters, advancement');
      break;
    case 'ice':
      sources.push("ice: the Runner's cost to get past it");
      break;
    case 'identity':
      sources.push('identity: constant, abilities played by the engine');
      break;
    case 'operation':
      sources.push(moneyOpGain(code) !== undefined ? 'money operation (from its text)' : 'simulated play');
      break;
    case 'event':
      sources.push('simulated play');
      break;
    default:
      if (isIcebreaker({ cardCode: code } as never)) sources.push('icebreaker: the stops it saves');
      if (CARD_PROFILES[code]) sources.push('payout profile');
      if (EFFECT_CODES.includes(code)) sources.push('effect formula');
      // The hand-set numbers in cardValues.ts: not used where a profile or effect formula prices the card
      else if (CARD_VALUES[code] && !CARD_PROFILES[code]) sources.push('hand-set number');
  }
  if (COUNTER_WORTH[code]) sources.push('counters by effect');
  return sources;
}

/** Cards still priced only by a hand-set number (Jeff, 2026-10-28: none should be). */
export function handSetOnly(cards: CardDefinition[]): string[] {
  return cards.filter(def => valueSources(def).length === 1 && valueSources(def)[0] === 'hand-set number').map(def => `${def.code} ${def.title}`);
}

/** Cards nothing prices on purpose, and counter-holding cards whose counters fall to a default rate. */
export function unpricedCards(cards: CardDefinition[]): string[] {
  const problems: string[] = [];
  for (const def of cards) {
    if (valueSources(def).length === 0) problems.push(`${def.code} ${def.title}: no value source`);
    const holds = HOLDS_COUNTERS.test(def.stripped_text ?? '');
    if (holds && !COUNTER_WORTH[def.code] && !CARD_PROFILES[def.code] && !COUNTERS_PRICED_ELSEWHERE[def.code]) {
      problems.push(`${def.code} ${def.title}: holds counters, none priced`);
    }
  }
  return problems;
}
