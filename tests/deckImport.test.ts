import { describe, expect, it } from 'vitest';
import { getCardDefinition } from '../src/core';
import { DECKS, DeckList, deckCodes } from '../src/data/decks';
import {
  fetchNetrunnerDbDeck,
  importDeckText,
  normalizeTitle,
  parseDeckText,
  parseNetrunnerDbUrl,
  resolveImport,
} from '../src/data/deckImport';

const SET_NAME: Record<string, string> = { sg: 'System Gateway', elev: 'Elevation' };

/** A deck written the way NetrunnerDB's plain-text export writes it. */
function nrdbText(deck: DeckList): string {
  const codes = deckCodes(deck);
  const identity = getCardDefinition(codes.identity);
  const byType = new Map<string, string[]>();
  for (const [title, n] of Object.entries(deck.cards)) {
    const def = getCardDefinition(deckCodes({ ...deck, cards: { [title]: 1 } }).cards[0]);
    const type = def.type_code[0].toUpperCase() + def.type_code.slice(1);
    const dots = def.faction_code !== identity.faction_code && def.faction_cost ? ' ' + '●'.repeat(def.faction_cost * n) : '';
    byType.set(type, [...(byType.get(type) ?? []), `${n}x ${def.title} (${SET_NAME[def.pack_code]})${dots}`]);
  }
  const sections = [...byType].map(([type, lines]) => `${type} (${lines.length})\n${lines.join('\n')}`);
  return [
    deck.name,
    '',
    `${identity.title} (${SET_NAME[identity.pack_code]})`,
    '',
    sections.join('\n\n'),
    '',
    '12 influence spent (max 15, available 3)',
    `${codes.cards.length} cards (min ${identity.minimum_deck_size})`,
    'Cards up to Elevation',
  ].join('\n');
}

