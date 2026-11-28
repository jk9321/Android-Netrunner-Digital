/**
 * R-B B1 (brief netrunner-ai/runner-rework/briefs/b1-core.md rev 1, bar 1, 2, 6 and 7), reused by R-B B2 (b2-run.md
 * rev 1, bars 1, 2, 6 and 7; BASE beta 57b02d6, two columns added): the branch's tree against its
 * base, decision by decision and per caller kind. Three trees, each loaded as its own module graph (facts-trees.ts loadTree):
 *   base     the base commit's src (BASE, default beta 57b02d6, B2's cut; B1 used ff04f60), from git;
 *   branch   this checkout's src (ai-runner-run);
 *   control  the base's src again: the time arm, and a check that the base is reproducible (base against base).
 * Every tree gets the same hooks (core-hooks.ts HOOKS: call-site records in files B1 does not change). FAULT=<name>
 * adds one planted fault (core-faults.ts, bar 2) to the branch tree only; FAULT=a,b,... gives shard s the fault s % n (none =
 * no fault), each fault over every source, and labels every line with its fault.
 *
 * At every top-level step the three trees must agree on each COLUMN (count and FNV hash of its records in that step):
 *   pick    the top-level action (both sides; GameRunner 'step' records of the top scope)
 *   reply   every action of every reply sample (GameRunner 'step' records of scope reply)
 *   rank    every rank list a Runner planner playout produces, actions and scores (turnPlanner hook)
 *   off     every chooseOffTurn answer, null included, in any scope
 *   run     every chooseAction answer of a Runner with a run under way and no prompt, in any scope
 *   prompt  every prompt answer of either side in any GameRunner scope, and every Runner planner playout's prompt and
 *           discard answer
 *   hard    every action of every Hard search playout (scopes hardR, hardC)
 *   oracle  every action of every oracle playout (scope oracle)
 *   rez     every chooseRez answer, null included
 *   drank   R-B B2: the deciding Runner's own rank list at every top-level main-phase decision, actions and scores bit for
 *           bit (runner/core.ts's `ranked`, top scope only: no planner rollout, reply, Hard or oracle playout)
 *   offrank R-B B2: the deciding Runner's off-turn score list at every top-level off-turn question (top scope only)
 *   crank   speed pass (CORP=1, core-hooks.ts CORP_HOOKS): the deciding Corp's own rank list at every top-level main-phase
 *           decision, actions and scores bit for bit (top scope only)
 *   cprank  speed pass (CORP=1): every rank list a Corp planner playout makes, actions and scores bit for bit
 *   legacy  facts-lockstep.ts's stream (every Runner chooseAction answer made inside the step, nested ones first): the
 *           continuity column, the old script's `inner`
 *   value   R-B B1b bar 1 (the value stream): every value handed to the diagnostics sink's onValue (valueModel logValue:
 *           quantity, site and the value bit for bit), in order, in every scope; one sink per tree (VALUES=0: none)
 * Each record carries its scope path (top>reply, top>oracle>..., top>hardR), so a record made in another place differs.
 *
 * POOL=batch (the 221 deals of g1 45444888753), nrdb (the 110 of NRDB=1 g1 45458221138), human
 * (tests/fixtures/human-games: the recorded moves replayed, each tree's own persistent agents asked on a copy at every
 * decision), hard (HARD_DEALS deals of the batch pool, Hard on both sides with SearchOptions seed SEED and samples SAMPLES),
 * oracle (ORACLE_DEALS deals of the batch pool, Normal, plan.oracle.safestRemote on in every tree).
 * A deal stops at the first step that differs (reported with the columns that differ). Time: ms of every step that asks
 * an agent, by side, per tree.
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/core-lockstep.ts -- POOL=batch,nrdb,human
 *   ARGS="POOL=batch DEALS=1001 MAX_STEPS=300" npx vite-node scripts/runner-rework/core-lockstep.ts
 *   ARGS="POOL=human DEALS=report-21 FAULT=offTurnHolder" npx vite-node scripts/runner-rework/core-lockstep.ts (DEALS names human files too)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Tree, loadTree } from './facts-trees';
import { CORP_HOOKS, HOOKS, Patch, applyPatches } from './core-hooks';
import { FAULTS } from './core-faults';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const BASE = process.env.BASE ?? '57b02d6fe816fdeaf778954f2f09539e50c105a7';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/runner-core-lockstep', String(shard));
const POOLS = (process.env.POOL ?? 'batch,nrdb,human').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 4000);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity); // local trial: stop after this long
// FAULT=a,b,...: one fault per shard, in turn (shard % n), each over every source with the shards that carry it
// ('none' = no fault: the bar's own leg in the same run)
const FAULT_LIST = (process.env.FAULT ?? '').split(',').filter(Boolean);
const FAULT = FAULT_LIST.length ? FAULT_LIST[shard % FAULT_LIST.length].replace(/^none$/, '') : '';
const [sub, subs] = FAULT_LIST.length > 1 ? [Math.floor(shard / FAULT_LIST.length), Math.floor(shards / FAULT_LIST.length)] : [shard, shards];
const SEED = Number(process.env.SEED ?? 12345);
const SAMPLES = Number(process.env.SAMPLES ?? 3);
const HARD_DEALS = Number(process.env.HARD_DEALS ?? 10);
const ORACLE_DEALS = Number(process.env.ORACLE_DEALS ?? 4);
// VALUES=0: no diagnostics sink (the value column stays empty), for a time-only run
const VALUES = process.env.VALUES !== '0';
// TIMES=1 (R-B B1b bar 4): the Corp's two hot named entries timed in every tree (hold.ts counted: countingHold;
// cardPlans.ts handPlanWorth: planning), outermost call only, and each decision's ms by side and kind; same patch in
// every tree, so it costs them alike
const TIMES = process.env.TIMES === '1';
/** CORP=1: the Corp's own scores as columns crank and cprank (core-hooks.ts CORP_HOOKS; the speed pass's bar 1). */
const CORP = process.env.CORP === '1';
const TIME_PATCHES: Patch[] = [
  [
    'ai/corp/hold.ts',
    'const counted = <T>(f: () => T): T => (pricing().countingHold ? f() : withPricing({ countingHold: true }, f));',
    "const counted = <T>(f: () => T): T => (pricing().countingHold ? f() : (globalThis as any).__lkTime('countingHold', () => withPricing({ countingHold: true }, f)));",
  ],
  [
    'ai/cardPlans.ts',
    'export function handPlanWorth(state: GameState, card: CardInstance): number | undefined {',
    "export function handPlanWorth(state: GameState, card: CardInstance): number | undefined {\n  return (globalThis as any).__lkTime('planning', () => __handPlanWorth(state, card));\n}\nfunction __handPlanWorth(state: GameState, card: CardInstance): number | undefined {",
  ],
];
type Named = Record<string, { ms: number; n: number }>;
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(FAULT_LIST.length ? { fault: FAULT || 'none', ...x } : x));
const key = (a: unknown) => (a === undefined ? 'undefined' : JSON.stringify(a));
const G = globalThis as any;
const NAMES = ['base', 'branch', 'control'] as const;
type Name = (typeof NAMES)[number];
const COLUMNS = ['pick', 'reply', 'rank', 'off', 'run', 'prompt', 'hard', 'oracle', 'rez', 'drank', 'offrank', 'crank', 'cprank', 'legacy', 'value'] as const;
type Column = (typeof COLUMNS)[number];

