/**
 * ai-rez-set bar, "one game a deal" (build-brief.md, the bar): every deal whose g1 record differs from the base is traced to
 * a changed rez window or its knock-on. Each deal is played twice from its start, by a copy of the branch (`branch`)
 * and by a copy of beta (`base`: the branch with rez-follow-set-arms.json's groups reverted), each its own Corp and
 * Runner (as runner-money-diverge.ts). The first agent call where the two answer differently is printed; then the same
 * call is asked again of both copies on that state with countedRez traced (a text patch on each copy: every countedRez
 * call pushes its board, ice and answer), and the first countedRez call whose answer differs is printed: on the game's
 * own window (depth 0: the board of the call itself) or inside the planner's look-ahead (a board the decision played
 * forward). A first difference with no countedRez difference under it is printed as `untraced` (a stop by the bar).
 *   DEALS=1081,2561 TROOT=.rf-div/0 npx vite-node scripts/stage-d/rez-follow-diverge.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { join, resolve } from 'node:path';
import { dealState } from '../stage-a/harness';
import { makeTrees, readArms } from './runner-money-trees';
import type { CardInstance, GameState } from '../../src/core';

const TRACE: [string, string, string] = [
  'ai/corp/rez.ts',
  "export function countedRez(state: GameState, ice: CardInstance): 'rez' | 'pass' | null {\n",
  "export function countedRez(state: GameState, ice: CardInstance): 'rez' | 'pass' | null {\n  const out = countedRezTraced(state, ice);\n  (globalThis as any).__rezTrace?.push({ s: state, ice: ice.instanceId, out });\n  return out;\n}\nfunction countedRezTraced(state: GameState, ice: CardInstance): 'rez' | 'pass' | null {\n",
];

async function load(dir: string) {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const po = await m('ai/playout.ts');
  const core = await m('core/index.ts');
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const vm = await m('ai/valueModel.ts');
  const iv = await m('ai/iceValues.ts');
  return {
    ai,
    po,
    core,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets();
      iv.clearDeckShares();
      vm.valueLoops?.clear();
    },
  };
}

async function main() {
  process.env.ARMS_FILE ||= 'scripts/stage-d/rez-follow-set-arms.json';
  const file = readArms();
  file.groups.trace = [TRACE];
  file.arms = { branch: ['trace'], base: [...(file.arms.base ?? ['rez', 'saci']), 'trace'] };
  const dirs = makeTrees(file, resolve(process.env.TROOT ?? '.rf-div/trees'));
  const trees: Record<string, Awaited<ReturnType<typeof load>>> = {};
  for (const t of ['branch', 'base']) trees[t] = await load(dirs[t]);
  const seeds = (process.env.DEALS ?? '').split(',').filter(Boolean).map(Number);
  for (const seed of seeds) {
    const logs: Record<string, { side: string; fn: string; T: number; a: string; s: GameState; args: unknown[] }[]> = {};
    for (const t of ['branch', 'base']) {
      const tr = trees[t];
      tr.clear();
      const log: (typeof logs)[string] = (logs[t] = []);
      const wrap = (side: string, inner: object) =>
        new Proxy(inner, {
          get(target, prop, recv) {
            const v = Reflect.get(target, prop, recv);
            if (typeof v !== 'function' || typeof prop !== 'string' || !prop.startsWith('choose')) return v;
            return (...args: unknown[]) => {
              const copy = structuredClone(args);
              const r = v.apply(target, args);
              log.push({ side, fn: prop, T: (copy[0] as GameState).turnNumber, a: JSON.stringify(r), s: copy[0] as GameState, args: copy });
              return r;
            };
          },
        });
      const g = new tr.po.GameRunner(dealState(seed), { corp: wrap('corp', tr.ai.createAgent('corp', 'normal')), runner: wrap('runner', tr.ai.createAgent('runner', 'normal')) });
      for (let k = 0; k < 4000 && g.step(); k++);
    }
    const a = logs.branch;
    const b = logs.base;
    const i = a.findIndex((x, k) => !b[k] || x.a !== b[k].a || x.fn !== b[k].fn);
    if (i < 0) {
      console.log(JSON.stringify({ seed, same: true, n: a.length }));
      continue;
    }
    const x = a[i];
    // The same call again, each copy on its own clone, with countedRez traced
    const traces: Record<string, { s: GameState; ice: string; out: string | null }[]> = {};
    for (const t of ['branch', 'base']) {
      const tr = trees[t];
      // The call's own history matters to the agent (its memory): replay it with a fresh agent from the deal start
      tr.clear();
      const agent = tr.ai.createAgent(x.side, 'normal');
      (globalThis as any).__rezTrace = [];
      try {
        (agent as any)[x.fn](...structuredClone(x.args));
      } catch (e) {
        console.log(JSON.stringify({ seed, error: (e as Error).message }));
      }
      traces[t] = (globalThis as any).__rezTrace;
      (globalThis as any).__rezTrace = undefined;
    }
    const n = Math.min(traces.branch.length, traces.base.length);
    let j = 0;
    while (j < n && traces.branch[j].out === traces.base[j].out && traces.branch[j].ice === traces.base[j].ice) j++;
    const at = j < n ? traces.branch[j] : undefined;
    const sv = at?.s.activeRun ? at.s.corp.servers[at.s.activeRun.server] : undefined;
    const ice = sv?.ice.find((c: CardInstance) => c.instanceId === at!.ice);
    const def = (c: CardInstance) => trees.branch.core.cardDef(c);
    const own = !!at && at.s.turnNumber === x.s.turnNumber && JSON.stringify(at.s.activeRun) === JSON.stringify(x.s.activeRun) && at.s.runner.credits === x.s.runner.credits && at.s.corp.credits === x.s.corp.credits;
    console.log(
      JSON.stringify({
        seed,
        at: i,
        T: x.T,
        side: x.side,
        fn: x.fn,
        branch: x.a.slice(0, 160),
        base: b[i]?.a.slice(0, 160),
        traced: at
          ? {
              depth: own ? 'own window' : 'look-ahead',
              T: at.s.turnNumber,
              server: at.s.activeRun?.server,
              ice: ice ? `${def(ice).title} ${ice.instanceId}` : at.ice,
              rootAgenda: !!sv?.root.some((c: CardInstance) => def(c).type_code === 'agenda'),
              branch: at.out,
              base: traces.base[j].out,
              calls: [traces.branch.length, traces.base.length],
            }
          : 'untraced',
      }),
    );
  }
}
void main();
