/**
 * B4a/B4b lockstep (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/b4-hidden-zones.md rev 1c, bar 2 and bar 7):
 * this checkout's tree (`branch`) against BASE (the commit before), step by step, on the base pools of g1 45794820047 and
 * NRDB g1 45800011213; `control` is BASE again (base against base). A copy of b3/lockstep.ts (core-hooks.ts HOOKS hashed
 * into one stream per step; a deal stops at its first differing step) without B3's reach and fire hooks, and with:
 *  - the knowledge fields (`knownToRunner`, `knownToCorp`, `rdKnownToRunner`, `archKnownToRunner`) compared after each step:
 *    `kn` on a deal's line is the first step where they differ between base and branch, so an engine commit's first
 *    difference can be traced to the fields it changes (a decision difference before it is untraced);
 *  - READS=<name,...>: the branch tree's reader hooks (b4/reads.ts) count, per step, the calls where the new reading
 *    differs from today's (`fires`, by reader | scope | side), so a reader commit's first difference is traced to its own
 *    reader (`firesAt` at the differing step);
 *  - CHAIN=<label>:<branch>:<base>[:<reads+...>];...: several pairs in one run, each in a child process (`pair` on its lines);
 *  - BRANCH=<sha>: the branch tree is that commit's src (this checkout's hooks and READS still apply), so an older
 *    commit's lockstep can carry today's trace hooks;
 *  - CLEAR=1 clears every tree's caches before each step, for bar 7's time (ms by tree and side; and by decision kind);
 *  - PICKS=1 (bar 3): a difference in the value stream where all three trees pick the same action is listed (`same` on the
 *    deal's line, with its reader fires) and the deal goes on;
 *  - FOLLOW=1 (bar 3, with PICKS=1): a pick that differs is listed too (`changed`), and the branch game takes base's pick
 *    there and goes on, so every decision is asked on the base game's board; a deal stops only at a control difference;
 *  - CONT=1 (bar 3, with FOLLOW=1): at each Corp pick that differs, the paired continuation on the branch tree from that
 *    board: a fresh branch game replayed to that step (each earlier pick forced to the one played, caches cleared where the
 *    lockstep cleared them; `replayed` says no forced pick differed from the replay's own, other than the lockstep's), then
 *    base's pick (`contBase`) or the branch's (`contBranch`) and played on. Both agents are the branch's and the engine's
 *    RNG is in the state, so the two differ only in that one pick. All three trees' caches are cleared after them.
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/b4/lockstep.ts -- BASE=<sha> POOL=batch,nrdb [READS=a] [CLEAR=1] [PICKS=1 [FOLLOW=1 [CONT=1]]]
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../../src/core';
import { ALL_DECKS } from '../../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../../nrdb-test-decks';
import { Tree, loadTree } from '../facts-trees';
import { HOOKS, applyPatches } from '../core-hooks';
import { READ_HOOKS } from './reads';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
// CHAIN=<label>:<branch sha>:<base sha>[:<reads+reads>];... runs each pair in turn, in a child process with this run's
// other settings, and prints its lines with `pair` set (one queue slot for several commits' locksteps)
if (process.env.CHAIN) {
  const troot = process.env.TROOT ?? 'node_modules/.cache/b4-lockstep';
  for (const [i, item] of process.env.CHAIN.split(';').filter(Boolean).entries()) {
    const [label, branch, base, reads = ''] = item.split(':');
    const dir = join(troot, `chain-${i}`);
    const env = { ...process.env, CHAIN: '', ARGS: '', BRANCH: branch, BASE: base, READS: reads.replace(/\+/g, ','), TROOT: dir };
    const run = spawnSync('npx', ['vite-node', 'scripts/runner-rework/b4/lockstep.ts'], { env, encoding: 'utf8', maxBuffer: 1 << 30 });
    for (const line of (run.stdout ?? '').split('\n')) if (line.startsWith('{')) console.log(`{"pair":${JSON.stringify(label)},${line.slice(1)}`);
    if (run.status !== 0) console.log(JSON.stringify({ kind: 'error', pair: label, error: (run.stderr ?? '').slice(-400) }));
    rmSync(dir, { recursive: true, force: true });
  }
  process.exit(0);
}
const BASE = process.env.BASE ?? '';
if (!BASE) throw new Error('BASE=<sha> is required');
/** BRANCH=<sha>: the branch tree from that commit's src rather than this checkout's (this checkout's hooks still apply). */
const BRANCH = process.env.BRANCH ?? '';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/b4-lockstep', String(shard));
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const LIMIT = Number(process.env.LIMIT ?? Infinity);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 6000);
const RECORDS = (process.env.RECORDS ?? '45794820047,45800011213').split(',');
const READS = (process.env.READS ?? '').split(',').filter(Boolean);
const CLEAR = process.env.CLEAR === '1';
const PICKS = process.env.PICKS === '1';
const FOLLOW = process.env.FOLLOW === '1';
const CONT = process.env.CONT === '1';
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const key = (a: unknown) => (a === undefined ? 'undefined' : JSON.stringify(a));
const G = globalThis as any;
const NAMES = ['base', 'branch', 'control'] as const;
type Name = (typeof NAMES)[number];

