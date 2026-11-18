// Audit note (unverified): Aircheck locks the Runner's pool during its run. The walk's 'thisRun' credits with Aircheck
// active, before and after runCredits (ai-hold-trash): HQ's Palisade (strength 2, "End the run") approached, Cleaver.
//   npx vite-node scripts/stage-d/aircheck-probe.ts
import { createCardInstance } from '../../src/core/engine/gameState';
import { installIceForTest, installProgramForTest, newGame } from '../../tests/helpers';
import { serverHold, walkStart, firstState } from '../../src/ai/corp/hold';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { availableCredits } from '../../src/core';

for (const [hosted, pool] of [[4, 0], [4, 5], [0, 5]]) {
  const s = newGame(3);
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.corp.credits = 20;
  const pal = installIceForTest(s, '30072', 'hq', true);
  s.corp.servers.hq.ice = s.corp.servers.hq.ice.filter(c => c.instanceId === pal);
  installProgramForTest(s, '30006');
  const a = createCardInstance(s, '36018');
  a.tokens = { credit: hosted };
  s.runner.heap.push(a);
  s.runner.credits = pool;
  s.activePlayer = 'runner';
  s.activeRun = { server: 'hq', phase: 'approach_ice', icePosition: 0, bonusCredits: 0, creditHosts: [a.instanceId], poolLocked: true, runEffects: [], isSuccessful: false } as never;
  const h = asSide('corp', () => (decisionContext(s, 'corp'), serverHold(s, 'hq', { when: 'thisRun' })));
  const ws = firstState(s, walkStart(s, false), 1, 20);
  console.log(`Aircheck ${hosted}, pool ${pool} (locked): engine spends ${availableCredits(s, 'runner')} | walk holds=${h.holds} need=${h.need} budget=${h.budget} | first state hosted=${ws.hosted} stealth=${ws.stealth}`);
}