// ------------------------------------------------------------------------------------------------ trees
function makeTrees(): Record<Name, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  // The base's src from git (a shallow checkout fetches the one commit); the shards of a job fetch at once and git's
  // shallow lock lets one through: the others wait and look again
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
    applyPatches(dir, HOOKS, `tree ${name}`, read, write);
    if (CORP) applyPatches(dir, CORP_HOOKS, `corp ${name}`, read, write);
    if (TIMES) applyPatches(dir, TIME_PATCHES, `times ${name}`, read, write);
    if (name === 'branch' && FAULT) {
      const fault: Patch[] | undefined = FAULTS[FAULT];
      if (!fault) throw new Error(`no fault ${FAULT} (core-faults.ts: ${Object.keys(FAULTS).join(', ')})`);
      applyPatches(dir, fault, `fault ${FAULT}`, read, write);
    }
    dirs[name] = dir;
  }
  return dirs;
}
let T: Record<Name, Tree & { createAgentWith: (side: string, level: string, opts: object) => any }>;

// ------------------------------------------------------------------------------------------------ records
/** FNV-1a, streamed: one per column. */
type Acc = { n: number; h: number };
const fnv = (acc: Acc, x: string) => {
  let h = acc.h;
  for (let i = 0; i < x.length; i++) {
    h ^= x.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // a separator, so ["ab","c"] and ["a","bc"] differ
  h ^= 0x1f;
  acc.h = Math.imul(h, 0x01000193) >>> 0;
  acc.n++;
};
type Rec = Record<Column, Acc>;
const fresh = (): Rec => Object.fromEntries(COLUMNS.map(c => [c, { n: 0, h: 0x811c9dc5 }])) as Rec;
const show = (r: Rec) => Object.fromEntries(COLUMNS.map(c => [c, `${r[c].n}:${r[c].h.toString(16)}`]));

/** Sets the hooks' globals to write into `rec` for tree `t` (cleared again by the returned function). */
function listen(t: Tree, rec: Rec, named: Named = {}): () => void {
  const scopes: string[] = [];
  const timing = new Set<string>();
  G.__lkTime = <T,>(name: string, fn: () => T): T => {
    if (timing.has(name)) return fn();
    timing.add(name);
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      timing.delete(name);
      const a = (named[name] ??= { ms: 0, n: 0 });
      a.ms += performance.now() - t0;
      a.n++;
    }
  };
  const path = () => scopes.join('>');
  const core = t.core;
  G.__lkIn = (gr: any) => {
    scopes.push(gr.__lkScope ?? 'top');
    return () => void scopes.pop();
  };
  G.__lk = (gr: any, kind: string, state: GameState, action: unknown) => {
    const scope: string = gr.__lkScope ?? 'top';
    const at = path() || scope;
    const a = key(action);
    if (kind === 'step') {
      const col: Column | null = scope === 'top' ? 'pick' : scope === 'reply' ? 'reply' : scope === 'oracle' ? 'oracle' : scope.startsWith('hard') ? 'hard' : null;
      if (col) fnv(rec[col], `${at}|${a}`);
      return;
    }
    if (kind === 'off') return fnv(rec.off, `${at}|${a}`);
    if (kind === 'rez') return fnv(rec.rez, `${at}|${a}`);
    // kind 'act': a chooseAction answer
    const side = core.actingSide(state);
    if (core.activePrompt(state)) fnv(rec.prompt, `${at}|${side}|${a}`);
    else if (state.activeRun && side === 'runner') fnv(rec.run, `${at}|${a}`);
    if (side === 'runner') fnv(rec.legacy, String(JSON.stringify(action)));
  };
  // R-B B2: scores bit for bit (String keeps every double; -0 apart from 0)
  const scoreList = (ranked: { action: unknown; score: number }[]) => JSON.stringify(ranked.map(r => [r.action, Object.is(r.score, -0) ? '-0' : String(r.score)]));
  G.__lkDecRank = (_s: GameState, ranked: { action: unknown; score: number }[]) => {
    if (path() === 'top') fnv(rec.drank, scoreList(ranked));
  };
  G.__lkOffRank = (_s: GameState, ranked: { action: unknown; score: number }[]) => {
    if (path() === 'top') fnv(rec.offrank, scoreList(ranked));
  };
  // Speed pass (CORP=1): the deciding Corp's own rank list (top scope only) and every Corp planner playout's rank list
  G.__lkCorpRank = (_s: GameState, ranked: { action: unknown; score: number }[]) => {
    if (path() === 'top') fnv(rec.crank, scoreList(ranked));
  };
  G.__lkCorpPlanRank = (_s: GameState, ranked: { action: unknown; score: number }[]) => fnv(rec.cprank, `${path()}|${scoreList(ranked)}`);
  G.__lkRank = (_s: GameState, ranked: { action: unknown; score: number }[]) => fnv(rec.rank, `${path()}|${JSON.stringify(ranked.map(r => [r.action, String(r.score)]))}`);
  // R-B B1b bar 1 (the value stream): every value an owner or copy hands the diagnostics sink, in order, in every scope
  G.__lkVal = (quantity: string, site: string, value: number) => fnv(rec.value, `${path()}|${quantity}|${site}|${Object.is(value, -0) ? '-0' : String(value)}`);
  G.__lkAns = (where: string, _s: GameState, action: unknown) => {
    fnv(rec.prompt, `${path()}>${where}|runner|${key(action)}`);
    fnv(rec.legacy, String(JSON.stringify(action)));
  };
  return () => {
    G.__lkIn = G.__lk = G.__lkRank = G.__lkAns = G.__lkDecRank = G.__lkOffRank = G.__lkCorpRank = G.__lkCorpPlanRank = G.__lkVal = G.__lkTime = undefined;
  };
}

