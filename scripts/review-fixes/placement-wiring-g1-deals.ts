/**
 * Bundle P build: the g1, deal by deal (review-fixes-1119/placement-build/brief.md rev 3, "Judged by": every deal that
 * differs has its first differing decision in a class). The reading (placement-wiring-build.ts) asks each decision of the
 * merge base's game with the merge base's agents, so it sees a changed action but not a changed held line: at deal 2321
 * T4 both trees install Marilyn Campaign at remote-4 and only the rest of the turn differs, because c2's line priced the
 * install it then made. This plays each deal on the merge base and on an arm in lockstep, as the g1 does (GameRunner, the
 * arm's own agents, caches kept), and stops at the first step where the move or either agent's kept memory differs. That
 * step is the decision the two games part at; it is read on its own board (the deciding Corp's view, as in the reading).
 *
 *   ARGS="SEEDS=2321,1001 ARMS=c1,head" npx vite-node scripts/review-fixes/placement-wiring-g1-deals.ts
 *   ARGS="G1=base.deals.json,branch.deals.json SHARD=0/4" npx vite-node scripts/review-fixes/placement-wiring-g1-deals.ts
 *
 * Hidden information: the agents are asked only through GameRunner; the class reads the board the Corp decides on with
 * the Corp's own kept line, as the reading's measure does.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dealState } from '../stage-a/harness';
import { Tree, loadTree } from './placement-wiring-trees';
import { BuildArm, hooksOf, makeBuildTrees } from './placement-wiring-build-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/placement-wiring-g1', String(shard));
const ARMS = (process.env.ARMS ?? 'c1,c2,head').split(',') as BuildArm[];
const out = (x: unknown) => console.log(JSON.stringify(x));
const key = (x: unknown) => JSON.stringify(x ?? null);
/** The agent's kept memory between decisions: every field but functions (a Map as its entries). */
const memOf = (agent: any) => JSON.stringify(Object.fromEntries(Object.entries(agent).filter(([, v]) => typeof v !== 'function')), (_k, v) => (v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v));

function seeds(): number[] {
  if (process.env.SEEDS) return process.env.SEEDS.split(',').map(Number);
  const [baseF, branchF] = (process.env.G1 ?? '').split(',');
  const bd = new Map((JSON.parse(readFileSync(baseF, 'utf8')) as any[]).map(d => [d.seed, d]));
  return (JSON.parse(readFileSync(branchF, 'utf8')) as any[])
    .filter(d => bd.has(d.seed) && key([bd.get(d.seed).cr, bd.get(d.seed).sc, bd.get(d.seed).winner]) !== key([d.cr, d.sc, d.winner]))
    .map(d => d.seed);
}

async function main() {
  const dirs = makeBuildTrees(root, ['beta', ...ARMS]);
  const trees: Record<string, Tree> = {};
  const hooks: Record<string, any> = {};
  for (const arm of ['beta', ...ARMS]) {
    trees[arm] = await loadTree(arm, dirs[arm]);
    hooks[arm] = await hooksOf(dirs[arm]);
  }
  const list = seeds();
  for (const [k, seed] of list.entries()) {
    if (k % shards !== shard) continue;
    for (const arm of ARMS) out(lockstep(seed, trees.beta, trees[arm], hooks[arm], hooks.beta));
  }
}

/** The first place two playout logs differ: the playout, its depth, the step, both sides' moves and their waiting-form flags. */
function firstDiff(A: any[], B: any[]) {
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i];
    const y = B[i];
    if (!x || !y) return { p: i, why: x ? 'a playout only the base has' : 'a playout only the arm has', base: x?.first ?? null, arm: y?.first ?? null, baseW: !!x?.w, armW: !!y?.w };
    const xs = [{ a: x.first, w: x.w }, ...x.steps];
    const ys = [{ a: y.first, w: y.w }, ...y.steps];
    for (let j = 0; j < Math.max(xs.length, ys.length); j++)
      if (key(xs[j]?.a) !== key(ys[j]?.a)) return { p: i, d: y.d, step: j, base: xs[j]?.a ?? 'end', arm: ys[j]?.a ?? 'end', baseW: !!xs[j]?.w, armW: !!ys[j]?.w, baseV: x.v, armV: y.v };
    if (x.v !== y.v) return { p: i, d: y.d, step: xs.length, why: 'same steps, different value', base: x.first, arm: y.first, baseV: x.v, armV: y.v, firstW: !!y.w };
  }
  return { same: true, playouts: [A.length, B.length] };
}

