// Record of the parked trash count (followup2-trash/work-cap-note.md; Jeff 2026-11-18 04:29Z "Park it as known debt"). Run on ai-hold-trash c742520, not on beta.
// Copied from the red team's probes (adversarial/2026-11-18-hold-trash-condition/probes); the -m copies set the
// trash-line probe switch from MODE (exact | inert | line).
// Red-team probe (adversarial/2026-11-18-hold-trash-condition): Corp decision time on boards the work-cap note did not
// build, on this tree (TREE labels the line). REPS (default 4; the first dropped, median of the rest). ONLY filters.
import { GameState } from '../../src/core';
import { createCardInstance } from '../../src/core/engine/gameState';
import { createAgent } from '../../src/ai';
import { Walk } from '../../src/ai/corp/hold';
import { clearCaches } from '../stage-a/harness';
import { installIceForTest, installProgramForTest, newGame } from '../../tests/helpers';

function board(setup: (s: GameState) => void): GameState {
  const s = newGame(3);
  s.corp.hq = [];
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.runner.credits = 3; s.corp.credits = 12; s.turnNumber = 7; s.runner.maxClicks = 4;
  s.runner.grip = s.runner.grip.slice(0, 5);
  setup(s); return s;
}
const ice = (s: GameState, code: string, rezzed: boolean, server: string) => installIceForTest(s, code, server, rezzed);
const agenda = (s: GameState, server: string) => s.corp.servers[server].root.push(createCardInstance(s, '30036'));
const RIG = ['30026', '30016', '30016', '30015', '30006', '30032', '36004', '30007'];
const rig = (s: GameState, n: number) => { for (const c of RIG.slice(0, n)) installProgramForTest(s, c); };
const boards: { name: string; s: GameState }[] = [];
for (const clicks of [4, 5]) {
  boards.push({ name: `M1 mycoweb: R&D Tatu-Bola, Cloud Eater, Mycoweb, Whitespace (unrezzed); Bumi*, Ansel* on HQ; 8 programs, ${clicks} clicks`, s: board(st => {
    st.runner.maxClicks = clicks; ice(st, '34044', false, 'rd'); ice(st, '34110', false, 'rd'); ice(st, '35053', false, 'rd'); ice(st, '30074', false, 'rd');
    ice(st, '35041', true, 'hq'); ice(st, '30038', true, 'hq'); ice(st, '30072', false, 'remote1'); agenda(st, 'remote1'); st.corp.credits = 25; rig(st, 8);
  }) });
  boards.push({ name: `M2 mycoweb x2: R&D Tatu-Bola, Mycoweb, Mycoweb, Whitespace (unrezzed, no trash ice); Bumi*, Ansel*, Cloud Eater* on HQ; 8 programs, ${clicks} clicks`, s: board(st => {
    st.runner.maxClicks = clicks; ice(st, '34044', false, 'rd'); ice(st, '35053', false, 'rd'); ice(st, '35053', false, 'rd'); ice(st, '30074', false, 'rd');
    ice(st, '35041', true, 'hq'); ice(st, '30038', true, 'hq'); ice(st, '34110', true, 'hq'); ice(st, '30072', false, 'remote1'); agenda(st, 'remote1'); st.corp.credits = 25; rig(st, 8);
  }) });
  boards.push({ name: `M3 mycoweb on remote: remote1 Tatu-Bola, Bumi, Mycoweb (unrezzed) + agenda; Ansel* on HQ; 8 programs, ${clicks} clicks`, s: board(st => {
    st.runner.maxClicks = clicks; ice(st, '34044', false, 'remote1'); ice(st, '35041', false, 'remote1'); ice(st, '35053', false, 'remote1'); agenda(st, 'remote1');
    ice(st, '30038', true, 'hq'); st.corp.credits = 25; rig(st, 8);
  }) });
}
// Count of corpTrash calls per decision (trash events walked), by wrapping the private method
let trashCalls = 0;
const proto = Walk.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
if (proto.corpTrash) { const o = proto.corpTrash; proto.corpTrash = function (this: unknown, ...a: unknown[]) { trashCalls++; return o.apply(this, a); }; }
const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
for (const b of boards) {
  if (process.env.ONLY && !b.name.includes(process.env.ONLY)) continue;
  const ms: number[] = []; let pick = ''; let calls = 0;
  for (let k = 0; k < Number(process.env.REPS ?? 4); k++) {
    clearCaches(); trashCalls = 0;
    const t = performance.now();
    pick = JSON.stringify(createAgent('corp', 'normal').chooseAction(structuredClone(b.s))).slice(0, 80);
    ms.push(performance.now() - t); calls = trashCalls;
  }
  console.log(JSON.stringify({ tree: process.env.TREE, board: b.name, decisionMs: Math.round(med(ms.slice(1))), all: ms.map(Math.round), trashCalls: calls, pick }));
}
