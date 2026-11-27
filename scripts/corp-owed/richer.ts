/**
 * Owed count 2 (F116, brief /mnt/project-files/netrunner-ai/owed-counts/brief.md item 2): the Corp against the richer
 * Runner. On the g3 base's deals (the 663 of g3 45717969976, beta e836f26), the source tree (e836f26, unchanged) plays
 * each deal; at every Corp decision (main, prompt, rez) two fresh Normal Corps decide on a copy of the board with the
 * source agent's own fields: `base` (e836f26) and `branch` (49d0409, R-14h's commit 3 = g3 45721179323), caches cleared.
 * A decision is flagged when base's pick installs a card from HQ or rezzes a card and branch's pick is another.
 * At a flagged decision both trees are asked again with the leaf hooks on (the planner's top-level candidates and values,
 * and each candidate's leaf split into evaluate's terms, averaged over every leaf the candidate's reply samples score),
 * and `diag` (e7d8a46: commit 3 with the Runner's 'later' money at today's credits inside the Corp's decision; the bar 5
 * split's diagnostic arm, a diagnostic only) is asked once more: does the flip remain with today's credits.
 *
 * Trees: source (e836f26, no patch: plays, never asked or cleared), base and branch and diag (the hooks below: each only
 * calls a global the script sets). Pools: g3 (scripts/corp-owed/deals-45717969976.json).
 *
 *   SHARD=0/64 npx vite-node scripts/corp-owed/richer.ts -- DEALS=1001 MAX_MS=60000
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Patch, Tree, loadTree, makeTree, rootOf } from './trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity);
const BASE = 'e836f269dfc1196ca3077eacef8767fce84cc005';
const BRANCH = '49d04097a1f9000fdea0fb388520038b3c78048a';
const DIAG = 'e7d8a4655277b246516614445b11f40f46e78bca';
const root = rootOf('richer', shard);
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x > 0 ? 'Inf' : '-Inf');
const G = globalThis as any;

const HOOKS: Patch[] = [
  ['ai/turnPlanner.ts', `import { evaluate } from './evaluate';`, `import { evaluate, sideStrength as __ss, runnerRigValue as __rig, tagsWorth as __tags, handAndClicks as __hc, corpBoardValue as __cb } from './evaluate';\nimport { sideCreditValue as __cr } from './valueModel';`],
  [
    'ai/turnPlanner.ts',
    `      const value = playout(root, side, c.action, ai, line, ends);`,
    `      (globalThis as any).__owCur = c.action;\n      const value = playout(root, side, c.action, ai, line, ends);\n      (globalThis as any).__owCur = undefined;`,
  ],
  [
    'ai/turnPlanner.ts',
    `    const extra = runnerReply(r.ends.state!, synergy, leaf, { from: first, count: REPLY.extra });`,
    `    (globalThis as any).__owCur = r.action;\n    const extra = runnerReply(r.ends.state!, synergy, leaf, { from: first, count: REPLY.extra });\n    (globalThis as any).__owCur = undefined;`,
  ],
  [
    'ai/turnPlanner.ts',
    `    if (side === 'corp' && plan().replyContenders && ai.reply && sampledReply()) best = contenders(scored, side, synergy) ?? best;`,
    `    if (side === 'corp' && plan().replyContenders && ai.reply && sampledReply()) best = contenders(scored, side, synergy) ?? best;\n    (globalThis as any).__owPlan?.(side, scored.map(x => [x.action, x.value]), best?.action, best?.value);`,
  ],
  [
    'ai/turnPlanner.ts',
    `  return withPricing({ leaves: [...pricing().leaves, { side, plan: plan() }] }, () => evaluate(state, side));`,
    `  return withPricing({ leaves: [...pricing().leaves, { side, plan: plan() }] }, () => {
    const __v = evaluate(state, side);
    const __g = globalThis as any;
    if (__g.__owLeaf && __g.__owCur && side === 'corp' && !state.winner) {
      const cCr = __cr(state, 'corp', 'corp');
      const cHand = __hc(state, 'corp', 'corp');
      const cBoard = __cb(state, 'corp');
      const cAll = __ss(state, 'corp', 'corp');
      const rCr = __cr(state, 'runner', 'corp');
      const rHand = __hc(state, 'runner', 'corp');
      const rTags = __tags(state, 'corp');
      const rRig = __rig(state);
      const rAll = __ss(state, 'runner', 'corp');
      __g.__owLeaf(__g.__owCur, { v: __v, cCredits: cCr, cHand, cBoard, cRest: cAll - cCr - cHand - cBoard, rCredits: rCr, rHand, rTags, rRig, rRest: rAll - rCr - rHand + rTags - rRig, rc: state.runner.credits, rt: state.runner.tags });
    }
    return __v;
  });`,
  ],
];

type Name = 'source' | 'base' | 'branch' | 'diag';
let T: Record<Name, Tree>;

const classInstance = (v: any) => v && typeof v === 'object' && !(v instanceof Map) && !(v instanceof Set) && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype;
function copyFields(from: any, to: any) {
  for (const k of Object.keys(from)) {
    const v = from[k];
    if (typeof v === 'function') continue;
    if (classInstance(v) && to[k] && typeof to[k] === 'object') Object.assign(to[k], structuredClone({ ...v }));
    else to[k] = structuredClone(v);
  }
}
const pickKey = (a: unknown): string => {
  if (a === null || a === undefined) return 'null';
  const sort = (x: any): any => (Array.isArray(x) ? x.map(sort) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])])) : x);
  return JSON.stringify(sort(a));
};
type Method = 'chooseAction' | 'chooseRez' | 'chooseOffTurn';
function ask(t: Tree, method: Method, s: GameState, rest: unknown[], from: any): { a: unknown; key: string; ms: number } {
  t.clear();
  const agent: any = t.ai.createAgent('corp', 'normal');
  copyFields(from, agent);
  const st = structuredClone(s);
  const t0 = performance.now();
  try {
    const a = agent[method](st, ...structuredClone(rest));
    return { a, key: pickKey(a), ms: performance.now() - t0 };
  } catch (e) {
    return { a: null, key: `error: ${(e as Error).message.slice(0, 100)}`, ms: performance.now() - t0 };
  }
}

const PARTS = ['v', 'cCredits', 'cHand', 'cBoard', 'cRest', 'rCredits', 'rHand', 'rTags', 'rRig', 'rRest', 'rc', 'rt'] as const;
/** Asked with the leaf hooks on: the top-level candidates' values and each candidate's mean leaf parts. */
function askLeaves(t: Tree, method: Method, s: GameState, rest: unknown[], from: any) {
  const leaves = new Map<string, { n: number; sum: Record<string, number> }>();
  const plans: { scored: [string, number][]; best: string; value: number }[] = [];
  G.__owLeaf = (cur: unknown, p: Record<string, number>) => {
    const k = pickKey(cur);
    const e = leaves.get(k) ?? { n: 0, sum: Object.fromEntries(PARTS.map(x => [x, 0])) };
    e.n++;
    for (const x of PARTS) e.sum[x] += p[x];
    leaves.set(k, e);
  };
  G.__owPlan = (side: string, scored: [unknown, number][], best: unknown, value: number) => side === 'corp' && plans.push({ scored: scored.map(([a, v]) => [pickKey(a), v]), best: pickKey(best), value });
  try {
    const r = ask(t, method, s, rest, from);
    return { ...r, plans, leaves: Object.fromEntries([...leaves].map(([k, e]) => [k, { n: e.n, ...Object.fromEntries(PARTS.map(x => [x, r3(e.sum[x] / e.n)])) }])) };
  } finally {
    G.__owLeaf = G.__owPlan = undefined;
  }
}

