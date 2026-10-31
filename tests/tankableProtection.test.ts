import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { iceCost } from '../src/ai/runs';
import { iceDepth, protectionCost } from '../src/ai/corpAI';
import { installIceForTest, installProgramForTest, newGame } from './helpers';

const DOOMSCROLL = '35063'; // tag, 1 net damage, 2 net damage at 2+ tags: nothing ends the run
const PALISADE = '30072'; // barrier, end the run
const CLEAVER = '30006'; // fracter

/** Rezzed Doomscroll inside a rezzed Palisade on HQ; the Runner has a fracter, no killer. */
function board(): { s: GameState; doom: string } {
  const s = newGame();
  const doom = installIceForTest(s, DOOMSCROLL, 'hq');
  installIceForTest(s, PALISADE, 'hq');
  s.corp.servers.hq.ice.forEach(i => (i.isRezzed = true));
  installProgramForTest(s, CLEAVER);
  s.runner.credits = 12;
  return { s, doom };
}
const ice = (s: GameState, id: string) => s.corp.servers.hq.ice.find(i => i.instanceId === id)!;

// Jeff 2026-10-31: a Runner with credits and cards clears the tag, draws past the damage and runs anyway.
describe('ice the Runner can take is no agenda protection (plan.tankProtection)', () => {
  it('Doomscroll the Runner can take counts as no layer of ice', () => {
    const { s, doom } = board();
    expect(iceCost(s, ice(s, doom))).toBeGreaterThan(3); // still costly to take
    expect(protectionCost(s, ice(s, doom))).toBe(0);
    expect(iceDepth(s, s.corp.servers.hq)).toBe(0); // Palisade is cheap to break too
  });

  it('Doomscroll still protects when its damage would flatline the Runner', () => {
    const { s, doom } = board();
    s.runner.grip.splice(1); // 1 card: the net damage ends the game
    expect(protectionCost(s, ice(s, doom))).toBeGreaterThan(3);
    expect(iceDepth(s, s.corp.servers.hq)).toBeGreaterThanOrEqual(1);
  });

  it('run-ending ice the Runner cannot break still counts in full', () => {
    const s = newGame();
    const wall = installIceForTest(s, PALISADE, 'hq');
    ice(s, wall).isRezzed = true;
    s.runner.credits = 12;
    expect(protectionCost(s, ice(s, wall))).toBe(iceCost(s, ice(s, wall)));
    expect(iceDepth(s, s.corp.servers.hq)).toBe(1);
  });
});
