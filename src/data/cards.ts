import { CardInstance, SideCode } from '../core/types/card';
import { shownImageCode } from './flipSides';

export { ALL_CARDS, CARD_SETS, getCardDefinition, cardDef } from '../core/cards';
export { FLIP_CARDS, shownCardDef } from './flipSides';

// Card art belongs to Null Signal Games and isn't shipped with the app; it is
// loaded from NetrunnerDB's image host at runtime.
export function getCardImageUrl(code: string): string {
  return `https://card-images.netrunnerdb.com/v2/large/${code}.jpg`;
}

/** The art for the side a card shows now: a flipped identity shows its flip side (data/flipSides.ts). */
export function getCardFaceImageUrl(
  card: Pick<CardInstance, 'cardCode' | 'flipped'>,
  state?: Parameters<typeof shownImageCode>[1],
): string {
  return getCardImageUrl(shownImageCode(card, state));
}

// Our own card backs (NSG's backs aren't licensed for public use)
export function getCardBackUrl(side: SideCode = 'corp'): string {
  return `/card-backs/${side}.svg`;
}
