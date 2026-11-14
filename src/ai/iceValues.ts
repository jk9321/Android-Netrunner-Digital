import { CardInstance, GameState, ServerState, SideCode, cardDef, getCardDefinition } from '../core';
import { maxHandSize, rezCost } from '../core/engine/cardEffects';
import { AUDREY, iceCost, isTrap, plannedSubroutines } from './runs';
import { KNOBS, RATES, guardLoop, memo, pointGain, pointValue } from './valueModel';
import { PACE } from './effectValues';
import { archivedAgendaLoss } from './evaluate';
import { corpKeepValue } from './cardValues';
import { centralAccess } from './threatModel';
import { turnsLeft } from './cardProfiles';
import { freeRezTargets } from './freeRez';
import { plan, pricing } from './pricing';
import { mainRemote } from './corpAI';

/**
 * Value model step 5 (docs/ai-value-model-plan.md): ice priced in credits,
 * as what it costs the Runner to get past it with the rig they have (Jeff),
 * subroutine costs included (runs.ts prices clicks, tags, damage, trashed
 * cards and the end of the run). Ice they can't get past counts as a full
 * stop. Unrezzed ice counts only while the Corp can pay to rez it (Jeff's
 * rule), and the Runner, who can't see it, values it by the odds.
 */

/** Worth of ice that stops the Runner outright (breakerTypeWorth keeps this base rate). */
export const ICE_STOP = 8;
/** Credits a Runner raises in a turn, for iceStopRunner (a named guess: 4 clicks at a credit each). */
export const RUNNER_TURN_INCOME = 4;
/**
 * Most a piece of ice is worth: what a full stop counts as. plan.iceStopRunner (Jeff, 2026-10-31: "why have
 * a cap at all?"): past what this Runner can raise in about two turns, more cost buys nothing, so the cap is
 * their credits plus two turns of income (at least the base 8), and unbreakable ice counts at that ceiling.
 */
export function iceStop(state?: GameState): number {
  if (plan().iceStopRunner && state) return Math.max(ICE_STOP, stopCredits(state) + 2 * RUNNER_TURN_INCOME);
  return ICE_STOP;
}

/**
 * plan.iceStopAnchor (Jeff, 2026-11-05, thread "Find why AI card valuation misses cards"): the cap
 * reads the Runner's credits as they were when the deciding AI started its decision, not in each
 * position it looks at. Otherwise every credit the Runner gains raised each ice it can't break by a
 * credit too, so Sure Gamble scored below clicking for a credit (and spending looked like a gain).
 * The credits are noted in the pricing context as the decision starts (handValues.ts decisionContext).
 */
function stopCredits(state: GameState): number {
  return plan().iceStopAnchor && pricing().anchor?.id === state.id ? pricing().anchor!.credits : state.runner.credits;
}

/** Worth of one installed piece of ice, as `viewer` can judge it. */
export function iceWorth(state: GameState, ice: CardInstance, viewer: SideCode): number {
  return guardLoop(state, `ice ${cardDef(ice).title} ${ice.instanceId}`, () => flatIceWorth(ice), () => iceWorthOf(state, ice, viewer));
}

function iceWorthOf(state: GameState, ice: CardInstance, viewer: SideCode): number {
  // plan.iceGripCap (Jeff's Teia game, 2026-11-06: VRcation beat Sure Gamble because drawing to 7 cards halved what
  // Empiricist's damage looked worth): the grip the ice will face on later turns is at most the hand size (rule 1.7.2b:
  // the rest is discarded at the end of the turn), as the damage clock reads it (effectValues lifeGrip)
  const limit = maxHandSize(state, 'runner');
  // (What the ice protects doesn't depend on the grip: priced on the state as given, so its memo holds)
  const original = state;
  if (plan().iceGripCap && state.runner.grip.length > limit) state = { ...state, runner: { ...state.runner, grip: state.runner.grip.slice(0, limit) } };
  if (ice.isRezzed) return RATES.ice + Math.min(iceStop(state), lastingIceCost(state, ice)) * protects(original, ice, viewer);
  // The Runner doesn't know what it is: iceCost's guess for unrezzed ice
  if (viewer === 'runner') return RATES.ice + iceCost(state, ice);
  // The Corp knows: what it would cost the Runner once rezzed, held back a little for the rez still to pay, by the
  // share of the Corp's one pool of credits this ice can count on (rezBudget)
  const share = plan().rezBudget
    ? rezBudget(state).get(ice.instanceId) ?? 0
    : state.corp.credits >= rezCost(state, ice) || freeRezTargets(state).has(ice.instanceId) ? REZ_NOW_SHARE : 0;
  // (No share, nothing to scale: ice in HQ under plan.rezBudget skips protects' look over every server. The break cost
  // is still worked out: skipping it changed play with every switch off, so something it calls keeps state; audit item)
  const stop = Math.min(iceStop(state), lastingIceCost(state, { ...ice, isRezzed: true }));
  return RATES.ice + (share > 0 ? share * stop * protects(original, ice, viewer) : 0);
}

