import { CardInstance, GameState } from '../core';
import { ECON_SCALE, profileOf, unrezzedWorth } from './cardProfiles';
import { corpEffect, effectsOn, runnerEffect } from './effectValues';
import { RATES, guardLoop, logValue } from './valueModel';
import { CARD_VALUES } from './cards';
import { plan } from './pricing';

/**
 * The AI's per-card numbers, by card code (each card's `value` in its set's
 * file in src/ai/cards/). Every Corp asset and upgrade and every Runner
 * program, hardware and resource that isn't an icebreaker needs an entry (tests/aiCardValues.test.ts lists any that are missing), so a new
 * set's cards are valued on purpose rather than falling to a default.
 * Card behaviour the AI special-cases (Urtica, Funhouse, LEO, run
 * events...) stays with the logic that uses it.
 */
export interface CardValue {
  /** Corp asset or upgrade: its worth installed, to the Corp keeping it and the Runner trashing it. */
  keep?: number;
  /** Corp econ asset: worth installing in its own remote and rezzing for money or cards. */
  econ?: number;
  /** Corp upgrade: [worth in a scoring remote, worth on HQ or R&D]. */
  upgrade?: [number, number];
  /** Runner program, hardware or resource (not an icebreaker): its worth installed beyond icebreaker coverage. */
  rig?: number;
  /** Cards it draws (a turn, or once): adds to keep, econ and rig worth while plan.drawValue is on. */
  draws?: number;
}

/** By card code: built from the per-set card files (src/ai/cards/). */
export { CARD_VALUES } from './cards';

/** Extra worth of the cards a card draws, now that a card in hand is worth about a credit. */
const drawBonus = (code: string): number => logValue('cardDrawn', 'drawBonus', undefined, RATES.cardDrawn * (CARD_VALUES[code]?.draws ?? 0), code);

/**
 * Worth of an installed Corp asset or upgrade (1 if not listed). With a game state, a card profile (step 4) prices it instead.
 * Owner of a Corp card's worth before it is installed (docs/ai-priced-quantities.md, valuation table).
 */
export const corpKeepValue = (code: string, state?: GameState, rezzed = false): number =>
  logValue('cardBeforeInstall', 'corpKeepValue', state, (state ? unrezzedWorth(state, code) ?? effect(state, code, rezzed)?.keep : undefined) ?? (CARD_VALUES[code]?.keep ?? RATES.defaultKeep) + drawBonus(code), code, rezzed);
/** A card's worth from what it does (effectValues.ts), while plan.effectValues is on. */
const effect = (state: GameState, code: string, rezzed = false) => (effectsOn() ? corpEffect(state, code, rezzed) : undefined);
/** An econ asset (a card profile or an `econ` entry): a type test, not a price (V-B B2, ruling 3; was econValue's undefined). */
export const isEconAsset = (code: string): boolean => !!profileOf(code) || CARD_VALUES[code]?.econ !== undefined;
/** An upgrade's worth in a scoring remote and on HQ or R&D. */
export const upgradeValue = (code: string, state?: GameState): [number, number] => {
  const fx = state ? effect(state, code)?.upgrade : undefined;
  const pair: [number, number] = fx ? [ECON_SCALE * fx[0], ECON_SCALE * fx[1]] : CARD_VALUES[code]?.upgrade ?? RATES.defaultUpgrade;
  logValue('cardBeforeInstall', 'upgradeValue', state, pair[0], code, pair[1]);
  return pair;
};
/** Worth of an installed Runner card beyond icebreaker coverage (2 if not listed). Owner of a Runner rig card's worth (registry). */
export const runnerCardValue = (code: string, state?: GameState, card?: CardInstance): number => {
  const flat = () => logValue('rigCard', 'runnerCardValue flat', state, (CARD_VALUES[code]?.rig ?? RATES.defaultRig) + drawBonus(code), code, card);
  // Effect formulas give credits; rig worth is on the board at RATES.rigCardScale per point
  // plan.rigEffects: the Runner's cards by what they do even where effectValues is off (the Corp's side; Gemini audit 2.1c)
  const fx = state && (effectsOn() || plan().rigEffects) ? guardLoop(state, `runner card ${code} ${card?.instanceId ?? ''}`, () => undefined, () => runnerEffect(state, code, card)) : undefined;
  return logValue('rigCard', 'runnerCardValue', state, fx !== undefined ? fx / RATES.rigCardScale : flat(), code, card);
};
