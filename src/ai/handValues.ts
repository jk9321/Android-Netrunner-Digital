import { CardInstance, GameState, SideCode, cardDef } from '../core';
import { breakerScript, isIcebreaker } from '../core/engine/ice';
import { CARD_PROFILES, payoutWait, payoutWorth, turnsLeft } from './cardProfiles';
import { corpKeepValue, runnerCardValue } from './cardValues';
import { breakerTypeWorth, iceWorth } from './iceValues';
import { agendaWorth, isOneUse, runnerRigValue } from './evaluate';
import { counterWorth } from './counterValues';
import { handPlanWorth } from './cardPlans';
import { planSide } from './synergy';
import { CLICK, RATES, cardRate, fingerprint, flatRate, handFilter, payoutSlide, printedGain, reachCard, setDeckCard } from './valueModel';
import { holdPricing, noteDecision, plan, pricing, withPricing } from './pricing';

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
      // A conditional card by its plan: payoff scaled by how ready its condition is (cardPlans.ts);
      // not inside the deck's average card, which a plan's payoff can be priced from (Chain Reaction > Corp card > damage > average)
      const planned = pricing().averaging ? undefined : handPlanWorth(state, card);
      if (planned !== undefined) return planned;
      // Played out when chosen (one-step simulation); in hand, a money card is worth its net gain
      const gain = printedGain(def.stripped_text);
      const average = cardRate(state, def.side_code);
      return gain !== undefined ? Math.max(average, gain - cost) : average;
    }
    case 'agenda': {
      const points = def.agenda_points ?? 1;
      // Installed in the safest remote it could go in (or a new, bare one), as the board will value it
      const remotes = Object.values(state.corp.servers).filter(s => s.isRemote && !s.root.some(c => ['agenda', 'asset'].includes(cardDef(c).type_code ?? '')));
      const best = Math.max(agendaWorth(state, 0, def.advancement_cost ?? 0, points, undefined, 1, true), ...remotes.map(s => agendaWorth(state, 0, def.advancement_cost ?? 0, points, s.id, undefined, true)));
      return best - CLICK;
    }
    case 'ice':
      // Installed unrezzed, as the board values it (the same check of what the Corp can rez)
      return iceWorth(state, { ...card, isRezzed: false }, 'corp') - CLICK;
    case 'asset':
    case 'upgrade':
      return corpKeepValue(card.cardCode, state) - CLICK;
  }
  // Runner rig cards
  const profile = CARD_PROFILES[card.cardCode];
  if (profile && plan().cardProfiles) return payoutWorth(profile, turns, profile.load, payoutWait(state, profile, 'runner'), cardRate(state, 'runner')) * payoutSlide(state, 'runner', 'runner', profile.load) - cost - CLICK;
  // (Not while the deck's average card is worked out: pricing the rig there prices the rig cards that asked for the average)
  if (isIcebreaker(card) && flatRate('breakers') && plan().breakerCredits?.runner && !pricing().pricingBreakers.has(card.instanceId) && !pricing().averaging) {
    // What it adds to the rig's coverage once installed (Mayfly's one use included), as the board will see it.
    // A breaker hosted on Bling or Madani is priced inside the rig too: while it is, the rule-based worth below
    const rig = state.runner.rig;
    const after = { ...state, runner: { ...state.runner, rig: { ...rig, programs: [...rig.programs, card] } } } as GameState;
    // (a hosted breaker would price itself again: pricing().pricingBreakers)
    const pricingBreakers = pricing().pricingBreakers;
    pricingBreakers.add(card.instanceId);
    try {
      return runnerRigValue(after, true, 'runner') - runnerRigValue(state, true, 'runner') - cost - CLICK;
    } finally {
      pricingBreakers.delete(card.instanceId);
    }
  }
  if (isIcebreaker(card)) {
    const breaks = breakerScript(card)?.breaks;
    const covered = state.runner.rig.programs.some(p => isIcebreaker(p) && breakerScript(p)?.breaks === breaks);
    let worth = !breaks || breaks === 'any' ? RATES.anyBreaker + 4 : covered ? 1 : breakerTypeWorth(state, breaks);
    if (plan().cardFixes && isOneUse(card)) worth /= 3; // Mayfly: one run, then trashed
    return worth - cost - CLICK;
  }
  const unique = def.uniqueness && [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources].some(c => c.cardCode === card.cardCode);
  if (unique) return -cost - CLICK; // a second copy only replaces the first
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
export function heldWorth(state: GameState, card: CardInstance, side: SideCode, freeInstall = false): number {
  const credits = side === 'corp' ? state.corp.credits : state.runner.credits;
  const soon = (cardDef(card).cost ?? 0) <= credits ? SOON.now : SOON.later;
  // Installed later without spending a click (a program hosted on Madani): the click playedWorth charges is saved
  return Math.max(HAND_FLOOR, soon * (playedWorth(state, card) + (freeInstall ? CLICK : 0)));
}

