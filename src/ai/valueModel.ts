/**
 * The AI's exchange rates, in credits: what a click, a card, a credit, a
 * counter, a point, a tag and the like are worth, in one place, so every
 * part of the AI prices them the same way.
 *
 * Step 1 of the value model (plan: https://claude.ai/artifact/FRSCNV6bvpe1iExG7VmNod)
 * only gathers the numbers the board evaluation already used, so play is
 * unchanged. Later steps replace them with the curves in the plan (the
 * credit slide against a need, clicks set by the best play, points and
 * damage clocks), each behind its own tuning.plan switch.
 */
import { CardInstance, GameState, SideCode, cardDef } from '../core';
import { tuning } from './synergy';

export const RATES = {
  /** A click left this turn. */
  click: 1,
  /** Extra worth of each credit while a side is short of them, up to `creditShortUntil` credits. */
  creditShortBonus: 0.6,
  creditShortUntil: 6,
  /** Each of the first `handCore` cards in hand. */
  handCore: 2,
  handCoreCards: 3,
  /** A card in hand beyond the first few, up to the limit (with plan.drawValue on, and off). */
  drawnCard: 1.6,
  drawnCardOff: 0.8,
  /** An agenda point in a score area. */
  point: 8,
  /** A tag, to the Corp and against the Runner (plus tagThreat with the deck-aware AI). */
  tagForCorp: 1.5,
  tagAgainstRunner: 3,
  /** Each point of core damage taken. */
  coreDamage: 4,
  /** Installed ice: unrezzed, and rezzed (plus a share of its rez cost). */
  ice: 1,
  rezzedIceCostShare: 0.6,
  /** Being able to break an ice type, and owning any "break any" breaker. */
  iceTypeCoverage: 8,
  anyBreaker: 2,
  /** An installed icebreaker, and the multiplier on other rig cards' CARD_VALUES worth. */
  icebreaker: 2,
  rigCardScale: 2,
  /** An advancement counter on an installed agenda, and an agenda ready to score. */
  advancement: 1.5,
  scoreableAgenda: 6,
  /** Counters, by what they do on the card (Jeff: never by counter type alone). */
  counters: {
    /** A hosted credit (Regolith, Azimat...). */
    hostedCredit: 0.6,
    /** Smartware Distributor's hosted credits: they pay out 1 a turn. */
    smartwareCredit: 0.25,
    /** A virus counter, and one on Fermenter (2 credits each when it is trashed). */
    virus: 0.7,
    fermenterVirus: 1.5,
    /** Dividends and Next Big Thing agenda counters in the score area. */
    scoredAgenda: 1.5,
    /** AU Co. power counters on the identity. */
    identityPower: 0.8,
  },
  /** A card hosted to play later (Bling, Madani). */
  hostedCard: 0.8,
  /** Each card a card draws, added to its CARD_VALUES worth while plan.drawValue is on. */
  cardDrawn: 0.5,
  /** Cards with no CARD_VALUES entry: Corp asset or upgrade, upgrade [scoring remote, HQ or R&D], Runner rig card. */
  defaultKeep: 1,
  defaultUpgrade: [1, 0.5] as [number, number],
  defaultRig: 2,
} as const;

/** Credits are worth more while a side is short of them. */
export function creditValue(credits: number): number {
  return credits + RATES.creditShortBonus * Math.min(Math.max(credits, 0), RATES.creditShortUntil);
}

/*
 * Step 2: the agreed curves. Each is switched by its own tuning.plan flag
 * (clickRate, creditSlide, pointClock, handFilter); with a flag off the
 * step-1 number above is used.
 */

/** Worth of a click (Jeff: never under a credit, 1.25 by default). */
export const CLICK = 1.25;
export const clickRate = (viewer: SideCode): number => (tuning.plan.clickRate?.[viewer] ? CLICK : RATES.click);

/**
 * Worth of `credits` against a need (Jeff): each extra credit is worth 1.8
 * when broke, sliding to 1 at the need, then fading toward 0.3. The sum of
 * those marginal values.
 */
