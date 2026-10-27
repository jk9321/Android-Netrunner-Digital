import { GameState, getCardDefinition } from '../core';
import { tuning } from './synergy';
import { RATES } from './valueModel';

/**
 * Value model step 4 (docs/ai-value-model-plan.md): money cards described
 * by what they pay out, so their worth comes from the exchange rates and
 * the turns left in the game instead of a hand-set number. Each payout is
 * worth 15% less per turn it waits, and payouts past the end of the game
 * are worth nothing (the step 3 lesson: stacked payouts lose worth).
 * tests/cardProfiles.test.ts works each one through.
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

export const CARD_PROFILES: Record<string, CardProfile> = {
  // Corp assets
  '30037': { load: 9, pay: 3, every: 'turn', perTurn: 1, drawAtEnd: 1 }, // Nico Campaign
  '35040': { load: 6, pay: 2, every: 'turn', perTurn: 1, clicksAtEnd: 2 }, // Otto Campaign
  '35072': { load: 8, pay: 4, every: 'turn', perTurn: 1, drawEach: 1 }, // Anthill Excavation Contract
  '30071': { load: 15, pay: 3, every: 'click', perTurn: 2 }, // Regolith Mining License
  // Runner resources
  '30027': { load: 9, pay: 3, every: 'click', perTurn: 1 }, // Telework Contract: once per turn
  '35022': { load: 6, pay: 1, every: 'turn', perTurn: 1 }, // Open Market
};

/** How much a payout is worth per turn it waits. */
const WAIT = 0.85;

/** Turns each side has left, guessed from the score (Jeff: mostly points). */
export function turnsLeft(state: GameState): number {
  return Math.max(2, 8 - Math.max(state.corp.score, state.runner.score));
}

/**
 * Worth of what a card will still pay out: all of its load, or `hosted`
 * credits once it has been rezzed or installed. Clicks spent taking money
 * count against it at the click rate; draws at a drawn card's worth.
 */
export function payoutWorth(profile: CardProfile, turns: number, hosted = profile.load): number {
  const payouts = Math.ceil(hosted / profile.pay);
  let value = 0;
  let turn = 0;
  for (let i = 0; i < payouts; i++) {
    turn = Math.floor(i / profile.perTurn) + 1;
    if (turn > turns) return value;
    const pay = Math.min(profile.pay, hosted - i * profile.pay);
    const click = profile.every === 'click' ? RATES.click : 0;
    value += WAIT ** turn * (pay - click + (profile.drawEach ?? 0) * RATES.drawnCard);
  }
  if (turn + 1 <= turns) value += WAIT ** (turn + 1) * ((profile.drawAtEnd ?? 0) * RATES.drawnCard + (profile.clicksAtEnd ?? 0) * RATES.click);
  return value;
}

/** The card's profile, while plan.cardProfiles is on. */
export const profileOf = (code: string): CardProfile | undefined => (tuning.plan.cardProfiles ? CARD_PROFILES[code] : undefined);

/** Worth of a profiled card still to be rezzed (Corp): its payouts less its rez cost. */
export function unrezzedWorth(state: GameState, code: string): number | undefined {
  const profile = profileOf(code);
  if (!profile) return undefined;
  return payoutWorth(profile, turnsLeft(state)) - (getCardDefinition(code).cost ?? 0);
}

/** The install score a profiled Corp econ asset gets, on the scale of corpAI's install scores. */
export const ECON_SCALE = 0.6;
