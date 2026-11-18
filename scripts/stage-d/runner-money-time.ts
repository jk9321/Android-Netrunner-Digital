/**
 * Stage D item 1 follow-up 4, step 1.5 (brief section 2.5): built boards for the arms that add state to the walk
 * (Side Hustle's credits grow by a run, Knickknack's choice at the first run, Arruaceiras's tag and trash). The hold
 * count of one server and one Corp decision, timed in beta (this tree) and in each arm's tree (runner-money-trees.ts,
 * one module graph each), median of REPS (default 3) after one warm run, one container.
 *
 * Boards (the gate-time worst case's shape: every server iced with unrezzed ice, Whitespace outermost, so every run may
 * fail and a retry is walked): 9 servers x 3 unrezzed ice (Whitespace, Palisade, Whitespace), Cleaver and Unity, 4 or 5
 * clicks, $0 or $4; with 0, 1 or 2 Side Hustles at 3 credits, Knickknack O'Brian, Arruaceiras Crew. And the trash builder's
 * worst case (found row 21: Bumi, Lycian, Cloud Eater outside Tatu-Bola, 5 programs), where beta's decision is 1.5 to 2.5 s.
 *
 *   npx vite-node scripts/stage-d/runner-money-time.ts
 */
import { join, resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { GameState } from '../../src/core';
import { createCardInstance } from '../../src/core/engine/gameState';
import { installIceForTest, installProgramForTest, newGame } from '../../tests/helpers';
import { makeTrees, readArms } from './runner-money-trees';

const REPS = Number(process.env.REPS ?? 3);
const file = readArms();
const want = (process.env.ARMS ?? 'runBegin,arru,installed').split(',');
file.arms = Object.fromEntries(Object.entries(file.arms).filter(([a]) => want.includes(a)));
const root = resolve('.rm-time');
const dirs = { beta: resolve('.'), ...makeTrees(file, root) } as Record<string, string>;

interface Tree { hold: (s: GameState, server: string) => boolean; decide: (s: GameState) => string; clear: () => void }
const trees: Record<string, Tree> = {};
for (const [t, dir] of Object.entries(dirs)) {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const hm = await m('ai/corp/hold.ts');
  const pr = await m('ai/pricing.ts');
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const vm = await m('ai/valueModel.ts');
  const iv = await m('ai/iceValues.ts');
  trees[t] = {
    hold: (s, server) => pr.asSide('corp', () => (hv.decisionContext(s, 'corp'), hm.serverHold(s, server, { when: 'runnerTurn', corpCredits: s.corp.credits }).holds)),
    decide: s => JSON.stringify(ai.createAgent('corp', 'normal').chooseAction(s)).slice(0, 70),
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets();
      iv.clearDeckShares();
      vm.valueLoops?.clear();
    },
  };
}

function board(o: { hustles: number; knick: boolean; arru: boolean; clicks: number; credits: number; row21?: boolean }): GameState {
  const s = newGame(3);
  s.corp.hq = [];
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.turnNumber = 9;
  s.corp.credits = 12;
  s.runner.credits = o.credits;
  s.runner.maxClicks = o.clicks;
  if (!o.row21) {
    installProgramForTest(s, '30006');
    installProgramForTest(s, '30026');
  }
  const resource = (code: string, credits = 0) => {
    const c = createCardInstance(s, code);
    c.isRezzed = true;
    if (credits) c.tokens = { ...c.tokens, credit: credits };
    s.runner.rig.resources.push(c);
  };
  for (let k = 0; k < o.hustles; k++) resource('35034', 3);
  if (o.knick) resource('35033');
  if (o.arru) resource('34073');
  if (o.row21) {
    // The trash builder's worst case (ai-hold-trash gate-time, found row 21): Bumi 1.0, Lycian, Cloud Eater outside
    // Tatu-Bola, all unrezzed (16 rez sets), 5 programs (Unity, Marjanah twice, Carmen, Cleaver), the Corp on 25
    s.corp.credits = 25;
    for (const code of ['34044', '35041', '34100', '34110']) installIceForTest(s, code, 'remote6', false);
    for (const code of ['30026', '30016', '30016', '30015', '30006']) installProgramForTest(s, code);
    s.runner.grip = s.runner.grip.slice(0, 5);
    s.corp.servers.remote6.root.push(createCardInstance(s, '30036'));
    return s;
  }
  for (const id of ['hq', 'rd', 'archives', 'remote1', 'remote2', 'remote3', 'remote4', 'remote5', 'remote6']) {
    for (const code of ['30074', '30072', '30074']) installIceForTest(s, code, id, false);
    if (id.startsWith('remote')) s.corp.servers[id].root.push(createCardInstance(s, '30036'));
  }
  return s;
}

const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const boards: { name: string; s: GameState }[] = [];
for (const [hustles, knick, arru] of [[0, false, false], [1, false, false], [2, false, false], [2, true, false], [0, false, true], [2, true, true]] as [number, boolean, boolean][]) {
  for (const clicks of [4, 5]) for (const credits of [0, 4]) {
    boards.push({ name: `9 servers x 3 unrezzed, Cleaver+Unity, ${hustles} Side Hustle${knick ? ', Knickknack' : ''}${arru ? ', Arruaceiras' : ''}, ${clicks} clicks, $${credits}`, s: board({ hustles, knick, arru, clicks, credits }) });
  }
}
const row21 = process.env.ROW21 ? process.env.ROW21.split(';').map(x => x.split(',').map((v, k) => (k ? v === '1' : Number(v)))) : [[0, false, false], [2, true, false], [0, false, true], [2, true, true]];
for (const [hustles, knick, arru] of row21 as [number, boolean, boolean][]) {
  for (const clicks of [4, 5]) {
    boards.push({ name: `row 21 shape: Bumi, Lycian, Cloud Eater outside Tatu-Bola, 5 programs, ${hustles} Side Hustle${knick ? ', Knickknack' : ''}${arru ? ', Arruaceiras' : ''}, ${clicks} clicks, $3`, s: board({ hustles, knick, arru, clicks, credits: 3, row21: true }) });
  }
}
for (const b of boards) {
  if (process.env.ONLY && !b.name.includes(process.env.ONLY)) continue;
  const out: Record<string, unknown> = { board: b.name };
  for (const [t, tree] of Object.entries(trees)) {
    const hold: number[] = [];
    const pick: number[] = [];
    let holds = false;
    let a = '';
    for (let k = 0; k <= REPS; k++) {
      tree.clear();
      let at = performance.now();
      holds = tree.hold(structuredClone(b.s), 'remote6');
      hold.push(performance.now() - at);
      tree.clear();
      at = performance.now();
      a = tree.decide(structuredClone(b.s));
      pick.push(performance.now() - at);
    }
    out[t] = { holds, holdMs: Math.round(med(hold.slice(1)) * 10) / 10, decisionMs: Math.round(med(pick.slice(1))), pick: a };
  }
  console.log(JSON.stringify(out));
}
rmSync(root, { recursive: true, force: true });
