import { CardInstance, GameState, ServerState, SideCode, cardDef } from '../core';
import { rezCost } from '../core/engine/cardEffects';
import { iceCost } from './runs';
import { RATES, guardLoop } from './valueModel';
import { turnsLeft } from './cardProfiles';
import { freeRezTargets } from './freeRez';
import { tuning } from './synergy';

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
/**
 * plan.iceStopHigh (Jeff, 2026-10-31: "the Runner's cost to boost their
 * breaker continues to scale"): ice worth follows what it costs the Runner
 * to get past it up to 16 credits, so a Pharos at 10 strength (16 against
 * Cleaver) is worth more than one at 5 (6), not the same capped 8.
 */
export const ICE_STOP_HIGH = 16;
/** Credits a Runner raises in a turn, for iceStopRunner (a named guess: 4 clicks at a credit each). */
export const RUNNER_TURN_INCOME = 4;
/**
 * Most a piece of ice is worth: what a full stop counts as. plan.iceStopRunner (Jeff, 2026-10-31: "why have
 * a cap at all?"): past what this Runner can raise in about two turns, more cost buys nothing, so the cap is
 * their credits plus two turns of income (at least the base 8), and unbreakable ice counts at that ceiling.
 */
export function iceStop(state?: GameState): number {
  if (tuning.plan.iceStopRunner && state) return Math.max(ICE_STOP, stopCredits(state) + 2 * RUNNER_TURN_INCOME);
  return tuning.plan.iceStopHigh ? ICE_STOP_HIGH : ICE_STOP;
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
  if (ice.isRezzed) return RATES.ice + Math.min(iceStop(state), iceCost(state, ice));
  // The Runner doesn't know what it is: iceCost's guess for unrezzed ice
  if (viewer === 'runner') return RATES.ice + iceCost(state, ice);
  // plan.freeRez: ice a coming free rez pays for (Send a Message, Unleash) counts as rezzable
  if (state.corp.credits < rezCost(state, ice) && !freeRezTargets(state).has(ice.instanceId)) return RATES.ice;
  // The Corp knows: what it would cost the Runner once rezzed, held back a little for the rez still to pay
  return RATES.ice + 0.6 * Math.min(iceStop(state), iceCost(state, { ...ice, isRezzed: true }));
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
