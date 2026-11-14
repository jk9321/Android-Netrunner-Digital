import { describe, expect, it } from 'vitest';
import { ALL_CARDS } from '../src/core/cards';
import { rezEffectOf } from '../src/ai/cards';

// review-bypass-hold.md S1: the counted rez reads a flag on the card's entry (src/ai/cards), not the card text. The flag
// is checked against the text here, so an ice with a rez effect can't be added without it.
describe('rezEffect flag', () => {
  it('is set on exactly the ice whose text says "When you rez this ice"', () => {
    const ice = ALL_CARDS.filter(c => c.type_code === 'ice');
    const byText = ice.filter(c => /when you rez this/i.test(c.stripped_text ?? '')).map(c => c.code).sort();
    const byFlag = ice.filter(c => rezEffectOf(c.code)).map(c => c.code).sort();
    expect(byFlag).toEqual(byText);
    expect(byFlag.length).toBeGreaterThan(0);
  });
});
