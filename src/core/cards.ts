import gatewayCards from '../data/system-gateway-cards.json';
import elevationCards from '../data/elevation-cards.json';
import vantagePointCards from '../data/vantage-point-cards.json';
import { CardDefinition, CardInstance } from './types/card';

/**
 * Static card definition registry. Game state only stores card codes on
 * instances; definitions are looked up here so state stays small and
 * hidden cards can be scrubbed by code alone.
 */
export const ALL_CARDS: CardDefinition[] = [...gatewayCards, ...elevationCards, ...vantagePointCards] as unknown as CardDefinition[];

/** The sets in the card pool, by pack code. */
export const CARD_SETS: { code: string; name: string }[] = [
  { code: 'sg', name: 'System Gateway' },
  { code: 'elev', name: 'Elevation' },
  { code: 'vp', name: 'Vantage Point' },
];

const CARDS_BY_CODE = new Map<string, CardDefinition>(ALL_CARDS.map(c => [c.code, c]));

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