function makeTrees(): Record<Name, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  for (const sha of [BASE, BRANCH].filter(Boolean)) {
    for (let tries = 0; ; tries++) {
      try {
        execSync(`git cat-file -e ${sha}^{commit}`, { stdio: 'ignore' });
        break;
      } catch {
        try {
          execSync(`git fetch --depth 1 origin ${sha}`, { stdio: 'ignore' });
        } catch (e) {
          if (tries >= 8) throw e;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000 + 700 * (shard % 4));
        }
      }
    }
  }
  const dirs = {} as Record<Name, string>;
  const read = (p: string) => readFileSync(p, 'utf8');
  const write = (p: string, t: string) => writeFileSync(p, t);
  for (const name of NAMES) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    if (name === 'branch' && BRANCH) execSync(`git archive ${BRANCH} src | tar -x -C ${dir}`);
    else if (name === 'branch') cpSync('src', join(dir, 'src'), { recursive: true });
    else execSync(`git archive ${BASE} src | tar -x -C ${dir}`);
    applyPatches(dir, HOOKS, `tree ${name}`, read, write);
    if (name === 'branch') for (const r of READS) applyPatches(dir, READ_HOOKS[r] ?? [], `reads ${r}`, read, write);
    dirs[name] = dir;
  }
  return dirs;
}
let T: Record<Name, Tree>;

type Acc = { n: number; h: number };
const fresh = (): Acc => ({ n: 0, h: 0x811c9dc5 });
const fnv = (acc: Acc, x: string) => {
  let h = acc.h;
  for (let i = 0; i < x.length; i++) {
    h ^= x.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= 0x1f;
  acc.h = Math.imul(h, 0x01000193) >>> 0;
  acc.n++;
};
/** Every hook writes into one stream, each record labelled with its kind and scope path; reaches go to `reach` (base only). */
function listen(t: Tree, rec: Acc, fires: Record<string, number> | null, side: string): () => void {
  const scopes: string[] = [];
  const path = () => scopes.join('>');
  const core = t.core;
  G.__lkIn = (gr: any) => {
    scopes.push(gr.__lkScope ?? 'top');
    return () => void scopes.pop();
  };
  G.__lk = (_gr: any, kind: string, state: GameState, action: unknown) => fnv(rec, `${path()}|${kind}|${kind === 'act' ? core.actingSide(state) : ''}|${key(action)}`);
  const scoreList = (ranked: { action: unknown; score: number }[]) => JSON.stringify(ranked.map(r => [r.action, Object.is(r.score, -0) ? '-0' : String(r.score)]));
  G.__lkDecRank = (_s: GameState, ranked: any[]) => fnv(rec, `${path()}|drank|${scoreList(ranked)}`);
  G.__lkOffRank = (_s: GameState, ranked: any[]) => fnv(rec, `${path()}|offrank|${scoreList(ranked)}`);
  G.__lkRank = (_s: GameState, ranked: any[]) => fnv(rec, `${path()}|rank|${scoreList(ranked)}`);
  G.__lkAns = (where: string, _s: GameState, action: unknown) => fnv(rec, `${path()}>${where}|ans|${key(action)}`);
  G.__b4Fire = fires
    ? (reader: string) => {
        const k = `${reader}|${path() === 'top' ? 'top' : 'inside'}|${side}`;
        fires[k] = (fires[k] ?? 0) + 1;
      }
    : undefined;
  return () => {
    G.__lkIn = G.__lk = G.__lkRank = G.__lkAns = G.__lkDecRank = G.__lkOffRank = G.__b4Fire = undefined;
  };
}

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

type Deal = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(t: Tree, d: Deal): GameState {
  const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck);
  const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck);
  if (!c || !r) throw new Error(`deal ${d.seed}: deck not found`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r));
}

