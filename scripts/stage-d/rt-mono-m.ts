// Record of the parked trash count (followup2-trash/work-cap-note.md; Jeff 2026-11-18 04:29Z "Park it as known debt"). Run on ai-hold-trash c742520, not on beta.
// Copied from the red team's probes (adversarial/2026-11-18-hold-trash-condition/probes); the -m copies set the
// trash-line probe switch from MODE (exact | inert | line).
// Red-team probe: does a second, unaffordable trash ice flip a holding server to "does not hold" under design (iii)?
import { GameState, cardDef } from '../../src/core';
import { createCardInstance } from '../../src/core/engine/gameState';
import { serverHold } from '../../src/ai/corp/hold';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { clearCaches } from '../stage-a/harness';
import { installIceForTest, installProgramForTest, newGame } from '../../tests/helpers';
import { rezCostOf } from '../../src/core';
(globalThis as { __trashMode?: string }).__trashMode = process.env.MODE === 'line' ? undefined : process.env.MODE;

function board(setup: (s: GameState) => void): GameState {
  const s = newGame(3);
  s.corp.hq = [];
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.runner.credits = 0; s.corp.credits = 20; s.turnNumber = 7;
  setup(s); return s;
}
const ice = (s: GameState, code: string, rezzed = true, server = 'remote1') => installIceForTest(s, code, server, rezzed);
const agenda = (s: GameState, server = 'remote1') => s.corp.servers[server].root.push(createCardInstance(s, '30036'));
const ask = (st: GameState, corp: number) => { clearCaches(); const s = structuredClone(st); return asSide('corp', () => (decisionContext(s, 'corp'), serverHold(s, 'remote1', { when: 'runnerTurn', corpCredits: corp }))); };
for (const outer of [null, '35041', '30038', '34110', '30062']) for (const corp of [12, 6]) {
  const s = board(st => {
    ice(st, '34044', false); ice(st, '34100', false);
    if (outer) ice(st, outer, false);
    installProgramForTest(st, '30026'); installProgramForTest(st, '30016');
    st.runner.credits = 1; agenda(st);
  });
  const costs = s.corp.servers.remote1.ice.map(c => `${cardDef(c).title}:${rezCostOf(s, c)}`).join(', ');
  const h = ask(s, corp);
  console.log(JSON.stringify({ tree: process.env.TREE, outer: outer ?? '-', corp, ice: costs, holds: h.holds, rez: h.rez?.length ?? null, need: h.need, budget: h.budget }));
}
