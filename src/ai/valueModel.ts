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
import { CardInstance, GameState, SideCode, cardDef, rezCostOf } from '../core';
import { plan, pricingKey } from './pricing';

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
  /** A tag, to the Corp and against the Runner (the flat rate; tagsWorth prices tags on the tag clock). */
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
  /** An advancement counter on a card (Hearts and Minds moves them). */
  advancement: 1.5,
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

/**
 * The click prices (code audit cleanup item 5, 2026-11-06), one place for all of them:
 * - CLICK 1.25: a click by default (Jeff: never under a credit). clickRate() is this (RATES.click, 1, was step 1)
 *   with plan.clickRate off for that side.
 * - clickWorth (handValues): a side's own click priced by the best plays in its hand, 1 to 3 (plan.clickByPlay).
 *   clickPrice(state, side, viewer) picks between them.
 * - AGENDA_CLICK 2 (evaluate): a click spent advancing, priced as what it could have built instead (plan.agendaClicks).
 * - payoutClick(): the click a payout card takes (Fermenter, Smartware, profiles paid "every click"). It was the
 *   step-1 1 while everything else moved to 1.25, so click-taken money looked cheaper than clicking for a credit;
 *   plan.oneClickPrice makes it CLICK.
 */
export const CLICK = 1.25;
export const clickRate = (): number => CLICK;
export const payoutClick = (): number => CLICK;

/**
 * Worth of `credits` against a need (Jeff): each extra credit is worth 1.8
 * when broke, sliding to 1 at the need, then fading toward 0.3. The sum of
 * those marginal values.
 */
export function creditSlide(credits: number, need: number, broke = 0): number {
  const c = Math.max(credits, 0);
  const n = Math.max(need, 1);
  // plan.brokeSlope: `broke` more for the first credit, sliding to nothing at BROKE_CREDITS
  const low = (x: number) => broke * (Math.min(x, BROKE_CREDITS) - Math.min(x, BROKE_CREDITS) ** 2 / (2 * BROKE_CREDITS));
  const below = (x: number) => x + 0.8 * (x - (x * x) / (2 * n)) + low(x);
  if (c <= n) return below(c) + Math.min(credits, 0);
  const over = c - n;
  return below(n) + 0.3 * over + 3.5 * (1 - Math.exp(-over / 5));
}

/** plan.brokeSlope: below this many credits the Corp is broke (it can't rez a typical ice in the Runner's turn). */
export const BROKE_CREDITS = 4;

/** Worth of each agenda point by the score it takes a side to (index = score reached; 7 is the win). */
const POINT_STEPS = [0, 8, 8, 9, 10, 12, 15, 15];

/**
 * Settings scripts/human-agreement.ts sweeps to fit the Corp to a human's choices (Jeff, 2026-11-05: his Corp games as
 * the teacher instead of fixing one hole at a time). Play leaves them at 1: each scales a rate it names.
 */
export const KNOBS = {
  /** The Corp's points (POINT_STEPS), as the Corp counts them. */
  corpPoints: 1,
};
/** Worth of a score of `score` points: the sum of its steps. */
export function pointValue(score: number, scale = 1): number {
  if (!plan().pointClock) return RATES.point * score * scale;
  let value = 0;
  for (let s = 1; s <= score; s++) value += POINT_STEPS[Math.min(s, 7)];
  return value * scale;
}

/**
 * What a position holds that the value helpers read: two calls with the same fingerprint on the same state agree.
 * Built by concatenation (planner speed 2026-11-12: memo builds it on every call); the same string the array join gave.
 */
export function fingerprint(state: GameState): string {
  const { corp, runner } = state;
  let servers = '';
  let first = true;
  for (const s of Object.values(corp.servers)) {
    servers += (first ? '' : ';') + s.id + ':' + printIds(s.ice) + '/' + printIds(s.root);
    first = false;
  }
  return state.turnNumber + '|' + state.activePlayer + '|' + corp.credits + '|' + corp.clicks + '|' + corp.score + '|' + corp.hq.length + '|' + corp.rd.length + '|' + corp.archives.faceUp.length + '|' + corp.archives.faceDown.length + '|' +
    runner.credits + '|' + runner.clicks + '|' + runner.score + '|' + runner.tags + '|' + runner.grip.length + '|' + runner.stack.length + '|' + printIds(runner.rig.programs) + '|' + printIds(runner.rig.hardware) + '|' + printIds(runner.rig.resources) + '|' + servers;
}

