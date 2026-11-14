import { CardInstance, GameState, SideCode, cardDef } from '../core';
import { breakerScript, isIcebreaker } from '../core/engine/ice';
import { CARD_PROFILES, payoutWait, payoutWorth, turnsLeft } from './cardProfiles';
import { corpKeepValue, runnerCardValue } from './cardValues';
import { breakerTypeWorth, iceWorth } from './iceValues';
import { agendaWorth, isOneUse, runnerRigValue } from './evaluate';
import { counterWorth } from './counterValues';
import { handPlanWorth } from './cardPlans';
import { CLICK, RATES, cardRate, fingerprint, handFilter, payoutSlide, pricingApart, positionSerial, printedGain, reachCard, scopeToGame, setDeckCard } from './valueModel';
import { leafHandByCard, noteDecision, plan, pricing, pricingKey, withPricing } from './pricing';
import { corpDrawPool, corpKnowsRd } from './oracle';

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
  if (profile) return payoutWorth(profile, turns, profile.load, payoutWait(state, profile, 'runner'), cardRate(state, 'runner')) * payoutSlide(state, 'runner', profile.load) - cost - CLICK;
  // (Not while the deck's average card is worked out: pricing the rig there prices the rig cards that asked for the average)
  if (isIcebreaker(card) && !pricing().pricingBreakers.has(card.instanceId) && !pricing().averaging) {
    // What it adds to the rig's coverage once installed (Mayfly's one use included), as the board will see it.
    // A breaker hosted on Bling or Madani is priced inside the rig too: while it is, the rule-based worth below
    const rig = state.runner.rig;
    const after = { ...state, runner: { ...state.runner, rig: { ...rig, programs: [...rig.programs, card] } } } as GameState;
    // (a hosted breaker would price itself again: pricing().pricingBreakers)
    const pricingBreakers = pricing().pricingBreakers;
    pricingBreakers.add(card.instanceId);
    try {
      return runnerRigValue(after) - runnerRigValue(state) - cost - CLICK;
    } finally {
      pricingBreakers.delete(card.instanceId);
    }
  }
  if (isIcebreaker(card)) {
    const breaks = breakerScript(card)?.breaks;
    const covered = state.runner.rig.programs.some(p => isIcebreaker(p) && breakerScript(p)?.breaks === breaks);
    let worth = !breaks || breaks === 'any' ? RATES.anyBreaker + 4 : covered ? 1 : breakerTypeWorth(state, breaks);
    if (isOneUse(card)) worth /= 3; // Mayfly: one run, then trashed
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
  return Number(load[1]) * counterWorth(state, card, type);
}

/** Worth of one card waiting in hand. */
export function heldWorth(state: GameState, card: CardInstance, side: SideCode, freeInstall = false): number {
  // Installed later without spending a click (a program hosted on Madani): the click playedWorth charges is saved
  return heldFromPlayed(state, card, side, playedWorth(state, card) + (freeInstall ? CLICK : 0));
}

/** A card's worth held in hand, from its worth played: soon if `state`'s credits pay for it, never under the floor. */
function heldFromPlayed(state: GameState, card: CardInstance, side: SideCode, played: number): number {
  const credits = side === 'corp' ? state.corp.credits : state.runner.credits;
  const soon = (cardDef(card).cost ?? 0) <= credits ? SOON.now : SOON.later;
  return Math.max(HAND_FLOOR, soon * played);
}

/**
 * As `side`'s decision starts, note in the pricing context what it knows: which cards are in `side`'s hand now
 * (anything that arrives later in a look-ahead is unknown) and the Runner's credits (iceValues.ts stopCredits).
 * Not while a planner plays a turn out (frozen).
 */
export function decisionContext(state: GameState, side: SideCode) {
  if (pricing().frozen) return;
  const hand = side === 'corp' ? state.corp.hq : state.runner.grip;
  // The deck's card prices at this decision's root (rootDeckAverage), kept while the decision notes the same board again
  const was = pricing().anchor;
  const deckValues = was?.root === state && was.side === side ? was.deckValues : undefined;
  noteDecision({ [side]: new Set(hand.map(c => c.instanceId)) }, { id: state.id, credits: state.runner.credits, root: state, side, deckValues });
}

/** Cards in `side`'s hand the deciding AI hasn't seen (drawn in a look-ahead): it can't know what they are. */
export function unseenInHand(state: GameState, side: SideCode): CardInstance[] {
  // plan.oracle.rd: a card the Corp drew in a look-ahead is one it knew was coming
  if (side === 'corp' && corpKnowsRd()) return [];
  const seen = pricing().known[side];
  const hand = side === 'corp' ? state.corp.hq : state.runner.grip;
  return seen ? hand.filter(c => !seen.has(c.instanceId)) : [];
}

const deckAverage = new Map<string, number>();
/**
 * On-hit audits of handValues' maps (test-only: tests/handCacheAudit.test.ts, scripts/cache-bisect.ts): with `on`, every
 * value served from the map is worked out again on the asking board and compared; a mismatch is a hit the key let
 * through for another board.
 */
