/**
 * ai-hold-reentry: the saved state (deal 2138, the Corp's first decision of turn 11), in one measurement tree.
 *   ARM=beta|c1|c2|asis [CAP_S=300] npx vite-node scripts/hold-reentry/saved-state.ts
 * Prints the probe's tally every TICK_S seconds while the decision runs (beta does not finish), then the pick and time.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '../../src/core';
import { Arm, Probe, installProbe, makeTrees, treeRoot } from './trees';

const arm = (process.env.ARM ?? 'c2') as Arm;
const file = process.env.STATE ?? 'tests/fixtures/hold-reentry/deal2138-T11-corp.json';
const tick = Number(process.env.TICK_S ?? 15) * 1000;
const t0 = performance.now();
const show = (t: Probe['t']) => JSON.stringify({ ...t, msDeep: Math.round(t.msDeep), msRun: Math.round(t.msRun), routes: Object.entries(t.routes).sort((a, b) => b[1] - a[1]).slice(0, 8) });
const probe = installProbe(new Probe(40, 500, t => console.log(`tick ${Math.round((performance.now() - t0) / 1000)} s ${show({ ...t, sets: probe.sets })}`), tick));

async function main() {
  const dir = makeTrees(treeRoot(`saved-${arm}-${process.pid}`), [arm])[arm];
  const ai = await import(/* @vite-ignore */ join(dir, 'src', 'ai/index.ts'));
  const state: GameState = JSON.parse(readFileSync(file, 'utf8'));
  probe.reset();
  const t = performance.now();
  const pick = ai.createAgent('corp', 'normal').chooseAction(state);
  const ms = performance.now() - t;
  const tally = probe.reset();
  console.log(`done ${arm} ${Math.round(ms)} ms pick ${JSON.stringify(pick)}`);
  console.log(`tally ${show(tally)}`);
}
void main();
