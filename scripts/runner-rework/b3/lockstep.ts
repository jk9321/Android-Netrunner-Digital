/**
 * B3 commit 0, bar 1 (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/b3-prompt-view.md rev 2): this checkout's
 * tree (`branch`, commit 0: runnerUnknownSlots keeps an unrezzed ice the Runner knows) against BASE (beta), step by step,
 * on the base pools of g1 45716865309 and NRDB g1 45721175528; `control` is BASE again (base against base). A copy of
 * last-credits-fix-lockstep.ts (R-B's lockstep hooks, core-hooks.ts HOOKS, hashed into one stream per step; a deal stops at
 * its first differing step) without its faults, drafts and 'later' stream, and with one reach hook in every tree:
 * runnerUnknownSlots reports the unrezzed ice the Runner knows (`!isRezzed && runnerKnows`, the only slots commit 0
 * changes) and the script names the reader from the call stack: view (runnerDecisionView; the ranking, the prompt answers
 * and the planner's root read that one view), guard (runnerAI promptAnswer's prompt guard), hard (search.ts determinize)
 * or other. Reaches are read on the base tree (the trees are equal up to the first difference), each with its scope path
 * (top = the game's own decision; deeper = a look-ahead inside it) and the step's deciding side.
 *
 * A deal's line: its first difference (step, turn, deciding side and kind, picks) with the reaches at that step and before
 * it; or no difference, and whether the base tree equals its record.
 *
 * Commit 1 (bar 2, the same script; launched as commit0-lockstep.ts for bar 1): where a tree has commit 1's dispatch point
 * (prompts.ts todayAnswer reading an entry's `promptAnswer`), the fire hook counts each entry's answers by card code,
 * scope (top, inside) and answering side, in the branch tree, over the steps before a deal's first difference (every
 * step of an identical deal): `fires` on the deal's line.
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/b3/lockstep.ts -- BASE=<sha> POOL=batch,nrdb
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../../src/core';
import { ALL_DECKS } from '../../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../../nrdb-test-decks';
import { Tree, loadTree } from '../facts-trees';
import { HOOKS, Patch, applyPatches } from '../core-hooks';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const BASE = process.env.BASE ?? '80055629eaf2877ddf5ce570b14bea45b4bb0576';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/b3-lockstep', String(shard));
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const LIMIT = Number(process.env.LIMIT ?? Infinity);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 6000);
const RECORDS = (process.env.RECORDS ?? '45716865309,45721175528').split(',');
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const key = (a: unknown) => (a === undefined ? 'undefined' : JSON.stringify(a));
const G = globalThis as any;
const NAMES = ['base', 'branch', 'control'] as const;
type Name = (typeof NAMES)[number];

/** The reach hook: the unrezzed ice the Runner knows, as runnerUnknownSlots sees them (the same line on both sides of commit 0). */
const REACH: Patch[] = [
  [
    'ai/runnerReply.ts',
    `export function runnerUnknownSlots(state: GameState, memory?: RunnerMemory): { ice: CardInstance[]; root: CardInstance[]; loose: CardInstance[] } {\n`,
    `export function runnerUnknownSlots(state: GameState, memory?: RunnerMemory): { ice: CardInstance[]; root: CardInstance[]; loose: CardInstance[] } {\n  const __kn = Object.values(state.corp.servers).flatMap(sv => sv.ice).filter(c => !c.isRezzed && c.runnerKnows);\n  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n  if (__kn.length) (globalThis as any).__b3Reach?.(__kn.map(c => c.cardCode));\n`,
  ],
];

/** Commit 1's fire hook: an entry's answer at the dispatch point (applied where the tree has it). */
const FIRE: Patch[] = [
  [
    'ai/prompts.ts',
    `    if (own) return { ...base, choice: own };\n`,
    `    if (own) {\n      // eslint-disable-next-line @typescript-eslint/no-explicit-any\n      (globalThis as any).__b3Fire?.(prompt.source.cardCode, side);\n      return { ...base, choice: own };\n    }\n`,
  ],
];

