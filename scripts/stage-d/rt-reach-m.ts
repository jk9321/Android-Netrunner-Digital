// Record of the parked trash count (followup2-trash/work-cap-note.md; Jeff 2026-11-18 04:29Z "Park it as known debt"). Run on ai-hold-trash c742520, not on beta.
// Copied from the red team's probes (adversarial/2026-11-18-hold-trash-condition/probes); the -m copies set the
// trash-line probe switch from MODE (exact | inert | line).
// Red-team probe: one server's mode depends on the other servers in a run sequence (turnReach / reachSets).
import { createCardInstance } from '../../src/core/engine/gameState';
import { turnReach } from '../../src/ai/corp/hold';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { clearCaches } from '../stage-a/harness';
import { installIceForTest, installProgramForTest, newGame } from '../../tests/helpers';
(globalThis as { __trashMode?: string }).__trashMode = process.env.MODE === 'line' ? undefined : process.env.MODE;

for (const credits of [1, 2, 3, 4, 6]) {
  const s = newGame(3);
  s.corp.hq = []; s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.corp.credits = 12; s.turnNumber = 7; s.runner.credits = credits;
  const tatu = installIceForTest(s, '34044', 'remote1', false); const lyc = installIceForTest(s, '34100', 'remote1', false);
  s.corp.servers.remote1.root.push(createCardInstance(s, '30036'));
  // remote2: two trash ice the Corp does not rez on this sequence (passed unrezzed, 6.9.2c)
  installIceForTest(s, '35041', 'remote2', false); installIceForTest(s, '34110', 'remote2', false);
  s.corp.servers.remote2.root.push(createCardInstance(s, '30036'));
  installProgramForTest(s, '30026'); installProgramForTest(s, '30016');
  const ask = (servers: string[], sets: string[][]) => { clearCaches(); const st = structuredClone(s); return asSide('corp', () => (decisionContext(st, 'corp'), turnReach(st, servers, sets, 12))).reaches; };
  console.log(JSON.stringify({ tree: process.env.TREE, credits,
    'remote1 alone (rez Tatu-Bola+Lycian)': ask(['remote1'], [[tatu, lyc]]),
    'remote2 (rez nothing) then remote1': ask(['remote2', 'remote1'], [[], [tatu, lyc]]),
    'remote1 then remote2': ask(['remote1', 'remote2'], [[tatu, lyc], []]) }));
}
