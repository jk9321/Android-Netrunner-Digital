import { CardInstance, GameState, SideCode, cardDef } from '../core';
import { breakerScript, isIcebreaker } from '../core/engine/ice';
import { CARD_PROFILES, payoutWait, payoutWorth, turnsLeft } from './cardProfiles';
import { corpKeepValue, runnerCardValue } from './cardValues';
import { breakerTypeWorth } from './iceValues';
import { isOneUse } from './evaluate';
import { counterWorth } from './counterValues';
import { iceCost } from './runs';
import { tuning } from './synergy';
import { CLICK, RATES, handFilter, pointValue } from './valueModel';

/**
 * Cards in hand by what they do (Jeff, 2026-10-28; plan.handByCard). A card
 * in hand is worth what it will add once played, less what playing it
 * costs, scaled down by how soon it can be played. Installing a card then
 * gains the part of its worth that waiting held back, so a card worth
 * installing gets installed, and a hand of cards the AI won't play isn't
 * worth drawing into. Cards the deciding side hasn't seen yet (just drawn
 * in a look-ahead) are worth the average of the cards left in its deck, so
 * the AI never learns what it would draw.
 */

/** Share of a card's worth held while it waits in hand: playable now, or not yet. */
export const SOON = { now: 0.7, later: 0.45 };
/** A card in hand is always worth something: it can be discarded to damage or a hand-size limit. */
export const HAND_FLOOR = 0.5;

/** Worth of a card once played, less its cost and click (credits), before the wait. */
export function playedWorth(state: GameState, card: CardInstance): number {
  const def = cardDef(card);
  const cost = def.cost ?? 0;
  const turns = turnsLeft(state);
  switch (def.type_code) {
    case 'event':
    case 'operation': {
      // Played out when chosen (one-step simulation); in hand, a money card is worth its net gain
      const gain = (def.stripped_text ?? '').match(/(?:^|\. )Gain (\d+) credits/);
      return gain ? Math.max(RATES.drawnCard, Number(gain[1]) - cost) : RATES.drawnCard;
    }
    case 'agenda': {
      // Scored from hand about 40% of the time; the rest is stolen or stuck
      const points = def.agenda_points ?? 1;
      return 0.4 * (pointValue(state.corp.score + points) - pointValue(state.corp.score));
    }
    case 'ice':
      return RATES.ice + 0.6 * Math.min(8, iceCost(state, { ...card, isRezzed: true })) - CLICK;
    case 'asset':
    case 'upgrade':
      return corpKeepValue(card.cardCode, state) - CLICK;
  }
  // Runner rig cards
  const profile = CARD_PROFILES[card.cardCode];
  if (profile && tuning.plan.cardProfiles) return payoutWorth(profile, turns, profile.load, payoutWait(state, profile, 'runner')) - cost - CLICK;
  if (isIcebreaker(card)) {
    const breaks = breakerScript(card)?.breaks;
    const covered = state.runner.rig.programs.some(p => isIcebreaker(p) && breakerScript(p)?.breaks === breaks);
    let worth = !breaks || breaks === 'any' ? RATES.anyBreaker + 4 : covered ? 1 : breakerTypeWorth(state, breaks);
    if (tuning.plan.cardFixes && isOneUse(card)) worth /= 3; // Mayfly: one run, then trashed
    return worth - cost - CLICK;
  }
  const unique = def.uniqueness && [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources].some(c => c.cardCode === card.cardCode);
  if (unique) return 0;
  return RATES.rigCardScale * runnerCardValue(card.cardCode, state, card) + loadedWorth(state, card) - cost - CLICK;
}

/** Counters a card puts on itself when installed (Red Team's 12 credits, Devadatta's 2 power counters...), at their worth. */
function loadedWorth(state: GameState, card: CardInstance): number {
  const text = cardDef(card).stripped_text ?? '';
  const load = text.match(/When you install this [a-z]+(?:,| and[^,.]*,) (?:load|place) (\d+) ?(?:\[?credits?\]?|(virus|power) counters?)/i);
  if (!load) return 0;
  const type = (load[2]?.toLowerCase() ?? 'credit') as 'credit' | 'virus' | 'power';
  return Number(load[1]) * counterWorth(state, card, type, 'runner');
}

/** Worth of one card waiting in hand. */
export function heldWorth(state: GameState, card: CardInstance, side: SideCode): number {
  const credits = side === 'corp' ? state.corp.credits : state.runner.credits;
  const soon = (cardDef(card).cost ?? 0) <= credits ? SOON.now : SOON.later;
  return Math.max(HAND_FLOOR, soon * playedWorth(state, card));
}

/** The cards in each side's hand the deciding AI has seen (set as it starts a decision). */
const known: Record<SideCode, Set<string> | null> = { corp: null, runner: null };

/** Remember which cards are in `side`'s hand now: anything that arrives later in a look-ahead is unknown. */
export function noteKnownHand(state: GameState, side: SideCode) {
  const hand = side === 'corp' ? state.corp.hq : state.runner.grip;
  known[side] = new Set(hand.map(c => c.instanceId));
}

const deckAverage = new Map<string, number>();

/** Average held worth of the cards left in a side's deck (what a draw is expected to bring). */
function drawWorth(state: GameState, side: SideCode): number {
  const deck = side === 'corp' ? state.corp.rd : state.runner.stack;
  const key = `${side}:${state.id}:${state.turnNumber}:${deck.length}`;
  const cached = deckAverage.get(key);
  if (cached !== undefined) return cached;
  const value = deck.length ? deck.reduce((n, c) => n + heldWorth(state, c, side), 0) / deck.length : RATES.drawnCard;
  if (deckAverage.size > 500) deckAverage.clear();
  deckAverage.set(key, value);
  return value;
}

/**
 * Worth of a side's own hand: the best `limit` cards by held worth, the
 * first over the limit as a filter (Jeff), the rest nothing. The first few
 * cards keep their extra worth as cards to have at all (life against damage).
 */
export function ownHandValue(state: GameState, side: SideCode): number {
  const hand = side === 'corp' ? state.corp.hq : state.runner.grip;
  const limit = (side === 'corp' ? state.corp.handSizeLimit : state.runner.handSizeLimit) ?? 5;
  const seen = known[side];
  const values = hand.map(c => (seen && !seen.has(c.instanceId) ? drawWorth(state, side) : heldWorth(state, c, side))).sort((a, b) => b - a);
  let value = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < RATES.handCoreCards) value += RATES.handCore - RATES.drawnCard; // having cards at all
    value += i < limit ? values[i] : i === limit ? handFilter() : 0;
  }
  return value;
}

export const handByCard = (side: SideCode): boolean => !!tuning.plan.handByCard?.[side];