/** The decision GameRunner.step asks an agent for at `s`, or null (as facts-lockstep.ts). */
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
  return { side, kind: core.activePrompt(s) ? 'prompt' : 'main' };
}

const ms: Record<Name, { corp: number[]; runner: number[] }> = { base: { corp: [], runner: [] }, branch: { corp: [], runner: [] }, control: { corp: [], runner: [] } };
const totals: Record<Name, Rec> = { base: fresh(), branch: fresh(), control: fresh() };
const started = Date.now();
const differing = (r: Record<Name, Rec>, a: Name, b: Name) => COLUMNS.filter(c => r[a][c].n !== r[b][c].n || r[a][c].h !== r[b][c].h);
const addTotals = (n: Name, r: Rec) => {
  for (const c of COLUMNS) totals[n][c].n += r[c].n;
};

// ------------------------------------------------------------------------------------------------ deals
type Deal = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(t: Tree, d: Deal): GameState {
  const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck);
  const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck);
  if (!c || !r) throw new Error(`deal ${d.seed}: deck not found (${d.corpDeck} v ${d.runnerDeck})`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r));
}

function agentsOf(t: Tree, level: 'normal' | 'hard') {
  const opts = level === 'hard' ? { seed: SEED, samples: SAMPLES } : {};
  return { corp: t.createAgentWith('corp', level, opts), runner: t.createAgentWith('runner', level, opts) };
}

