import { describe, expect, it } from 'vitest';
import { cardTextHtml } from '../src/ui/cardText';
import { ALL_CARDS, getCardDefinition } from '../src/data/cards';

describe('cardTextHtml', () => {
  it('renders Kessleroid with italics and one subroutine icon per subroutine', () => {
    const html = cardTextHtml(getCardDefinition('35075').text!);
    expect(html).toMatch(/<em>\(while it is <span[^>]*>rezzed<\/span>\)<\/em>/);
    expect(html).not.toContain('[subroutine]');
    expect(html.match(/aria-label="subroutine"/g)).toHaveLength(2);
    expect(html.split('<br />')).toHaveLength(3);
    expect(html).toMatch(/End the run<\/span>\.<br \/>.*<\/svg><\/span> End the run\.$/);
  });

  it('leaves no raw symbol tokens or escaped markup in any card text', () => {
    for (const c of ALL_CARDS) {
      if (!c.text) continue;
      const html = cardTextHtml(c.text);
      expect(html, c.title).not.toMatch(/\[[a-z-]+\]/);
      expect(html, c.title).not.toContain('&lt;');
    }
  });
});