/** While a planner plays a turn out, keep the hands as they were seen (a card drawn in the playout stays unseen). Returns the undo. */
export function freezeKnownHand(): () => void {
  return holdPricing({ frozen: true });
}

/**
 * As `side`'s decision starts, note in the pricing context what it knows: which cards are in `side`'s hand now
 * (anything that arrives later in a look-ahead is unknown) and the Runner's credits (iceValues.ts stopCredits).
 * Not while a planner plays a turn out (frozen).
 */
export function decisionContext(state: GameState, side: SideCode) {
  if (pricing().frozen) return;
  const hand = side === 'corp' ? state.corp.hq : state.runner.grip;
  noteDecision({ [side]: new Set(hand.map(c => c.instanceId)) }, { id: state.id, credits: state.runner.credits });
}
/** The old name of decisionContext. */
export const noteKnownHand = decisionContext;

/** Cards in `side`'s hand the deciding AI hasn't seen (drawn in a look-ahead): it can't know what they are. */
export function unseenInHand(state: GameState, side: SideCode): CardInstance[] {
  const seen = pricing().known[side];
  const hand = side === 'corp' ? state.corp.hq : state.runner.grip;
  return seen ? hand.filter(c => !seen.has(c.instanceId)) : [];
}

const deckAverage = new Map<string, number>();

/** Average held worth of the cards left in a side's deck (what a draw is expected to bring). */
function drawWorth(state: GameState, side: SideCode): number {
  const deck = side === 'corp' ? state.corp.rd : state.runner.stack;
  // The cards, not just the count: the Runner reply deals guessed decks of the same size (runnerReply.ts).
  // plan.drawWorthCredits (code audit, 2026-11-06): and the side's credits, which decide what each card would cost to play
  // (heldWorth's SOON): without them the average from the turn's first credit count was used all turn, and in look-aheads
  // that spend or gain money (found as a test that passed alone and failed after another, tests/brokeCorp.test.ts)
  const credits = plan().drawWorthCredits ? `${side === 'corp' ? state.corp.credits : state.runner.credits}:` : '';
  // and the whole position (valueModel fingerprint: scores, rezzed ice, rigs...): the in-run rez model's look-aheads
  // (2026-11-06) price boards a turn would otherwise never see (a steal, a rez, a toll paid), and with the cache cleared
  // at its size cap a value from one of those could be served for the real board, so a reloaded game played on
  // differently from the one in memory (tests/savedGame.test.ts)
  const board = plan().drawWorthCredits ? `${fingerprint(state)}:` : '';
  const key = `${planSide()}:${side}:${state.id}:${state.turnNumber}:${credits}${board}${deck.map(c => c.instanceId).join(',')}`;
  const cached = deckAverage.get(key);
  if (cached !== undefined) return cached;
  // While the average is worked out, a card's worth that needs the average card (cardRate) gets the flat rate:
  // the deck's average card can't depend on itself (a value loop otherwise, valueModel.ts guardLoop)
  const value = withPricing({ averaging: true }, () => (deck.length ? deck.reduce((n, c) => n + heldWorth(state, c, side), 0) / deck.length : RATES.drawnCard));
  if (deckAverage.size > 500) deckAverage.clear();
  deckAverage.set(key, value);
  return value;
}