function deal(pool: string, d: Deal, level: 'normal' | 'hard', checkRecord: boolean) {
  const g = {} as Record<Name, any>;
  const tms = {} as Record<Name, { corp: number[]; runner: number[] }>;
  for (const n of NAMES) {
    T[n].clear();
    g[n] = new T[n].GameRunner(dealStateOf(T[n], d), agentsOf(T[n], level));
    tms[n] = { corp: [], runner: [] };
  }
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  let steps = 0;
  let diff: Record<string, unknown> | null = null;
  const sums = { base: fresh(), branch: fresh(), control: fresh() } as Record<Name, Rec>;
  const named = { base: {}, branch: {}, control: {} } as Record<Name, Named>;
  const kinds = { base: {}, branch: {}, control: {} } as Record<Name, Named>;
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.base.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const dec = decisionOf(T.base.core, s);
    const res = {} as Record<Name, Rec>;
    const more = {} as Record<Name, boolean>;
    // One step each, in a turn that rotates (no tree always first)
    const order = NAMES.map((_, k) => NAMES[(k + i) % NAMES.length]);
    for (const n of order) {
      res[n] = fresh();
      const stop = listen(T[n], res[n], named[n]);
      const t0 = performance.now();
      try {
        more[n] = g[n].step();
      } finally {
        stop();
      }
      const dt = performance.now() - t0;
      if (dec && more[n]) tms[n][dec.side].push(Math.round(dt * 10) / 10);
      if (dec && more[n] && TIMES) {
        const k = (kinds[n][`${dec.side}:${dec.kind}`] ??= { ms: 0, n: 0 });
        k.ms += dt;
        k.n++;
      }
    }
    if (!more.base && !more.branch && !more.control) break;
    steps++;
    for (const n of NAMES) {
      addTotals(n, res[n]);
      for (const c of COLUMNS) sums[n][c].n += res[n][c].n;
    }
    const vb = differing(res, 'base', 'branch');
    const vc = differing(res, 'base', 'control');
    if (more.base !== more.branch || more.base !== more.control || vb.length || vc.length) {
      diff = { step: i, T: s.turnNumber, side: dec?.side, kind: dec?.kind, branchCols: vb, controlCols: vc, base: show(res.base), branch: show(res.branch), control: show(res.control) };
      break;
    }
    if (!more.base) break;
  }
  const B = g.base.state;
  const recordSame = checkRecord ? !diff && (B.winner ?? null) === d.winner && key(cr) === key(d.cr) && key(sc) === key(d.sc) : null;
  for (const n of NAMES) for (const side of ['corp', 'runner'] as const) ms[n][side].push(...tms[n][side]);
  const counts = Object.fromEntries(COLUMNS.map(c => [c, sums.base[c].n]));
  out({ kind: 'deal', pool, seed: d.seed, steps, counts, recordSame, winner: B.winner ?? null, T: B.turnNumber, diff, ms: tms, ...(TIMES ? { named, kinds } : {}) });
}

