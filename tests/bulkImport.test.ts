import { describe, expect, it } from 'vitest';
import { daysBetween, extractDeckRefs, fetchDecks, fetchDecksByDate, filterCandidates, isAlreadySaved, resetNrdbIndex } from '../src/beta/bulkImport';

// A tiny NetrunnerDB: two of our cards, one identity, and one card we lack
const CARDS = [
  { code: '30010', title: 'The Catalyst: Convention Breaker', pack_code: 'sg', type_code: 'identity' },
  { code: '30001', title: 'Sure Gamble', pack_code: 'sg', type_code: 'event' },
  { code: '99999', title: 'Unknown Future Card', pack_code: 'xx', type_code: 'event' },
];
const PACKS = [
  { code: 'sg', name: 'System Gateway' },
  { code: 'xx', name: 'Future Set' },
];
const deck = (id: number, cards: Record<string, number>, extra: object = {}) => ({ id, name: `Deck ${id}`, user_name: 'tester', cards, ...extra });

function fakeFetch(decks: Record<string, unknown[]>): typeof fetch {
  return (async (url: string) => {
    const path = String(url).replace('https://netrunnerdb.com/api/2.0/public/', '');
    const data = path === 'cards' ? CARDS : path === 'packs' ? PACKS : decks[path];
    if (!data) return new Response('', { status: 404 });
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as typeof fetch;
}

describe('bulk NetrunnerDB import (beta tool)', () => {
  it('finds links, bare ids and shared deck ids in any text, without repeats', () => {
    const refs = extractDeckRefs(
      'see https://netrunnerdb.com/en/decklist/99164/padma-bypass and 98786, 98786\nhttps://netrunnerdb.com/en/deck/view/74e0b6cb-fe91-4e2f-a792-b117bd3d183b junk',
    );
    expect(refs).toEqual([
      { kind: 'decklist', id: '99164' },
      { kind: 'decklist', id: '98786' },
      { kind: 'deck', id: '74e0b6cb-fe91-4e2f-a792-b117bd3d183b' },
    ]);
  });

  it('fetches listed decks, keeps missing cards with their set, and reports failures', async () => {
    resetNrdbIndex();
    const f = fakeFetch({
      'decklist/1': [deck(1, { '30010': 1, '30001': 3 })],
      'decklist/2': [deck(2, { '30010': 1, '30001': 3, '99999': 2 })],
    });
    const { candidates, errors } = await fetchDecks(extractDeckRefs('1 2 3'), undefined, f);
    expect(candidates.map(c => c.result.playable)).toEqual([true, false]);
    expect(candidates[0].result.deck).toMatchObject({ identity: 'The Catalyst: Convention Breaker', cards: { 'Sure Gamble': 3 }, credit: 'tester' });
    expect(candidates[1].result.missing).toEqual([{ title: 'Unknown Future Card', count: 2, set: 'Future Set' }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('decklist/3');
  });

  it('fetches a date range one day at a time, requiring >=1 like or favorite, and filters the results', async () => {
    resetNrdbIndex();
    const f = fakeFetch({
      'decklists/by_date/2026-10-01': [
        deck(1, { '30010': 1, '30001': 3 }, { mwl_code: 'startup-ban-list-26-05', date_creation: '2026-10-01T10:00:00+00:00', votes_count: 1, favorites_count: 0 }),
        deck(3, { '30010': 1, '30001': 3 }, { mwl_code: 'startup-ban-list-26-05', date_creation: '2026-10-01T12:00:00+00:00', votes_count: 0, favorites_count: 0 }),
      ],
      'decklists/by_date/2026-10-02': [
        deck(2, { '30010': 1, '99999': 3 }, { mwl_code: 'standard-ban-list-26-05', date_creation: '2026-10-02T10:00:00+00:00', votes_count: 0, favorites_count: 2 }),
      ],
      'decklists/by_date/2026-10-03': [],
    });
    const { candidates, errors } = await fetchDecksByDate('2026-10-01', '2026-10-03', undefined, f);
    expect(errors).toEqual([]);
    expect(candidates.map(c => c.ref.id)).toEqual(['2', '1']); // newest first; deck 3 (0 votes, 0 favorites) excluded
    expect(candidates.map(c => ({ votes: c.votes, favorites: c.favorites }))).toEqual([
      { votes: 0, favorites: 2 },
      { votes: 1, favorites: 0 },
    ]);
    expect(filterCandidates(candidates, { playableOnly: true }).map(c => c.ref.id)).toEqual(['1']);
    expect(filterCandidates(candidates, { startupOnly: true }).map(c => c.ref.id)).toEqual(['1']);
    expect(filterCandidates(candidates, { side: 'corp' })).toEqual([]);
    expect(filterCandidates(candidates, { text: 'deck 2' }).map(c => c.ref.id)).toEqual(['2']);
    expect(isAlreadySaved(candidates[1], [{ name: 'Deck 1', identity: 'The Catalyst: Convention Breaker' }])).toBe(true);
  });

  it('counts days inclusively and rejects a backwards range', async () => {
    expect(daysBetween('2026-02-27', '2026-03-01')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
    await expect(fetchDecksByDate('2026-10-05', '2026-10-01', undefined, fakeFetch({}))).rejects.toThrow(/start date/);
  });
});