function makeTrees(): Record<Name, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  for (let tries = 0; ; tries++) {
    try {
      execSync(`git cat-file -e ${BASE}^{commit}`, { stdio: 'ignore' });
      break;
    } catch {
      try {
        execSync(`git fetch --depth 1 origin ${BASE}`, { stdio: 'ignore' });
      } catch (e) {
        if (tries >= 8) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000 + 700 * (shard % 4));
      }
    }
  }
  const dirs = {} as Record<Name, string>;
  const read = (p: string) => readFileSync(p, 'utf8');
  const write = (p: string, t: string) => writeFileSync(p, t);
  for (const name of NAMES) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    if (name === 'branch') cpSync('src', join(dir, 'src'), { recursive: true });
    else execSync(`git archive ${BASE} src | tar -x -C ${dir}`);
    applyPatches(dir, [...HOOKS, ...REACH], `tree ${name}`, read, write);
    if (read(join(dir, 'src', FIRE[0][0])).includes(FIRE[0][1])) applyPatches(dir, FIRE, `fire ${name}`, read, write);
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
type Reach = { reader: string; scope: string; codes: string[] };
/** The reader of a runnerUnknownSlots call, from the stack (frames: the hook, runnerUnknownSlots, its caller, ...). */
function readerOf(stack: string): string {
  const frames = stack.split('\n').slice(1).map(l => l.trim());
  const at = frames.findIndex(f => f.includes('runnerUnknownSlots'));
  const rest = frames.slice(at + 1);
  const caller = rest[0] ?? '';
  if (caller.includes('promptAnswer')) return 'guard';
  if (caller.includes('dealRunnerUnknowns')) {
    if (rest.some(f => f.includes('determinize'))) return 'hard';
    if (rest.some(f => f.includes('runnerDecisionView'))) return 'view';
    if (rest.some(f => f.includes('guessRunnerView'))) return 'view-other';
  }
  return `other:${caller.replace(/\(.*$/, '').slice(0, 60)}`;
}
/** Every hook writes into one stream, each record labelled with its kind and scope path; reaches go to `reach` (base only). */
function listen(t: Tree, rec: Acc, reach: Reach[] | null, fires: Record<string, number> | null): () => void {
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
  G.__b3Reach = reach
    ? (codes: string[]) => {
        const limit = Error.stackTraceLimit;
        Error.stackTraceLimit = 60;
        const stack = new Error().stack ?? '';
        Error.stackTraceLimit = limit;
        reach.push({ reader: readerOf(stack), scope: path() || 'none', codes });
      }
    : undefined;
  G.__b3Fire = fires
    ? (code: string, side: string) => {
        const k = `${code}|${path() === 'top' ? 'top' : 'inside'}|${side}`;
        fires[k] = (fires[k] ?? 0) + 1;
      }
    : undefined;
  return () => {
    G.__lkIn = G.__lk = G.__lkRank = G.__lkAns = G.__lkDecRank = G.__lkOffRank = G.__b3Reach = G.__b3Fire = undefined;
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

/** Reaches summed by reader | scope depth | deciding side. */
const tally = (rs: (Reach & { side: string })[]) => {
  const m: Record<string, number> = {};
  for (const r of rs) {
    const k = `${r.reader}|${r.scope === 'top' ? 'top' : r.scope === 'none' ? 'none' : 'inside'}|${r.side}`;
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
};
const ms: Record<Name, { corp: number; runner: number }> = { base: { corp: 0, runner: 0 }, branch: { corp: 0, runner: 0 }, control: { corp: 0, runner: 0 } };
function deal(pool: string, d: Deal) {
  const g = {} as Record<Name, any>;
  const tms = { base: { corp: 0, runner: 0 }, branch: { corp: 0, runner: 0 }, control: { corp: 0, runner: 0 } } as Record<Name, { corp: number; runner: number }>;
  for (const n of NAMES) {
    T[n].clear();
    g[n] = new T[n].GameRunner(dealStateOf(T[n], d), { corp: T[n].createAgent('corp', 'normal'), runner: T[n].createAgent('runner', 'normal') });
  }
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  let diff: Record<string, unknown> | null = null;
  let steps = 0;
  const before: (Reach & { side: string })[] = [];
  let firstReach: { step: number; T: number } | null = null;
  const fires: Record<string, number> = {};
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.base.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const dec = decisionOf(T.base.core, s);
    const res = {} as Record<Name, Acc>;
    const more = {} as Record<Name, boolean>;
    const at: Reach[] = [];
    const stepFires: Record<string, number> = {};
    const order = NAMES.map((_, k) => NAMES[(k + i) % NAMES.length]);
    for (const n of order) {
      res[n] = fresh();
      const stop = listen(T[n], res[n], n === 'base' ? at : null, n === 'branch' ? stepFires : null);
      const t0 = performance.now();
      try {
        more[n] = g[n].step();
      } finally {
        stop();
      }
      if (dec) tms[n][dec.side] += performance.now() - t0;
    }
    steps++;
    const side = dec?.side ?? 'none';
    const atSide = at.map(r => ({ ...r, side }));
    if (at.length && !firstReach) firstReach = { step: i, T: s.turnNumber };
    const same = (a: Name, b: Name) => res[a].n === res[b].n && res[a].h === res[b].h && more[a] === more[b];
    if (!same('base', 'branch') || !same('base', 'control')) {
      const pick = (n: Name) => key(g[n].last).slice(0, 160);
      const codes = [...new Set(atSide.flatMap(r => r.codes))];
      diff = {
        step: i,
        T: s.turnNumber,
        side: dec?.side ?? null,
        kind: dec?.kind ?? null,
        branch: !same('base', 'branch'),
        control: !same('base', 'control'),
        reachAt: tally(atSide),
        reachBefore: tally(before),
        firstReach,
        codes,
        picks: { base: pick('base'), branch: pick('branch') },
      };
      break;
    }
    before.push(...atSide);
    for (const [k, v] of Object.entries(stepFires)) fires[k] = (fires[k] ?? 0) + v;
    if (!more.base) break;
  }
  const B = g.base.state;
  const recordSame = !diff ? (B.winner ?? null) === d.winner && key(cr) === key(d.cr) && key(sc) === key(d.sc) : null;
  for (const n of NAMES) for (const side of ['corp', 'runner'] as const) ms[n][side] += tms[n][side];
  const r1 = (x: number) => Math.round(x);
  out({ kind: 'deal', pool, seed: d.seed, steps, diff, reach: diff ? null : tally(before), firstReach, fires, recordSame, ms: Object.fromEntries(NAMES.map(n => [n, { corp: r1(tms[n].corp), runner: r1(tms[n].runner) }])) });
}

async function main() {
  const dirs = makeTrees();
  T = {} as Record<Name, Tree>;
  for (const n of NAMES) T[n] = await loadTree(n, dirs[n]);
  const batch: Deal[] = JSON.parse(readFileSync(`scripts/runner-rework/b3/deals-${RECORDS[0]}.json`, 'utf8'));
  const nrdb: Deal[] = JSON.parse(readFileSync(`scripts/runner-rework/b3/deals-${RECORDS[1]}.json`, 'utf8'));
  const sources: { pool: string; d: Deal }[] = [];
  for (const pool of POOLS) (pool === 'batch' ? batch : nrdb).filter(d => !DEALS.length || DEALS.includes(String(d.seed))).slice(0, LIMIT).forEach(d => sources.push({ pool, d }));
  for (let i = shard; i < sources.length; i += shards) {
    try {
      deal(sources[i].pool, sources[i].d);
    } catch (e) {
      out({ kind: 'error', pool: sources[i].pool, seed: sources[i].d.seed, error: (e as Error).stack?.slice(0, 400) });
    }
  }
  out({ kind: 'time', ms: Object.fromEntries(NAMES.map(n => [n, { corp: Math.round(ms[n].corp), runner: Math.round(ms[n].runner) }])) });
  if (process.env.OUT_DIR) writeFileSync(join(process.env.OUT_DIR, `done-${shard}.txt`), 'ok');
}
main();
