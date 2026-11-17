// keepFor's worst case (AI Coordinator 14:32Z): one board, 3 centrals and 6 remotes each with an agenda behind a rezzed
// Palisade outside an unrezzed Whitespace, the Runner with Cleaver; median decision time on this tree (TREE labels the
// line). Run it on beta and on the branch: npx vite-node scripts/stage-d/keep-worst-case.ts
import { GameState } from '../../src/core';
import { createCardInstance } from '../../src/core/engine/gameState';
import { createAgent } from '../../src/ai';
import { rezMoney } from '../../src/ai/corp/rezMoney';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { clearCaches } from '../stage-a/harness';
import { installIceForTest, installProgramForTest, newGame } from '../../tests/helpers';
const AGENDAS = ['30036', '30044', '30052', '30060', '30036', '30044'];
function build(credits: number, clicks: number, remotes: number): GameState {
  const s = newGame(3);
  s.turnNumber = 9;
  s.corp.credits = 12;
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  installProgramForTest(s, '30006'); // Cleaver
  s.runner.credits = credits;
  s.runner.maxClicks = clicks;
  s.corp.hq.push(createCardInstance(s, '30052'));
  for (const id of ['hq', 'rd', 'archives']) { installIceForTest(s, '30074', id, false); installIceForTest(s, '30072', id, true); }
  for (let r = 1; r <= remotes; r++) {
    const sv = `remote${r}`;
    installIceForTest(s, '30074', sv, false);
    installIceForTest(s, '30072', sv, true);
    s.corp.servers[sv].root.push(createCardInstance(s, AGENDAS[r - 1]));
  }
  return s;
}
const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const remotes = Number(process.env.REMOTES ?? 6);
for (const clicks of [4, 5]) for (const credits of [0, 4, 8, 12, 30]) {
  const s = build(credits, clicks, remotes);
  const keepMs: number[] = [], pickMs: number[] = [];
  let keep = 0, staked = 0, pick = '';
  for (let k = 0; k < 4; k++) {
    clearCaches();
    const st = structuredClone(s);
    let t = performance.now();
    const m = asSide('corp', () => (decisionContext(st, 'corp'), rezMoney(st)));
    keepMs.push(performance.now() - t);
    keep = m.keep; staked = Object.keys(m.byServer).length;
    clearCaches();
    t = performance.now();
    pick = JSON.stringify(createAgent('corp', 'normal').chooseAction(structuredClone(s))).slice(0, 70);
    pickMs.push(performance.now() - t);
  }
  console.log(JSON.stringify({ tree: process.env.TREE, clicks, credits, staked, keep, keepMs: Math.round(med(keepMs.slice(1))), decisionMs: Math.round(med(pickMs.slice(1))), pick }));
}
