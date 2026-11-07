import type { CardInstance, GameState } from '../../core';
import type { CardProfile } from '../cardProfiles';
import type { CardValue } from '../cardValues';
import type { CorpEffect } from '../effectValues';
import { CardSynergy, setSynergy } from '../synergyTags';
import { ELEVATION } from './elevation';
import { LIBERATION } from './liberation';
import { SYSTEM_GATEWAY } from './systemGateway';
import type { CardAI, CorpEffectContext, CounterType, CounterWorth } from './types';
import { VANTAGE_POINT } from './vantagePoint';

export type { CardAI, CorpEffectContext, CounterType, CounterWorth } from './types';

/**
 * The AI's card knowledge, one entry per card, one file per set (2026-11-03).
 * Adding a set: a new file beside these, listed here. The old per-file tables
 * (SYNERGY, CARD_VALUES, CARD_PROFILES, COUNTER_WORTH, EFFECT_CODES) are built from it.
 */
const SETS: Record<string, CardAI>[] = [SYSTEM_GATEWAY, ELEVATION, VANTAGE_POINT, LIBERATION];

function join(sets: Record<string, CardAI>[]): Record<string, CardAI> {
  const all: Record<string, CardAI> = {};
  for (const set of sets) {
    for (const [code, entry] of Object.entries(set)) {
      if (all[code]) throw new Error(`card ${code} is listed twice in src/ai/cards`);
      all[code] = entry;
    }
  }
  return all;
}

export const CARDS: Record<string, CardAI> = join(SETS);

/** The cards that have one part, by code. */
function pick<K extends keyof CardAI>(key: K): Record<string, NonNullable<CardAI[K]>> {
  const out: Record<string, NonNullable<CardAI[K]>> = {};
  for (const [code, entry] of Object.entries(CARDS)) if (entry[key]) out[code] = entry[key] as NonNullable<CardAI[K]>;
  return out;
}

export const SYNERGY: Record<string, CardSynergy> = pick('synergy');
setSynergy(SYNERGY);
export const CARD_VALUES: Record<string, CardValue> = pick('value');
export const CARD_PROFILES: Record<string, CardProfile> = pick('profile');
export const COUNTER_WORTH: Record<string, Partial<Record<CounterType, CounterWorth>>> = pick('counters');
export const COUNTER_FORMULAS: Record<string, Partial<Record<CounterType, CounterWorth>>> = pick('counterFormulas');
/** The cards priced by an effect formula (for the audit). */
export const EFFECT_CODES: string[] = Object.keys(CARDS).filter(code => CARDS[code].corp || CARDS[code].runner);

/** A Corp card's formula, if it has one. */
export const corpFormula = (state: GameState, code: string, ctx: CorpEffectContext): CorpEffect | undefined => CARDS[code]?.corp?.(state, code, ctx);
/** A Runner card's formula, if it has one. */
/** plan.oneCurrency: a faceup Corp card's worth in Archives (Petty Cash, played again from there). */
export const archivedWorth = (state: GameState, code: string): number => CARDS[code]?.archived?.(state) ?? 0;
export const runnerFormula = (state: GameState, code: string, card?: CardInstance): number | undefined => CARDS[code]?.runner?.(state, code, card);