/** The deck's average card for valueModel's cardRate (plan.flatRates.cards); the flat rate while it is being worked out. */
setDeckCard((state, side) => (pricing().averaging ? RATES.drawnCard : drawWorth(state, side)));

/**
 * Worth of a side's own hand: the best `limit` cards by held worth, the
 * first over the limit as a filter (Jeff), the rest nothing. The first few
 * cards keep their extra worth as cards to have at all (life against damage).
 */
export function ownHandValue(state: GameState, side: SideCode): number {
  const hand = side === 'corp' ? state.corp.hq : state.runner.grip;
  const limit = (side === 'corp' ? state.corp.handSizeLimit : state.runner.handSizeLimit) ?? 5;
  const seen = pricing().known[side];
  // plan.heldMoney: the money operation moneyReach already puts on the Corp's credit slide isn't counted again in HQ
  const reach = side === 'corp' && plan().heldMoney && plan().moneyReach ? reachCard(state) : undefined;
  const values = hand
    .map(c => (seen && !seen.has(c.instanceId) ? drawWorth(state, side) : c === reach ? HAND_FLOOR : heldWorth(state, c, side)))
    .sort((a, b) => b - a);
  let value = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < RATES.handCoreCards) value += RATES.handCore - RATES.drawnCard; // having cards at all
    value += i < limit ? values[i] : i === limit ? handFilter() : 0;
  }
  return value;
}

export const handByCard = (side: SideCode): boolean => !!plan().handByCard?.[side];

/**
 * A click priced by the best plays in hand (Jeff, 2026-10-28; plan.clickByPlay):
 * at least a credit (1 on the credit slide, Jeff's floor), usually more.
 * Each card in hand can be played once, so with k clicks left a click is
 * worth the average of the k best uses: playing the best cards, drawing
 * (the deck average) or taking a credit, which can be repeated. A card in
 * hand already holds most of its worth (SOON.now), so playing it now is
 * worth only the rest: what a click left unspent loses.
 */
export function clickWorth(state: GameState, side: SideCode): number {
  const player = side === 'corp' ? state.corp : state.runner;
  const clicks = Math.max(1, player.clicks);
  const key = `${planSide()}:${side}:${state.id}:${state.turnNumber}:${player.clicks}:${player.credits}:${(side === 'corp' ? state.corp.hq : state.runner.grip).map(c => c.instanceId).join(',')}`;
  const cached = clickCache.get(key);
  if (cached !== undefined) return cached;
  const hand = side === 'corp' ? state.corp.hq : state.runner.grip;
  const credits = player.credits;
  const plays = hand
    .filter(c => (cardDef(c).cost ?? 0) <= credits && cardDef(c).type_code !== 'agenda')
    // What playing it now adds: the card already holds SOON.now of its worth in hand, so the click buys the
    // rest (playedWorth charges the click: add it back to get what the click buys)
    .map(c => (1 - SOON.now) * (playedWorth(state, c) + CLICK))
    .sort((a, b) => b - a);
  const repeatable = Math.max(1, drawWorth(state, side));
  let total = 0;
  for (let i = 0; i < clicks; i++) total += Math.max(repeatable, plays[i] ?? 0);
  const value = Math.max(1, Math.min(3, total / clicks));
  if (clickCache.size > 2000) clickCache.clear();
  clickCache.set(key, value);
  return value;
}
const clickCache = new Map<string, number>();

/** Price of a click left to `side`, as `viewer` sees it: best play in hand for its own, the 1.25 default for the other side's. */
export function clickPrice(state: GameState, side: SideCode, viewer: SideCode): number {
  if (!plan().clickRate?.[viewer]) return RATES.click;
  return side === viewer && plan().clickByPlay?.[viewer] ? clickWorth(state, side) : CLICK;
}

