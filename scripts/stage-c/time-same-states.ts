/**
 * Step 4 Stage C: decision time of the old ranking and the new order on the same recorded states (the time stops:
 * mean 1.15x, p95 1.3x). At each recorded Corp main-phase decision a fresh Corp of each core decides on a copy of the
 * state, caches cleared before each, the order of the two alternating. MODE=normal (planner on, default), nolook
 * (turnPlanner.corp off), rollout (planner: false, counted questions off).
 *   DEALS=1001,1041 MODE=normal npx vite-node scripts/stage-c/time-same-states.ts
 */
import { GameState } from '../../src/core';
import { createAgent } from '../../src/ai';
import { HeuristicCorpAI } from '../../src/ai/corpAI';
import { plan, withPricing } from '../../src/ai/pricing';
import { planWith } from '../../src/ai/synergy';
import { isCorpMain } from '../../src/ai/corp/lines';
import { clearCaches, forEachRecorded } from '../stage-a/harness';

const mode = process.env.MODE ?? 'normal';
const times = { old: [] as number[], new: [] as number[] };
let k = 0;
const decide = (core: 'old' | 'new', s: GameState) => {
  const base = mode === 'nolook' ? planWith(plan(), ['turnPlanner.corp']) : plan();
  const p = { ...base, corpCore: core === 'new', rolloutLines: core === 'new' && process.env.LINES !== '0' };
  return withPricing({ plan: p }, () => {
    const agent = mode === 'rollout' ? new HeuristicCorpAI({ synergy: true, planner: false }) : createAgent('corp', 'normal');
    clearCaches();
    const t = performance.now();
    agent.chooseAction(structuredClone(s));
    times[core].push(performance.now() - t);
  });
};
forEachRecorded({
  decision: d => {
    if (d.kind !== 'action' || !isCorpMain(d.state)) return;
    if (k++ % 2) {
      decide('old', d.state);
      decide('new', d.state);
    } else {
      decide('new', d.state);
      decide('old', d.state);
    }
  },
});
const stat = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, mean: s.reduce((a, b) => a + b, 0) / Math.max(1, s.length), p95: s[Math.floor(0.95 * (s.length - 1))] ?? 0 };
};
const o = stat(times.old);
const n = stat(times.new);
console.log(JSON.stringify({ mode, old: o, new: n, meanRatio: n.mean / o.mean, p95Ratio: n.p95 / o.p95, times }));
