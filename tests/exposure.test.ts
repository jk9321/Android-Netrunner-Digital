import { describe, expect, it } from 'vitest';
import { iceDepth, outOfReach } from '../src/ai/corpAI';
import { installIceForTest, installProgramForTest, newGame } from './helpers';

const PALISADE = '30072';
const CLEAVER = '30006';

/** A remote behind two rezzed Palisades (4 strength there) and a Runner with Cleaver: 3 credits each to get through. */
function twoLayers(runnerCredits: number) {
  const s = newGame();
  s.runner.rig.programs = [];
  installProgramForTest(s, CLEAVER);
  s.runner.credits = runnerCredits;
  installIceForTest(s, PALISADE, 'remote-1');
  installIceForTest(s, PALISADE, 'remote-1');
  return { s, server: s.corp.servers['remote-1'] };
}

describe('agenda exposure by what the Runner can pay (Jeff, 2026-10-29; plan.exposureByCost)', () => {
  it('two layers are no protection against a Runner who can pay for both', () => {
    const { s, server } = twoLayers(12);
    expect(iceDepth(s, server)).toBe(2); // the old rule called this safe
    expect(outOfReach(s, server, s.corp.credits)).toBe(false);
  });

  it('the same ice keeps out a Runner who can’t pay for it with a turn’s income', () => {
    const { s, server } = twoLayers(3);
    expect(outOfReach(s, server, s.corp.credits)).toBe(true);
  });

  it('unrezzed ice counts only while the Corp can pay to rez it', () => {
    const { s, server } = twoLayers(3);
    for (const ice of server.ice) ice.isRezzed = false;
    expect(outOfReach(s, server, 6)).toBe(true);
    expect(outOfReach(s, server, 3)).toBe(false);
  });
});
