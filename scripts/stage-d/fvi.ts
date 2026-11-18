// Record of the parked trash count (followup2-trash/work-cap-note.md; Jeff 2026-11-18 04:29Z "Park it as known debt"). Run on ai-hold-trash c742520, not on beta.
// Full against inert (rev 3, section 10): every rez set of each built board (gate-time.ts) and each row-21 dump (DIRS),
// own credits and unlimited, by turnReach; run on the trash tree and on an inert tree, OUT= the answers.
import { readFileSync } from 'node:fs';
import { GameState } from '../../src/core';
import { createCardInstance } from '../../src/core/engine/gameState';
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
// ---- full against inert: every rez set of the server's unrezzed ice (turnReach), own credits and unlimited
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { turnReach } from '../../src/ai/corp/hold';
const items: { name: string; server: string; s: GameState }[] = boards.map(b => ({ name: b.name, server: b.server, s: b.s }));
for (const dir of (process.env.DIRS ?? '').split(',').filter(Boolean))
  for (const shard of readdirSync(dir))
    for (const f of readdirSync(join(dir, shard))) {
      const d = JSON.parse(readFileSync(join(dir, shard, f), 'utf8'));
      const t = d.line.ice.join('|');
      if (d.line.label !== 'false does not hold' || !t.includes('Tatu-Bola') || !t.includes('Lycian')) continue;
      items.push({ name: `row21 ${f}`, server: d.server, s: d.state });
    }
const res: Record<string, { reaches: boolean; need: number }> = {};
for (const it of items) {
  const ids = (it.s.corp.servers[it.server]?.ice ?? []).filter(c => !c.isRezzed).map(c => c.instanceId).slice(0, 10);
  for (let m = 0; m < 1 << ids.length; m++) {
    const set = ids.filter((_, i) => m & (1 << i));
    for (const credits of [undefined, Infinity]) {
      clearCaches();
      const st = structuredClone(it.s);
      const r = asSide('corp', () => (decisionContext(st, 'corp'), turnReach(st, [it.server], [set], credits ?? st.corp.credits)));
      res[`${it.name}|${set.join(',')}|${credits ?? 'own'}`] = { reaches: r.reaches, need: r.need };
    }
  }
}
writeFileSync(process.env.OUT!, JSON.stringify(res));
console.log(process.env.TREE, 'items', items.length, 'asks', Object.keys(res).length);
