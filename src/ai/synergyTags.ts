import { CardDefinition } from '../core';

/**
 * Hand-written synergy tags for every card, used by the deck-aware nudges in
 * synergy.ts. The tags themselves are each card's `synergy` entry in its set's
 * file in src/ai/cards/; this file holds the themes, conditions and guesses. A card "gives" a theme when it does that thing (an enabler:
 * Sure Gamble gives econ) and "wants" a theme when it pays off for it (a
 * payoff: Pennyshaver wants runs). Weights are about 1 for a typical card,
 * 2 for a card built around the theme.
 *
 * A new set needs a `synergy` on each of its cards; tests/synergy.test.ts fails for any card
 * without one, and for conditional wording ("if the Runner is tagged",
 * "when you score this agenda") without the matching `when` tag. Until
 * then, inferSynergy() guesses from the card text.
 */

export const THEMES = [
  'econ', // gaining credits
  'draw', // drawing cards
  'runs', // making runs, successful runs
  'hq', // runs on HQ, accessing HQ
  'rd', // runs on R&D, accessing R&D
  'archives', // runs on Archives
  'trash', // the Runner trashing Corp cards
  'virus', // virus counters
  'discard', // filling the heap / Archives (or trashing from hand)
  'install', // extra, cheap or free installs
  'breakers', // icebreakers
  'tags', // tagging the Runner
  'damage', // net, meat and core damage
  'advance', // advancement counters
  'operations', // playing operations
  'bioroid', // bioroid cards
  'denial', // making the opponent lose or spend credits
  'ice', // installing ice
] as const;

export type Theme = (typeof THEMES)[number];
export type ThemeWeights = Partial<Record<Theme, number>>;

/**
 * When a card's effect applies or is at its best, for effects whose worth
 * depends on timing (see CONDITION_PATTERNS for the wording each matches).
 */
export const CONDITIONS = [
  'ifTagged', // needs or punishes a tagged Runner (Retribution, Orbital Superiority)
  'onScore', // fires when an agenda is scored (or stolen)
  'scoredThisTurn', // grows with agendas scored this turn (Neurospike)
  'successfulRun', // needs or rewards a successful run
  'notInstalledThisTurn', // targets a card installed on an earlier turn (Seamless Launch)
  'threat', // depends on the threat level
] as const;
export type Condition = (typeof CONDITIONS)[number];

/** Card wording that means a card needs a condition tag (tests/synergy.test.ts checks every card). */
export const CONDITION_PATTERNS: Record<Condition, RegExp> = {
  ifTagged: /runner is tagged|if the runner has at least \d+ tags?|tags? is removed|runner takes a tag/i,
  onScore: /when (you score this agenda|this agenda is scored)|whenever you score an agenda|scored or stolen/i,
  scoredThisTurn: /agendas you scored this turn/i,
  successfulRun: /successful run/i,
  notInstalledThisTurn: /did not install this turn/i,
  threat: /threat level|threat \d/i,
};

export interface CardSynergy {
  /** What the card does (enabler). */
  gives?: ThemeWeights;
  /** What the card rewards (payoff). */
  wants?: ThemeWeights;
  /** Conditions its effect depends on. */
  when?: Condition[];
}

/**
 * By card code: each card's `synergy` in its set's file in src/ai/cards/ (one entry per card,
 * 2026-11-03). Filled in by src/ai/cards/index.ts when it loads: this file imports nothing from
 * the AI, so the card files (which reach synergy.ts through tuning) can't make an import cycle.
 */
export let SYNERGY: Record<string, CardSynergy> = {};
export function setSynergy(table: Record<string, CardSynergy>): void {
  SYNERGY = table;
}

/** Text patterns for guessing a card's themes when it has no hand-written entry (a new set). */
const GIVES_PATTERNS: [RegExp, Theme][] = [
  [/gain \d+ ?(\[?credit|credits)/i, 'econ'],
  [/load \d+/i, 'econ'],
  [/draw \d+ cards?/i, 'draw'],
  [/\brun (any|hq|r&d|archives|a central)/i, 'runs'],
  [/virus counter/i, 'virus'],
  [/give the runner \d+ tag/i, 'tags'],
  [/(net|meat|core) damage/i, 'damage'],
  [/advancement counter/i, 'advance'],
  [/loses? \d+ ?(\[?credit|credits)/i, 'denial'],
  [/trash the card you are accessing|trash the non-agenda card/i, 'trash'],
];
const WANTS_PATTERNS: [RegExp, Theme][] = [
  [/whenever you make a successful run|if you made a successful run/i, 'runs'],
  [/runner is tagged|tag is removed|takes a tag/i, 'tags'],
  [/dividends/i, 'advance'],
  [/you trash a card you are accessing|steal or trash/i, 'trash'],
  [/from (your heap|archives)/i, 'discard'],
  [/play(ed)? an operation|transaction operation/i, 'operations'],
];

/** A best guess from the card's text, for cards not in SYNERGY yet. */
export function inferSynergy(def: CardDefinition): CardSynergy {
  const text = def.stripped_text ?? '';
  const gives: ThemeWeights = {};
  const wants: ThemeWeights = {};
  for (const [pattern, theme] of GIVES_PATTERNS) if (pattern.test(text)) gives[theme] = 1;
  for (const [pattern, theme] of WANTS_PATTERNS) if (pattern.test(text)) wants[theme] = 1;
  if (/icebreaker/i.test(def.keywords ?? '')) gives.breakers = 1;
  if (/bioroid/i.test(def.keywords ?? '')) gives.bioroid = 1;
  if (def.type_code === 'ice') gives.ice = 1;
  const when = CONDITIONS.filter(c => CONDITION_PATTERNS[c].test(text));
  return { gives, wants, when };
}

/** The tags for a card: hand-written if there are any, otherwise guessed from its text. */
export function cardSynergy(def: CardDefinition): CardSynergy {
  return SYNERGY[def.code] ?? inferSynergy(def);
}
