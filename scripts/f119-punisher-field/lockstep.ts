/**
 * F119-S (addendum-structure.md to brief f119-punisher-field rev 1): bars (b) and (c). Started from
 * scripts/tag-owner/owner-lockstep.ts (copied, not edited). Three trees play each g1 deal of both pools by a plain
 * GameRunner, one step each in a turn that rotates:
 *   leg      this checkout's src (the branch: the tagUse field, its readers and the clock reading it);
 *   base     the merge base's src as it is (ARM_BASE, a full SHA: beta at the branch's start);
 *   control  the merge base's src again: the time control, and a check that base is reproducible.
 * Every tree has one RECORD patch, which only writes a global: each HeuristicRunnerAI.chooseAction's answer, so the Runner
 * steps inside a decision (the Corp's reply Runners, the planner's rollouts) are compared too. At every step the action
 * and the hash of the inner Runner answers must be equal in leg, base and control: the first step that differs is a
 * STOP (bar b: one difference is a stop), reported, and the deal ends there. Beside it, the base's turn record (cr, sc,
 * winner) against the g1 base run's deals.json (recordSame). Time (bar c): ms of every step that asks an agent, by side
 * and kind (main, prompt, run, rez, off), per tree, over the steps played alike.
 *   ARGS="ARM_BASE=<40-char sha>"   (ai-script: SHARD=<k>/64; local: SHARD=0/64 npx vite-node scripts/f119-punisher-field/lockstep.ts -- ARM_BASE=...)
 *   PER_POOL=n: the first n deals of each pool only; DEALS=a,b: those seeds only.
 * Sum: node scripts/f119-punisher-field/lockstep-sum.mjs <out dir or files>.
 * No hidden read: the script compares answers the agents gave and the game's public record.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { makeTree, type Patch } from '../corp-owed/trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const PER_POOL = Number(process.env.PER_POOL ?? 0);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 4000);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity);
const ARM_BASE = process.env.ARM_BASE ?? '';
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/f119-lockstep', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const key = (a: unknown) => (a ? JSON.stringify(a) : 'null');
const G = globalThis as any;
/** The g1 bases named for beta at the branch's start (project memory, BASELINES): the batch pool and the NRDB pool. */
const RUNS: Record<string, string> = { batch: '46008214593', nrdb: '46012461062' };

const RECORD_AT = `  chooseAction(state: GameState): GameAction {
    return asSide('runner', () => this.decide(state));
  }`;
const RECORD = (tree: string): Patch => [
  'ai/runnerAI.ts',
  RECORD_AT,
  `  chooseAction(state: GameState): GameAction {
    const __answer = asSide('runner', () => this.decide(state));
    (globalThis as any).__lkRunner_${tree}?.push(String(JSON.stringify(__answer))); // an undefined answer is logged as 'undefined'
    return __answer;
  }`,
];

interface T {
  name: string;
  createAgent: any;
  GameRunner: any;
  core: any;
  decks: any;
  clear: () => void;
}
async function loadTree(name: string, dir: string): Promise<T> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const files = ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts', 'ai/threatModel.ts'];
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of files) mods.push(await m(p));
  const [ai, po, core, decks, hv, fx, vm, iv, tm] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    core,
    decks,
    clear: () => {
      hv.clearHandCaches();
      fx.clearDamageThreats();
      tm.clearThreatCaches?.();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}

