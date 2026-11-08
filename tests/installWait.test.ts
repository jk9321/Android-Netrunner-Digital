import { afterEach, describe, expect, it } from 'vitest';
import { corpCardValue } from '../src/ai/evaluate';
import { tuning } from '../src/ai/synergy';
import { createCardInstance, GameState } from '../src/core';
import { newGame } from './helpers';
import { inDecision } from './helpers/pricing';

/**
 * plan.installWait (install-worth side check, 2026-11-08): an unrezzed asset pays nothing until it is rezzed in a rez
 * window (comprehensive rules 5.6.1b, 5.6.2a) and the Runner gets a turn at it first, so as the Corp prices its own board
 * it is worth its rezzed worth after one wait less the rez cost still to pay, with oneCurrency off as well as on.
 */
const REGOLITH = '30071';
const installWaitDefault = tuning.plan.installWait;
afterEach(() => { tuning.plan.installWait = installWaitDefault; });

function regolithOnBoard(rezzed: boolean): { s: GameState; worth: () => number } {
  const s = newGame();
  const card = createCardInstance(s, REGOLITH);
  card.isRezzed = rezzed;
  s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote Server 1', isRemote: true, ice: [], root: [card] };
  return { s, worth: () => inDecision(s, 'corp', () => corpCardValue(card, s, 'corp')) };
}

describe('plan.installWait', () => {
  it('is off by default and leaves oneCurrency off', () => {
    expect(installWaitDefault).toBe(false);
    expect(tuning.plan.oneCurrency).toBe(false);
  });

  it('an unrezzed Regolith is worth less to the Corp with the switch on than off', () => {
    const { worth } = regolithOnBoard(false);
    tuning.plan.installWait = false;
    const off = worth();
    tuning.plan.installWait = true;
    const on = worth();
    expect(on).toBeLessThan(off);
  });

  it('a rezzed Regolith is priced the same either way', () => {
    const { worth } = regolithOnBoard(true);
    tuning.plan.installWait = false;
    const off = worth();
    tuning.plan.installWait = true;
    expect(worth()).toBe(off);
  });

  it('the Runner side does not use it (sideOff.runner)', () => {
    const { s } = regolithOnBoard(false);
    const card = s.corp.servers['remote-1'].root[0];
    const asRunner = () => inDecision(s, 'runner', () => corpCardValue(card, s, 'runner'));
    tuning.plan.installWait = false;
    const off = asRunner();
    tuning.plan.installWait = true;
    expect(asRunner()).toBe(off);
  });
});
