import { describe, expect, it } from 'vitest';
import { ALL_CARDS, FLIP_CARDS, getCardDefinition, getCardFaceImageUrl, getCardImageUrl, shownCardDef } from '../src/data/cards';
import { splitFaces } from '../src/data/flipSides';

const melies = (server: 'hq' | 'rd' | 'archives') => ({ corp: { meliesServer: server } });

describe('flip sides of double-sided identities', () => {
  it('lists every identity whose text flips it, with a back title for each side its text has', () => {
    const flippers = ALL_CARDS.filter(c => /flip this identity/i.test(c.text ?? '')).map(c => c.code).sort();
    expect(Object.keys(FLIP_CARDS).sort()).toEqual(flippers);
    for (const code of flippers) expect(FLIP_CARDS[code].backs.length).toBe(splitFaces(getCardDefinition(code).text ?? '').length - 1);
  });

  it('a flipped identity shows its flip side art (NetrunnerDB <code>-<back>.jpg); unflipped shows the front', () => {
    expect(getCardFaceImageUrl({ cardCode: '35023', flipped: true })).toBe(getCardImageUrl('35023-0'));
    expect(getCardFaceImageUrl({ cardCode: '35023', flipped: false })).toBe(getCardImageUrl('35023'));
    expect(getCardFaceImageUrl({ cardCode: '35023' })).toBe(getCardImageUrl('35023'));
    expect(getCardFaceImageUrl({ cardCode: '30001', flipped: true })).toBe(getCardImageUrl('30001'));
  });

  it('Méliès U shows the back of the copy the Corp set (rules 1.5.2b)', () => {
    const flipped = { cardCode: '36036', flipped: true };
    expect(getCardFaceImageUrl(flipped, melies('hq'))).toBe(getCardImageUrl('36036-0'));
    expect(getCardFaceImageUrl(flipped, melies('rd'))).toBe(getCardImageUrl('36036-1'));
    expect(getCardFaceImageUrl(flipped, melies('archives'))).toBe(getCardImageUrl('36036-2'));
    const rd = shownCardDef(flipped, melies('rd'));
    expect(rd.title).toBe('Méliès U: Subsurface Labs');
    expect(rd.text).toMatch(/^When you flip this identity to this side during a run on R&D,/);
    expect(rd.flavor).toBe('Beneath any notice.');
    expect(rd.keywords).toBe('Department');
    const front = shownCardDef({ cardCode: '36036', flipped: false }, melies('rd'));
    expect(front.title).toBe('Méliès U: Only the Brightest');
    expect(front.text).not.toMatch(/Side \d/);
    expect(front.flavor).toBeUndefined();
  });

  it('title, text and flavor follow the side that is up', () => {
    const front = shownCardDef({ cardCode: '35023', flipped: false });
    expect(front.title).toBe('Dewi Subrotoputri: Pedagogical Dhalang');
    expect(front.text).toMatch(/^Whenever you make a successful run, if your \[mu\] is full/);
    expect(front.text).not.toMatch(/Flip side/);
    expect(front.flavor).toBe('Who else will teach the stories of good and evil?');
    const back = shownCardDef({ cardCode: '35023', flipped: true });
    expect(back.title).toBe('Dewi Subrotoputri: Shadow Guide');
    expect(back.text).toMatch(/^Whenever you make a successful run, if you have at least 1 unused \[mu\]/);
    expect(back.flavor).toBe('We can’t leave the corps’ dirty deeds in the shadows.');
    const nebula = shownCardDef({ cardCode: '35057', flipped: true });
    expect(nebula.title).toBe('Nebula Talent Management: Gemilang Arena');
    expect(nebula.text).toBe('The first time each turn you play an operation, gain [click].\nWhen the Runner makes a successful run on HQ or R&D, flip this identity.');
    expect(shownCardDef({ cardCode: '30001' })).toBe(getCardDefinition('30001'));
  });
});
