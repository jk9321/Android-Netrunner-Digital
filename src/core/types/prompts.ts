import { SideCode } from './card';

/**
 * A decision the game is waiting on. While any prompt is pending, the only
 * legal action is RESOLVE_PROMPT for the first prompt in the queue, made by
 * the prompt's side.
 */
export type Prompt = MulliganPrompt | DiscardPrompt | AccessTrashPrompt | AccessOrderPrompt | EffectChoicePrompt | EffectCardsPrompt;

interface BasePrompt {
  id: string;
  side: SideCode;
  message: string;
}

/** Keep the opening hand, or shuffle it back and draw a new one. */
export interface MulliganPrompt extends BasePrompt {
  kind: 'mulligan';
}

/** Discard exactly `count` cards from hand at end of turn. */
export interface DiscardPrompt extends BasePrompt {
  kind: 'discard';
  count: number;
}

/**
 * The Runner is accessing a card and may use one mid-access ability: pay the
 * trash cost (basic trash ability, when trashCost is set) or one of the
 * alternatives offered by installed cards (e.g. Carnivore).
 */
export interface AccessTrashPrompt extends BasePrompt {
  kind: 'access_trash';
  cardInstanceId: string;
  /** null when the basic trash ability can't be used (no trash cost, or can't afford it). */
  trashCost: number | null;
  /** Mid-access abilities from installed cards; ids are the source card's instance id. */
  alternatives?: { id: string; label: string }[];
}

/**
 * During a breach the Runner picks which candidate to access next (rules
 * 7.3.4): a card in the root, a random card from HQ, the next card of R&D,
 * or the next card in Archives. Option ids are 'root:<instance id>', 'hq', 'rd' or 'archives'.
 */
export interface AccessOrderPrompt extends BasePrompt {
  kind: 'access_order';
  options: { id: string; label: string }[];
}

/**
 * Identifies the card script waiting on a prompt answer and where it is in
 * its resolution. `data` must stay plain JSON.
 */
export interface EffectSource {
  cardCode: string;
  instanceId: string;
  step: string;
  data?: Record<string, string | number | boolean | string[]>;
}

/** A card effect asks a player to pick one option. */
export interface EffectChoicePrompt extends BasePrompt {
  kind: 'effect_choice';
  options: { id: string; label: string }[];
  source: EffectSource;
}

/** A card effect asks a player to pick between `min` and `max` of the candidate cards. */
export interface EffectCardsPrompt extends BasePrompt {
  kind: 'effect_cards';
  candidateIds: string[];
  min: number;
  max: number;
  source: EffectSource;
}

export type PromptChoice =
  | { kind: 'mulligan'; mulligan: boolean }
  | { kind: 'discard'; cardInstanceIds: string[] }
  | { kind: 'access_trash'; trash: boolean; alternativeId?: string }
  | { kind: 'access_order'; optionId: string }
  /** trashFirst: on a prompt that installs a card (source.data.install), cards to trash first (rules 8.5.6). */
  | { kind: 'effect_choice'; optionId: string; trashFirst?: string[] }
  /** trashFirst: on a prompt that installs the chosen card (source.data.install), installed cards to trash first (rules 8.5.6). */
  | { kind: 'effect_cards'; cardInstanceIds: string[]; trashFirst?: string[] };