export const drawAudit = { on: false, checked: 0, mismatches: 0, errors: [] as number[] };
export const clickAudit = { on: false, checked: 0, mismatches: 0, errors: [] as number[] };
/** Empties handValues' maps (test-only: scripts/cache-bisect.ts). */
export function clearHandCaches(): void {
  deckAverage.clear();
  clickCache.clear();
}

/**
 * Whether drawWorth on this board takes the decision root's prices (rootDeckAverage): the Corp's own deck, in the
 * playouts of a Corp decision's planner (frozen). Not the Runner's stack (its cards' worth turns on the rig, which the
 * views of a Corp decision change), nor a decision's own boards (a prompt's
 * answers are simulated and compared outside a playout: tests/clearinghouseRez.test.ts). Nor while a deck card is
 * being priced on the root (priceAtRoot): what that asks for is priced per board, and keyed so (deckRootKey ''), so a
 * value cached there doesn't depend on which cards the decision had priced so far.
 */
function atDeckRoot(state: GameState, side: SideCode): boolean {
  const anchor = pricing().anchor;
  return side === 'corp' && !pricing().pricingRootDeck && pricing().frozen && !!anchor?.root && anchor.side === 'corp' && anchor.root.id === state.id && pricing().side !== null;
}
/**
 * For caches that outlive a decision (threatModel's): which decision root's deck prices a value on this board used,
 * '' when none. Every root is its own: two roots with the same fingerprint can still price a deck card differently
 * (tests/threatCacheAudit.test.ts, deal 1421, served one such budget across decisions with the fingerprint here).
 */
export function deckRootKey(state: GameState): string {
  if (!atDeckRoot(state, 'corp')) return '';
  return `r${positionSerial(pricing().anchor!.root!)}`;
}

/** Average held worth of the cards left in a side's deck (what a draw is expected to bring). */
function drawWorth(state: GameState, side: SideCode): number {
  // plan.oracle.rd: the Corp's next draw is R&D's top card itself
  const deck = side === 'corp' ? corpDrawPool(state) : state.runner.stack;
  // The cards, not just the count: the Runner reply deals guessed decks of the same size (runnerReply.ts).
  // plan.drawWorthCredits (code audit, 2026-11-06): and the side's credits, which decide what each card would cost to play
  // (heldWorth's SOON): without them the average from the turn's first credit count was used all turn, and in look-aheads
  // that spend or gain money (found as a test that passed alone and failed after another, tests/brokeCorp.test.ts)
  const rootAvg = rootDeckAverage(state, side, deck);
  if (rootAvg !== undefined) return rootAvg;
  const credits = `${side === 'corp' ? state.corp.credits : state.runner.credits}:`;
  // and the whole position (valueModel fingerprint: scores, rezzed ice, rigs...): the in-run rez model's look-aheads
  // (2026-11-06) price boards a turn would otherwise never see (a steal, a rez, a toll paid), and with the cache cleared
  // at its size cap a value from one of those could be served for the real board, so a reloaded game played on
  // differently from the one in memory (tests/savedGame.test.ts)
  const board = `${fingerprint(state)}:`;
  const key = `${pricingKey()}:${side}:${state.id}:${state.turnNumber}:${credits}${board}${deck.map(c => c.instanceId).join(',')}`;
  // Audit Step 2 (AI-CACHE-HIDDEN-STATE): the key leaves out what R&D, Archives, the grip and the heap hold, the counters
  // and hosts of installed cards and the run under way (fingerprint has the zones by size only), so some hits are another
  // board's value (about 6%: drawAudit, tests/handCacheAudit.test.ts). An exact key cost the Corp about +50% decision time
  // (more misses, each repricing the Runner's whole stack), so the map is kept to one game: which wrong value is served
  // then depends on this game's own calls only, never on the games played before in the process (batch shards: 218 of 221).
  // Known debt, closed by pricing the Runner's stack once per decision (Step 4/5 list).
  scopeToGame(deckAverage, state);
  const cached = deckAverage.get(key);
  if (cached !== undefined && !drawAudit.on) return cached;
  // While the average is worked out, a card's worth that needs the average card (cardRate) gets the flat rate:
  // the deck's average card can't depend on itself (a value loop otherwise, valueModel.ts guardLoop)
  const value = withPricing({ averaging: true }, () => (deck.length ? deck.reduce((n, c) => n + heldWorth(state, c, side), 0) / deck.length : RATES.drawnCard));
  if (cached !== undefined) {
    // The audit (test-only): a value served from the map, worked out again on the asking board
    drawAudit.checked++;
    if (value !== cached) {
      drawAudit.mismatches++;
      drawAudit.errors.push(Math.abs(value - cached));
    }
    return cached;
  }
  if (deckAverage.size > 500) deckAverage.clear();
  deckAverage.set(key, value);
  return value;
}