function describe(s: GameState, a: any): { type: string; card?: string; type_code?: string; fromHQ?: boolean; server?: string } {
  if (!a) return { type: 'null' };
  if (typeof a === 'string') {
    const c = T.source.core.findCardAnywhere(s, a);
    return { type: 'REZ', card: c ? T.source.core.getCardDefinition(c.cardCode).title : a, type_code: c ? T.source.core.getCardDefinition(c.cardCode).type_code : undefined };
  }
  if (a.type === 'REZ_CARD' || a.cardInstanceId) {
    const c = T.source.core.findCardAnywhere(s, a.cardInstanceId);
    const def = c ? T.source.core.getCardDefinition(c.cardCode) : null;
    return { type: a.type, card: def?.title, type_code: def?.type_code, fromHQ: !!s.corp.hq.find((x: any) => x.instanceId === a.cardInstanceId), server: a.targetServerId };
  }
  return { type: a.type, server: a.targetServerId };
}
/** Base's pick installs from HQ or rezzes, and branch's pick is another. */
const installOrRez = (s: GameState, a: any): boolean => {
  if (!a) return false;
  if (typeof a === 'string') return true; // chooseRez answers a card id
  if (a.type === 'REZ_CARD') return true;
  return a.type === 'INSTALL_CARD' && s.corp.hq.some((x: any) => x.instanceId === a.cardInstanceId);
};

