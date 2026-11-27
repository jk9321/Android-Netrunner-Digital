import { describe, expect, it } from 'vitest';
import { ALL_CARDS, FLIP_SIDE_CODES, getCardFaceImageUrl, getCardImageUrl } from '../src/data/cards';

describe('flip-side card art', () => {
  it('lists every identity whose text flips it, and nothing else', () => {
    const flippers = ALL_CARDS.filter(c => /flip this identity/i.test(c.text ?? '')).map(c => c.code).sort();
    expect([...FLIP_SIDE_CODES].sort()).toEqual(flippers);
  });

  it('a flipped identity shows its flip side (NetrunnerDB <code>-0.jpg); unflipped shows the front', () => {
    expect(getCardFaceImageUrl({ cardCode: '35023', flipped: true })).toBe(getCardImageUrl('35023-0'));
    expect(getCardFaceImageUrl({ cardCode: '35023', flipped: false })).toBe(getCardImageUrl('35023'));
    expect(getCardFaceImageUrl({ cardCode: '35023' })).toBe(getCardImageUrl('35023'));
  });

  it('a card with no flip side keeps its front even if marked flipped', () => {
    expect(getCardFaceImageUrl({ cardCode: '30001', flipped: true })).toBe(getCardImageUrl('30001'));
  });
});
