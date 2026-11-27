/**
 * Speed pass G0 (addendum-g.md rev 2, section 7; scripts only): lever G, one board per (board object, action), patched
 * into the lockstep's BRANCH tree copy only (core-faults.ts mechanism, FAULT=leverG), never into src. The lockstep then
 * gives, against BASE (the same src without G) and its control arm: first differences (G must make none), time by caller
 * kind with TIMES=1 (scripts/speed-pass/time-sum.mjs), and at the end of each shard the branch tree's G counts: hits by
 * the caller that made the board and the one it was served to, misses by caller, the boards held at a top-level
 * decision's end (peak and total), and a sampled re-execute audit (AUDIT_EVERY, default 64: every 64th hit executed again
 * on its parent and compared with the served board as JSON; bar 2's full-rate whole-state audit comes with the build).
 *
 * The callers that share (addendum section 2): simulate (prompts.ts), the planner's step (turnPlanner.ts), iceFallback and
 * spareAfter (corp/placement.ts), and GameRunner.apply only on a rollout GameRunner (runnerReply's samples and oracle,
 * search.ts), marked `share`. The lockstep's own GameRunners (the real games) never share.
 *
 *   SHARD=0/64 npx vite-node scripts/speed-pass/g0.ts -- POOL=batch,nrdb CORP=1 VALUES=0 TIMES=1 BASE=<full sha of this src>
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { FAULTS } from '../runner-rework/core-faults';
import { HOOKS } from '../runner-rework/core-hooks';
import { gPatches } from './g-patches';

FAULTS.leverG = gPatches();
// Red team finding 6: valueLoops by chain in every tree (named by the tree's directory), to compare with and without G
HOOKS.push(['ai/valueModel.ts', 'export const valueLoops = new Map<string, number>();', 'export const valueLoops = new Map<string, number>();\n((globalThis as any).__vlTrees ??= {})[import.meta.url] = valueLoops;']);
// Each deal's (or human file's) largest held count, after the lockstep's own line for it
const log = console.log;
console.log = (...a: unknown[]) => {
  log(...a);
  const line = a[0];
  const g = (globalThis as any).__g0;
  if (!g || typeof line !== 'string' || !/"kind":"(deal|human)"/.test(line)) return;
  const id = /"seed":(\d+)/.exec(line)?.[1] ?? /"src":"([^"]+)"/.exec(line)?.[1];
  g.dealPeak = Math.max(g.dealPeak, g.held);
  log(JSON.stringify({ kind: 'g0deal', id, heldPeak: g.dealPeak }));
  g.dealPeak = 0;
};
process.env.FAULT ||= 'leverG';
process.on('exit', () => {
  const g = (globalThis as any).__g0;
  if (g) {
    g.heldPeak = Math.max(g.heldPeak, g.held);
    log(JSON.stringify({ kind: 'g0', ...g }));
  }
  const vl = (globalThis as any).__vlTrees ?? {};
  log(JSON.stringify({ kind: 'g0loops', trees: Object.fromEntries(Object.entries(vl).map(([url, m]) => [/\/(base|branch|control)\//.exec(url)?.[1] ?? url, Object.fromEntries(m as Map<string, number>)])) }));
});
// The f117 trees carry D1's rollout line (scripts/f117/lockstep.ts swaps that one hook, then runs core-lockstep)
await import('../f117/lockstep');
