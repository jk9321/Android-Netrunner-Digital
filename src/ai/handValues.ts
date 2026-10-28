import { CardInstance, GameState, SideCode, cardDef } from '../core';
import { breakerScript, isIcebreaker } from '../core/engine/ice';
import { CARD_PROFILES, payoutWait, payoutWorth, turnsLeft } from './cardProfiles';
import { corpKeepValue, runnerCardValue } from './cardValues';
import { breakerTypeWorth, iceWorth } from './iceValues';
import { agendaWorth, isOneUse, runnerRigValue } from './evaluate';
import { counterWorth } from './counterValues';
import { iceCost } from './runs';
import { tuning } from './synergy';
import { CLICK, RATES, handFilter, pointValue, sideCreditValue } from './valueModel';

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
      const points = def.agenda_points ?? 1;
      if (tuning.plan.agendaBoard) {
        // Installed in the safest remote it could go in (or a new, bare one), as the board will value it (plan.agendaBoard)
        const remotes = Object.values(state.corp.servers).filter(s => s.isRemote && !s.root.some(c => ['agenda', 'asset'].includes(cardDef(c).type_code ?? '')));
        const best = Math.max(agendaWorth(state, 0, def.advancement_cost ?? 0, points, undefined, 1), ...remotes.map(s => agendaWorth(state, 0, def.advancement_cost ?? 0, points, s.id)));
        return best - CLICK;
      }
      // Scored from hand about 40% of the time; the rest is stolen or stuck
      return 0.4 * (pointValue(state.corp.score + points) - pointValue(state.corp.score));
    }
    case 'ice':
      // Installed unrezzed, as the board values it (plan.agendaBoard: the same check of what the Corp can rez)
      if (tuning.plan.agendaBoard) return iceWorth(state, { ...card, isRezzed: false }, 'corp') - CLICK;
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
export function heldWorth(state: GameState, card: CardInstance, side: SideCode): number {
  const credits = side === 'corp' ? state.corp.credits : state.runner.credits;
  const soon = (cardDef(card).cost ?? 0) <= credits ? SOON.now : SOON.later;
  return Math.max(HAND_FLOOR, soon * playedWorth(state, card));
}

/** The cards in each side's hand the deciding AI has seen (set as it starts a decision). */
const known: Record<SideCode, Set<string> | null> = { corp: null, runner: null };

let frozen = false;

/** While a planner plays a turn out, keep the hands as they were seen (a card drawn in the playout stays unseen). Returns the undo. */
export function freezeKnownHand(): () => void {
  const was = frozen;
  frozen = true;
  return () => (frozen = was);
}

/** Remember which cards are in `side`'s hand now: anything that arrives later in a look-ahead is unknown. */
export function noteKnownHand(state: GameState, side: SideCode) {
  if (frozen) return;
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
  const key = `${side}:${state.id}:${state.turnNumber}:${player.clicks}:${player.credits}:${(side === 'corp' ? state.corp.hq : state.runner.grip).map(c => c.instanceId).join(',')}`;
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
  if (side === viewer && handSchedule(viewer)) return scheduleClick(state, side);
  if (!tuning.plan.clickRate?.[viewer]) return RATES.click;
  return side === viewer && tuning.plan.clickByPlay?.[viewer] ? clickWorth(state, side) : CLICK;
}

/**
 * The hand schedule (Jeff, 2026-10-28; plan.handSchedule): hand value and
 * click value from one plan. It lays out when each card in hand would be
 * played over this turn and the next SCHEDULE.turns, limited by the clicks
 * each turn and the credits on hand (a spare click is a credit click).
 * Each turn's plays go best first, and a card counts its worth (what it
 * adds, less its cost) cut by SCHEDULE.discount for each turn it waits.
 * Cards over the hand limit at the end of this turn are discarded (worth
 * nothing), and cards still waiting at the end are worth little. A click
 * left this turn is then worth what it adds to the plan: a card played a
 * turn sooner, or a credit when credits are what holds the plan back.
 */