/** fingerprint's list of cards: instance id, 'r' if rezzed, the count of hosted cards (when the card has a list). */
function printIds(cards: CardInstance[]): string {
  let out = '';
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    out += (i ? ',' : '') + c.instanceId + (c.isRezzed ? 'r' : '') + (c.hostedCards?.length ?? '');
  }
  return out;
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
  key = pricingKey() + ':' + key; // values depend on the pricing context: the deciding side, its plan, the guards up (pricing.ts)
  if (entry.values.has(key)) return entry.values.get(key) as T;
  const value = work();
  entry.values.set(key, value);
  return value;
}


/** The deck's average card (handValues.ts registers it; valueModel can't import it without a cycle). */
let deckCard: ((state: GameState, side: SideCode) => number) | null = null;
export const setDeckCard = (fn: (state: GameState, side: SideCode) => number) => (deckCard = fn);

/**
 * Worth of one card drawn from, or lost out of, `side`'s hand: the deck's
 * average card with plan.flatRates.cards (no peeking: the deck, not the
 * hand), else the flat rate.
 */
export function cardRate(state: GameState | undefined, side: SideCode): number {
  return state && deckCard ? deckCard(state, side) : RATES.drawnCard;
}

/** Worth of `points` more for a side on `score` (averaged decklist points can be fractional). */
export function pointGain(score: number, points: number): number {
  const whole = Math.floor(points);
  const base = pointValue(score + whole) - pointValue(score);
  return base + (points - whole) * (pointValue(score + whole + 1) - pointValue(score + whole));
}

/** Worth of a flatline (plan.flatRates.flatline: the whole game, the Corp's points still to come and the Runner's lost). */
export function flatlineWorth(state: GameState): number {
  return pointValue(7) - pointValue(state.corp.score) + pointValue(state.runner.score);
}

/** evaluate's points term for the Corp (sideStrength: the Corp's points less the Runner's). */
export function pointsTerm(state: GameState): number {
  return pointValue(state.corp.score) - pointValue(state.runner.score);
}

/**
 * A game end met inside a SAMPLED Runner reply (audit Step 1, spec-step1-terminal-price.md), priced for the Corp on the
 * point clock instead of evaluate's ±1000. The winner's points term settles to 7 (1.7.2a: 7 agenda points win; 1.7.2b
 * flatline; 1.7.2c Corp decked), and the loser also forfeits what it could still have scored (pointValue(7) less its
 * points at the root): a loss costs the rest of the game, so a near loss is not cheap (on the plain clock a Runner win
 * from 4 points cost only 42 against a sibling sample, deal 1321 T14). The rest is `rootBoard`, the board before the
 * Runner's reply (the reply root's leaf less its points term): evaluate is not zero-centred (a quiet mid-game board reads
 * ~100), so the root's board is the baseline every sample of that line starts from; the board the game ended on is not
 * read, the game is over. Same winner, same line: same price. Read by runnerReply only.
 */
export function sampledEndWorth(winner: SideCode, rootBoard: number, root: GameState): number {
  return winner === 'corp'
    ? rootBoard + pointValue(7) + (pointValue(7) - pointValue(root.runner.score))
    : rootBoard - pointValue(7) - (pointValue(7) - pointValue(root.corp.score));
}

/** Worth of the first card over the hand-size limit (Jeff: you pick the worst card to discard). */
export const handFilter = (): number => 0.3;

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

/** The average of `values`, or `fallback` for none. */
export const mean = (values: number[], fallback: number): number => (values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : fallback);
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
      // plan.oneRezMoney: what rezzing it costs now (Tread Lightly, Fransofia Ward), as the rule ranking's reserve counts it
      if (counts) for (const ice of server.ice) if (!ice.isRezzed) need += plan().oneRezMoney ? rezCostOf(state, ice) : cardDef(ice).cost ?? 0;
    }
    return need;
  }
  return Math.max(0, ...servers.map(s => s.ice.filter(i => i.isRezzed).reduce((n, i) => n + (cardDef(i).cost ?? 0), 0)));
}

