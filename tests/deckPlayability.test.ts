import { describe, expect, it } from 'vitest';
import { importDeckText } from '../src/data/deckImport';
import { buildPrintingIndex, groupMissingBySet, rankSetsToUnlock } from '../src/data/deckPlayability';

describe('deck playability', () => {
  it('flags an import with every card in the game as fully playable', () => {
    const r = importDeckText('Deck\n\nThe Catalyst: Convention Breaker (System Gateway)\n\n3x Sure Gamble (System Gateway)');
    expect(r.playable).toBe(true);
    expect(r.deck?.missing).toBeUndefined();
  });

  it('lists missing cards with their set and keeps them on the saved deck', () => {
    const r = importDeckText(
      'Deck\n\nThe Catalyst: Convention Breaker (System Gateway)\n\n3x Sure Gamble (System Gateway)\n2x Cezve (Midnight Sun)\n1x Mystery Card'
    );
    expect(r.playable).toBe(false);
    expect(r.missing).toEqual([
      { title: 'Cezve', count: 2, set: 'Midnight Sun' },
      { title: 'Mystery Card', count: 1 },
    ]);
    expect(r.deck?.missing).toEqual(r.missing);
    expect(groupMissingBySet(r.missing).map(g => [g.set, g.copies])).toEqual([
      ['Midnight Sun', 2],
      ['Unknown set', 1],
    ]);
  });

  it('reports a missing identity with its set', () => {
    const r = importDeckText('Deck\n\nNyusha "Sable" Sintashta: Symphonic Prodigy (Midnight Sun)\n\n3x Sure Gamble (System Gateway)');
    expect(r.missing).toEqual([{ title: 'Nyusha "Sable" Sintashta: Symphonic Prodigy', count: 1, set: 'Midnight Sun' }]);
    expect(r.playable).toBe(false);
  });

  it('ranks the sets that unlock the most decks, counting reprints for every set they are in', () => {
    const index = buildPrintingIndex([
      { title: 'A', pack_code: 'su21' },
      { title: 'A', pack_code: 'ms' }, // reprint
      { title: 'B', pack_code: 'ms' },
      { title: 'C', pack_code: 'ph' },
      { title: 'Old', pack_code: 'core' },
    ]);
    const m = (title: string) => ({ title, count: 1 });
    const decks = [
      { id: 'ok', missing: [] },
      { id: 'a', missing: [m('A')] },
      { id: 'ab', missing: [m('A'), m('B')] },
      { id: 'c', missing: [m('C')] },
      { id: 'old', missing: [m('Old')] },
    ];
    const r = rankSetsToUnlock(decks, index, ['su21', 'ms', 'ph']);
    expect(r.playableNow).toEqual(['ok']);
    expect(r.unreachable).toEqual(['old']);
    expect(r.alone[0]).toEqual({ pack: 'ms', unlocked: ['a', 'ab'], copies: 3 });
    expect(r.order.map(s => [s.pack, s.unlocked, s.playableAfter])).toEqual([
      ['ms', ['a', 'ab'], 3],
      ['ph', ['c'], 4],
    ]);
  });
});