export const SCHEDULE = {
  /** Turns after this one the plan looks at. */
  turns: 2,
  /** Share of a play's worth kept for each turn it waits. */
  discount: 0.8,
  /** Clicks a later turn keeps back for runs (Runner) or advancing (Corp). */
  reserve: 1,
};

/** What a spare click buys when no card is worth playing: a credit (Jeff's floor). */
const SPARE_CLICK = 1;

/** A card's play in the schedule: what it adds, the credits and the clicks it takes. */
interface Play { gain: number; cost: number; clicks: number }

/** The plays a side's hand holds: a card's worth once played less its cost; unseen cards at the deck average. */
function handPlays(state: GameState, side: SideCode): Play[] {
  const hand = side === 'corp' ? state.corp.hq : state.runner.grip;
  const seen = known[side];
  let unseen: Play | null = null;
  return hand.map(c => {
    if (seen && !seen.has(c.instanceId)) return (unseen ??= deckPlay(state, side));
    return cardPlay(state, c);
  });
}

function cardPlay(state: GameState, card: CardInstance): Play {
  const def = cardDef(card);
  if (def.side_code === 'runner' && def.type_code !== 'event') return { gain: rigInstallGain(state, card), cost: def.cost ?? 0, clicks: 1 };
  // A money operation or event: its net credits on the credit slide, as the evaluation will count them once played
  const money = (def.type_code === 'event' || def.type_code === 'operation') && (def.stripped_text ?? '').match(/(?:^|\. )Gain (\d+) credits/);
  if (money) {
    const player = def.side_code === 'corp' ? state.corp : state.runner;
    const net = Number(money[1]) - (def.cost ?? 0);
    const after = { ...state, [def.side_code]: { ...player, credits: player.credits + net } } as GameState;
    return { gain: sideCreditValue(after, def.side_code, def.side_code) - sideCreditValue(state, def.side_code, def.side_code), cost: def.cost ?? 0, clicks: 1 };
  }
  const gain = playedWorth(state, card) + CLICK;
  // An agenda is installed and advanced: a click and a credit for each advancement (rules 1.10, 4.4)
  if (def.type_code === 'agenda') return { gain, cost: def.advancement_cost ?? 0, clicks: 1 + (def.advancement_cost ?? 0) };
  // Ice is installed facedown and rezzed later: no credits now
  if (def.type_code === 'ice') return { gain, cost: 0, clicks: 1 };
  return { gain, cost: def.cost ?? 0, clicks: 1 };
}

const rigGains = new Map<string, number>();

/**
 * What installing a Runner card adds, measured the way the evaluation will
 * see it once installed: the rig's worth with it less without, its loaded
 * counters, less its install cost on the credit slide. So a card the plan
 * plays now loses nothing when it is installed.
 */
function rigInstallGain(state: GameState, card: CardInstance): number {
  const def = cardDef(card);
  const rig = state.runner.rig;
  const key = `${state.id}:${state.turnNumber}:${state.runner.credits}:${[...rig.programs, ...rig.hardware, ...rig.resources].map(c => c.instanceId).join(',')}:${card.cardCode}`;
  const cached = rigGains.get(key);
  if (cached !== undefined) return cached;
  const zone = def.type_code === 'program' ? 'programs' : def.type_code === 'hardware' ? 'hardware' : 'resources';
  const cost = def.cost ?? 0;
  const after = { ...state, runner: { ...state.runner, credits: state.runner.credits - cost, rig: { ...rig, [zone]: [...rig[zone], card] } } } as GameState;
  const unique = def.uniqueness && [...rig.programs, ...rig.hardware, ...rig.resources].some(c => c.cardCode === card.cardCode);
  const gain = unique
    ? -cost
    : runnerRigValue(after, true, 'runner') - runnerRigValue(state, true, 'runner') + loadedWorth(state, card) +
      sideCreditValue(after, 'runner', 'runner') - sideCreditValue(state, 'runner', 'runner');
  if (rigGains.size > 2000) rigGains.clear();
  rigGains.set(key, gain);
  return gain;
}

const deckPlays = new Map<string, Play>();