const result = (gr: any) => ({ winner: gr.state.winner ?? null, corpPts: gr.state.corp.score, runnerPts: gr.state.runner.score, T: gr.state.turnNumber });
/** The branch game played on to its end (no hooks listening). */
function playOn(gr: any) {
  try {
    for (let i = 0; i < MAX_STEPS && gr.step(); i++);
  } catch (e) {
    return { error: (e as Error).message.slice(0, 120) };
  }
  return result(gr);
}
/**
 * A fresh branch game replayed through `played` (the picks base made; at a step in `forced` the branch's own pick is
 * replaced by it), its caches cleared at the steps in `clears`, then `pick` applied there, then played on.
 */
function replayWith(d: Deal, played: string[], forced: Set<number>, clears: Set<number>, pick: unknown) {
  T.branch.clear();
  const gr = new T.branch.GameRunner(dealStateOf(T.branch, d), { corp: T.branch.createAgent('corp', 'normal'), runner: T.branch.createAgent('runner', 'normal') });
  let replayed = true;
  try {
    for (let i = 0; i < played.length; i++) {
      if (clears.has(i)) T.branch.clear();
      const prev = gr.state;
      gr.step();
      if (key(gr.last) === played[i]) continue;
      if (!forced.has(i)) replayed = false;
      gr.state = T.branch.core.executeAction(prev, JSON.parse(played[i]));
      gr.last = JSON.parse(played[i]);
    }
    if (clears.has(played.length)) T.branch.clear();
    gr.apply(pick);
  } catch (e) {
    return { error: (e as Error).message.slice(0, 120), replayed };
  }
  return { ...playOn(gr), replayed };
}