/** plan.iceProtects: the share of its break cost an ice in a server holding nothing (and planned for nothing) keeps. */
export const ICE_UNGUARDED = 0.2;
/** plan.iceProtects: the share of the average agenda's stake an empty scoring remote counts, as the place the next one goes. */
export const ICE_PLANNED = 0.5;

/**
 * plan.iceProtects (install-worth side check, AI Coordinator addendum 2026-11-08; Corp view only): ice is worth what it
 * protects, not only what it costs the Runner. The break cost (above) stays the cap; this is the share of it the
 * server's stake supports: the stake over the summed break costs of the server's ice, at most 1, at least ICE_UNGUARDED.
 * At Jeff's positions an ice on any server read 0.2 to 2 agenda points (1 point = 8) whatever sat behind it, and one ice
 * install outscored one advance (install-worth/report.md). Rules: a successful run breaches the attacked server and
 * accesses its cards (7.4.1a-d), so what ice holds back is what the breach would take.
 */
function protects(state: GameState, ice: CardInstance, viewer: SideCode): number {
  if (viewer !== 'corp' || !plan().iceProtects) return 1;
  const server = Object.values(state.corp.servers).find(s => s.ice.some(c => c.instanceId === ice.instanceId));
  if (server) return protectsIn(state, server);
  // Ice not installed (in HQ, as handValues prices it): what it would protect on the best server it could join, so
  // holding it and installing it compare like with like. A new remote holds nothing, unless the Corp has no scoring
  // remote yet: then this ice would found one, the place the next agenda goes (as serverStake prices one)
  return memo(state, `iceProtects:hand:${ice.cardCode}`, () => {
    const existing = Object.values(state.corp.servers).map(s => protectsIn(state, s, ice));
    const found = mainRemote(state) ? 0 : Math.min(1, plannedStake(state) / Math.max(1e-9, Math.min(iceStop(state), lastingIceCost(state, { ...ice, isRezzed: true }))));
    return Math.max(ICE_UNGUARDED, found, ...existing);
  });
}

/** The share for `server`'s ice (with `extra` added to it, for ice not yet installed). */
function protectsIn(state: GameState, server: ServerState, extra?: CardInstance): number {
  return memo(state, `iceProtects:${server.id}:${extra?.cardCode ?? ''}`, () => {
    const ice = extra ? [...server.ice, extra] : server.ice;
    const breaks = ice.reduce((n, c) => n + Math.min(iceStop(state), lastingIceCost(state, { ...c, isRezzed: true })), 0);
    if (breaks <= 0) return 1;
    return Math.max(ICE_UNGUARDED, Math.min(1, serverStake(state, server) / breaks));
  });
}