/** The need credits slide against: the build target or the board's need, whichever is more. */
export const creditNeed = (state: GameState, side: SideCode): number => {
  return Math.max(buildTarget(state, side), boardNeed(state, side));
};

/** Share of a money operation's net gain that holding its cost already earns (plan.moneyReach): it still takes a click, and a turn. */
export const MONEY_REACH = 0.5;

/**
 * Money the Corp's credits unlock (Jeff's bug report, 2026-10-31; plan.moneyReach): the best money
 * operation in HQ it can afford, by its net gain. Credits are lumpy: a broke Corp with Petty Cash
 * (3 credits before the turn's first action) and Hedge Fund (5) in HQ can play neither, and its
 * last credit spent on a 1-credit rez keeps it locked out. The Corp's own view only: the Runner
 * doesn't see HQ.
 */
export function moneyReach(state: GameState): number {
  const card = reachCard(state);
  // plan.heldMoney: less the credit the click that plays it could have taken instead, so holding it is never worth
  // as much as playing it (a held Petty Cash, +2 for a click, was worth the same as a click for a credit)
  return card ? MONEY_REACH * Math.max(0, moneyGain(card) - 1) : 0;
}

/** The credits a card's text gains outright ("Gain N credits" at the start of a sentence), or undefined. */
export function printedGain(text: string | undefined): number | undefined {
  const gain = /(?:^|\. )Gain (\d+) credits/.exec(text ?? '');
  return gain ? Number(gain[1]) : undefined;
}

/** Net credits a money operation gains when played ("Gain N credits" less its cost), else 0. */
export function moneyGain(card: CardInstance): number {
  const def = cardDef(card);
  if (def.type_code !== 'operation' && def.type_code !== 'event') return 0;
  const gain = printedGain(def.stripped_text);
  return gain !== undefined ? gain - (def.cost ?? 0) : 0;
}

/** The money operation in HQ that moneyReach counts: the best net gain the Corp can pay for. */
export function reachCard(state: GameState): CardInstance | undefined {
  const credits = state.corp.credits;
  let best: CardInstance | undefined;
  for (const card of state.corp.hq) {
    const def = cardDef(card);
    if (def.type_code !== 'operation' || (def.cost ?? 0) > credits) continue;
    if (moneyGain(card) > (best ? moneyGain(best) : 0)) best = card;
  }
  return best;
}

/** plan.brokeSlope: the Corp's first credit worth this much more (1.8 + 1 = 2.8), sliding to nothing at BROKE_CREDITS. */
export const BROKE_SLOPE = 1;

/** Worth of a side's credits on this board, as `viewer` (the deciding side) prices them. */
export function sideCreditValue(state: GameState, side: SideCode, viewer: SideCode): number {
  const credits = side === 'corp' ? state.corp.credits : state.runner.credits;
  // The money it unlocks in HQ sits on the slide with the credits: worth most to a broke Corp
  const reach = side === 'corp' && viewer === 'corp' ? moneyReach(state) : 0;
  const need = creditNeed(state, side);
  // plan.brokeSlope (Jeff, 2026-11-05: rez ice when needed, then build back up): the Corp's own first 4 credits are
  // worth up to 2.8 each, not 1.8 (a steeper slope all the way to the need made a click for a credit beat installing
  // Otto Campaign at 6 credits). Broke, it made no more money than when rich (2.3 credits a turn): a credit click scored
  // 1.8 - 1.25 and lost to advancing or installing almost anything, and it went into the Runner's turn unable to rez
  const broke = side === 'corp' && viewer === 'corp' ? BROKE_SLOPE : 0;
  return reach ? creditSlide(credits + reach, need, broke) + Math.min(credits, 0) : creditSlide(credits, need, broke);
}

