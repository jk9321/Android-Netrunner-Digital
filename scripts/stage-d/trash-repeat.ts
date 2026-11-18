// Is the built worst case's time paid once or by every Corp decision while the board stands (AI Coordinator, the stop
// of 22:48Z, item d)? The board of gate-time's "row 21 worst case ... 5 programs, 4 clicks, $3": the Corp decides,
// it decides again on the board its click for a credit leaves (each decision of play is a new board), the caches kept
// between, as in play: 3 decisions, its clicks 3, 2 and 1. (Playing the pick with executeAction on this hand-built
// board fails in the planner's legality check on both trees, so the next board is made by hand.)
//   TREE=branch npx vite-node scripts/stage-d/trash-repeat.ts
import { GameState } from '../../src/core';
import { createCardInstance } from '../../src/core/engine/gameState';
import { createAgent } from '../../src/ai';
import { clearCaches } from '../stage-a/harness';
import { installIceForTest, installProgramForTest, newGame } from '../../tests/helpers';

const RIG = ['30026', '30016', '30016', '30015', '30006'];
let s: GameState = newGame(3);
s.corp.hq = [];
s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
s.turnNumber = 7;
s.corp.credits = 25;
for (const code of ['34044', '35041', '34100', '34110']) installIceForTest(s, code, 'remote1', false);
for (const code of RIG) installProgramForTest(s, code);
s.runner.grip = s.runner.grip.slice(0, 5);
s.runner.credits = 3;
s.runner.maxClicks = 4;
s.corp.servers.remote1.root.push(createCardInstance(s, '30036'));
clearCaches();
for (let k = 0; k < 3; k++) {
  const t = performance.now();
  const a = createAgent('corp', 'normal').chooseAction(structuredClone(s));
  const ms = Math.round(performance.now() - t);
  console.log(JSON.stringify({ tree: process.env.TREE, decision: k + 1, clicks: s.corp.clicks, credits: s.corp.credits, ms, pick: JSON.stringify(a).slice(0, 70) }));
  s = structuredClone(s);
  s.corp.clicks -= 1;
  s.corp.credits += 1;
}