function lockstep(seed: number, tb: Tree, ta: Tree, h: any, hb: any) {
  // Each tree keeps its own module caches (as in its own g1 game); both start cleared
  tb.clear();
  ta.clear();
  const ab = { corp: tb.createAgent('corp', 'normal'), runner: tb.createAgent('runner', 'normal') };
  const aa = { corp: ta.createAgent('corp', 'normal'), runner: ta.createAgent('runner', 'normal') };
  const gb = new tb.GameRunner(dealState(seed), ab);
  const ga = new ta.GameRunner(dealState(seed), aa);
  for (let n = 0; n < 4000; n++) {
    const s = gb.state;
    if (key(s) !== key(ga.state)) return { seed, arm: ta.name, n, stop: 'the boards differ before a differing step' };
    const side = tb.core.actingSide(s);
    // The board and the Corp's kept line before the step, kept apart from the games (legality is cached per state object)
    const board = structuredClone(s);
    const held = structuredClone((aa.corp as any).memory?.heldLine ?? null);
    // LOG=<seed>:<step>,...: the two trees' Corp playouts logged at that step (the reading's record patch), first difference kept (M7)
    const logAt = (process.env.LOG ?? '').split(',').some(x => x === `${seed}:${n}`);
    const G = globalThis as any;
    const logged = (g: any, hk: any) => {
      if (!logAt) return { ok: g.step(), log: null };
      Object.assign(G, { __pwLog: [], __pwW: hk.W, __pwS: hk.S, __pwDepth: 0 });
      try {
        return { ok: g.step(), log: G.__pwLog };
      } finally {
        Object.assign(G, { __pwLog: null, __pwW: null, __pwS: null });
      }
    };
    const rb = logged(gb, hb);
    const ra = logged(ga, h);
    const okB = rb.ok;
    const okA = ra.ok;
    if (!okB || !okA) return { seed, arm: ta.name, n, same: okB === okA, end: true };
    const moved = key(gb.last) !== key(ga.last);
    const memC = memOf(ab.corp) !== memOf(aa.corp);
    const memR = memOf(ab.runner) !== memOf(aa.runner);
    if (!moved && !memC && !memR) continue;
    const row: any = { seed, arm: ta.name, n, T: board.turnNumber, side, base: gb.last, armMove: ga.last, moved, corpMemory: memC, runnerMemory: memR };
    if (side === 'corp') {
      const legal = ta.core.getLegalActions(structuredClone(board), 'corp');
      const m = h.measure(structuredClone(board), legal, { held });
      row.s = m.s;
      row.covers = m.c;
      const cover = (a: any) => {
        if (!a || a.type !== 'INSTALL_CARD') return null;
        const at = a.asNewRemote || !a.targetServerId ? 'new' : a.targetServerId;
        return m.c.find((c: any) => (c.form === 'waiting' ? a.cardInstanceId === c.card : a.cardInstanceId === c.pairWith) && at === c.server)?.form ?? null;
      };
      row.coverBase = cover(gb.last);
      row.coverArm = cover(ga.last);
      row.lineBase = (ab.corp as any).memory?.heldLine ?? null;
      row.lineArm = (aa.corp as any).memory?.heldLine ?? null;
      row.planBase = (ab.corp as any).planMemory?.line ?? null;
      row.planArm = (aa.corp as any).planMemory?.line ?? null;
      // M7 through the kept line: each planned step on the board it is planned for, and whether it is a waiting-form cover's install there
      const walk = (after: any, plan: any[] | null, agent: any) => {
        let st = structuredClone(after);
        const steps: any[] = [];
        for (const x of plan ?? []) {
          const lg = ta.core.getLegalActions(structuredClone(st), 'corp');
          const mm = h.measure(structuredClone(st), lg, { held: structuredClone(agent.memory?.heldLine ?? null) });
          const a = x.action;
          const at = a?.type === 'INSTALL_CARD' ? (a.asNewRemote || !a.targetServerId ? 'new' : a.targetServerId) : null;
          steps.push({ a, waiting: !!at && mm.c.some((c: any) => c.form === 'waiting' && c.card === a.cardInstanceId && c.server === at), covers: mm.c.length });
          try {
            st = ta.core.executeAction(st, a);
          } catch {
            steps.push({ stop: 'the planned step is not legal here' });
            break;
          }
        }
        return steps;
      };
      row.walkBase = walk(gb.state, row.planBase, ab.corp);
      row.walkArm = walk(ga.state, row.planArm, aa.corp);
    }
    if (logAt) row.firstLog = firstDiff(rb.log ?? [], ra.log ?? []);
    return row;
  }
  return { seed, arm: ta.name, stop: 'no difference in 4000 steps' };
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