export function creditSlide(credits: number, need: number): number {
  const c = Math.max(credits, 0);
  const n = Math.max(need, 1);
  const below = (x: number) => x + 0.8 * (x - (x * x) / (2 * n));
  if (c <= n) return below(c) + Math.min(credits, 0);
  const over = c - n;
  return below(n) + 0.3 * over + 3.5 * (1 - Math.exp(-over / 5));
}

/** Worth of each agenda point by the score it takes a side to (index = score reached; 7 is the win). */
const POINT_STEPS = [0, 8, 8, 9, 10, 12, 15, 15];
/** Worth of a score of `score` points: the sum of its steps. */
export function pointValue(score: number): number {
  if (!tuning.plan.pointClock) return RATES.point * score;
  let value = 0;
  for (let s = 1; s <= score; s++) value += POINT_STEPS[Math.min(s, 7)];
  return value;
}

/** What a position holds that the value helpers read: two calls with the same fingerprint on the same state agree. */
function fingerprint(state: GameState): string {
  const { corp, runner } = state;
  const ids = (cards: CardInstance[]) => cards.map(c => c.instanceId + (c.isRezzed ? 'r' : '') + (c.hostedCards?.length ?? '')).join(',');
  const servers = Object.values(corp.servers).map(s => s.id + ':' + ids(s.ice) + '/' + ids(s.root)).join(';');
  return [
    state.turnNumber, state.activePlayer, corp.credits, corp.clicks, corp.score, corp.hq.length, corp.rd.length, corp.archives.faceUp.length, corp.archives.faceDown.length,
    runner.credits, runner.clicks, runner.score, runner.tags, runner.grip.length, runner.stack.length, ids(runner.rig.programs), ids(runner.rig.hardware), ids(runner.rig.resources), servers,
  ].join('|');
}

const memos = new WeakMap<GameState, { print: string; values: Map<string, unknown> }>();

/**
 * A value worked out once per position: the AI prices the same board many
 * times over in one decision (each ice's subroutines price the rig, which
 * prices runs on each server...). Kept on the state object, and dropped if
 * the state is changed in place (tests do).
 */
export function memo<T>(state: GameState, key: string, work: () => T): T {
  const print = fingerprint(state);
  let entry = memos.get(state);
  if (!entry || entry.print !== print) {
    entry = { print, values: new Map() };
    memos.set(state, entry);
  }
  if (entry.values.has(key)) return entry.values.get(key) as T;
  const value = work();
  entry.values.set(key, value);
  return value;
}

/** True while a plan.flatRates piece is on. */
export const flatRate = (key: string): boolean => !!tuning.plan.flatRates?.[key];

/** The deck's average card (handValues.ts registers it; valueModel can't import it without a cycle). */
let deckCard: ((state: GameState, side: SideCode) => number) | null = null;
export const setDeckCard = (fn: (state: GameState, side: SideCode) => number) => (deckCard = fn);

/**
 * Worth of one card drawn from, or lost out of, `side`'s hand: the deck's
 * average card with plan.flatRates.cards (no peeking: the deck, not the
 * hand), else the flat rate.
 */
export function cardRate(state: GameState | undefined, side: SideCode): number {
  return state && deckCard && flatRate('cards') ? deckCard(state, side) : RATES.drawnCard;
}

/** Worth of `points` more for a side on `score` (averaged decklist points can be fractional). */
export function pointGain(score: number, points: number): number {
  if (!flatRate('points')) return RATES.point * points;
  const whole = Math.floor(points);
  const base = pointValue(score + whole) - pointValue(score);
  return base + (points - whole) * (pointValue(score + whole + 1) - pointValue(score + whole));
}

/** Worth of a flatline (plan.flatRates.flatline: the whole game, the Corp's points still to come and the Runner's lost). */
export function flatlineWorth(state: GameState): number {
  if (!flatRate('flatline')) return 4 * RATES.point;
  return pointValue(7) - pointValue(state.corp.score) + pointValue(state.runner.score);
}