/** What a breach of `server` would cost the Corp over the turns its ice stands, as the Corp sees it (plan.iceProtects). */
export function serverStake(state: GameState, server: ServerState): number {
  const swing = (points: number) => pointValue(state.corp.score + points, KNOBS.corpPoints) - pointValue(state.corp.score, KNOBS.corpPoints) + pointGain(state.runner.score, points);
  const turns = turnsLeft(state);
  if (server.id === 'hq' || server.id === 'rd') {
    // One access each run (7.4.1b-c), at the agenda loss centralExposure prices one access at, on the runs the Runner
    // makes there over the turns left (PACE); HQ as it is on the next run, the deck's average after
    const { hqNow, density } = centralAccess(state);
    const runs = PACE.runs * (server.id === 'hq' ? PACE.hqShare : PACE.rdShare);
    return server.id === 'hq' ? runs * (hqNow + density * Math.max(0, turns - 1)) : runs * density * turns;
  }
  if (server.id === 'archives') {
    return [...state.corp.archives.faceDown, ...state.corp.archives.faceUp].filter(c => cardDef(c).type_code === 'agenda').reduce((n, c) => n + archivedAgendaLoss(state, cardDef(c).agenda_points ?? 1), 0);
  }
  let stake = 0;
  for (const card of server.root) {
    const def = cardDef(card);
    if (def.type_code === 'agenda') stake += swing(def.agenda_points ?? 1);
    // An asset or upgrade at its listed keep worth, not its priced worth: that reads the server's ice (Manegarm
    // Skunkworks' tax, an asset's trash risk behind ice), which reads this stake, a value loop (review 2 batch: 639 games)
    else if (!isTrap(card.cardCode)) stake += Math.max(0, corpKeepValue(card.cardCode));
  }
  // An empty remote that is the scoring remote (most ice, no asset: corpAI.ts mainRemote) is where the next agenda goes:
  // the deck's average agenda (HQ and R&D, as the Corp knows them). Scoring the agenda in it doesn't make its ice idle
  if (server.root.length === 0 && server.isRemote && mainRemote(state)?.id === server.id) stake += plannedStake(state);
  return stake;
}

/** The stake of the empty scoring remote: ICE_PLANNED of the swing of the deck's average agenda (HQ and R&D, as the Corp knows them). */
function plannedStake(state: GameState): number {
  const agendas = [...state.corp.hq, ...state.corp.rd].filter(c => cardDef(c).type_code === 'agenda');
  if (!agendas.length) return 0;
  const points = agendas.reduce((n, c) => n + (cardDef(c).agenda_points ?? 1), 0) / agendas.length;
  return ICE_PLANNED * (pointValue(state.corp.score + points, KNOBS.corpPoints) - pointValue(state.corp.score, KNOBS.corpPoints) + pointGain(state.runner.score, points));
}

/** Credits it takes Audrey v2 to earn back one virus counter: a card trashed while accessing it (a trash cost and the run's click). */
export const AUDREY_REFILL = 3;

/**
 * plan.oneCurrency: what it costs the Runner to get past rezzed ice for as long as the ice stays, not this instant. A
 * breaker that runs on counters it has spent (Audrey v2 short of virus counters) is not gone: it earns one back whenever
 * the Runner trashes a card it is accessing. Priced as gone, a purge of Audrey's 2 counters made every piece of ice it
 * broke a full stop for the rest of the game and read +51, above installing an agenda. So the cost is the lower of now
 * and with the counters this ice takes (one per 2 subroutines) earned back at AUDREY_REFILL each.
 */
export function lastingIceCost(state: GameState, ice: CardInstance): number {
  const now = iceCost(state, ice);
  if (!plan().oneCurrency || !ice.isRezzed) return now;
  const audreys = state.runner.rig.programs.filter(p => p.cardCode === AUDREY);
  if (audreys.length === 0) return now;
  const have = Math.max(...audreys.map(p => p.tokens?.virus ?? 0));
  const uses = Math.max(1, Math.ceil(plannedSubroutines(state, ice).length / 2));
  if (have >= uses) return now;
  const programs = state.runner.rig.programs.map(p => (p.cardCode === AUDREY ? { ...p, tokens: { ...p.tokens, virus: uses } } : p));
  const full = iceCost({ ...state, runner: { ...state.runner, rig: { ...state.runner.rig, programs } } }, ice);
  return Math.min(now, full + (uses - have) * AUDREY_REFILL);
}

/** Share of an unrezzed ice's rezzed worth the Corp counts while it can pay for the rez now (the rest is the rez still to pay). */
export const REZ_NOW_SHARE = 0.6;
/** The share for ice the pool can't cover now but next turn's income would: one Runner turn unprotected, not the whole game. */
export const REZ_NEXT_SHARE = 0.3;
/** Credits a Corp raises in a turn, for the rez budget (a named guess: 3 clicks at a credit each). */
export const CORP_TURN_INCOME = 3;

