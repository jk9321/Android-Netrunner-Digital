import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { serverHold } from '../src/ai/corp/hold';
import { inDecision } from './helpers/pricing';
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

// Rewritten in Step 4 Stage C7 against the hold owner (corp/hold.ts serverHold), which replaced the ranking's iceDepth and
// outOfReach: what holds a server is what the Runner can pay on its next turn, not the number of layers
const holds = (s: GameState, corpCredits = s.corp.credits) => inDecision(s, 'corp', () => serverHold(s, 'remote-1', { when: 'runnerTurn', corpCredits }).holds);
describe('agenda exposure by what the Runner can pay (Jeff, 2026-10-29; plan.exposureByCost)', () => {
  it('two layers are no protection against a Runner who can pay for both', () => {
    const { s } = twoLayers(12);
    expect(holds(s)).toBe(false);
  });

  // The owner's budget is the Runner's credits and its next turn's clicks (runnerBudget): a Runner with none on hand
  it('the same ice keeps out a Runner who can’t pay for it with a turn’s income', () => {
    const { s } = twoLayers(0);
    expect(holds(s)).toBe(true);
  });

  it('unrezzed ice counts only while the Corp can pay to rez it', () => {
    const { s, server } = twoLayers(0);
    for (const ice of server.ice) ice.isRezzed = false;
    expect(holds(s, 6)).toBe(true);
    expect(holds(s, 3)).toBe(false);
  });
});
