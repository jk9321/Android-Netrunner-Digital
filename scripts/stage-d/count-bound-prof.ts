/**
 * The count bound item, step 2 (brief: /mnt/project-files/netrunner-ai/stage-d/count-bound/brief-2.md), Part E: where
 * the time outside the hold count goes, on the slow Corp decisions of the first count (count-bound-slow.json: every
 * decision of 0.5 s or more in ai-script 44459518787, by base, slowest first; the first 50 flagged).
 *
 * The sources are reached as count-bound.ts reaches them (deals played whole by the `source` tree, human games
 * replayed; the same units, so the same shards hold the same decisions). At each listed decision, three asks:
 *   1. `base`, unprofiled: the control time and answer;
 *   2. `base` under the V8 sampling profiler (node:inspector, 100 us): every sample classed by its stack into a phase
 *      (before the look-ahead, the look-ahead and inside it the playouts' own Corp, the leaf and the Runner's reply,
 *      after the pick) and a kind (hold count, engine, structuredClone, valuation, GC, other), and self time per
 *      function summed over the shard;
 *   3. `cnt` (count-bound-lib.ts CNT patches): candidates, playouts, actions per playout, reply samples and steps, and
 *      the work repeated within the decision by a content fingerprint of the board (engine actions, legality, the
 *      leaf, the Corp's order, the Runner agent's decision, playouts, reply samples), with the time of each repeat.
 * The answers of 2 and 3 are checked against 1 (a difference is a stop).
 *
 *   SHARD=0/64 npx vite-node scripts/stage-d/count-bound-prof.ts
 *   DEALS=1001 HUMAN=none ONLY=20 npx vite-node scripts/stage-d/count-bound-prof.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { Session } from 'node:inspector';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { deals, dealState, humanFiles } from '../stage-a/harness';
import { Tree, ask, askAt, key, loadTree, makeTrees, out, r1 } from './count-bound-lib';

for (const kv of (process.env.ARGS ?? '').split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const CHUNK = Number(process.env.CHUNK ?? 12);
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const ONLY = Number(process.env.ONLY ?? 0); // only the first N of the list (local tries)
const INTERVAL = Number(process.env.INTERVAL ?? 100);
const SAVE = Number(process.env.SAVE ?? 20); // .cpuprofile files kept for the N slowest

const list: [string, number, number, number][] = JSON.parse(readFileSync('scripts/stage-d/count-bound-slow.json', 'utf8'));
const wanted = new Map<string, { rank: number; recorded: number }>();
for (const [k, [src, i, ms]] of list.entries()) if (!ONLY || k < ONLY) wanted.set(`${src}#${i}`, { rank: k, recorded: ms });

// ------------------------------------------------------------------------------------------------ fingerprints and counts
const fps = new WeakMap<object, string>();
const fp = (s: any): string => {
  let f = fps.get(s);
  if (f === undefined) {
    f = createHash('md5').update(JSON.stringify(s, (k, v) => (k === 'log' ? undefined : v))).digest('hex');
    fps.set(s, f);
  }
  return f;
};
type Rep = { calls: number; repeats: number; ms: number; repeatMs: number };
const rep = (): Rep => ({ calls: 0, repeats: 0, ms: 0, repeatMs: 0 });
const cp: any = {
  on: false,
  reset() {
    this.c = { candidates: 0, plans: 0, playouts: 0, psteps: 0, replies: 0, rsteps: 0, legalCalls: 0, legalMiss: 0, legalMissSeen: 0, isLegalCalls: 0, isLegalMiss: 0, isLegalMissSeen: 0 };
    this.r = { exec: rep(), leaf: rep(), rank: rep(), runner: rep(), playout: rep(), reply: rep() };
    this.seen = { exec: new Set(), leaf: new Set(), rank: new Set(), runner: new Set(), playout: new Set(), reply: new Set(), legal: new Set(), isLegal: new Set() };
    this.depth = 0;
  },
  timed(kind: string, k: string, f: () => any, top = true) {
    const r: Rep = this.r[kind];
    r.calls++;
    const again = this.seen[kind].has(k);
    if (again) r.repeats++;
    else this.seen[kind].add(k);
    if (!top) return f();
    const t = performance.now();
    try {
      return f();
    } finally {
      const ms = performance.now() - t;
      r.ms += ms;
      if (again) r.repeatMs += ms;
    }
  },
  exec(s: any, a: any, f: () => any) {
    if (!this.on) return f();
    const top = this.depth === 0;
    this.depth++;
    try {
      return this.timed('exec', `${fp(s)}|${JSON.stringify(a)}`, f, top);
    } finally {
      this.depth--;
    }
  },
  leaf(s: any, side: string, f: () => any) {
    return this.on ? this.timed('leaf', `${fp(s)}|${side}`, f) : f();
  },
  rank(s: any, held: any, f: () => any) {
    return this.on ? this.timed('rank', `${fp(s)}|${JSON.stringify(held)}`, f) : f();
  },
  runner(s: any, f: () => any) {
    return this.on ? this.timed('runner', fp(s), f) : f();
  },
  plan(n: number) {
    if (!this.on) return;
    this.c.plans++;
    this.c.candidates += n;
  },
  playout(s: any, first: any, mode: string) {
    if (!this.on) return;
    this.r.playout.calls++;
    const k = `${fp(s)}|${JSON.stringify(first)}|${mode}`;
    if (this.seen.playout.has(k)) this.r.playout.repeats++;
    else this.seen.playout.add(k);
    this.c.playouts++;
  },
  pstep() {
    if (this.on) this.c.psteps++;
  },
  reply(s: any, k: number) {
    if (!this.on) return;
    this.r.reply.calls++;
    const id = `${fp(s)}|${k}`;
    if (this.seen.reply.has(id)) this.r.reply.repeats++;
    else this.seen.reply.add(id);
    this.c.replies++;
  },
  rstep() {
    if (this.on) this.c.rsteps++;
  },
  legal(s: any, side: string, hit: boolean) {
    if (!this.on) return;
    this.c.legalCalls++;
    if (hit) return;
    this.c.legalMiss++;
    const k = `${fp(s)}|${side}`;
    if (this.seen.legal.has(k)) this.c.legalMissSeen++;
    else this.seen.legal.add(k);
  },
  isLegal(s: any, a: string, hit: boolean) {
    if (!this.on) return;
    this.c.isLegalCalls++;
    if (hit) return;
    this.c.isLegalMiss++;
    const k = `${fp(s)}|${a}`;
    if (this.seen.isLegal.has(k)) this.c.isLegalMissSeen++;
    else this.seen.isLegal.add(k);
  },
};
(globalThis as any).__cp = cp;

// ------------------------------------------------------------------------------------------------ the profiler
const session = new Session();
session.connect();
const post = (method: string, params?: object): any => {
  let res: any;
  let err: any;
  session.post(method, params ?? {}, (e: any, r: any) => {
    err = e;
    res = r;
  });
  if (err) throw err;
  if (res === undefined) throw new Error(`inspector ${method}: no synchronous answer`);
  return res;
};
post('Profiler.enable');
post('Profiler.setSamplingInterval', { interval: INTERVAL });

const VAL = /\/src\/ai\/(evaluate|valueModel|handValues|effectValues|cardValues|iceValues|counterValues|synergy|synergyTags|pricing|payoutRisk|cardProfiles|cardPlans)\.ts/;
const fileOf = (url: string) => {
  const m = url.match(/\/src\/(.*)$/);
  return m ? m[1].replace(/\?.*$/, '') : url ? url.split('/').pop()! : '';
};
type Cls = { phase: string; kind: string; exec: boolean; legal: boolean; view: boolean; self: string };
function classify(path: any[]): Cls {
  const has = (n: string) => path.some(f => f.functionName === n);
  const fn = path[path.length - 1];
  const self = `${fn.functionName || '(anonymous)'} ${fileOf(fn.url)}${fn.url ? `:${fn.lineNumber + 1}` : ''}`;
  const url = fn.url as string;
  const kind = path.some(f => /\/src\/ai\/corp\/hold\.ts/.test(f.url))
    ? 'hold'
    : fn.functionName === '(garbage collector)'
      ? 'gc'
      : fn.functionName === 'structuredClone'
        ? 'clone'
        : /\/src\/core\//.test(url)
          ? 'engine'
          : VAL.test(url)
            ? 'valuation'
            : 'other';
  let phase: string;
  if (has('planTurn')) {
    const ri = path.findIndex(f => f.functionName === 'runnerReply');
    if (ri >= 0) {
      const inner = path.slice(ri + 1);
      let agent = '';
      for (const f of inner) {
        if (/\/src\/ai\/runnerAI\.ts/.test(f.url)) agent = 'runner';
        else if (/\/src\/ai\/corpAI\.ts/.test(f.url)) agent = 'corp';
      }
      phase = inner.some(f => f.functionName === 'leafValue') ? 'reply.leaf' : agent ? `reply.${agent}` : inner.some(f => f.functionName === 'executeAction') ? 'reply.engine' : inner.some(f => f.functionName === 'guessHidden') ? 'reply.deal' : 'reply.other';
    } else if (has('leafValue')) phase = 'look.leaf';
    else if (has('playout')) phase = has('rankMainActions') ? 'look.corp.order' : has('scoreInTwoPick') || has('lineAsk') ? 'look.corp.line' : has('chooseAction') ? 'look.corp.answer' : has('executeAction') ? 'look.corp.engine' : 'look.corp.other';
    else phase = 'look.setup';
  } else if (has('moneyPick') || has('keepsScore') || has('scoreInTwoPick')) phase = 'after';
  else if (has('lineStep') || has('heldLaterStep')) phase = 'before.line';
  else if (has('winNowAction') || has('scoreNowPlan')) phase = 'before.q1q3';
  else if (has('rankMainActions')) phase = 'before.order';
  else if (has('answerPrompt')) phase = 'prompt';
  else if (has('decideRez') || has('chooseRez')) phase = 'rez';
  else if (has('corpDecisionView')) phase = 'before.view';
  else if (has('getLegalActions')) phase = 'before.legal';
  else phase = 'other';
  return { phase, kind, exec: has('executeAction'), legal: has('isLegalAction') || has('getLegalActions'), view: has('corpDecisionView') || has('runnerDecisionView') || has('guessHidden'), self };
}
const selfTotals = new Map<string, number>();
function readProfile(profile: any) {
  const byId = new Map<number, any>();
  const parent = new Map<number, number>();
  for (const n of profile.nodes) {
    byId.set(n.id, n);
    for (const c of n.children ?? []) parent.set(c, n.id);
  }
  const cls = new Map<number, Cls>();
  const clsOf = (id: number): Cls => {
    let c = cls.get(id);
    if (!c) {
      const path: any[] = [];
      for (let x: number | undefined = id; x !== undefined; x = parent.get(x)) path.unshift(byId.get(x).callFrame);
      cls.set(id, (c = classify(path)));
    }
    return c;
  };
  const phase: Record<string, number> = {};
  const kind: Record<string, number> = {};
  const pk: Record<string, number> = {};
  let exec = 0;
  let legal = 0;
  let view = 0;
  let total = 0;
  let idle = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const ms = (profile.timeDeltas[i + 1] ?? 0) / 1000;
    const c = clsOf(profile.samples[i]);
    if (c.self.startsWith('(idle)') || c.self.startsWith('(program)') || c.self.startsWith('(root)')) {
      idle += ms;
      continue;
    }
    total += ms;
    phase[c.phase] = (phase[c.phase] ?? 0) + ms;
    kind[c.kind] = (kind[c.kind] ?? 0) + ms;
    pk[`${c.phase}/${c.kind}`] = (pk[`${c.phase}/${c.kind}`] ?? 0) + ms;
    if (c.exec) exec += ms;
    if (c.legal) legal += ms;
    if (c.view) view += ms;
    selfTotals.set(c.self, (selfTotals.get(c.self) ?? 0) + ms);
  }
  const round = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r1(v)]));
  return { total: r1(total), idle: r1(idle), phase: round(phase), kind: round(kind), pk: round(pk), incl: { exec: r1(exec), legal: r1(legal), view: r1(view) } };
}

// ------------------------------------------------------------------------------------------------ the sources
async function main() {
  const names = ['base', 'cnt', 'source'] as any[];
  const dirs = makeTrees(join(process.env.TROOT ?? 'node_modules/.cache/cb-prof', String(shard)), names);
  const trees: Record<string, Tree> = {};
  for (const t of names) trees[t] = await loadTree(t, dirs[t]);
  const outDir = process.env.OUT_DIR && existsSync(process.env.OUT_DIR) ? process.env.OUT_DIR : 'node_modules/.cache/cb-prof-out';
  mkdirSync(outDir, { recursive: true });

  type Unit = { kind: 'deal'; seed: number } | { kind: 'human'; file: string; from: number; to: number };
  const units: Unit[] = deals().map(seed => ({ kind: 'deal' as const, seed }));
  const core = trees.base.core;
  const startOf = (report: any): GameState => {
    if (report.startsAt === 'state') return structuredClone(report.state);
    let s = core.createInitialGameState(trees.base.decks.deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
    if (report.startStops) s = { ...s, stops: report.startStops };
    return s;
  };
  const reports = new Map<string, any>();
  for (const file of humanFiles()) {
    const report = JSON.parse(readFileSync(file, 'utf8'));
    if (!report.moves?.length) continue;
    reports.set(file, report);
    let s = startOf(report);
    let n = 0;
    for (const move of report.moves as GameAction[]) {
      if (askAt(trees.base, s)?.side === 'corp') n++;
      try {
        s = core.executeAction(s, move);
      } catch {
        break;
      }
    }
    for (let from = 0; from < n; from += CHUNK) units.push({ kind: 'human', file, from, to: Math.min(n, from + CHUNK) });
  }

  const decide = (src: string, i: number, s: GameState) => {
    const q = askAt(trees.base, s);
    if (!q || q.side !== 'corp') return false;
    const w = wanted.get(`${src}#${i}`);
    if (!w) return true;
    const ctrl = ask(trees.base, q);
    post('Profiler.start');
    const p = ask(trees.base, q);
    const { profile } = post('Profiler.stop');
    const prof = readProfile(profile);
    if (w.rank < SAVE) writeFileSync(join(outDir, `prof-${w.rank}-${src.replace(/[^a-z0-9.-]/gi, '_')}-${i}.cpuprofile`), JSON.stringify(profile));
    cp.reset();
    cp.on = true;
    let c: { a: string; ms: number };
    try {
      c = ask(trees.cnt, q);
    } finally {
      cp.on = false;
    }
    const st = s as any;
    out({
      kind: 'p',
      src,
      i,
      rank: w.rank,
      T: s.turnNumber,
      fn: q.fn,
      recorded: w.recorded,
      ms: { control: r1(ctrl.ms), prof: r1(p.ms), cnt: r1(c.ms) },
      ...(p.a !== ctrl.a || c.a !== ctrl.a ? { differs: true, control: ctrl.a.slice(0, 200), prof: p.a.slice(0, 200), cnt: c.a.slice(0, 200) } : {}),
      facts: { rig: st.runner.rig.programs.length + st.runner.rig.hardware.length + st.runner.rig.resources.length, hq: st.corp.hq.length, clicks: st.corp.clicks, credits: st.corp.credits, servers: Object.keys(st.corp.servers).length, ice: Object.values(st.corp.servers).reduce((n: number, x: any) => n + x.ice.length, 0) },
      prof,
      counts: cp.c,
      repeats: Object.fromEntries(Object.entries(cp.r as Record<string, Rep>).map(([k, v]) => [k, { calls: v.calls, repeats: v.repeats, ms: r1(v.ms), repeatMs: r1(v.repeatMs) }])),
      a: key(null) === ctrl.a ? 'null' : ctrl.a.slice(0, 120),
    });
    return true;
  };

  for (const [k, u] of units.entries()) {
    if (k % shards !== shard) continue;
    const srcName = u.kind === 'deal' ? `deal:${u.seed}` : `human:${u.file.split('/').pop()}`;
    if (![...wanted.keys()].some(x => x.startsWith(`${srcName}#`))) continue;
    if (process.env.DEALS && u.kind === 'deal' && !process.env.DEALS.split(',').includes(String(u.seed))) continue;
    if (process.env.DEALS && u.kind === 'human' && process.env.HUMAN === 'none') continue;
    if (u.kind === 'human' && ![...wanted.keys()].some(x => x.startsWith(`${srcName}#`) && Number(x.split('#')[1]) >= u.from && Number(x.split('#')[1]) < u.to)) continue;
    const t0 = performance.now();
    let n = 0;
    if (u.kind === 'deal') {
      const t = trees.source;
      t.clear();
      const g = new t.GameRunner(dealState(u.seed), { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') });
      for (let m = 0; m < 4000 && !g.state.winner; m++) {
        if (decide(srcName, n, g.state)) n++;
        if (!g.step()) break;
      }
      out({ kind: 's', src: srcName, decisions: n, ms: Math.round(performance.now() - t0) });
    } else {
      const report = reports.get(u.file);
      let s = startOf(report);
      let stopped: string | null = null;
      for (const [j, move] of (report.moves as GameAction[]).entries()) {
        if (askAt(trees.base, s)?.side === 'corp') {
          if (n >= u.from && n < u.to) decide(srcName, n, s);
          n++;
          if (n >= u.to) break;
        }
        try {
          s = core.executeAction(s, move);
        } catch (e) {
          stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
          break;
        }
      }
      out({ kind: 's', src: srcName, from: u.from, to: u.to, stopped, ms: Math.round(performance.now() - t0) });
    }
  }
  const top = [...selfTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400);
  out({ kind: 'fn', shard, self: top.map(([f, ms]) => [f, r1(ms)]) });
  out({ kind: 'mem', shard, maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024) });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
