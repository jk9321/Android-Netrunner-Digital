import { CardDefinition, CardInstance } from '../core/types/card';
import { GameState } from '../core/types/state';
import { getCardDefinition } from '../core/cards';

/**
 * Double-sided identities. NetrunnerDB's card data has one title and one text for
 * both sides: the text holds the flip side after "Flip side:" (or "Side 1:", "Side 2:"...
 * for Méliès U, whose three copies have different backs). The back titles are printed
 * only on the cards, so they live here. NetrunnerDB serves back i's art as <code>-<i>.jpg.
 * tests/cardImages.test.ts checks this table against every card whose text flips its identity.
 */
interface FlipCard {
  /** Back titles in NetrunnerDB's image order (<code>-0, <code>-1, ...). */
  backs: readonly string[];
  /** Keywords on the back (when they differ from the front's). */
  backKeywords?: string;
  /** Flavor lines: the front's has one unless false; each back takes the next line. */
  frontFlavor: boolean;
}

export const FLIP_CARDS: Readonly<Record<string, FlipCard>> = {
  '35023': { backs: ['Dewi Subrotoputri: Shadow Guide'], frontFlavor: true },
  '35057': { backs: ['Nebula Talent Management: Gemilang Arena'], frontFlavor: true },
  // Side 1 = HQ, side 2 = R&D, side 3 = Archives (state.corp.meliesServer)
  '36036': { backs: ['Méliès U: Tenure Floors', 'Méliès U: Subsurface Labs', 'Méliès U: Disposal Grounds'], backKeywords: 'Department', frontFlavor: false },
};

const MELIES_BACK = { hq: 0, rd: 1, archives: 2 } as const;

type FaceState = { corp: Pick<GameState['corp'], 'meliesServer'> };

/** Which back a flipped card shows (Méliès U: the copy the Corp set; 1.5.2b). */
function backIndex(card: Pick<CardInstance, 'cardCode'>, state?: FaceState | null): number {
  if (card.cardCode === '36036') return MELIES_BACK[state?.corp.meliesServer ?? 'hq'];
  return 0;
}

/** The card's text split into its front and its backs. */
export function splitFaces(text: string): string[] {
  return text.split(/\n(?:Flip side|Side \d):\s*/);
}

/** The card as printed on the side that is up: title, text, flavor and keywords. */
export function shownCardDef(card: Pick<CardInstance, 'cardCode' | 'flipped'>, state?: FaceState | null): CardDefinition {
  const def = getCardDefinition(card.cardCode);
  const flip = FLIP_CARDS[card.cardCode];
  if (!flip) return def;
  const texts = splitFaces(def.text ?? '');
  const flavors = (def.flavor ?? '').split('\n');
  if (!card.flipped) {
    return { ...def, text: texts[0], flavor: flip.frontFlavor ? flavors[0] : undefined };
  }
  const i = backIndex(card, state);
  const title = flip.backs[i];
  return {
    ...def,
    title,
    stripped_title: title.normalize('NFD').replace(/[̀-ͯ]/g, ''),
    text: texts[i + 1] ?? texts[texts.length - 1],
    flavor: flavors[i + (flip.frontFlavor ? 1 : 0)] || undefined,
    keywords: flip.backKeywords ?? def.keywords,
  };
}

/** The art for the side a card shows now (getCardImageUrl's code, with -<back> when flipped). */
export function shownImageCode(card: Pick<CardInstance, 'cardCode' | 'flipped'>, state?: FaceState | null): string {
  return card.flipped && FLIP_CARDS[card.cardCode] ? `${card.cardCode}-${backIndex(card, state)}` : card.cardCode;
}
