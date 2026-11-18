// Stage D item 1 follow-up 4, part 1: the one-game check's trace: play a deal in the branch tree and in the base tree (each its own Corp and Runner), log every agent call, print the first difference.
//   DEALS=1071,2411 ARMS_FILE=scripts/stage-d/runner-money-base.json TROOT=.rm-trace/t0 npx vite-node scripts/stage-d/runner-money-diverge.ts
// One line per deal: the first agent call where the two trees answer differently, the groups in play and the Runner's rig.
import { join, resolve } from 'node:path';
import { dealState } from '../stage-a/harness';
import { makeTrees, present, readArms } from './runner-money-trees';
import type { GameState } from '../../src/core';

async function load(dir: string) {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const po = await m('ai/playout.ts');
  const hv = await m('ai/handValues.ts'); const ev = await m('ai/effectValues.ts'); const vm = await m('ai/valueModel.ts'); const iv = await m('ai/iceValues.ts');
  return { ai, po, clear: () => { hv.clearHandCaches(); ev.clearDamageThreats(); vm.clearBuildTargets(); iv.clearDeckShares(); vm.valueLoops?.clear(); } };
}
async function main() {
  const file = readArms();
  const dirs = { branch: resolve('.'), ...makeTrees(file, resolve(process.env.TROOT ?? '.rm-trace/trees')) } as Record<string, string>;
  const seeds = (process.env.DEALS ?? '').split(',').map(Number);
  const trees: Record<string, Awaited<ReturnType<typeof load>>> = {};
  for (const t of ['branch', 'base']) trees[t] = await load(dirs[t]);
  for (const seed of seeds) {
    const logs: Record<string, { side: string; fn: string; T: number; a: string; s: GameState }[]> = {};
    for (const t of ['branch', 'base']) {
      const tr = trees[t];
      tr.clear();
      const log: typeof logs[string] = (logs[t] = []);
      const wrap = (side: string, inner: object) => new Proxy(inner, { get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (typeof v !== 'function' || typeof prop !== 'string' || !prop.startsWith('choose')) return v;
        return (...args: unknown[]) => { const s = structuredClone(args[0] as GameState); const r = v.apply(target, args); log.push({ side, fn: prop, T: s.turnNumber, a: JSON.stringify(r), s }); return r; };
      } });
      const g = new tr.po.GameRunner(dealState(seed), { corp: wrap('corp', tr.ai.createAgent('corp', 'normal')), runner: wrap('runner', tr.ai.createAgent('runner', 'normal')) });
      for (let k = 0; k < 4000 && g.step(); k++);
    }
    const a = logs.branch, b = logs.base;
    const i = a.findIndex((x, k) => !b[k] || x.a !== b[k].a || x.fn !== b[k].fn);
    if (i < 0) { console.log(JSON.stringify({ seed, same: true, n: a.length })); continue; }
    const x = a[i], y = b[i];
    const p = present(x.s);
    const rig = [...x.s.runner.rig.resources, ...x.s.runner.rig.hardware].map(c => c.cardCode);
    console.log(JSON.stringify({ seed, at: i, T: x.T, side: x.side, fn: x.fn, active: x.s.activePlayer, run: x.s.activeRun?.serverId ?? null, groups: Object.entries(p).filter(([k, v]) => k !== 'known' && v === true).map(([k]) => k), rig, credits: x.s.runner.credits, branch: x.a, base: y?.a, baseFn: y?.fn }));
  }
}
void main();
