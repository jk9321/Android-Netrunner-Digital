import { CardInstance, GameState, ServerState, SideCode, cardDef } from '../core';
import { rezCost } from '../core/engine/cardEffects';
import { iceSubroutines } from '../core/engine/ice';
import { AUDREY, iceCost } from './runs';
import { RATES, guardLoop, memo } from './valueModel';
import { turnsLeft } from './cardProfiles';
import { freeRezTargets } from './freeRez';
import { tuning } from './synergy';
import { LOCKDOWN, PACE } from './effectValues';

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
  if (tuning.plan.iceStopRunner && state) return Math.max(ICE_STOP, stopCredits(state) + 2 * RUNNER_TURN_INCOME);
  return ICE_STOP;
}

/**
 * plan.iceStopAnchor (Jeff, 2026-11-05, thread "Find why AI card valuation misses cards"): the cap
 * reads the Runner's credits as they were when the deciding AI started its decision, not in each
 * position it looks at. Otherwise every credit the Runner gains raised each ice it can't break by a
 * credit too, so Sure Gamble scored below clicking for a credit (and spending looked like a gain).
 */
let anchor: { id: string; credits: number } | null = null;

/** Note the Runner's credits as a decision starts (handValues.ts noteKnownHand; held while a planner plays out). */
export function noteIceStopCredits(state: GameState) {
  anchor = { id: state.id, credits: state.runner.credits };
}

function stopCredits(state: GameState): number {
  return tuning.plan.iceStopAnchor && anchor?.id === state.id ? anchor.credits : state.runner.credits;
}

/** Worth of one installed piece of ice, as `viewer` can judge it. */
export function iceWorth(state: GameState, ice: CardInstance, viewer: SideCode): number {
  return guardLoop(state, `ice ${cardDef(ice).title} ${ice.instanceId}`, () => flatIceWorth(ice), () => iceWorthOf(state, ice, viewer));
}

function iceWorthOf(state: GameState, ice: CardInstance, viewer: SideCode): number {
  if (tuning.plan.oneCurrency && viewer === 'corp') return iceToll(state, ice);
  if (ice.isRezzed) return RATES.ice + Math.min(iceStop(state), lastingIceCost(state, ice));
  // The Runner doesn't know what it is: iceCost's guess for unrezzed ice
  if (viewer === 'runner') return RATES.ice + iceCost(state, ice);
  // The Corp knows: what it would cost the Runner once rezzed, held back a little for the rez still to pay, by the
  // share of the Corp's one pool of credits this ice can count on (rezBudget)
  const share = tuning.plan.rezBudget
    ? rezBudget(state).get(ice.instanceId) ?? 0
    : state.corp.credits >= rezCost(state, ice) || freeRezTargets(state).has(ice.instanceId) ? REZ_NOW_SHARE : 0;
  return RATES.ice + share * Math.min(iceStop(state), lastingIceCost(state, { ...ice, isRezzed: true }));
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
  if (!tuning.plan.oneCurrency || !ice.isRezzed) return now;
  const audreys = state.runner.rig.programs.filter(p => p.cardCode === AUDREY);
  if (audreys.length === 0) return now;
  const have = Math.max(...audreys.map(p => p.tokens?.virus ?? 0));
  const uses = Math.max(1, Math.ceil(iceSubroutines(state, ice).length / 2));
  if (have >= uses) return now;
  const programs = state.runner.rig.programs.map(p => (p.cardCode === AUDREY ? { ...p, tokens: { ...p.tokens, virus: uses } } : p));
  const full = iceCost({ ...state, runner: { ...state.runner, rig: { ...state.runner.rig, programs } } }, ice);
  return Math.min(now, full + (uses - have) * AUDREY_REFILL);
}

/**
 * plan.oneCurrency, the Corp's view (review 2): ice is worth the toll it takes, not a flat stop. What it protects is
 * priced where it protects: centralExposure (HQ, R&D), stealOdds in agendaWorth (agenda remotes), the payout wait of an
 * iced asset, heldAgendasWorth's best open remote (an empty iced remote is room for the agendas in HQ). Counted again
 * here, ice read +6.75 even in a new empty remote and the Corp iced servers where Jeff clicked for credits. The toll is
 * what the Runner pays to get past it on the runs it makes there (PACE: runs a turn by the server's share of them, a
 * remote's share split over the remotes with something in them) over the turns left, by the share of the rez the Corp
 * can pay for (rezBudget) when it is unrezzed. Ice the Runner can't get past takes none (its stop is the protection).
 */
function iceToll(state: GameState, ice: CardInstance): number {
  const server = Object.values(state.corp.servers).find(sv => sv.ice.some(c => c.instanceId === ice.instanceId));
  const remotes = Object.values(state.corp.servers).filter(sv => sv.isRemote && sv.root.length > 0).length;
  const share = !server
    ? 0
    : server.id === 'hq' ? PACE.hqShare
    : server.id === 'rd' ? PACE.rdShare
    : server.id === 'archives' ? PACE.archivesShare
    : server.root.length > 0 ? PACE.remoteShare / Math.max(1, remotes) : 0;
  const rez = ice.isRezzed ? 1 : rezBudget(state).get(ice.instanceId) ?? 0;
  let turns = 0;
  for (let t = 0; t < turnsLeft(state); t++) turns += LOCKDOWN ** t;
  // Ice it can't get past takes no toll: the Runner runs elsewhere, and the stop is priced in what the server protects
  const cost = lastingIceCost(state, { ...ice, isRezzed: true });
  const toll = cost < iceStop(state) ? cost : 0;
  return RATES.ice + rez * PACE.runs * share * toll * turns;
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
export function rezBudget(state: GameState): Map<string, number> {
  // Keyed by what it reads that tests change in place (credits, the unrezzed ice, the free-rez switch)
  const ice = Object.values(state.corp.servers).flatMap(s => s.ice.filter(c => !c.isRezzed).map(c => c.instanceId + c.cardCode)).join();
  return memo(state, `rezBudget:${state.corp.credits}:${!!tuning.plan.freeRez}:${ice}`, () => countRezBudget(state));
}

function countRezBudget(state: GameState): Map<string, number> {
  const free = freeRezTargets(state);
  const shares = new Map<string, number>();
  const waiting: { id: string; cost: number; stop: number }[] = [];
  for (const server of Object.values(state.corp.servers)) {
    for (const ice of server.ice) {
      if (ice.isRezzed) continue;
      if (free.has(ice.instanceId)) {
        shares.set(ice.instanceId, REZ_NOW_SHARE);
        continue;
      }
      waiting.push({ id: ice.instanceId, cost: rezCost(state, ice), stop: Math.min(iceStop(state), lastingIceCost(state, { ...ice, isRezzed: true })) });
    }
  }
  waiting.sort((a, b) => b.stop / Math.max(1, b.cost) - a.stop / Math.max(1, a.cost));
  let now = Math.max(0, state.corp.credits);
  let next = CORP_TURN_INCOME;
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
 * flat rate did.
 */
export function breakerTypeWorth(state: GameState, type: string): number {
  const clock = Math.min(1, turnsLeft(state) / 4);
  return 3 * ICE_STOP * iceTypeOdds(state)[type] * clock;
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
    const keywords = (cardDef(ice).keywords ?? '').toLowerCase();
    for (const t of ICE_TYPES) if (keywords.includes(t)) count[t]++;
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
