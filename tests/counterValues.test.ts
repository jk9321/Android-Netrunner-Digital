import { describe, expect, it } from 'vitest';
import { CardInstance, GameState } from '../src/core';
import { createCardInstance } from '../src/core/engine/gameState';
import { addCounters, rezCost } from '../src/core/engine/cardEffects';
import { COUNTER_WORTH, counterWorth, countersWorth } from '../src/ai/counterValues';
import { tuning } from '../src/ai/synergy';
import { installIceForTest, newGame, runnerInstall } from './helpers';

const ANSEL = '30038'; // bioroid sentry, rez 6, three subroutines
const make = (s: GameState, code: string): CardInstance => createCardInstance(s, code);
const worth = (code: string, type: 'credit' | 'virus' | 'power' | 'agenda') => {
  const s = newGame();
  return counterWorth(s, make(s, code), type, 'corp');
};

describe('counters are worth what they do on their card (value model step 3)', () => {
  it('prices money counters by how they pay out', () => {
    expect(worth('30071', 'credit')).toBeCloseTo(2 / 3); // Regolith: 3 credits for a click
    expect(worth('30037', 'credit')).toBeCloseTo(0.85); // Nico: paid out free each turn
    expect(worth('35040', 'credit')).toBeCloseTo(0.85); // Otto
    expect(worth('35072', 'credit')).toBeCloseTo(0.85); // Anthill
    expect(worth('35082', 'credit')).toBeCloseTo(0.8); // Mahkota: recurring, rezzes only
    expect(worth('35029', 'credit')).toBeCloseTo(0.8); // Azimat: recurring, trash costs only
    expect(worth('30007', 'virus')).toBeCloseTo(1.75); // Fermenter: 2 each, less a click shared by about 4
  });

  it('values Smartware credits less the more are stacked, since it pays out 1 a turn', () => {
    const s = newGame();
    const smartware = make(s, '30033');
    addCounters(smartware, 'credit', 3);
    const three = countersWorth(s, smartware, 'credit', 'runner');
    expect(three).toBeCloseTo(0.85 + 0.85 ** 2 + 0.85 ** 3);
    addCounters(smartware, 'credit', 3);
    // The next 3 are worth well under the first 3, and under a click for 1 credit each turn
    expect(countersWorth(s, smartware, 'credit', 'runner') - three).toBeLessThan(1.5);
  });

  it('prices effect counters by the effect', () => {
    expect(worth('35051', 'power')).toBe(1.5); // Phật Gioan: 1 net damage each
    expect(worth('35046', 'power')).toBe(1.5); // AU Co.
    expect(worth('35049', 'agenda')).toBe(4); // Sericulture: 2 advancements
    expect(worth('35071', 'agenda')).toBe(3.5); // Off the Books: tutor and free install
    expect(worth('35038', 'agenda')).toBe(3); // Project Ingatan
    expect(worth('35059', 'agenda')).toBe(1.5); // Embedded Reporting
    expect(worth('35060', 'agenda')).toBe(3); // Next Big Thing
    expect(worth('35048', 'agenda')).toBe(3); // Proprionegation
    expect(worth('30008', 'virus')).toBe(0.9); // Leech
    expect(worth('35008', 'virus')).toBe(1); // Hantu
    expect(worth('30024', 'virus')).toBe(1.2); // Conduit
    expect(worth('35031', 'power')).toBe(1.2); // Devadatta Drone
    expect(worth('35010', 'power')).toBe(1.2); // Cacophony
  });

  it('prices trojan counters by their host', () => {
    let s = newGame();
    const ansel = installIceForTest(s, ANSEL, 'remote-9');
    let botulus: string, tranq: string;
    [s, botulus] = runnerInstall(s, '30004', ansel);
    [s, tranq] = runnerInstall(s, '30017', ansel);
    const prog = (id: string) => s.runner.rig.programs.find(c => c.instanceId === id)!;
    // No breaker for Ansel installed: a broken subroutine is worth the 3 cap
    expect(counterWorth(s, prog(botulus), 'virus', 'runner')).toBe(3);
    const ice = s.corp.servers['remote-9'].ice[0];
    const tranqWorth = counterWorth(s, prog(tranq), 'virus', 'runner');
    expect(tranqWorth).toBeCloseTo(ice.isRezzed ? rezCost(s, ice) / 3 : 0.3);
    // A trojan with no host is worth nothing
    expect(counterWorth(s, { ...prog(botulus), hostedOnId: undefined }, 'virus', 'runner')).toBe(0);
  });

  it('every entry is tested above, and switching the piece off restores the step-1 rates', () => {
    expect(Object.keys(COUNTER_WORTH).length).toBe(23);
    const s = newGame();
    const fermenter = make(s, '30007');
    addCounters(fermenter, 'virus', 2);
    tuning.plan.counterEffects.runner = false;
    expect(countersWorth(s, fermenter, 'virus', 'runner')).toBeCloseTo(3);
    tuning.plan.counterEffects.runner = true;
    expect(countersWorth(s, fermenter, 'virus', 'runner')).toBeCloseTo(3.5);
  });
});
