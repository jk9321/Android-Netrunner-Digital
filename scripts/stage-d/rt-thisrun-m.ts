// Record of the parked trash count (followup2-trash/work-cap-note.md; Jeff 2026-11-18 04:29Z "Park it as known debt"). Run on ai-hold-trash c742520, not on beta.
// Copied from the red team's probes (adversarial/2026-11-18-hold-trash-condition/probes); the -m copies set the
// trash-line probe switch from MODE (exact | inert | line).
// Red-team probe: a 'thisRun' question at Lycian's approach, with an outer trash ice the Runner has already passed (or none).
import { executeAction } from '../../src/core';
import { createCardInstance } from '../../src/core/engine/gameState';
import { serverHold } from '../../src/ai/corp/hold';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { clearCaches } from '../stage-a/harness';
import { installIceForTest, installProgramForTest, newGame, startRunnerTurn } from '../../tests/helpers';
(globalThis as { __trashMode?: string }).__trashMode = process.env.MODE === 'line' ? undefined : process.env.MODE;

for (const outer of [null, '30038', '35041']) for (const credits of [1, 2, 3, 4]) {
  const s = newGame(3);
  s.corp.hq = []; s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.corp.credits = 12; s.turnNumber = 7;
  installIceForTest(s, '34044', 'remote1', false); installIceForTest(s, '34100', 'remote1', false);
  if (outer) installIceForTest(s, outer, 'remote1', true);
  installProgramForTest(s, '30026'); installProgramForTest(s, '30016');
  s.corp.servers.remote1.root.push(createCardInstance(s, '30036'));
  s.runner.credits = credits;
  startRunnerTurn(s);
  const r = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
  const lycian = r.corp.servers.remote1.ice[1].instanceId;
  clearCaches();
  const h = asSide('corp', () => (decisionContext(r, 'corp'), serverHold(r, 'remote1', { when: 'thisRun', from: 1, mustRez: [lycian], further: true })));
  console.log(JSON.stringify({ tree: process.env.TREE, passedOuter: outer ?? '-', credits, clicks: r.runner.clicks, holds: h.holds, need: h.need, budget: h.budget }));
}
