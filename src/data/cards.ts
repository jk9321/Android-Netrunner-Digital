import { CardInstance, SideCode } from '../core/types/card';

export { ALL_CARDS, CARD_SETS, getCardDefinition, cardDef } from '../core/cards';

// Card art belongs to Null Signal Games and isn't shipped with the app; it is
// loaded from NetrunnerDB's image host at runtime.
export function getCardImageUrl(code: string): string {
  return `https://card-images.netrunnerdb.com/v2/large/${code}.jpg`;
}

// Double-sided identities: NetrunnerDB serves the flip side's art as <code>-0.jpg.
// tests/cardImages.test.ts checks this list against every card whose text flips its identity.
export const FLIP_SIDE_CODES: ReadonlySet<string> = new Set([
  '35023', // Dewi Subrotoputri: Pedagogical Dhalang / Shadow Guide
  '35057', // Nebula Talent Management: Making Stars / Gemilang Arena
  '36036', // Méliès U: Only the Brightest / Tenure Floors
]);

/** The art for the side a card shows now: a flipped identity shows its flip side. */
export function getCardFaceImageUrl(card: Pick<CardInstance, 'cardCode' | 'flipped'>): string {
  return card.flipped && FLIP_SIDE_CODES.has(card.cardCode)
    ? getCardImageUrl(`${card.cardCode}-0`)
    : getCardImageUrl(card.cardCode);
}

// Our own card backs (NSG's backs aren't licensed for public use)
export function getCardBackUrl(side: SideCode = 'corp'): string {
  return `/card-backs/${side}.svg`;
}
