import { describe, expect, it } from 'vitest';
import { ALL_CARDS, FORMATS, getCardDefinition, getFormat, isBanned, validateDeck, validateFormat } from '../src/core';
import { DECKS, deckCodes } from '../src/data/decks';

const titlesBanned = (id: 'startup' | 'standard') =>
  ALL_CARDS.filter(c => isBanned(getFormat(id), c)).map(c => c.title).sort();

describe('formats', () => {
  it('bans the System Gateway and Elevation cards on the current lists', () => {
    expect(titlesBanned('startup')).toEqual(['Cleaver', 'Mercia B4LL4RD', 'NBN: Reality Plus', 'Offworld Office', 'Seamless Launch']);
    expect(titlesBanned('standard')).toEqual(['Cleaver', 'Luminal Transubstantiation', 'Offworld Office', 'Touch-ups']);
  });

  it('allows every card in casual, and both core sets in Startup and Standard', () => {
    for (const f of FORMATS) {
      const sets = f.sets;
      if (sets) expect(sets).toEqual(expect.arrayContaining(['sg', 'elev']));
    }
    expect(titlesBanned('casual' as never)).toEqual([]);
  });

  it('leaves decks without a format unchanged and adds format problems when one is set', () => {
    const weyland = deckCodes(DECKS.find(d => d.id === 'weyland-built-to-last')!);
    expect(validateDeck(weyland)).toEqual([]);
    const offworld = ALL_CARDS.find(c => c.title === 'Offworld Office')!.code;
    const withBan = { ...weyland, cards: [...weyland.cards.slice(1), offworld] };
    expect(validateDeck(withBan).join('|')).not.toMatch(/banned/);
    expect(validateDeck({ ...withBan, format: 'standard' }).join('|')).toMatch(/Offworld Office is banned in Standard/);
  });

  it('checks a banned identity', () => {
    const nbn = ALL_CARDS.find(c => c.title === 'NBN: Reality Plus')!;
    expect(validateDeck({ identity: nbn.code, cards: [], format: 'startup' }).join('|')).toMatch(/NBN: Reality Plus is banned in Startup/);
  });

  it('rejects cards from sets outside the card pool', () => {
    const identity = getCardDefinition(ALL_CARDS[0].code);
    const fromDownfall = { ...identity, title: 'Old card', pack_code: 'df' };
    expect(validateFormat(getFormat('standard'), identity, [fromDownfall])).toEqual([]);
    expect(validateFormat(getFormat('startup'), identity, [fromDownfall])).toEqual([
      "Old card is from Downfall, which isn't legal in Startup",
    ]);
  });

  it('limits Startup Corp decks to 4 agendas worth 3 or more points', () => {
    const f = getFormat('startup');
    const corpId = ALL_CARDS.find(c => c.side_code === 'corp' && c.type_code === 'identity')!;
    const three = ALL_CARDS.find(c => c.type_code === 'agenda' && (c.agenda_points ?? 0) >= 3)!;
    expect(f.extraRules!(corpId, Array(4).fill(three))).toEqual([]);
    expect(f.extraRules!(corpId, Array(5).fill(three)).join('|')).toMatch(/at most 4/);
  });
});

describe('formatStatuses', () => {
  it('lists every format that bans a card', async () => {
    const { describeFormatStatuses, formatStatuses } = await import('../src/core');
    const card = (title: string) => ALL_CARDS.find(c => c.title === title)!;
    expect(describeFormatStatuses(formatStatuses(card('Cleaver')))).toBe('Banned in Startup, Standard');
    expect(describeFormatStatuses(formatStatuses(card('Seamless Launch')))).toBe('Banned in Startup');
    expect(formatStatuses(card('Sure Gamble'))).toEqual([]);
  });
});
