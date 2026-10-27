import { describe, expect, it } from 'vitest';
import { CARD_PROFILES, payoutWorth, turnsLeft, unrezzedWorth } from '../src/ai/cardProfiles';
import { newGame } from './helpers';

const sum = (...terms: number[]) => terms.reduce((a, b) => a + b, 0);

describe('money cards are worth what they will still pay out (value model step 4)', () => {
  it('Nico Campaign: 3 a turn for 3 turns, then a card', () => {
    expect(payoutWorth(CARD_PROFILES['30037'], 8)).toBeCloseTo(sum(3 * 0.85, 3 * 0.85 ** 2, 3 * 0.85 ** 3, 1.6 * 0.85 ** 4));
  });

  it('Regolith Mining License: 3 per click, 2 clicks a turn, the click counted against it', () => {
    expect(payoutWorth(CARD_PROFILES['30071'], 8)).toBeCloseTo(sum(4 * 0.85, 4 * 0.85 ** 2, 2 * 0.85 ** 3));
    // Partly used: only what is left counts
    expect(payoutWorth(CARD_PROFILES['30071'], 8, 6)).toBeCloseTo(sum(4 * 0.85));
  });

  it('Otto Campaign gives its 2 clicks when it empties; Anthill draws with each payout', () => {
    expect(payoutWorth(CARD_PROFILES['35040'], 8)).toBeCloseTo(sum(2 * 0.85, 2 * 0.85 ** 2, 2 * 0.85 ** 3, 2 * 0.85 ** 4));
    expect(payoutWorth(CARD_PROFILES['35072'], 8)).toBeCloseTo(sum(5.6 * 0.85, 5.6 * 0.85 ** 2));
  });

  it('Telework Contract pays once a turn; Open Market 1 a turn', () => {
    expect(payoutWorth(CARD_PROFILES['30027'], 8)).toBeCloseTo(sum(2 * 0.85, 2 * 0.85 ** 2, 2 * 0.85 ** 3));
    expect(payoutWorth(CARD_PROFILES['35022'], 8)).toBeCloseTo(sum(...[1, 2, 3, 4, 5, 6].map(t => 0.85 ** t)));
  });

  it('payouts after the game is likely over count for nothing', () => {
    expect(payoutWorth(CARD_PROFILES['35022'], 2)).toBeCloseTo(0.85 + 0.85 ** 2);
    const s = newGame();
    expect(turnsLeft(s)).toBe(8);
    s.runner.score = 6;
    expect(turnsLeft(s)).toBe(2);
    // Late in the game an unrezzed Nico is barely worth its rez cost
    expect(unrezzedWorth(s, '30037')!).toBeLessThan(unrezzedWorth(newGame(), '30037')!);
  });
});
