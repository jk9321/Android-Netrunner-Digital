import { CardInstance, GameState, SideCode, cardDef } from '../core';
import { rezCost } from '../core/engine/cardEffects';
import { iceCost } from './runs';
import { RATES } from './valueModel';

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