/** The average play a card drawn from the deck brings. */
function deckPlay(state: GameState, side: SideCode): Play {
  const deck = side === 'corp' ? state.corp.rd : state.runner.stack;
  const key = `${side}:${state.id}:${state.turnNumber}:${deck.length}`;
  const cached = deckPlays.get(key);
  if (cached) return cached;
  const play = deck.length
    ? deck.map(c => cardPlay(state, c)).reduce((n, p) => ({ gain: n.gain + Math.max(0, p.gain) / deck.length, cost: n.cost + p.cost / deck.length, clicks: n.clicks + p.clicks / deck.length }), { gain: 0, cost: 0, clicks: 0 })
    : { gain: RATES.drawnCard, cost: 0, clicks: 1 };
  if (deckPlays.size > 500) deckPlays.clear();
  deckPlays.set(key, play);
  return play;
}

/**
 * Worth of a side's clicks left this turn and its hand together, by the
 * schedule. `clicks` overrides the clicks left (for pricing one click).
 */
export function scheduleValue(state: GameState, side: SideCode, clicks?: number): number {
  const player = side === 'corp' ? state.corp : state.runner;
  const left = clicks ?? player.clicks;
  const key = `${side}:${state.id}:${state.turnNumber}:${left}:${player.credits}:${(side === 'corp' ? state.corp.hq : state.runner.grip).map(c => c.instanceId).join(',')}`;
  const cached = scheduleCache.get(key);
  if (cached !== undefined) return cached;
  const limit = player.handSizeLimit ?? 5;
  const perTurn = (side === 'corp' ? 3 : 4) - SCHEDULE.reserve;
  let waiting = handPlays(state, side).sort((a, b) => b.gain / b.clicks - a.gain / a.clicks);
  let credits = player.credits;
  let value = 0;
  // Having cards at all (life against damage, options)
  value += Math.min(waiting.length, RATES.handCoreCards) * (RATES.handCore - RATES.drawnCard);
  for (let t = 0; t <= SCHEDULE.turns; t++) {
    const weight = SCHEDULE.discount ** t;
    let turnClicks = t === 0 ? left : perTurn;
    while (turnClicks > 0) {
      // Best play per click that fits this turn (an agenda may take its clicks over two turns: counted where it starts)
      const clicksNeeded = (p: Play) => Math.max(1, Math.round(p.clicks));
      const i = waiting.findIndex(p => p.cost <= credits && p.gain > SPARE_CLICK * clicksNeeded(p) && (clicksNeeded(p) <= turnClicks || t > 0 || clicksNeeded(p) > perTurn));
      if (i < 0) {
        // A credit click: worth a credit now, and a credit toward next turn's plays
        turnClicks--;
        credits += 1;
        if (t === 0) value += SPARE_CLICK;
        continue;
      }
      const [play] = waiting.splice(i, 1);
      const used = Math.min(turnClicks, clicksNeeded(play));
      turnClicks -= used;
      credits -= play.cost;
      // This turn's clicks are counted whole; a later turn's clicks are there anyway, so only what a play adds over credits
      value += weight * (play.gain - (t === 0 ? 0 : SPARE_CLICK * clicksNeeded(play)));
    }
    // End of this turn: the worst cards over the limit are discarded; the first one over is a small filter
    if (t === 0 && waiting.length > limit) {
      value += handFilter();
      waiting = waiting.slice(0, limit);
    }
  }
  // Still waiting after the plan: played some day, maybe
  for (const play of waiting) value += SCHEDULE.discount ** (SCHEDULE.turns + 1) * Math.max(0, play.gain - SPARE_CLICK);
  if (scheduleCache.size > 4000) scheduleCache.clear();
  scheduleCache.set(key, value);
  return value;
}
const scheduleCache = new Map<string, number>();

export const handSchedule = (side: SideCode): boolean => !!tuning.plan.handSchedule?.[side];

/** One click left this turn, by the schedule: what the plan loses without it. */
export function scheduleClick(state: GameState, side: SideCode): number {
  const clicks = (side === 'corp' ? state.corp : state.runner).clicks;
  if (clicks <= 0) return SPARE_CLICK;
  return scheduleValue(state, side, clicks) - scheduleValue(state, side, clicks - 1);
}
