import { describe, expect, it } from 'vitest';
import { copyLimitProblems, createInitialGameState, getCardDefinition, requiredAgendaPoints, validateDeck } from '../src/core';
import { DECKS, DeckList, deckCodes, deckGameSetup, pickRandomDeck, randomDeckPool } from '../src/data/decks';
import { playout } from './helpers';

describe('decklists', () => {
  for (const deck of DECKS) {
    it(`${deck.name} is legal`, () => {
      expect(validateDeck(deckCodes(deck))).toEqual([]);
    });
  }

  it('the official starter decks have the published sizes', () => {
    expect(deckCodes(DECKS.find(d => d.id === 'catalyst-starter')!).cards).toHaveLength(30);
    expect(deckCodes(DECKS.find(d => d.id === 'syndicate-starter')!).cards).toHaveLength(34);
  });

  it('the NSG sample decks are 44 cards (Corp) and 40 cards (Runner)', () => {
    const samples = DECKS.filter(d => d.source === 'official sample' && !d.id.startsWith('core-'));
    expect(samples).toHaveLength(7);
    for (const deck of samples) expect(deckCodes(deck).cards).toHaveLength(deck.side === 'corp' ? 44 : 40);
  });

  it('includes the 21 credited System Gateway + Elevation sample decks', () => {
    const core = DECKS.filter(d => d.id.startsWith('core-'));
    expect(core).toHaveLength(21);
    expect(core.filter(d => d.side === 'corp')).toHaveLength(12);
    for (const deck of core) {
      expect(deck.source).toBe('official sample');
      expect(deck.credit).toMatch(/Phi aka Girometics/);
    }
    expect(deckCodes(core.find(d => d.id === 'core-quick-returns')!).cards).toHaveLength(48);
  });

  it('builds a game from two decklists', () => {
    const state = createInitialGameState(deckGameSetup(7, 'weyland-built-to-last', 'zahya-sadeghi'));
    expect(state.corp.hq.length + state.corp.rd.length).toBe(44);
    expect(state.runner.identity.cardCode).toBe('30010');
  });
});

describe('validateDeck', () => {
  const weyland = () => deckCodes(DECKS.find(d => d.id === 'weyland-built-to-last')!);

  it('needs 2 points per 5 cards plus 2 (or 1 more)', () => {
    expect(requiredAgendaPoints(40)).toEqual([18, 19]);
    expect(requiredAgendaPoints(45)).toEqual([20, 21]);
  });

  it('counts the copy limit by name, so reprints share it (rule 1.4.7)', () => {
    const palisade = getCardDefinition('30072');
    const reprint = { ...palisade, code: '99072', pack_code: 'reprint' };
    expect(copyLimitProblems([palisade, palisade, reprint])).toEqual([]);
    expect(copyLimitProblems([palisade, palisade, reprint, reprint])).toEqual(['4 copies of Palisade (limit 3)']);
  });

  it('reports size, copies, side, influence, agenda points and out-of-faction agendas', () => {
    const d = weyland();
    expect(validateDeck({ ...d, cards: d.cards.slice(0, 39) }).join('|')).toMatch(/needs at least 40/);
    expect(validateDeck({ ...d, cards: [...d.cards, '30072'] }).join('|')).toMatch(/4 copies of Palisade/);
    expect(validateDeck({ ...d, cards: [...d.cards, '30030'] }).join('|')).toMatch(/Sure Gamble is a runner card/);
    expect(validateDeck({ ...d, cards: [...d.cards, '30044'] }).join('|')).toMatch(/out-of-faction agenda/);
    const heavy = [...d.cards, ...Array(3).fill('30050'), ...Array(3).fill('30049')]; // Anoetic Void 4, Neurospike 3
    expect(validateDeck({ ...d, cards: heavy }).join('|')).toMatch(/influence/);
    const noAgendas = d.cards.filter(c => !['30060', '30067', '30069', '30068'].includes(c));
    expect(validateDeck({ ...d, cards: [...noAgendas, ...Array(d.cards.length - noAgendas.length).fill('30075')] }).join('|')).toMatch(/agenda points/);
  });
});

describe('real deck playouts', () => {
  const corps = DECKS.filter(d => d.side === 'corp');
  const runners = DECKS.filter(d => d.side === 'runner');
  corps.forEach((corp, i) => {
    const runner = runners[i % runners.length];
    it(`${corp.name} vs ${runner.name} plays without errors`, () => {
      const state = playout(100 + i, 500, deckGameSetup(100 + i, corp.id, runner.id));
      expect(state.turnNumber).toBeGreaterThan(1);
    });
  });
});

describe('random deck', () => {
  it('never picks a starter deck and only picks legal decks of the right side', () => {
    const illegal: DeckList = { id: 'bad', name: 'Bad', side: 'corp', identity: DECKS[0].identity, cards: {}, source: 'custom' };
    for (const side of ['corp', 'runner'] as const) {
      const pool = randomDeckPool([...DECKS, illegal], side);
      expect(pool.length).toBeGreaterThan(1);
      expect(pool.every(d => d.side === side && d.source !== 'official starter')).toBe(true);
      expect(pool.some(d => d.id === 'bad')).toBe(false);
    }
  });

  it('picks a different deck from the current one', () => {
    const pool = randomDeckPool(DECKS, 'runner');
    for (let i = 0; i < 20; i++) {
      const r = i / 20;
      expect(pickRandomDeck(DECKS, 'runner', pool[0].id, () => r)!.id).not.toBe(pool[0].id);
    }
  });
});
