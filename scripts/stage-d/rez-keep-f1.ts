/**
 * Stage D item 3 step 1: exploit pin F1's board (tests/fixtures/adversarial/stage-c-f1-hq-toll-rez.json) and its mirrors,
 * read through rez-keep-lib: the rule, the window, keepRest (rest of this turn, without HQ) and keepNext (rezMoney's keep),
 * and what the agent picks. Mirrors: the Corp richer by 3 (the rez leaves keepRest), and the Runner with no click left
 * after this run (no other server reachable this turn). Both should rez as today under the arm.
 *   npx vite-node scripts/stage-d/rez-keep-f1.ts
 */
import { readFileSync } from 'node:fs';
import { GameState } from '../../src/core';
import { rezMoney } from '../../src/ai/corp/rezMoney';
import { createAgent } from '../../src/ai';
import { rezCandidates } from '../../src/ai/playout';
import { keepRest, restOfTurn, ruleOf, windowOf } from './rez-keep-lib';

const f1: GameState = JSON.parse(readFileSync('tests/fixtures/adversarial/stage-c-f1-hq-toll-rez.json', 'utf8'));
const boards: [string, GameState][] = [
  ['F1', f1],
  ['mirror: Corp +3 credits', { ...f1, corp: { ...f1.corp, credits: f1.corp.credits + 3 } }],
  ['mirror: Runner has no click left', { ...f1, runner: { ...f1.runner, clicks: 0 } }],
];
for (const [name, s] of boards) {
  const run = s.activeRun!;
  const ice = s.corp.servers[run.server].ice[run.icePosition!];
  const w = windowOf(s, ice);
  const rest = keepRest(restOfTurn(s, w.runnerAfter, s.corp.credits - w.rezCost), run.server);
  const pick = createAgent('corp', 'normal').chooseRez!(structuredClone(s), rezCandidates(s, 'approach_ice'));
  const arm = !w.stopsWithFurther && s.corp.credits - w.rezCost < rest.keep && rest.keep > 0;
  console.log(`${name}: rule ${ruleOf(s, ice).rule}, ${w.title} rez ${w.rezCost}, Corp ${s.corp.credits}, Runner ${w.runner} -> ${w.runnerAfter} after the toll, clicks ${w.clicksLeft}; keepRest ${rest.keep} ${JSON.stringify(rest.byServer)}, keepNext ${rezMoney(s).keep}; today ${pick?.type === 'REZ_CARD' ? 'rez' : 'pass'}; arm ${arm ? 'pass' : 'as today'}`);
}