describe('deck import', () => {
  it('normalizes titles across accents, quotes and punctuation', () => {
    expect(normalizeTitle('Brân 1.0')).toBe(normalizeTitle('Bran 1.0'));
    expect(normalizeTitle('Tomorrowʼs Headline')).toBe(normalizeTitle("Tomorrow's Headline"));
    expect(normalizeTitle('René “Loup” Arcemont: Party Animal')).toBe(normalizeTitle('Rene "Loup" Arcemont: Party Animal'));
  });

  it('round-trips every built-in deck through the NetrunnerDB text export', () => {
    for (const deck of DECKS) {
      const result = importDeckText(nrdbText(deck));
      expect(result.missing, deck.id).toEqual([]);
      expect(result.notes, deck.id).toEqual([]);
      expect(result.deck?.name).toBe(deck.name);
      expect(result.deck?.identity).toBe(deck.identity);
      expect(result.deck?.side).toBe(deck.side);
      expect(result.deck?.cards).toEqual(deck.cards);
      expect(result.deck?.source).toBe('custom');
      expect(result.problems, deck.id).toEqual([]);
    }
  });

  it('reports cards and identities outside the pool and still builds the deck', () => {
    const text = [
      'Esa Test Deck',
      'Esâ Afontov: Eco-Insurrectionist (Midnight Sun)',
      'Event (2)',
      '3x Sure Gamble (System Gateway)',
      '2x Dirty Laundry (Uprising Booster Pack)',
      'Program (1)',
      '1x Unity (System Gateway) ●●',
    ].join('\n');
    const result = importDeckText(text);
    expect(result.missing).toEqual([
      { title: 'Esâ Afontov: Eco-Insurrectionist', count: 1 },
      { title: 'Dirty Laundry', count: 2 },
    ]);
    expect(result.deck?.side).toBe('runner');
    expect(result.deck?.cards).toEqual({ 'Sure Gamble': 3, Unity: 1 });
    expect(result.notes[0]).toMatch(/isn't in this game/);
    expect(result.problems.length).toBeGreaterThan(0); // too few cards
  });

  it('reads Markdown and BBCode copies', () => {
    const md = [
      '## Catalyst',
      '',
      '[The Catalyst: Convention Breaker](https://netrunnerdb.com/en/card/30001) _(System Gateway)_',
      '',
      '### Event (3)',
      '* 3x [Sure Gamble](https://netrunnerdb.com/en/card/30008) _(System Gateway)_',
    ].join('\n');
    expect(parseDeckText(md)).toEqual({
      name: 'Catalyst',
      identity: 'The Catalyst: Convention Breaker',
      entries: [{ title: 'Sure Gamble', count: 3 }],
    });
    const bb = '[b]Event (3)[/b]\n3x [url=https://netrunnerdb.com/en/card/30008]Sure Gamble[/url] [i](System Gateway)[/i]';
    expect(parseDeckText(bb).entries).toEqual([{ title: 'Sure Gamble', count: 3 }]);
  });

  it('reads jinteki.net style lists without an identity', () => {
    const result = importDeckText('3 Hedge Fund\n2 Palisade\nSure Gamble x1');
    expect(result.deck?.side).toBe('corp');
    expect(result.deck?.cards).toEqual({ 'Hedge Fund': 3, Palisade: 2 });
    expect(result.notes.join(' ')).toMatch(/no identity/);
    expect(result.notes.join(' ')).toMatch(/Left out 1x Sure Gamble/);
  });

  it('reads OCTGN .o8d files', () => {
    const xml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<deck game="0f38e453-26df-4c04-9d67-6d43de939c77">
  <section name="Identity">
    <card qty="1" id="bc0f047c-01b1-427f-a439-d451eda30001">The Catalyst: Convention Breaker</card>
  </section>
  <section name="R&amp;D / Stack">
    <card qty="3" id="bc0f047c-01b1-427f-a439-d451eda30008">Sure Gamble</card>
    <card qty="2" id="bc0f047c-01b1-427f-a439-d451eda30010">Cleaver</card>
  </section>
  <notes><![CDATA[]]></notes>
</deck>`;
    const result = importDeckText(xml);
    expect(result.deck?.identity).toBe('The Catalyst: Convention Breaker');
    expect(result.deck?.cards).toEqual({ 'Sure Gamble': 3, Cleaver: 2 });
  });

  it('returns no deck when nothing matches', () => {
    expect(importDeckText('hello\nworld').deck).toBeNull();
    expect(resolveImport({ entries: [{ title: 'Not a card', count: 3 }] }).missing).toEqual([{ title: 'Not a card', count: 3 }]);
  });

  it('recognizes NetrunnerDB links', () => {
    expect(parseNetrunnerDbUrl('https://netrunnerdb.com/en/decklist/98786/stealing-the-stars')).toEqual({ kind: 'decklist', id: '98786' });
    expect(parseNetrunnerDbUrl('netrunnerdb.com/en/deck/view/3c018765-5d53-4d4d-9c99-ef561a83bbc8')).toEqual({
      kind: 'deck',
      id: '3c018765-5d53-4d4d-9c99-ef561a83bbc8',
    });
    expect(parseNetrunnerDbUrl('https://example.com/decklist/1')).toBeNull();
  });

  it('fetches a decklist from the API and looks up cards outside the pool by title', async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string) => {
      calls.push(url);
      const json = (data: unknown[]) => ({ ok: true, status: 200, json: async () => ({ data }) });
      if (url.endsWith('/decklist/98786')) {
        return json([{ name: 'Stealing the Stars', cards: { '35057': 1, '30052': 2, '37042': 2, '99001': 3 } }]);
      }
      if (url.endsWith('/card/37042')) return json([{ title: 'Some Later Ice' }]);
      if (url.endsWith('/card/99001')) return json([{ title: 'Hedge Fund' }]); // a reprint
      return { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const parsed = await fetchNetrunnerDbDeck('https://netrunnerdb.com/en/decklist/98786/stealing-the-stars', fakeFetch);
    expect(calls[0]).toBe('https://netrunnerdb.com/api/2.0/public/decklist/98786');
    const result = resolveImport(parsed);
    expect(result.deck?.name).toBe('Stealing the Stars');
    expect(result.deck?.identity).toBe('Nebula Talent Management: Making Stars');
    expect(result.deck?.cards).toEqual({ 'Tomorrowʼs Headline': 2, 'Hedge Fund': 3 });
    expect(result.missing).toEqual([{ title: 'Some Later Ice', count: 2 }]);
  });
});
