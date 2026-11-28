/**
 * Speed pass lever G, bar 1 with valueLoops (red team finding 6; coordinator 2026-11-28 03:12Z: guardLoop's
 * positionSerial reader stays "leave" only if valueLoops is identical with and without G on the full pool): runs
 * f117/lockstep.ts unchanged (same args), and records valueModel's valueLoops by chain in every tree (base, branch,
 * control), printed at the end of the shard as a `g0loops` line (scripts/speed-pass/g0-sum.mjs reads it).
 *
 *   SHARD=0/64 npx vite-node scripts/speed-pass/g-loops.ts -- POOL=batch,nrdb,human CORP=1 VALUES=0 TIMES=1 BASE=<full sha>
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { HOOKS } from '../runner-rework/core-hooks';

HOOKS.push(['ai/valueModel.ts', 'export const valueLoops = new Map<string, number>();', 'export const valueLoops = new Map<string, number>();\n((globalThis as any).__vlTrees ??= {})[import.meta.url] = valueLoops;']);
process.on('exit', () => {
  const vl = (globalThis as any).__vlTrees ?? {};
  const trees = Object.fromEntries(Object.entries(vl).map(([url, m]) => [/\/(base|branch|control)\//.exec(url)?.[1] ?? url, Object.fromEntries(m as Map<string, number>)]));
  console.log(JSON.stringify({ kind: 'g0loops', trees }));
});
await import('../f117/lockstep');
