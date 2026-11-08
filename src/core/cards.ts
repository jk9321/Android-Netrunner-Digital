import gatewayCards from '../data/system-gateway-cards.json';
import elevationCards from '../data/elevation-cards.json';
import vantagePointCards from '../data/vantage-point-cards.json';
import liberationCards from '../data/liberation-cards.json';
import { CardDefinition, CardInstance } from './types/card';

/**
 * Static card definition registry. Game state only stores card codes on
 * instances; definitions are looked up here so state stays small and
 * hidden cards can be scrubbed by code alone.
 */
export const ALL_CARDS: CardDefinition[] = [...gatewayCards, ...elevationCards, ...vantagePointCards, ...liberationCards] as unknown as CardDefinition[];

/** The sets in the card pool, by pack code. */
export const CARD_SETS: { code: string; name: string }[] = [
  { code: 'sg', name: 'System Gateway' },
  { code: 'elev', name: 'Elevation' },
  { code: 'vp', name: 'Vantage Point' },
  { code: 'tai', name: 'The Automata Initiative' },
  { code: 'rwr', name: 'Rebellion Without Rehearsal' },
];

/**
 * Placeholder cards (multiplayer phase 1, chunk 2). A table rebuilt from one
 * player's view (core/view/reconstruct.ts) holds these where the player may
 * not see a card: the opponent's hand, the decks, a facedown installed card
 * (rules 4.2.2, 4.3.2, 4.6.2). They are not in ALL_CARDS, so no deck, card
 * list or title index sees them; `type_code` is 'unknown', which no rules
 * code tests for.
 */
export const HIDDEN_CORP = 'hidden-corp';
export const HIDDEN_RUNNER = 'hidden-runner';
const placeholder = (code: string, side: 'corp' | 'runner'): CardDefinition => ({
  code,
  title: 'Facedown card',
  pack_code: '',
  side_code: side,
  faction_code: side === 'corp' ? 'neutral-corp' : 'neutral-runner',
  type_code: 'unknown' as CardDefinition['type_code'],
  text: '',
});

/** A placeholder for a card the viewer may not see (see HIDDEN_CORP). */
export const isHiddenCode = (code: string | undefined): boolean => code === HIDDEN_CORP || code === HIDDEN_RUNNER;
export const isHidden = (card: CardInstance): boolean => isHiddenCode(card.cardCode);

const CARDS_BY_CODE = new Map<string, CardDefinition>([
  ...ALL_CARDS.map(c => [c.code, c] as const),
  [HIDDEN_CORP, placeholder(HIDDEN_CORP, 'corp')],
  [HIDDEN_RUNNER, placeholder(HIDDEN_RUNNER, 'runner')],
]);

export function getCardDefinition(code: string): CardDefinition {
  const card = CARDS_BY_CODE.get(code);
  if (!card) {
    throw new Error(`Card definition with code ${code} not found!`);
  }
  return card;
}

/** Shorthand for the definition of an instance. */
export function cardDef(card: CardInstance): CardDefinition {
  return getCardDefinition(card.cardCode);
}
