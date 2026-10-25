import { SideCode } from '../core/types/card';

export { ALL_CARDS, CARD_SETS, getCardDefinition, cardDef } from '../core/cards';

// Card art belongs to Null Signal Games and isn't shipped with the app; it is
// loaded from NetrunnerDB's image host at runtime.
export function getCardImageUrl(code: string): string {
  return `https://card-images.netrunnerdb.com/v2/large/${code}.jpg`;
}

// Our own card backs (NSG's backs aren't licensed for public use)
export function getCardBackUrl(side: SideCode = 'corp'): string {
  return `/card-backs/${side}.svg`;
}
