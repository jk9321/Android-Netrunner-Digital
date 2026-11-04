import { GameState, getCardDefinition } from '../core';
import { tuning } from './synergy';
import { RATES, cardRate } from './valueModel';
import { CARD_PROFILES } from './cards';
import { PAYOUT_RISK } from './payoutRisk';

/**
 * Value model step 4 (docs/ai-value-model-plan.md): money cards described
 * by what they pay out, so their worth comes from the exchange rates and
 * the turns left in the game instead of a hand-set number. Each payout is
 * worth 15% less per turn it waits, and payouts past the end of the game
 * are worth nothing (the step 3 lesson: stacked payouts lose worth).
 * tests/cardProfiles.test.ts works each one through. Each card's profile is
 * its `profile` in its set's file in src/ai/cards/.
 */
export interface CardProfile {
  /** Credits loaded onto it when rezzed or installed. */
  load: number;
  /** Credits taken per payout. */
  pay: number;
  /** 'turn': taken free when the turn begins; 'click': a click per payout. */
  every: 'turn' | 'click';
  /** Payouts a turn at most (clicks: how many the AI will spend on it). */
  perTurn: number;
  /** Cards drawn with each payout, and once when it empties. */
  drawEach?: number;
  drawAtEnd?: number;
  /** Clicks gained when it empties (Otto Campaign). */
  clicksAtEnd?: number;
}

/** By card code: built from the per-set card files (src/ai/cards/). */
export { CARD_PROFILES } from './cards';

/** How much a payout is worth per turn it waits (step 4, before plan.payoutRisk). */
const WAIT = 0.85;

// PAYOUT_RISK lives in its own file with no imports, so the card files can read it while this one loads
export { PAYOUT_RISK } from './payoutRisk';

/** Worth kept per turn a payout of this card waits. */
export function payoutWait(state: GameState, profile: CardProfile, owner: 'corp' | 'runner', iced = false): number {
  if (!tuning.plan.payoutRisk) return WAIT;
  const time = profile.every === 'click' ? PAYOUT_RISK.clickWait : 1;
  const risk = owner === 'corp'
    ? (tuning.plan.measuredAssetRisk ? (iced ? PAYOUT_RISK.moneyIced : bareAssetRisk(state)) : iced ? PAYOUT_RISK.corpIced : PAYOUT_RISK.corpBare)
    : (state.runner.tags > 0 ? PAYOUT_RISK.runnerTagged : PAYOUT_RISK.runnerUntagged);
  return time * (1 - risk);
}

/** Weight of the measured bare-asset risk against this game's own record, in Runner turns (plan.readAssetTrash). */
const BARE_PRIOR_TURNS = 3;

/**
 * Per Runner turn risk of a money asset with no ice being trashed. plan.readAssetTrash (bug report #16, Jeff: Zahya
 * trashed every unprotected asset and the Corp kept installing them): the self-play average, moved toward what this
 * Runner has done this game (state.bareAssets).
 */
export function bareAssetRisk(state: GameState): number {
  const seen = state.bareAssets;
  if (!tuning.plan.readAssetTrash || !seen) return PAYOUT_RISK.moneyBare;
  return (BARE_PRIOR_TURNS * PAYOUT_RISK.moneyBare + seen.trashed) / (BARE_PRIOR_TURNS + seen.exposed);
}

/** Turns each side has left, guessed from the score (Jeff: mostly points). */
export function turnsLeft(state: GameState): number {
  return Math.max(2, 8 - Math.max(state.corp.score, state.runner.score));
}

/**
 * Worth of what a card will still pay out: all of its load, or `hosted`
 * credits once it has been rezzed or installed. Clicks spent taking money
 * count against it at the click rate; draws at a drawn card's worth.
 */
export function payoutWorth(profile: CardProfile, turns: number, hosted = profile.load, wait = WAIT, card: number = RATES.drawnCard): number {
  const payouts = Math.ceil(hosted / profile.pay);
  let value = 0;
  let turn = 0;
  for (let i = 0; i < payouts; i++) {
    turn = Math.floor(i / profile.perTurn) + 1;
    if (turn > turns) return value;
    const pay = Math.min(profile.pay, hosted - i * profile.pay);
    const click = profile.every === 'click' ? RATES.click : 0;
    value += wait ** turn * (pay - click + (profile.drawEach ?? 0) * card);
  }
  if (turn + 1 <= turns) value += wait ** (turn + 1) * ((profile.drawAtEnd ?? 0) * card + (profile.clicksAtEnd ?? 0) * RATES.click);
  return value;
}

/** The card's profile, while plan.cardProfiles is on. */
export const profileOf = (code: string): CardProfile | undefined => (tuning.plan.cardProfiles ? CARD_PROFILES[code] : undefined);

/** Worth of a profiled card still to be rezzed (Corp): its payouts less its rez cost. */
export function unrezzedWorth(state: GameState, code: string, iced = false): number | undefined {
  const profile = profileOf(code);
  if (!profile) return undefined;
  return payoutWorth(profile, turnsLeft(state), profile.load, payoutWait(state, profile, 'corp', iced), cardRate(state, 'corp')) - (getCardDefinition(code).cost ?? 0);
}

/** The install score a profiled Corp econ asset gets, on the scale of corpAI's install scores. */
export const ECON_SCALE = 0.6;