/**
 * Counts for scripts: averages served from the root prices, and deck cards priced at a root. With `audit` on
 * (tests/rootDeckAverage.test.ts), every price served from the decision's cache is priced again and compared.
 */
export const deckAvgStats = { served: 0, priced: 0, audit: false, checked: 0, mismatches: 0 };
/**
 * Planner speed tier 2 (bars/planner-fast-deckavg.md): in the Corp's decisions, the deck's average card prices each
 * deck card's played worth once, on the decision's own board (its root, noted by decisionContext), and averages
 * them over the deck the asking board holds (a card the line drew is out of it), held as soon as that board's
 * credits allow. Repricing every deck card on every board was 59% of the Corp's decision time
 * (planner-fast-step1.md). Undefined (the per-board price) where atDeckRoot says no.
 * Cache: anchor.deckValues, per decision (a new anchor each time decisionContext notes another board), keyed by the
 * pricing context and side, then the card. Audited by tests/rootDeckAverage.test.ts (every hit priced again).
 */
function rootDeckAverage(state: GameState, side: SideCode, deck: CardInstance[]): number | undefined {
  if (!atDeckRoot(state, side)) return undefined;
  const anchor = pricing().anchor!;
  if (!deck.length) return RATES.drawnCard;
  const all = (anchor.deckValues ??= new Map());
  const key = `${pricingKey()}:${side}`;
  let values = all.get(key);
  if (!values) all.set(key, (values = new Map()));
  const root = anchor.root!;
  deckAvgStats.served++;
  // The asking board's credits decide which cards could be played soon (heldFromPlayed), as in the per-board
  // average (plan.drawWorthCredits): a line that spends its money down sees its draws worth less. Only the
  // card's played worth is kept from the root.
  let sum = 0;
  for (const c of deck) {
    let played = values.get(c.instanceId);
    if (played !== undefined && deckAvgStats.audit) {
      deckAvgStats.checked++;
      if (priceAtRoot(root, c) !== played) deckAvgStats.mismatches++;
    }
    if (played === undefined) {
      played = priceAtRoot(root, c);
      values.set(c.instanceId, played);
      deckAvgStats.priced++;
    }
    sum += heldFromPlayed(state, c, side, played);
  }
  return sum / deck.length;
}

/**
 * A deck card's played worth on the decision's root. As the per-board average does: inside it, a card's worth that
 * needs the average card gets the flat rate. Priced apart from the lookups that asked (pricingApart), so the decision
 * keeps one price per card whatever card was being priced when the average was first asked for (a card pricing its
 * own effects otherwise met itself: a value loop, and its flat value kept all decision).
 */
function priceAtRoot(root: GameState, card: CardInstance): number {
  return pricingApart(() => withPricing({ averaging: true, pricingRootDeck: true }, () => playedWorth(root, card)));
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
  const reach = side === 'corp' ? reachCard(state) : undefined;
  const values = hand
    // plan.oracle.rd: a card the Corp drew in a look-ahead is one it knew was coming
    .map(c => (seen && !seen.has(c.instanceId) && !(side === 'corp' && corpKnowsRd()) ? drawWorth(state, side) : c === reach ? HAND_FLOOR : heldWorth(state, c, side)))
    .sort((a, b) => b - a);
  let value = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < RATES.handCoreCards) value += RATES.handCore - RATES.drawnCard; // having cards at all
    value += i < limit ? values[i] : i === limit ? handFilter() : 0;
  }
  return value;
}

export const handByCard = (side: SideCode): boolean => leafHandByCard(side) || !!plan().handByCard?.[side];

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
  // The board is in the key (valueModel fingerprint): each hand card's played worth and the deck's average read it. Before,
  // the key left it out and about 17% of hits were another board's value (Audit Step 2 clickAudit; tests/threatCacheAudit
  // deal 1421: a stale click worth reached a cached Runner budget). Kept to one game, as drawWorth's map (above)
  const key = `${pricingKey()}:${side}:${state.id}:${state.turnNumber}:${player.clicks}:${player.credits}:${(side === 'corp' ? state.corp.hq : state.runner.grip).map(c => c.instanceId).join(',')}:${fingerprint(state)}`;
  scopeToGame(clickCache, state);
  const cached = clickCache.get(key);
  if (cached !== undefined && !clickAudit.on) return cached;
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
  if (cached !== undefined) {
    clickAudit.checked++;
    if (value !== cached) {
      clickAudit.mismatches++;
      clickAudit.errors.push(Math.abs(value - cached));
    }
    return cached;
  }
  if (clickCache.size > 2000) clickCache.clear();
  clickCache.set(key, value);
  return value;
}
const clickCache = new Map<string, number>();

/** Price of a click left to `side`, as `viewer` sees it: best play in hand for its own, the 1.25 default for the other side's. */
export function clickPrice(state: GameState, side: SideCode, viewer: SideCode): number {
  return side === viewer && plan().clickByPlay?.[viewer] ? clickWorth(state, side) : CLICK;
}

