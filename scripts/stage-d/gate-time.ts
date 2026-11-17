// The failed-run retry's time (design answer of 16:29Z, 6): the hold count and a Corp decision on the boards the retry
// opens on, timed on this tree (TREE labels the line). Run it on beta and on the branch:
//   TREE=beta npx vite-node scripts/stage-d/gate-time.ts
// Boards: the two pins (Ping; human game 49 turn 1, Thunderbolt Armaments), Lycian with Tatu-Bola (found-list row 21),
// three unrezzed ice under Thunderbolt Armaments with 4 clicks, and a built worst case where every rez set holds
// against one run and the retry opens on each (3 centrals and 6 remotes, Whitespace outermost, all ice unrezzed,
// the Runner with Cleaver and $0 to $6: Whitespace ends every run, and its rez is a change the retry reads).
import { readFileSync } from 'node:fs';
import { GameState } from '../../src/core';
import { createCardInstance } from '../../src/core/engine/gameState';
import { createAgent } from '../../src/ai';
import { Walk, serverHold } from '../../src/ai/corp/hold';
import { rezMoney } from '../../src/ai/corp/rezMoney';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { clearCaches } from '../stage-a/harness';
import { installIceForTest, installProgramForTest, newGame } from '../../tests/helpers';

function board(setup: (s: GameState) => void): GameState {
  const s = newGame(3);
  s.corp.hq = [];
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.runner.credits = 0;
  s.corp.credits = 20;
  s.turnNumber = 7;
  setup(s);
  return s;
}
const ice = (s: GameState, code: string, rezzed = true, server = 'remote1') => installIceForTest(s, code, server, rezzed);
const agenda = (s: GameState, server = 'remote1') => s.corp.servers[server].root.push(createCardInstance(s, '30036'));

const boards: { name: string; server: string; corp: number; s: GameState }[] = [];
for (const credits of [10, 4]) {
  boards.push({ name: `pin: Ping outside Lamplighter, Cleaver, $${credits}`, server: 'remote1', corp: 20, s: board(st => {
    ice(st, '35080'); ice(st, '30055', false); installProgramForTest(st, '30006'); st.runner.credits = credits; agenda(st);
  }) });
}
const f = JSON.parse(readFileSync(new URL('../../tests/fixtures/hold-walk/thunderbolt-49-t1-rd.json', import.meta.url), 'utf8')) as { server: string; state: GameState };
boards.push({ name: 'pin: game 49 turn 1, Thunderbolt Armaments, Diviner on R&D', server: f.server, corp: Infinity, s: f.state });
for (const fracters of [1, 2]) {
  boards.push({ name: `row 21: Tatu-Bola inside Lycian, Unity + ${fracters} Marjanah, $1`, server: 'remote1', corp: 12, s: board(st => {
    ice(st, '34044', false); ice(st, '34100', false); installProgramForTest(st, '30026');
    for (let k = 0; k < fracters; k++) installProgramForTest(st, '30016');
    st.runner.credits = 1; st.corp.credits = 12; agenda(st);
  }) });
}
for (const credits of [4, 8, 15]) {
  boards.push({ name: `Thunderbolt: Diviner, Palisade, Whitespace unrezzed, Cleaver, 4 clicks, $${credits}`, server: 'remote1', corp: 20, s: board(st => {
    st.corp.identity = createCardInstance(st, '34096');
    ice(st, '30046', false); ice(st, '30072', false); ice(st, '30074', false);
    installProgramForTest(st, '30006'); st.runner.credits = credits; st.runner.maxClicks = 4; agenda(st);
  }) });
}
// Two ice per server (4 rez sets each), then three (Whitespace outside Palisade outside Whitespace: 8 sets each)
const LAYERS = [['30072', '30074'], ['30074', '30072', '30074']];
for (const layers of LAYERS) for (const clicks of [4, 5]) for (const credits of [0, 4, 6]) {
  boards.push({ name: `worst case: 9 servers x ${layers.length} unrezzed ice, Cleaver, ${clicks} clicks, $${credits}`, server: 'remote6', corp: 12, s: board(st => {
    st.turnNumber = 9; st.corp.credits = 12; installProgramForTest(st, '30006');
    st.runner.credits = credits; st.runner.maxClicks = clicks;
    for (const id of ['hq', 'rd', 'archives', 'remote1', 'remote2', 'remote3', 'remote4', 'remote5', 'remote6']) {
      for (const code of layers) ice(st, code, false, id);
      if (id.startsWith('remote')) agenda(st, id);
    }
  }) });
}
// Found-list row 21's built worst case for time (brief followup2-trash 4): three trash subroutines (Bumi 1.0, Lycian as a
// sentry, Cloud Eater) outside Tatu-Bola, all unrezzed (16 rez sets), and a rig of 5 to 8 programs, two of them the same
// (Unity, Marjanah twice, Carmen, Cleaver, then Mayfly, Corsair, Fermenter), retries on (4 and 5 clicks)
const RIG = ['30026', '30016', '30016', '30015', '30006', '30032', '36004', '30007'];
for (const programs of [5, 8]) for (const clicks of [4, 5]) for (const credits of [3, 8]) {
  boards.push({ name: `row 21 worst case: Bumi, Lycian, Cloud Eater outside Tatu-Bola, ${programs} programs, ${clicks} clicks, $${credits}`, server: 'remote1', corp: 25, s: board(st => {
    st.corp.credits = 25; ice(st, '34044', false); ice(st, '35041', false); ice(st, '34100', false); ice(st, '34110', false);
    for (const code of RIG.slice(0, programs)) installProgramForTest(st, code);
    st.runner.grip = st.runner.grip.slice(0, 5); st.runner.credits = credits; st.runner.maxClicks = clicks; agenda(st);
  }) });
}
// Scaling (AI Coordinator, the stop of 22:48Z, item b): 1, 2 or 3 trash-subroutine ice (Lycian; Cloud Eater; Bumi 1.0)
// outside Tatu-Bola, all unrezzed, by 3, 5 or 8 programs of RIG (every one fits "trash 1 installed program"), 4 clicks
// (retries on), $3
const TRASH_ICE = [['34100'], ['34100', '34110'], ['35041', '34100', '34110']];
for (const trash of TRASH_ICE) for (const programs of [3, 5, 8]) {
  boards.push({ name: `scaling: ${trash.length} trash ice outside Tatu-Bola, ${programs} programs, 4 clicks, $3`, server: 'remote1', corp: 25, s: board(st => {
    st.corp.credits = 25; ice(st, '34044', false);
    for (const code of trash) ice(st, code, false);
    for (const code of RIG.slice(0, programs)) installProgramForTest(st, code);
    st.runner.grip = st.runner.grip.slice(0, 5); st.runner.credits = 3; st.runner.maxClicks = 4; agenda(st);
  }) });
}

