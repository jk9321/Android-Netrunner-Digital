import type { CardInstance, GameState } from '../../core';
import type { CardProfile } from '../cardProfiles';
import type { CardValue } from '../cardValues';
import type { CorpEffect } from '../effectValues';
import type { CardSynergy } from '../synergyTags';

export type CounterType = 'credit' | 'virus' | 'power' | 'agenda';
export type CounterWorth = (state: GameState, card: CardInstance) => number;

/** What corpEffect works out once for every Corp card, before its own formula. */
export interface CorpEffectContext {
  /** Its rez cost, or 0 once rezzed (plan.rezPaid). */
  cost: number;
  /** Worth to the Corp of scoring a typical agenda from its deck. */
  agenda: number;
  /** Worth of a card in HQ. */
  card: number;
  /** Worth of a tag on the Runner. */
  tag: number;
}

/**
 * Everything the AI knows about one card's worth, in one place (2026-11-03,
 * from Gemini's CardFacts review). What a card does stays in its engine
 * script; this is only how the AI prices it. Every part is optional.
 */
export interface CardAI {
  /** Deck-aware synergy tags: what it gives and wants, and when its effect applies (synergyTags.ts). Every card has one. */
  synergy?: CardSynergy;
  /** Hand-set numbers: the fallback when effect values are off or a value loop is cut short (cardValues.ts). */
  value?: CardValue;
  /** Money cards: what they pay out and when (cardProfiles.ts). */
  profile?: CardProfile;
  /** Corp asset or upgrade: its worth from what it does, in credits (effectValues.ts corpEffect). */
  corp?: (state: GameState, code: string, ctx: CorpEffectContext) => CorpEffect;
  /** Runner rig card that isn't an icebreaker: its worth installed, in credits (effectValues.ts runnerEffect). */
  runner?: (state: GameState, code: string, card?: CardInstance) => number;
  /** Corp root card: its worth once rezzed, less the rez cost, where corp() doesn't say (effectValues.ts rezzedWorth). */
  rezzed?: (state: GameState, card: CardInstance, rezCost: number) => number;
  /** One counter on it, by type (counterValues.ts COUNTER_WORTH). */
  counters?: Partial<Record<CounterType, CounterWorth>>;
  /** One counter on it worked out from what it turns into, while plan.counterFormulas is on. */
  counterFormulas?: Partial<Record<CounterType, CounterWorth>>;
}
