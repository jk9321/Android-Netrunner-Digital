/**
 * Stage D item 1 follow-up 4, part 1 (design answer section 5, the built boards at most 1.30x): the hold count of one
 * server and one Corp decision on the built boards, timed in the base tree (BASE, a checkout of the branch's base) and
 * in this tree (the branch line), median of REPS (default 3) after one warm run, one container.
 *
 * Boards: the trash builder's worst case (found row 21: Bumi, Lycian, Cloud Eater outside Tatu-Bola on remote 6, 5
 * programs, the Corp on 25, the Runner on $3), all unrezzed, with 0 or 2 Side Hustles at 3 credits and Knickknack
 * O'Brian; and the Lightning Laboratory board (ruling 8 (a)): the same rig, the four ice rezzed, Lightning Laboratory
 * scored and its flag set on remote 6 (the turn's end derezzes 2 of the 4: 6 picks).
 *
 *   BASE=<a copy of the base's tree, under this one; default .rm-base> npx vite-node scripts/stage-d/runner-money-build-time.ts
 */
import { join, resolve } from 'node:path';
import { GameState } from '../../src/core';
import { createCardInstance } from '../../src/core/engine/gameState';
import { installIceForTest, installProgramForTest, newGame } from '../../tests/helpers';

const REPS = Number(process.env.REPS ?? 3);
const dirs: Record<string, string> = { base: resolve(process.env.BASE ?? '.rm-base'), branch: resolve('.') };

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

function board(o: { hustles: number; knick: boolean; lightning: boolean; clicks: number }): GameState {
  const s = newGame(3);
  s.corp.hq = [];
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.turnNumber = 9;
  s.corp.credits = 25;
  s.runner.credits = Number(process.env.CREDITS ?? 3);
  s.runner.maxClicks = o.clicks;
  const resource = (code: string, credits = 0) => {
    const c = createCardInstance(s, code);
    c.isRezzed = true;
    if (credits) c.tokens = { ...c.tokens, credit: credits };
    s.runner.rig.resources.push(c);
  };
  for (let k = 0; k < o.hustles; k++) resource('35034', 3);
  if (o.knick) resource('35033');
  for (const code of ['34044', '35041', '34100', '34110']) installIceForTest(s, code, 'remote6', o.lightning);
  if (o.lightning) {
    for (const c of s.corp.servers.remote6.ice) if (c.cardCode === '34100') c.chosenSubtypes = ['barrier'];
    const lab = createCardInstance(s, '34097');
    s.corp.scoreArea.push(lab);
    s.turnFlags[`lightning:${lab.instanceId}`] = Object.keys(s.corp.servers).indexOf('remote6') + 1;
  }
  for (const code of ['30026', '30016', '30016', '30015', '30006']) installProgramForTest(s, code);
  s.runner.grip = s.runner.grip.slice(0, 5);
  s.corp.servers.remote6.root.push(createCardInstance(s, '30036'));
  return s;
}

const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const boards: { name: string; s: GameState }[] = [];
const shapes: [number, boolean, boolean][] = process.env.SHAPES
  ? process.env.SHAPES.split(';').map(x => x.split(',')).map(([h, k, l]) => [Number(h), k === '1', l === '1'])
  : [[0, false, true], [0, false, false], [2, false, false], [0, true, false], [2, true, false]];
for (const [hustles, knick, lightning] of shapes) {
  for (const clicks of [4, 5]) {
    const name = `row 21 rig, ${lightning ? 'Lightning Laboratory flag, 4 ice rezzed' : '4 ice unrezzed'}, ${hustles} Side Hustle${knick ? ', Knickknack' : ''}, ${clicks} clicks, $${process.env.CREDITS ?? 3}`;
    boards.push({ name, s: board({ hustles, knick, lightning, clicks }) });
  }
}
for (const b of boards) {
  const out: Record<string, unknown> = { board: b.name };
  let base = 0;
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
    const ms = med(pick.slice(1));
    if (t === 'base') base = ms;
    out[t] = { holds, holdMs: Math.round(med(hold.slice(1)) * 10) / 10, decisionMs: Math.round(ms), x: base ? Math.round((ms / base) * 100) / 100 : 1, pick: a };
  }
  console.log(JSON.stringify(out));
}
