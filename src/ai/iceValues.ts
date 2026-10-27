import { CardInstance, GameState, SideCode, cardDef } from '../core';
import { rezCost } from '../core/engine/cardEffects';
import { iceCost } from './runs';
import { RATES } from './valueModel';
import { turnsLeft } from './cardProfiles';

/**
 * Value model step 5 (docs/ai-value-model-plan.md): ice priced in credits,
 * as what it costs the Runner to get past it with the rig they have (Jeff),
 * subroutine costs included (runs.ts prices clicks, tags, damage, trashed
 * cards and the end of the run). Ice they can't get past counts as a full
 * stop. Unrezzed ice counts only while the Corp can pay to rez it (Jeff's
 * rule), and the Runner, who can't see it, values it by the odds.
 */

/** Worth of ice that stops the Runner outright. */
export const ICE_STOP = 8;

/** Worth of one installed piece of ice, as `viewer` can judge it. */
export function iceWorth(state: GameState, ice: CardInstance, viewer: SideCode): number {
  if (ice.isRezzed) return RATES.ice + Math.min(ICE_STOP, iceCost(state, ice));
  // The Runner doesn't know what it is: iceCost's guess for unrezzed ice
  if (viewer === 'runner') return RATES.ice + iceCost(state, ice);
  if (state.corp.credits < rezCost(state, ice)) return RATES.ice;
  // The Corp knows: what it would cost the Runner once rezzed, held back a little for the rez still to pay
  return RATES.ice + 0.6 * Math.min(ICE_STOP, iceCost(state, { ...ice, isRezzed: true }));
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
