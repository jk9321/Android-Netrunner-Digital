import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { iceCost } from '../src/ai/runs';
import { stealOdds } from '../src/ai/effectValues';
import { outOfReach } from '../src/ai/corpAI';
import { installIceForTest, installProgramForTest, newGame, runnerInstall } from './helpers';

const PALISADE = '30072'; // barrier
const UNITY = '30026'; // decoder: breaks code gates only
const CHROMATOPHORES = '35030'; // host ice gains barrier, code gate and sentry

/** A rezzed Palisade on HQ and a Runner with only a decoder and 10 credits. */
function board(): { s: GameState; ice: string } {
  const s = newGame();
  const ice = installIceForTest(s, PALISADE, 'hq');
  s.corp.servers.hq.ice.find(i => i.instanceId === ice)!.isRezzed = true;
  installProgramForTest(s, UNITY);
  s.runner.credits = 10;
  return { s, ice };
}
const hqIce = (s: GameState, id: string) => s.corp.servers.hq.ice.find(i => i.instanceId === id)!;

// Rules 2.16.5: abilities can add subtypes; the host ice has them, so a decoder can break a barrier hosting Chromatophores.
describe('Corp AI protection counts subtypes gained from Chromatophores (rules 2.16.5)', () => {
  it('a decoder can get through a barrier hosting Chromatophores, and the steal odds rise', () => {
    const { s, ice } = board();
    expect(iceCost(s, hqIce(s, ice))).toBe(Infinity);
    const before = stealOdds(s, 'hq');
    const [after] = runnerInstall(s, CHROMATOPHORES, ice);
    expect(iceCost(after, hqIce(after, ice))).toBeLessThan(5);
    expect(stealOdds(after, 'hq')).toBeGreaterThan(before * 5);
  });

  it('the Corp no longer treats the server as out of the Runner’s reach', () => {
    const { s, ice } = board();
    s.runner.credits = 5; // unbreakable ice counts as 8 credits to get through
    expect(outOfReach(s, s.corp.servers.hq, s.corp.credits)).toBe(true);
    const [after] = runnerInstall(s, CHROMATOPHORES, ice);
    expect(outOfReach(after, after.corp.servers.hq, after.corp.credits)).toBe(false);
  });

  it('also when the Chromatophores host is still unrezzed', () => {
    const { s, ice } = board();
    hqIce(s, ice).isRezzed = false;
    s.runner.credits = 5;
    s.corp.credits = 10; // the Corp can afford the rez, so the ice counts (Jeff)
    expect(outOfReach(s, s.corp.servers.hq, s.corp.credits)).toBe(true);
    const [after] = runnerInstall(s, CHROMATOPHORES, ice);
    expect(outOfReach(after, after.corp.servers.hq, after.corp.credits)).toBe(false);
  });
});