type Deal = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(t: Tree, d: Deal): GameState {
  const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck);
  const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck);
  if (!c || !r) throw new Error(`deal ${d.seed}: deck not found`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r));
}
const key = (a: unknown) => JSON.stringify(a ?? null);

function deal(gi: number, d: Deal) {
  const t0 = performance.now();
  const S = T.source;
  S.clear();
  const counts: Record<string, number> = {};
  const inc = (k: string) => void (counts[k] = (counts[k] ?? 0) + 1);
  const ms = { base: 0, branch: 0 };
  let di = 0;
  const corp = S.ai.createAgent('corp', 'normal');
  const watched = new Proxy(corp, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (prop !== 'chooseAction' && prop !== 'chooseRez') return v;
      return (s: GameState, ...rest: unknown[]) => {
        const method = prop as Method;
        const i = di++;
        const kind = method === 'chooseRez' ? 'rez' : s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main';
        const b = ask(T.base, method, s, rest, target);
        const r = ask(T.branch, method, s, rest, target);
        ms.base += b.ms;
        ms.branch += r.ms;
        inc(`n ${kind}`);
        if (b.key !== r.key) inc(`differ ${kind}`);
        const own = v.apply(target, [s, ...rest]);
        if (pickKey(own) !== b.key) inc(`sourceDiffers ${kind}`);
        if (b.key !== r.key && installOrRez(s, b.a)) {
          inc(`flag ${kind}`);
          const bl = askLeaves(T.base, method, s, rest, target);
          const rl = askLeaves(T.branch, method, s, rest, target);
          const dg = ask(T.diag, method, s, rest, target);
          out({
            kind: 'f',
            gi,
            seed: d.seed,
            corpDeck: d.corpDeck,
            runnerDeck: d.runnerDeck,
            i,
            T: s.turnNumber,
            dk: kind,
            board: { cc: s.corp.credits, ck: s.corp.clicks, rc: s.runner.credits, rk: s.runner.clicks, rt: s.runner.tags, cs: s.corp.score, rs: s.runner.score, hq: s.corp.hq.length },
            base: { pick: b.key, what: describe(s, b.a) },
            branch: { pick: r.key, what: describe(s, r.a) },
            diag: { pick: dg.key, what: describe(s, dg.a), asBase: dg.key === b.key, asBranch: dg.key === r.key },
            replay: { base: bl.key === b.key, branch: rl.key === r.key },
            plans: { base: bl.plans, branch: rl.plans },
            leaves: { base: bl.leaves, branch: rl.leaves },
          });
        }
        return own;
      };
    },
  });
  const run = new S.po.GameRunner(dealStateOf(S, d), { corp: watched, runner: S.ai.createAgent('runner', 'normal') });
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  for (let n = 0; n < 6000; n++) {
    const s: GameState = run.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    if (!run.step()) break;
  }
  const matches = (run.state.winner ?? null) === d.winner && key(cr) === key(d.cr) && key(sc) === key(d.sc);
  out({ kind: 'g', gi, seed: d.seed, corpDeck: d.corpDeck, runnerDeck: d.runnerDeck, decisions: di, counts, matches, winner: run.state.winner ?? null, ms: { base: Math.round(ms.base), branch: Math.round(ms.branch), all: Math.round(performance.now() - t0) } });
}

async function main() {
  const t = { source: [], base: HOOKS, branch: HOOKS, diag: HOOKS } as Record<Name, Patch[]>;
  const refs: Record<Name, string> = { source: BASE, base: BASE, branch: BRANCH, diag: DIAG };
  T = {} as Record<Name, Tree>;
  for (const n of ['source', 'base', 'branch', 'diag'] as Name[]) T[n] = await loadTree(n, makeTree(join(root, n), { ref: refs[n], patches: t[n] }));
  const deals: Deal[] = JSON.parse(readFileSync('scripts/corp-owed/deals-45717969976.json', 'utf8'));
  const started = Date.now();
  for (let gi = shard; gi < deals.length; gi += shards) {
    if (DEALS.length && !DEALS.includes(String(deals[gi].seed))) continue;
    if (Date.now() - started > MAX_MS) break;
    try {
      deal(gi, deals[gi]);
    } catch (e) {
      out({ kind: 'err', gi, seed: deals[gi].seed, error: (e as Error).stack?.slice(0, 500) });
    }
  }
  out({ kind: 's', shard, ms: Date.now() - started });
  if (process.env.OUT_DIR) writeFileSync(join(process.env.OUT_DIR, `done-${shard}.txt`), 'ok');
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
