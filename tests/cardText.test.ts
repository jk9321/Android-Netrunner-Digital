import { describe, expect, it } from 'vitest';
import { cardTextHtml, flavorTextHtml } from '../src/ui/cardText';
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

describe('flavorTextHtml', () => {
  it('renders Stick and Poke emphasis and escapes unsafe markup while preserving em/strong and line breaks', () => {
    const html = flavorTextHtml(getCardDefinition('36008').flavor!);
    expect(html).toContain('<em>not</em>');
    expect(html).not.toContain('&lt;em&gt;');

    const overclock = flavorTextHtml(getCardDefinition('30029').flavor!);
    expect(overclock).toContain('<strong>our</strong>');
    expect(overclock).toContain('<br />');
    expect(overclock).toContain('Novelties&amp;Acquisitions');

    expect(flavorTextHtml('<em>ok</em><script>x</script>')).toBe('<em>ok</em>&lt;script&gt;x&lt;/script&gt;');
  });

  it('leaves no escaped markup in any card flavor text', () => {
    for (const c of ALL_CARDS) {
      if (!c.flavor) continue;
      const html = flavorTextHtml(c.flavor);
      expect(html, c.title).not.toContain('&lt;');
    }
  });
});