/**
 * The rez budget (structural review item 2 follow-up, 2026-11-06): each unrezzed ice was counted rezzable when the
 * Corp's credits covered its own rez cost, so 3 credits "protected" a 3-credit Palisade on a remote and a 3-credit
 * Whitespace on HQ at once, and spending them cost both shares (3 credits to 0 priced at about 19, more than a 2-point
 * steal). Now the unrezzed ice draws its rez costs from one pool, best stop first (what it would cost the Runner once
 * rezzed, per credit of rez): the ice the pool covers gets REZ_NOW_SHARE, the ice a turn's income more would cover
 * REZ_NEXT_SHARE, the rest nothing. plan.freeRez: ice a coming free rez pays for (Send a Message, Unleash) is covered
 * without drawing on the pool.
 */
export function rezBudget(state: GameState, decisionStops = false): Map<string, number> {
  // Keyed by what it reads that tests change in place (credits, the unrezzed ice, the free-rez switch)
  const ice = Object.values(state.corp.servers).flatMap(s => s.ice.filter(c => !c.isRezzed).map(c => c.instanceId + c.cardCode)).join();
  const stops = decisionStops ? decisionStopCache() : null;
  return memo(state, `rezBudget:${state.corp.credits}:${ice}${stops ? ':d' : ''}`, () => countRezBudget(state, stops));
}

/**
 * Stops noted once per decision (the anchor pricing notes as a decision starts), for plan.ownIceKnown's rez budget
 * (effectValues ownIce): it asks on every position the planner looks at, and the stop (lastingIceCost against the rig)
 * only orders the ice that compete for the money, which a turn's plays barely move. Null outside a decision.
 */
function decisionStopCache(): Map<string, number> | null {
  // The anchor is a new object with every decision (pricing noteDecision): the stops live on it
  const anchor = pricing().anchor;
  if (!anchor) return null;
  return (anchor.stops ??= new Map());
}

function countRezBudget(state: GameState, stops: Map<string, number> | null = null): Map<string, number> {
  const free = freeRezTargets(state);
  const shares = new Map<string, number>();
  const waiting: { ice: CardInstance; id: string; cost: number; stop: number }[] = [];
  for (const server of Object.values(state.corp.servers)) {
    for (const ice of server.ice) {
      if (ice.isRezzed) continue;
      if (free.has(ice.instanceId)) {
        shares.set(ice.instanceId, REZ_NOW_SHARE);
        continue;
      }
      waiting.push({ ice, id: ice.instanceId, cost: rezCost(state, ice), stop: 0 });
    }
  }
  let now = Math.max(0, state.corp.credits);
  let next = CORP_TURN_INCOME;
  // The order only matters when ice competes for the money: when the ice the credits cover now fits all at once and no
  // ice waits on next turn's income, the shares are the same in any order (the rest is out of reach either way), and
  // the stops (lastingIceCost, the costly part) aren't needed
  const cheap = waiting.filter(w => w.cost <= now);
  if (cheap.reduce((sum, w) => sum + w.cost, 0) <= now && !waiting.some(w => w.cost > now && w.cost <= now + next)) {
    for (const w of cheap) shares.set(w.id, REZ_NOW_SHARE);
    return shares;
  }
  for (const w of waiting) {
    const noted = stops?.get(w.id);
    w.stop = noted ?? Math.min(iceStop(state), lastingIceCost(state, { ...w.ice, isRezzed: true }));
    if (stops && noted === undefined) stops.set(w.id, w.stop);
  }
  waiting.sort((a, b) => b.stop / Math.max(1, b.cost) - a.stop / Math.max(1, a.cost));
  for (const ice of waiting) {
    if (ice.cost <= now) {
      now -= ice.cost;
      shares.set(ice.id, REZ_NOW_SHARE);
    } else if (ice.cost <= now + next) {
      next -= ice.cost - now;
      now = 0;
      shares.set(ice.id, REZ_NEXT_SHARE);
    }
  }
  return shares;
}

/** The step-1 rate, with plan.iceInCredits off. */
export const flatIceWorth = (ice: CardInstance): number =>
  ice.isRezzed ? RATES.ice + RATES.rezzedIceCostShare * (cardDef(ice).cost ?? 0) : RATES.ice;

const ICE_TYPES = ['barrier', 'code gate', 'sentry'] as const;
const deckShares = new Map<string, Record<string, number>>();
/** Empties deckIceShare's map (test-only: scripts/cache-bisect.ts). */
export const clearDeckShares = (): void => deckShares.clear();