/** FNV-1a over the inner Runner answers of one step. */
function hash(xs: string[]): string {
  let h = 0x811c9dc5;
  for (const x of xs)
    for (let i = 0; i < x.length; i++) {
      h ^= x.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  return `${xs.length}:${h.toString(16)}`;
}
/** The decision GameRunner.step asks an agent for at `s`, or null (as owner-lockstep.ts). */
function decisionOf(core: any, s: GameState): { side: 'corp' | 'runner'; kind: string } | null {
  const side = core.actingSide(s);
  if (!side || s.winner) return null;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
    const want = core.wantsStop(s, side, w);
    if (want && side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server')) return { side, kind: 'rez' };
    if (want && side === 'runner' && w.step === 'corp_action') return { side, kind: 'off' };
    return null;
  }
  return { side, kind: core.activePrompt(s) ? 'prompt' : s.activeRun ? 'run' : 'main' };
}

type Rec = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(t: T, rec: Rec): GameState {
  const c = DECK_POOL.find(d => d.side === 'corp' && d.name === rec.corpDeck);
  const r = DECK_POOL.find(d => d.side === 'runner' && d.name === rec.runnerDeck);
  if (!c || !r) throw new Error(`deal ${rec.seed}: deck not found (${rec.corpDeck} v ${rec.runnerDeck})`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(rec.seed, c, r));
}
type Tally = Record<string, number>;
const inc = (t: Tally, k: string, n = 1) => void (t[k] = (t[k] ?? 0) + n);

const LK = ['leg', 'base', 'control'] as const;
type Lk = (typeof LK)[number];
function lockDeal(T: Record<Lk, T>, pool: string, rec: Rec) {
  const g = {} as Record<Lk, any>;
  const ms = {} as Record<Lk, Tally>;
  for (const n of LK) {
    T[n].clear();
    g[n] = new T[n].GameRunner(dealStateOf(T[n], rec), { corp: T[n].createAgent('corp', 'normal'), runner: T[n].createAgent('runner', 'normal') });
    ms[n] = {};
  }
  let stop: Record<string, unknown> | null = null;
  let steps = 0;
  let decisions = 0;
  let inner = 0;
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.base.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const d = decisionOf(T.base.core, s);
    const res = {} as Record<Lk, { more: boolean; act: string; inner: string; ms: number }>;
    for (let k = 0; k < LK.length; k++) {
      const n = LK[(k + i) % LK.length];
      const log: string[] = [];
      G[`__lkRunner_${n}`] = log;
      const t0 = performance.now();
      const more = g[n].step();
      const dt = performance.now() - t0;
      G[`__lkRunner_${n}`] = undefined;
      res[n] = { more, act: key(g[n].last), inner: hash(log), ms: dt };
    }
    const same = (a: Lk, b: Lk) => res[a].more === res[b].more && res[a].act === res[b].act && res[a].inner === res[b].inner;
    if (!res.base.more && !res.leg.more && !res.control.more) break;
    steps++;
    if (d) {
      decisions++;
      for (const n of LK) inc(ms[n], `${d.side}:${d.kind}`, res[n].ms);
      inc(ms.leg, `n ${d.side}:${d.kind}`);
    }
    inner += Number(res.base.inner.split(':')[0]);
    if (!same('leg', 'base') || !same('control', 'base')) {
      stop = {
        step: i,
        decision: decisions,
        T: s.turnNumber,
        side: d?.side,
        kind: d?.kind,
        tags: s.runner.tags,
        legDiffers: !same('leg', 'base'),
        controlDiffers: !same('control', 'base'),
        leg: { ...res.leg, act: res.leg.act.slice(0, 200) },
        base: { ...res.base, act: res.base.act.slice(0, 200) },
        control: { ...res.control, act: res.control.act.slice(0, 200) },
      };
      break;
    }
    if (!res.base.more) break;
  }
  const B: GameState = g.base.state;
  const r1 = (t: Tally) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  out({
    kind: 'deal',
    pool,
    seed: rec.seed,
    steps,
    decisions,
    inner,
    stop,
    winner: B.winner ?? null,
    T: B.turnNumber,
    recordSame: !stop && (B.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc),
    ms: Object.fromEntries(LK.map(n => [n, r1(ms[n])])),
  });
}

async function main() {
  const started = Date.now();
  if (!/^[0-9a-f]{40}$/.test(ARM_BASE)) throw new Error('ARM_BASE (the merge base, a full SHA) is required');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const sources: { pool: string; rec: Rec }[] = [];
  for (const pool of POOLS) {
    const recs: Rec[] = JSON.parse(readFileSync(`scripts/f119-punisher-field/deals-${RUNS[pool]}.json`, 'utf8'));
    let n = 0;
    for (const r of recs) {
      if (DEALS.length && !DEALS.includes(String(r.seed))) continue;
      if (PER_POOL && n >= PER_POOL) break;
      n++;
      sources.push({ pool, rec: r });
    }
  }
  const baseDir = makeTree(join(root, 'base'), { ref: ARM_BASE, patches: [RECORD('base')] });
  const controlDir = join(root, 'control');
  mkdirSync(controlDir, { recursive: true });
  cpSync(join(baseDir, 'src'), join(controlDir, 'src'), { recursive: true });
  const controlText = readFileSync(join(controlDir, 'src', 'ai', 'runnerAI.ts'), 'utf8').replace('__lkRunner_base', '__lkRunner_control');
  writeFileSync(join(controlDir, 'src', 'ai', 'runnerAI.ts'), controlText);
  const dirs: Record<Lk, string> = { leg: makeTree(join(root, 'leg'), { patches: [RECORD('leg')] }), base: baseDir, control: controlDir };
  const T = {} as Record<Lk, T>;
  for (const n of LK) T[n] = await loadTree(n, dirs[n]);
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    if (Date.now() - started > MAX_MS) break;
    try {
      lockDeal(T, src.pool, src.rec);
    } catch (e) {
      out({ kind: 'error', pool: src.pool, seed: src.rec.seed, error: (e as Error).stack?.slice(0, 400) });
    }
  }
  out({ kind: 's', shard, ms: Date.now() - started, rss: Math.round(process.memoryUsage().rss / 1e6) });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