// REACH=1: the trash-reach probe's count (trash-reach.mjs) on these boards, against real boards: the most distinct sets of
// trashed cards one walk reaches in the Corp decision, and the walks over 4 (the timings are then not clean)
const reach: Set<string>[] = [];
if (process.env.REACH) {
  const proto = Walk.prototype as unknown as { approach: (ws: { gone: number[] }, j: number, pos: number) => number };
  const original = proto.approach;
  const seen = new WeakMap<object, Set<string>>();
  proto.approach = function (this: object, ws, j, pos) {
    let g = seen.get(this);
    if (!g) {
      seen.set(this, (g = new Set()));
      reach.push(g);
    }
    g.add(String(ws.gone));
    return original.call(this, ws, j, pos);
  };
}
const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const only = process.env.ONLY; // REPS: repetitions per board (default 9; the first is dropped)
for (const b of boards) {
  if (only && !b.name.includes(only)) continue;
  const holdMs: number[] = [], keepMs: number[] = [], pickMs: number[] = [];
  let holds: boolean | undefined, pick = '';
  for (let k = 0; k < Number(process.env.REPS ?? 9); k++) {
    clearCaches();
    let st = structuredClone(b.s);
    let t = performance.now();
    holds = asSide('corp', () => (decisionContext(st, 'corp'), serverHold(st, b.server, { when: 'runnerTurn', corpCredits: b.corp }).holds));
    holdMs.push(performance.now() - t);
    clearCaches();
    st = structuredClone(b.s);
    t = performance.now();
    asSide('corp', () => (decisionContext(st, 'corp'), rezMoney(st)));
    keepMs.push(performance.now() - t);
    clearCaches();
    reach.length = 0;
    t = performance.now();
    pick = JSON.stringify(createAgent('corp', 'normal').chooseAction(structuredClone(b.s))).slice(0, 70);
    pickMs.push(performance.now() - t);
  }
  const r = (v: number[]) => Math.round(med(v.slice(1)) * 10) / 10;
  const sets = process.env.REACH ? { mostSets: Math.max(0, ...reach.map(g => g.size)), walksOver4: reach.filter(g => g.size > 4).length } : {};
  console.log(JSON.stringify({ tree: process.env.TREE, board: b.name, ...sets, holds, holdMs: r(holdMs), rezMoneyMs: r(keepMs), decisionMs: r(pickMs), pick }));
}