/**
 * Share of each ice type in the Corp's decklist (public, so the Normal AI
 * stays fair), worked out once per game. Ice with two types counts for both.
 */
export function deckIceShare(state: GameState): Record<string, number> {
  const key = `${state.id}:${state.corp.identity.cardCode}`;
  const cached = deckShares.get(key);
  if (cached) return cached;
  const corp = state.corp;
  const cards = [
    ...corp.hq, ...corp.rd, ...corp.archives.faceUp, ...corp.archives.faceDown,
    ...Object.values(corp.servers).flatMap(s => s.ice),
  ];
  const count: Record<string, number> = { barrier: 0, 'code gate': 0, sentry: 0 };
  for (const card of cards) {
    const def = cardDef(card);
    if (def.type_code !== 'ice') continue;
    const keywords = (def.keywords ?? '').toLowerCase();
    for (const t of ICE_TYPES) if (keywords.includes(t)) count[t]++;
  }
  const total = ICE_TYPES.reduce((n, t) => n + count[t], 0);
  const share = Object.fromEntries(ICE_TYPES.map(t => [t, total > 0 ? count[t] / total : 1 / 3]));
  deckShares.set(key, share);
  return share;
}

/**
 * Worth of being able to break an ice type (step 5b): the full stops it
 * saves across the Corp's ice of that type, by the odds of meeting that
 * type (shown ice and the decklist), less as the game runs out of turns. Three even types give 8 each, as the
 * flat rate did. `odds`: iceTypeOdds(state), passed in by a caller that prices all three types on one board
 * (runnerRigValue).
 */
export function breakerTypeWorth(state: GameState, type: string, odds: Record<string, number> = iceTypeOdds(state)): number {
  const clock = Math.min(1, turnsLeft(state) / 4);
  return 3 * ICE_STOP * odds[type] * clock;
}

const typeFlags = new Map<string, boolean[]>();
/** Which of ICE_TYPES a card's printed keywords name (static card data, so kept by card code: iceTypeOdds is asked on every board, planner speed 2026-11-12). */
function iceTypeFlags(code: string): boolean[] {
  let flags = typeFlags.get(code);
  if (!flags) {
    const keywords = (getCardDefinition(code).keywords ?? '').toLowerCase();
    flags = ICE_TYPES.map(t => keywords.includes(t));
    typeFlags.set(code, flags);
  }
  return flags;
}

/** Weight of the decklist against the ice the Corp has actually shown, in pieces of ice. */
const DECK_PRIOR = 3;

/**
 * Share of each ice type the Runner should expect to meet: the ice the Corp
 * has shown (rezzed, or faceup in Archives), with the decklist as a prior
 * worth 3 pieces of ice. Sums to 1.
 */
export function iceTypeOdds(state: GameState): Record<string, number> {
  const deck = deckIceShare(state);
  const shown = [
    ...Object.values(state.corp.servers).flatMap(s => s.ice).filter(c => c.isRezzed),
    ...state.corp.archives.faceUp.filter(c => cardDef(c).type_code === 'ice'),
  ];
  const count: Record<string, number> = Object.fromEntries(ICE_TYPES.map(t => [t, DECK_PRIOR * deck[t]]));
  for (const ice of shown) {
    const flags = iceTypeFlags(ice.cardCode);
    for (let i = 0; i < ICE_TYPES.length; i++) if (flags[i]) count[ICE_TYPES[i]]++;
  }
  const total = ICE_TYPES.reduce((n, t) => n + count[t], 0);
  return Object.fromEntries(ICE_TYPES.map(t => [t, count[t] / total]));
}

/** An AI breaker covers every type, but costs more to use: this share of each type it alone covers. */
export const AI_BREAKER_SHARE = 0.6;

/**
 * The board with `ice` installed outermost on `server` (a new remote when
 * null), for ice whose strength depends on where it sits (Scatter Field:
 * +4 only while it is the only ice protecting its server, rules 4.6.9).
 * Shallow: only the corp's servers are copied.
 */
export function withIceInstalled(state: GameState, ice: CardInstance, server: ServerState | null): GameState {
  const target: ServerState = server ?? { id: 'remote-placed', name: 'New remote', isRemote: true, ice: [], root: [] };
  const servers = { ...state.corp.servers, [target.id]: { ...target, ice: [...target.ice, ice] } };
  return { ...state, corp: { ...state.corp, servers } };
}