/**
 * plan.payoutSlide (Jeff, 2026-11-04: Telework Contract and Fermenter held while clicking for credits): credits a card
 * will still pay out sit on the same slide as the credits in hand. Spent credits were priced on the slide (up to 1.8
 * each when broke) but payouts at a flat 1, so a broke side never found an econ card worth installing. The worth of
 * each credit to come, as a multiple of a flat credit. Runner cards only: on the Corp's Regolith it made taking
 * the credits barely better than leaving them, so the Corp drew instead of taking.
 */
/** plan.liquidity: credits on a card are worth this much more than at half the need while the side is short. */
export const LIQUIDITY_LIFT = 1.1;

export function payoutSlide(state: GameState, side: SideCode, amount: number): number {
  if (amount <= 0) return 1;
  const credits = side === 'corp' ? state.corp.credits : state.runner.credits;
  const need = creditNeed(state, side);
  // plan.liquidity (Jeff, 2026-11-06, his Teia game: the Runner sat on 0-5 credits for 13 turns and never played Sure
  // Gamble): credits still on a card can't be spent this turn. Priced from the pool in hand, every credit gained made
  // Telework Contract's credits look less needed: Sure Gamble at 5 credits gained 6.1 in cash, lost 3.5 on the contract
  // and scored below drawing a card. They sit on the slide from half the need instead, whatever less is in hand, so cash
  // keeps the broke end of the slide to itself; a bank past the need still slides off.
  // A tenth on top while short (fading out from half the need to the need): credits on a card get spent while the
  // Runner is still short, so a broke Runner keeps installing Telework Contract and Fermenter (payoutSlide.test.ts)
  const pool = Math.max(credits, need / 2);
  const lift = 1 + (LIQUIDITY_LIFT - 1) * Math.min(1, Math.max(0, 2 - (2 * credits) / Math.max(need, 1)));
  return ((creditSlide(pool + amount, need) - creditSlide(pool, need)) / amount) * lift;
}

/*
 * Value loops (Jeff, 2026-10-30): a card's worth can depend on another's,
 * which can depend on the first (ice with a tag subroutine prices tags, tags
 * price the rig, the rig prices that ice again). Each main lookup runs
 * through guardLoop: a lookup already in progress further up returns its
 * flat value instead of looping. Tests fail on a loop (so the valuation gets
 * fixed); batches count them (valueLoops, printed with the results); play
 * just carries on.
 */
const pricing: string[] = [];
/** Loops met since the last reset, by chain ("a > b > a"). */
export const valueLoops = new Map<string, number>();
const loopsFail = (): boolean => typeof process !== 'undefined' && !!process.env?.VITEST && !process.env?.VALUE_LOOPS_OK;

/**
 * Runs `work` as a lookup of its own, outside the lookups in progress (planner speed tier 2: a deck card priced once
 * for the whole decision is priced the same whoever asked first). Loops inside `work` are still guarded.
 */
export function pricingApart<T>(work: () => T): T {
  const outer = pricing.splice(0);
  try {
    return work();
  } finally {
    pricing.splice(0, pricing.length, ...outer);
  }
}

const stateIds = new WeakMap<GameState, number>();
let nextStateId = 0;

/** A number for this position object, the same each time it is asked (guardLoop's lookups, handValues deckRootKey). */
export function positionSerial(state: GameState): number {
  let id = stateIds.get(state);
  if (id === undefined) stateIds.set(state, (id = nextStateId++));
  return id;
}

/** `key` names the lookup; the same lookup on another position (a rig with a card taken out) is not a loop. */
export function guardLoop<T>(state: GameState | undefined, key: string, flat: () => T, work: () => T): T {
  if (!state) return work();
  key = `${key} @${positionSerial(state)}`;
  const at = pricing.indexOf(key);
  if (at >= 0) {
    const chain = [...pricing.slice(at), key].join(' > ');
    valueLoops.set(chain, (valueLoops.get(chain) ?? 0) + 1);
    if (loopsFail()) throw new Error(`Value loop: ${chain}`);
    return flat();
  }
  pricing.push(key);
  try {
    return work();
  } finally {
    pricing.pop();
  }
}