/** Worth of the first card over the hand-size limit (Jeff: you pick the worst card to discard). */
export const handFilter = (): number => (tuning.plan.handFilter ? 0.3 : 0);

/** Every card a side owns, wherever it is (for decklist averages). */
export function sideCards(state: GameState, side: SideCode): CardInstance[] {
  const corp = state.corp;
  const runner = state.runner;
  const installed = [
    ...Object.values(corp.servers).flatMap(s => [...s.root, ...s.ice]),
    ...runner.rig.programs,
    ...runner.rig.hardware,
    ...runner.rig.resources,
  ];
  const all = [
    ...corp.hq, ...corp.rd, ...corp.archives.faceUp, ...corp.archives.faceDown, ...corp.scoreArea,
    ...runner.grip, ...runner.stack, ...runner.heap, ...runner.scoreArea,
    ...installed, ...installed.flatMap(c => c.hostedCards ?? []),
  ];
  return all.filter(c => cardDef(c).side_code === side);
}

const mean = (values: number[], fallback: number) => (values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : fallback);
const buildTargets = new Map<string, number>();

/**
 * Credits a side should build toward from turn 1 (Jeff), from decklist
 * averages: Corp, 2.5 layers of its typical ice plus an agenda's
 * advancement; Runner, 2.5 layers of the Corp's typical ice (its rez cost
 * stands in for the cost to break it) plus its own 3 most expensive cards.
 * Decklists are public, so the Normal AI stays fair.
 */
export function buildTarget(state: GameState, side: SideCode): number {
  // The game id carries its seed, so this is worked out once per game
  const key = `${side}:${state.id}:${state.corp.identity.cardCode}:${state.runner.identity.cardCode}`;
  const cached = buildTargets.get(key);
  if (cached !== undefined) return cached;
  const corpCards = sideCards(state, 'corp');
  const runnerCards = sideCards(state, 'runner');
  const ice = mean(corpCards.filter(c => cardDef(c).type_code === 'ice').map(c => cardDef(c).cost ?? 0), 3);
  let target: number;
  if (side === 'corp') {
    target = 2.5 * ice + mean(corpCards.filter(c => cardDef(c).type_code === 'agenda').map(c => cardDef(c).advancement_cost ?? 3), 3);
  } else {
    const costs = runnerCards.map(c => cardDef(c).cost ?? 0).sort((a, b) => b - a);
    target = 2.5 * ice + mean(costs.slice(0, 3), 3);
  }
  buildTargets.set(key, target);
  return target;
}

/**
 * Credits a side needs on this board: the Corp, to rez its unrezzed ice on
 * the centrals and on remotes holding agendas; the Runner, to pay the rez
 * cost of the rezzed ice on the most expensive server (rez cost standing
 * in for break cost until step 5 prices ice by what it costs to break).
 */
export function boardNeed(state: GameState, side: SideCode): number {
  const servers = Object.values(state.corp.servers);
  if (side === 'corp') {
    let need = 0;
    for (const server of servers) {
      const counts = !server.isRemote || server.root.some(c => cardDef(c).type_code === 'agenda');
      if (counts) for (const ice of server.ice) if (!ice.isRezzed) need += cardDef(ice).cost ?? 0;
    }
    return need;
  }
  return Math.max(0, ...servers.map(s => s.ice.filter(i => i.isRezzed).reduce((n, i) => n + (cardDef(i).cost ?? 0), 0)));
}

/** The need credits slide against: the build target or the board's need, whichever is more. */
export const creditNeed = (state: GameState, side: SideCode): number => Math.max(buildTarget(state, side), boardNeed(state, side));

/** Worth of a side's credits on this board, as `viewer` (the deciding side) prices them. */
export function sideCreditValue(state: GameState, side: SideCode, viewer: SideCode): number {
  const credits = side === 'corp' ? state.corp.credits : state.runner.credits;
  return tuning.plan.creditSlide?.[viewer] ? creditSlide(credits, creditNeed(state, side)) : creditValue(credits);
}