// ------------------------------------------------------------------------------------------------ human files
function human(file: string) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  if (!r.moves?.length) return;
  const src = `human:${file.split('/').pop()}`;
  const core = T.base.core;
  let s: GameState;
  if (r.startsAt === 'state') s = structuredClone(r.state);
  else {
    s = core.createInitialGameState(T.base.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
    if (r.startStops) s = { ...s, stops: r.startStops };
  }
  const agents = {} as Record<Name, { corp: any; runner: any }>;
  for (const n of NAMES) {
    T[n].clear();
    agents[n] = agentsOf(T[n], 'normal');
  }
  const tms = { base: { corp: [], runner: [] }, branch: { corp: [], runner: [] }, control: { corp: [], runner: [] } } as Record<Name, { corp: number[]; runner: number[] }>;
  let decisions = 0;
  const diffs: Record<string, unknown>[] = [];
  const errors: string[] = [];
  const sums = { base: fresh(), branch: fresh(), control: fresh() } as Record<Name, Rec>;
  let stopped: string | null = null;
  for (const [j, move] of (r.moves as any[]).entries()) {
    const ai = { ...s, stops: { corp: 'ai', runner: 'ai' } } as GameState;
    const d = decisionOf(core, ai);
    if (d) {
      decisions++;
      const res = {} as Record<Name, Rec>;
      const err = {} as Record<Name, string>;
      const order = NAMES.map((_, k) => NAMES[(k + j) % NAMES.length]);
      for (const n of order) {
        res[n] = fresh();
        const stop = listen(T[n], res[n]);
        const g = new T[n].GameRunner(structuredClone(ai), agents[n]);
        const t0 = performance.now();
        try {
          g.step();
          err[n] = '';
        } catch (e) {
          err[n] = `error: ${(e as Error).message.slice(0, 120)}`;
          errors.push(`${n} moves[${j}]: ${err[n]}`);
        } finally {
          stop();
        }
        tms[n][d.side].push(Math.round((performance.now() - t0) * 10) / 10);
      }
      for (const n of NAMES) {
        addTotals(n, res[n]);
        for (const c of COLUMNS) sums[n][c].n += res[n][c].n;
      }
      const vb = differing(res, 'base', 'branch');
      const vc = differing(res, 'base', 'control');
      if (vb.length || vc.length || err.base !== err.branch || err.base !== err.control) diffs.push({ at: j, T: s.turnNumber, side: d.side, kind: d.kind, branchCols: vb, controlCols: vc, err });
    }
    try {
      s = core.executeAction(s, move);
    } catch (e) {
      stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
      break;
    }
  }
  for (const n of NAMES) for (const side of ['corp', 'runner'] as const) ms[n][side].push(...tms[n][side]);
  const counts = Object.fromEntries(COLUMNS.map(c => [c, sums.base[c].n]));
  out({ kind: 'human', src, moves: r.moves.length, stopped, decisions, counts, diffs: diffs.length, first: diffs.slice(0, 3), errors: errors.slice(0, 3), ms: tms });
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const dirs = makeTrees();
  T = {} as typeof T;
  for (const n of NAMES) {
    T[n] = (await loadTree(n, dirs[n])) as Tree & { createAgentWith: (side: string, level: string, opts: object) => any };
    // createAgent with SearchOptions (the Hard leg's seed and samples): the tree's own ai/index.ts
    const ai = await import(/* @vite-ignore */ join(dirs[n], 'src', 'ai/index.ts'));
    T[n].createAgentWith = (side: string, level: string, opts: object) => ai.createAgent(side, level, opts);
    if (VALUES) {
      // R-B B1b: one sink per tree for the whole run, installed at the top level (after the tree's graph has loaded, so
      // the load order is the tree's own); it only hands each value to the column
      const diag = await import(/* @vite-ignore */ join(dirs[n], 'src', 'ai/diagnostics.ts'));
      const sink = diag.installDiagnostics();
      sink.onValue = (quantity: string, site: string, _state: unknown, value: number) => G.__lkVal?.(quantity, site, value);
    }
    if (POOLS.includes('oracle')) {
      if (POOLS.length !== 1) throw new Error('POOL=oracle runs alone (plan.oracle.safestRemote is set for the whole process)');
      T[n].synergy.applyPlanOff('+oracle.safestRemote');
    }
  }
  // RECORDS_BATCH / RECORDS_NRDB / RECORDS_G3 (R-B B1b bar 1): the base tree's own records (a base run's deals.json), so
  // recordSame checks the base against the run it stands for; g3 (its deals, 3 games each) only with RECORDS_G3
  const records = (name: string, fallback: string) => JSON.parse(readFileSync(process.env[name] ?? fallback, 'utf8')) as Deal[];
  const batch = records('RECORDS_BATCH', 'scripts/runner-rework/facts-deals-45444888753.json');
  const nrdb = records('RECORDS_NRDB', 'scripts/runner-rework/facts-deals-45458221138.json');
  const pick = (recs: Deal[]) => recs.filter(r => !DEALS.length || DEALS.includes(String(r.seed)));
  const sources: { pool: string; id: any }[] = [];
  for (const pool of POOLS) {
    if (pool === 'batch') for (const r of pick(batch)) sources.push({ pool, id: r });
    else if (pool === 'nrdb') for (const r of pick(nrdb)) sources.push({ pool, id: r });
    else if (pool === 'g3') for (const r of pick(records('RECORDS_G3', 'RECORDS_G3 is required for POOL=g3'))) sources.push({ pool, id: r });
    else if (pool === 'hard') for (const r of pick(batch).slice(0, HARD_DEALS)) sources.push({ pool, id: r });
    else if (pool === 'oracle') for (const r of pick(batch).slice(0, ORACLE_DEALS)) sources.push({ pool, id: r });
    else if (pool === 'human') {
      const dir = 'tests/fixtures/human-games';
      for (const f of readdirSync(dir).filter(f => f.endsWith('.json') && (!DEALS.length || DEALS.includes(f.slice(0, -5)))).sort()) sources.push({ pool, id: join(dir, f) });
    } else throw new Error(`unknown pool ${pool}`);
  }
  for (const [k, src] of sources.entries()) {
    if (sub >= subs || k % subs !== sub) continue;
    if (Date.now() - started > MAX_MS) break;
    try {
      if (src.pool === 'human') human(src.id);
      else deal(src.pool, src.id, src.pool === 'hard' ? 'hard' : 'normal', src.pool === 'batch' || src.pool === 'nrdb' || src.pool === 'g3');
    } catch (e) {
      out({ kind: 'error', pool: src.pool, src: src.pool === 'human' ? src.id : src.id.seed, error: (e as Error).stack?.slice(0, 400) });
    }
  }
  out({ kind: 'totals', fault: FAULT || null, counts: Object.fromEntries(NAMES.map(n => [n, Object.fromEntries(COLUMNS.map(c => [c, totals[n][c].n]))])) });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