const knowledge = (s: GameState) => key([s.corp.knownToRunner ?? [], s.runner.knownToCorp ?? [], s.corp.rdKnownToRunner ?? [], (s.corp as any).archKnownToRunner ?? []]);
/** KN_DUMP=1: at the first difference, the knowledge entries only one of base and branch holds, by field. */
const KN_DUMP = process.env.KN_DUMP === '1';
function knDiff(a: GameState, b: GameState) {
  const fields = (s: GameState): Record<string, unknown[]> => ({ knownToRunner: s.corp.knownToRunner ?? [], knownToCorp: s.runner.knownToCorp ?? [], rdKnownToRunner: s.corp.rdKnownToRunner ?? [], archKnownToRunner: (s.corp as any).archKnownToRunner ?? [] });
  const fa = fields(a), fb = fields(b), res: Record<string, unknown> = {};
  for (const f of Object.keys(fa)) {
    const ka = new Set(fa[f].map(key)), kb = new Set(fb[f].map(key));
    const onlyBase = [...ka].filter(x => !kb.has(x)), onlyBranch = [...kb].filter(x => !ka.has(x));
    if (onlyBase.length || onlyBranch.length) res[f] = { base: onlyBase, branch: onlyBranch };
  }
  return res;
}
const ms: Record<Name, Record<string, number>> = { base: {}, branch: {}, control: {} };
const addMs = (m: Record<string, number>, k: string, x: number) => (m[k] = (m[k] ?? 0) + x);
function deal(pool: string, d: Deal) {
  const g = {} as Record<Name, any>;
  const tms = { base: {}, branch: {}, control: {} } as Record<Name, Record<string, number>>;
  for (const n of NAMES) {
    T[n].clear();
    g[n] = new T[n].GameRunner(dealStateOf(T[n], d), { corp: T[n].createAgent('corp', 'normal'), runner: T[n].createAgent('runner', 'normal') });
  }
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  let diff: Record<string, unknown> | null = null;
  let steps = 0;
  let kn: { step: number; T: number } | null = null;
  const fires: Record<string, number> = {};
  const sameAt: Record<string, unknown>[] = [];
  const changedAt: Record<string, unknown>[] = [];
  const played: string[] = [];
  const forced = new Set<number>();
  const clears = new Set<number>();
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.base.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const dec = decisionOf(T.base.core, s);
    const side = dec?.side ?? 'none';
    const res = {} as Record<Name, Acc>;
    const more = {} as Record<Name, boolean>;
    const stepFires: Record<string, number> = {};
    const order = NAMES.map((_, k) => NAMES[(k + i) % NAMES.length]);
    const prevBranch: GameState = g.branch.state;
    for (const n of order) {
      res[n] = fresh();
      if (CLEAR) T[n].clear();
      const stop = listen(T[n], res[n], n === 'branch' ? stepFires : null, side);
      const t0 = performance.now();
      try {
        more[n] = g[n].step();
      } finally {
        stop();
      }
      if (dec) {
        const t = performance.now() - t0;
        addMs(tms[n], dec.side, t);
        addMs(tms[n], `${dec.side}|${dec.kind}`, t);
      }
    }
    steps++;
    if (!kn && knowledge(g.base.state) !== knowledge(g.branch.state)) kn = { step: i, T: g.base.state.turnNumber };
    const same = (a: Name, b: Name) => res[a].n === res[b].n && res[a].h === res[b].h && more[a] === more[b];
    const pick = (n: Name) => key(g[n].last).slice(0, 160);
    const samePick = more.base === more.branch && key(g.base.last) === key(g.branch.last);
    if (PICKS && same('base', 'control') && !same('base', 'branch') && samePick) {
      sameAt.push({ step: i, T: s.turnNumber, side: dec?.side ?? null, kind: dec?.kind ?? null, firesAt: stepFires, pick: pick('base') });
    } else if (FOLLOW && same('base', 'control') && !samePick && more.base && more.branch) {
      const at: Record<string, unknown> = { step: i, T: s.turnNumber, side: dec?.side ?? null, kind: dec?.kind ?? null, firesAt: stepFires, picks: { base: pick('base'), branch: pick('branch') } };
      if (CONT && dec?.side === 'corp') {
        const branchPick = g.branch.last;
        at.contBase = replayWith(d, played, forced, clears, g.base.last);
        at.contBranch = replayWith(d, played, forced, clears, branchPick);
        for (const n of NAMES) T[n].clear();
        clears.add(i + 1);
      }
      changedAt.push(at);
      forced.add(i);
      g.branch.state = T.branch.core.executeAction(prevBranch, g.base.last);
      g.branch.last = g.base.last;
    } else if (!same('base', 'branch') || !same('base', 'control')) {
      diff = {
        step: i,
        T: s.turnNumber,
        side: dec?.side ?? null,
        kind: dec?.kind ?? null,
        branch: !same('base', 'branch'),
        control: !same('base', 'control'),
        firesAt: stepFires,
        picks: { base: pick('base'), branch: pick('branch') },
        ...(KN_DUMP && { knAt: knDiff(g.base.state, g.branch.state) }),
      };
      break;
    }
    played.push(key(g.base.last));
    for (const [k, v] of Object.entries(stepFires)) fires[k] = (fires[k] ?? 0) + v;
    if (!more.base) break;
  }
  const B = g.base.state;
  const recordSame = !diff ? (B.winner ?? null) === d.winner && key(cr) === key(d.cr) && key(sc) === key(d.sc) : null;
  for (const n of NAMES) for (const [k, v] of Object.entries(tms[n])) addMs(ms[n], k, v);
  const r1 = (x: number) => Math.round(x);
  out({ kind: 'deal', pool, seed: d.seed, steps, diff, kn, fires, recordSame, ...(PICKS ? { same: sameAt } : {}), ...(FOLLOW ? { changed: changedAt } : {}), ms: Object.fromEntries(NAMES.map(n => [n, Object.fromEntries(Object.entries(tms[n]).map(([k, v]) => [k, r1(v)]))])) });
}

async function main() {
  const dirs = makeTrees();
  T = {} as Record<Name, Tree>;
  for (const n of NAMES) T[n] = await loadTree(n, dirs[n]);
  const batch: Deal[] = JSON.parse(readFileSync(`scripts/runner-rework/b4/deals-${RECORDS[0]}.json`, 'utf8'));
  const nrdb: Deal[] = JSON.parse(readFileSync(`scripts/runner-rework/b4/deals-${RECORDS[1]}.json`, 'utf8'));
  const sources: { pool: string; d: Deal }[] = [];
  for (const pool of POOLS) (pool === 'batch' ? batch : nrdb).filter(d => !DEALS.length || DEALS.includes(String(d.seed))).slice(0, LIMIT).forEach(d => sources.push({ pool, d }));
  for (let i = shard; i < sources.length; i += shards) {
    try {
      deal(sources[i].pool, sources[i].d);
    } catch (e) {
      out({ kind: 'error', pool: sources[i].pool, seed: sources[i].d.seed, error: (e as Error).stack?.slice(0, 400) });
    }
  }
  out({ kind: 'time', ms: Object.fromEntries(NAMES.map(n => [n, Object.fromEntries(Object.entries(ms[n]).map(([k, v]) => [k, Math.round(v)]))])) });
  if (process.env.OUT_DIR) writeFileSync(join(process.env.OUT_DIR, `done-${shard}.txt`), 'ok');
}
main();
