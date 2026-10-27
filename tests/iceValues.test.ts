import { describe, expect, it } from 'vitest';
import { ICE_STOP, iceWorth } from '../src/ai/iceValues';
import { iceCost } from '../src/ai/runs';
import { installIceForTest, installProgramForTest, newGame } from './helpers';

const PALISADE = '30072'; // barrier, end the run
const CLEAVER = '30006'; // fracter

describe('ice is worth what it costs the Runner to get past (value model step 5)', () => {
  it('a full stop while the Runner has no breaker for it, less once they do', () => {
    const s = newGame();
    installIceForTest(s, PALISADE, 'remote-9');
    const ice = () => s.corp.servers['remote-9'].ice[0];
    expect(iceWorth(s, ice(), 'corp')).toBe(1 + ICE_STOP);
    installProgramForTest(s, CLEAVER);
    expect(iceWorth(s, ice(), 'corp')).toBeCloseTo(1 + iceCost(s, ice()));
    expect(iceWorth(s, ice(), 'corp')).toBeLessThan(1 + ICE_STOP);
  });

  it("unrezzed ice counts only while the Corp can pay to rez it, and the Runner guesses", () => {
    const s = newGame();
    installIceForTest(s, PALISADE, 'remote-9', false);
    const ice = s.corp.servers['remote-9'].ice[0];
    s.corp.credits = 0;
    expect(iceWorth(s, ice, 'corp')).toBe(1);
    s.corp.credits = 10;
    expect(iceWorth(s, ice, 'corp')).toBeCloseTo(1 + 0.6 * ICE_STOP);
    expect(iceWorth(s, ice, 'runner')).toBeCloseTo(1 + iceCost(s, ice));
  });
});

describe('breakers are worth the stops they save (value model step 5b)', () => {
  it('splits 24 across the ice types by the Corp decklist, less late in the game', async () => {
    const { breakerTypeWorth, deckIceShare } = await import('../src/ai/iceValues');
    const s = newGame();
    const share = deckIceShare(s);
    expect(share.barrier + share['code gate'] + share.sentry).toBeCloseTo(1);
    const total = ['barrier', 'code gate', 'sentry'].reduce((n, t) => n + breakerTypeWorth(s, t), 0);
    expect(total).toBeCloseTo(24);
    s.corp.score = 6;
    expect(['barrier', 'code gate', 'sentry'].reduce((n, t) => n + breakerTypeWorth(s, t), 0)).toBeCloseTo(12);
  });
});
