/**
 * R-B O1b (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/o1b-trash-owner.md rev 2, tracker R-14f): step 0.2
 * (trashNet's fires on the base tree, by cause), step 0.4 (the planted faults through bar 2's check), step 0.5 (time
 * against a control arm), step 0.6 (the Corp side's count: a seen, unrezzed Public Access Plaza rezzed before its access
 * when the Corp could pay), bar 2 (where play may change) and bar 6 (MODE=play). Adapted from trash-floor.ts (O1a), whose
 * classes, records and sums it keeps; hooks and faults: trash-owner-hooks.ts (OWNER, FACT, FAULTS) and
 * trash-floor-hooks.ts (CARRY, LOOK), call-only text patches on scratch copies of src.
 *
 * MODE=fires (step 0.2, 0.6): the BASE tree (git archive of BASE, default beta ad25482, the src of g1 45553599707 and
 * NRDB=1 g1 45555227992) plays every deal of the pools to its end. At each top-level decision it records whether any
 * trashNet call under it would return a value different (by more than 0.001) from the base's on the branch, by the class
 * of the call (`own`, `plan`, the nested scope `reply`, `hardR`, `hardC`, `oracle`, and the carried reads `memo`, `line`,
 * `off`) and by cause (`tag`, `cost`, `purseOut`, `purseRun`, `blocked`, `grip`; trash-owner-hooks.ts). The deal's record
 * (winner, cr, sc) must equal the batch's: the hook computes beside the base and changes no play. Step 0.6: every run on a
 * server whose root holds an unrezzed Plaza the Runner has seen (its memory), with the Corp's purse against the Plaza's rez
 * cost at the approach to the server and whether the Plaza was rezzed when the breach began.
 *
 * MODE=lockstep (step 0.4, 0.5 and bar 2): three trees step together to the first step whose records differ (core-hooks.ts
 * columns). `base` is BASE's src with every hook and the OWNER hook live; `control` is the same text with OWNER's global
 * unset (so it times the base's own work); `branch` is this checkout's src (LEG=branch) or BASE's src with one planted
 * fault (LEG=seen001, hq001). At the first differing step the line carries the base tree's fires at that step, with their
 * causes. Time: ms of every step that asks an agent, by side, per tree, over the steps the three trees play alike.
 *
 * MODE=play (bar 6): as trash-floor.ts MODE=play: the g3 deals on one tree per leg (LEGS=base,branch), no hook, each game's
 * record and the Corp side's counts, plus tags the Runner took.
 *
 * POOL=batch,nrdb (the 221 deals of g1 45553599707, the 110 of NRDB=1 g1 45555227992); DEALS=seed,... or PER_POOL=n.
 *
 *   ARGS="MODE=fires"; ARGS="MODE=lockstep LEGS=branch,seen001,hq001 PER_POOL=20" (step 0.4, 0.5); ARGS="MODE=lockstep LEGS=branch" (bar 2)
 *   ARGS="MODE=fires POOL=nrdb DEALS=1001 MAX_STEPS=300" npx vite-node scripts/runner-rework/trash-owner.ts (a local minute)
 *
 * No hidden read by any arm: the script reads only what the hooks hand it (values the AI computed), the Runner agent's own
 * memory (step 0.6: what it has seen), and the game's public record.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Tree, loadTree } from './facts-trees';
import { HOOKS, Patch, applyPatches } from './core-hooks';
import { CARRY, LOOK } from './trash-floor-hooks';
import { FACT, FAULTS, OWNER } from './trash-owner-hooks';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const MODE = process.env.MODE ?? 'fires';
const BASE = process.env.BASE ?? 'ad254825ff2afe2e2a18e99b89adc5954718b04e';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/trash-owner', String(shard));
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const PER_POOL = Number(process.env.PER_POOL ?? Infinity);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 4000);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity);
const LEGS = MODE === 'lockstep' ? (process.env.LEGS ?? 'branch').split(',').filter(Boolean) : MODE === 'play' ? (process.env.LEGS ?? 'base,branch').split(',').filter(Boolean) : ['fires'];
const LEG = LEGS[shard % LEGS.length];
const [sub, subs] = LEGS.length > 1 ? [Math.floor(shard / LEGS.length), Math.floor(shards / LEGS.length)] : [shard, shards];
const out = (x: Record<string, unknown>) => console.log(JSON.stringify({ mode: MODE, leg: LEG, ...x }));
const key = (a: unknown) => (a === undefined ? 'undefined' : JSON.stringify(a));
const G = globalThis as any;
const NAMES = (MODE === 'lockstep' ? ['base', 'branch', 'control'] : MODE === 'play' ? [LEG === 'branch' ? 'branch' : 'base'] : ['base']) as Name[];
type Name = 'base' | 'branch' | 'control';
const COLUMNS = ['pick', 'reply', 'rank', 'off', 'run', 'prompt', 'hard', 'oracle', 'rez', 'legacy'] as const;
type Column = (typeof COLUMNS)[number];

// ------------------------------------------------------------------------------------------------ trees
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
    const checkout = name === 'branch' && LEG === 'branch';
    if (checkout) cpSync('src', join(dir, 'src'), { recursive: true });
    else execSync(`git archive ${BASE} src | tar -x -C ${dir}`);
    // MODE=play: the tree as it is, no hook (the batch's own play)
    if (MODE === 'play') {
      dirs[name] = dir;
      continue;
    }
    // The OWNER hook and the fact go on BASE's src only (the branch's trashNet is the new value itself)
    const patches: Patch[] = [...HOOKS, ...(checkout ? [] : [...FACT, ...OWNER]), ...CARRY, ...LOOK];
    applyPatches(dir, patches, `tree ${name}`, read, write);
    if (name === 'branch' && !checkout) {
      const fault = FAULTS[LEG];
      if (!fault) throw new Error(`no leg ${LEG} (branch, or a fault of trash-owner-hooks.ts: ${Object.keys(FAULTS).join(', ')})`);
      applyPatches(dir, fault, `fault ${LEG}`, read, write);
    }
    dirs[name] = dir;
  }
  return dirs;
}
let T: Record<Name, Tree>;

// ------------------------------------------------------------------------------------------------ fires
/** One tree's fire bookkeeping (trash-floor-hooks.ts): the counter, the marks, and the classes seen in the current step. */
class Fires {
  /** The OWNER hook is live on this tree (the base tree; the control tree carries its text with the global unset). */
  constructor(readonly owner: boolean) {}
  count = 0;
  step = new Set<string>();
  cards = new Set<string>();
  causes = new Set<string>();
  scopes: string[] = [];
  look = { corp: 0, runner: 0 };
  memos = new WeakMap<Map<string, unknown>, Set<string>>();
  lines = new WeakSet<object>();
  held = new WeakMap<object, boolean>();
  stepStart = 0;
  /** The class of a call made now: the nested GameRunner scope, else the Runner planner's playouts, else the agent's own. */
  cls(): string {
    if (this.scopes.length > 1) return this.scopes[1];
    return this.look.runner > 0 ? 'plan' : 'own';
  }
  fire(cls: string) {
    this.count++;
    this.step.add(cls);
  }
  begin() {
    this.step = new Set();
    this.cards = new Set();
    this.causes = new Set();
    this.stepStart = this.count;
  }
  /** Sets the hooks' globals to this tree's bookkeeping (core-hooks' scope hook is wrapped to keep the scope path). */
  install() {
    G.__toNet = this.owner
      ? (old: number, code: string, res: { value: number; causes: string[] }) => {
          if (!(Math.abs(res.value - old) > 0.001)) return;
          this.fire(this.cls());
          this.cards.add(code);
          for (const c of res.causes) this.causes.add(c);
        }
      : undefined;
    G.__tfCount = () => this.count;
    G.__tfMemoEnd = (m: number | undefined, map: Map<string, unknown>, k: string) => {
      if (m === undefined || this.count <= m) return;
      let set = this.memos.get(map);
      if (!set) this.memos.set(map, (set = new Set()));
      set.add(k);
    };
    G.__tfMemoHit = (map: Map<string, unknown>, k: string) => {
      if (this.memos.get(map)?.has(k)) this.fire(`memo:${this.cls()}`);
    };
    G.__tfPlanSet = (memory: object, chosen: boolean) => {
      if (chosen && this.count > this.stepStart) this.lines.add(memory);
      else this.lines.delete(memory);
    };
    G.__tfPlanHit = (memory: object) => {
      if (this.lines.has(memory)) this.fire(`line:${this.cls()}`);
    };
    G.__tfHeld = (agent: object, f0: number | undefined) => this.held.set(agent, f0 !== undefined && this.count > f0);
    G.__tfHeldRead = (agent: object) => {
      if (this.held.get(agent)) this.fire(`off:${this.cls()}`);
    };
    G.__tfLook = (side: 'corp' | 'runner', d: number) => {
      this.look[side] += d;
    };
  }
}
const uninstall = () => {
  G.__toNet = G.__tfCount = G.__tfMemoEnd = G.__tfMemoHit = G.__tfPlanSet = G.__tfPlanHit = G.__tfHeld = G.__tfHeldRead = G.__tfLook = undefined;
};

// ------------------------------------------------------------------------------------------------ records (core-lockstep.ts)
type Acc = { n: number; h: number };
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
type Rec = Record<Column, Acc>;
const fresh = (): Rec => Object.fromEntries(COLUMNS.map(c => [c, { n: 0, h: 0x811c9dc5 }])) as Rec;

/** The hooks' globals for tree `t` writing into `rec`, and the fire bookkeeping `f` (cleared by the returned function). */
function listen(t: Tree, rec: Rec, f: Fires): () => void {
  const scopes = f.scopes;
  scopes.length = 0;
  const path = () => scopes.join('>');
  const core = t.core;
  f.install();
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
    const side = core.actingSide(state);
    if (core.activePrompt(state)) fnv(rec.prompt, `${at}|${side}|${a}`);
    else if (state.activeRun && side === 'runner') fnv(rec.run, `${at}|${a}`);
    if (side === 'runner') fnv(rec.legacy, String(JSON.stringify(action)));
  };
  G.__lkRank = (_s: GameState, ranked: { action: unknown; score: number }[]) => fnv(rec.rank, `${path()}|${JSON.stringify(ranked.map(r => [r.action, String(r.score)]))}`);
  G.__lkAns = (where: string, _s: GameState, action: unknown) => {
    fnv(rec.prompt, `${path()}>${where}|runner|${key(action)}`);
    fnv(rec.legacy, String(JSON.stringify(action)));
  };
  return () => {
    G.__lkIn = G.__lk = G.__lkRank = G.__lkAns = undefined;
    uninstall();
  };
}

/** The decision GameRunner.step asks an agent for at `s`, or null (as core-lockstep.ts); 'run' is a Runner main decision in a run. */
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
  if (core.activePrompt(s)) return { side, kind: 'prompt' };
  return { side, kind: side === 'runner' && s.activeRun ? 'run' : 'main' };
}

// ------------------------------------------------------------------------------------------------ deals
type Deal = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(t: Tree, d: Deal): GameState {
  const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck);
  const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck);
  if (!c || !r) throw new Error(`deal ${d.seed}: deck not found (${d.corpDeck} v ${d.runnerDeck})`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r));
}
const agentsOf = (t: Tree) => ({ corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') });

/** MODE=fires: the base tree plays the deal to its end; each decision's fire classes, summed per deal. */
function firesDeal(pool: string, d: Deal) {
  const t = T.base;
  t.clear();
  const ag = agentsOf(t);
  const g = new t.GameRunner(dealStateOf(t, d), ag);
  const f = new Fires(true);
  const causes: Record<string, number> = {};
  const causeBy: Record<string, number> = {};
  // Step 0.6: runs on a server whose root holds an unrezzed Plaza the Runner has seen
  const plazaRuns = new Map<string, { T: number; id: string; asked: boolean; couldPay: boolean | null; rezzedAtBreach: boolean | null; trashOffered: boolean; trashed: boolean }>();
  const memory: Map<string, string> | undefined = (ag.runner as any).memory;
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  // by "side:kind": decisions, decisions with a fire, and with a fire of each class
  const by: Record<string, { n: number; fired: number; own: number; cls: Record<string, number> }> = {};
  const cards: Record<string, number> = {};
  let firstFire: { step: number; T: number; side: string; kind: string } | null = null;
  let steps = 0;
  const t0 = performance.now();
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const dec = decisionOf(t.core, s);
    const pr = plazaRun(t, s, plazaRuns, memory);
    const ask = t.core.activePrompt(s);
    f.begin();
    const stop = listen(t, fresh(), f);
    let more: boolean;
    try {
      more = g.step();
    } finally {
      stop();
    }
    if (!more) break;
    steps++;
    if (pr) {
      if (dec?.kind === 'rez' && s.activeRun?.phase === 'approach_server') pr.asked = true;
      if (ask?.kind === 'access_trash' && ask.cardInstanceId === pr.id) {
        pr.trashOffered = true;
        const a: any = g.last;
        if (a?.type === 'RESOLVE_PROMPT' && a.choice?.trash) pr.trashed = true;
      }
    }
    if (dec) {
      const k = `${dec.side}:${dec.kind}`;
      const row = (by[k] ??= { n: 0, fired: 0, own: 0, cls: {} });
      row.n++;
      if (f.step.size) {
        row.fired++;
        if (f.step.has('own')) row.own++;
        for (const c of f.step) row.cls[c] = (row.cls[c] ?? 0) + 1;
        for (const c of f.cards) cards[c] = (cards[c] ?? 0) + 1;
        for (const c of f.causes) {
          causes[c] = (causes[c] ?? 0) + 1;
          causeBy[`${k}|${c}`] = (causeBy[`${k}|${c}`] ?? 0) + 1;
        }
        firstFire ??= { step: i, T: s.turnNumber, side: dec.side, kind: dec.kind };
      }
    }
  }
  const B = g.state;
  const recordSame = (B.winner ?? null) === d.winner && key(cr) === key(d.cr) && key(sc) === key(d.sc);
  out({ kind: 'deal', pool, seed: d.seed, steps, recordSame, winner: B.winner ?? null, T: B.turnNumber, by, cards, causes, causeBy, firstFire, plazaRuns: [...plazaRuns.values()], ms: Math.round(performance.now() - t0) });
}

const PLAZA = '35062';
/** Step 0.6: the record of the run in progress on a server whose root held an unrezzed Plaza the Runner had seen when the
 * run began (null otherwise); updated with the Corp's purse at the approach to the server and the Plaza at the breach. */
function plazaRun(t: Tree, s: GameState, runs: Map<string, any>, memory: Map<string, string> | undefined): any {
  const run = s.activeRun;
  if (!run || run.accessOnly) return null;
  const key = `${s.turnNumber}:${s.runsThisTurn.length}:${run.server}`;
  const root = s.corp.servers[run.server]?.root ?? [];
  let rec = runs.get(key);
  if (!rec && run.phase !== 'access' && !run.breached) {
    const p = root.find(c => c.cardCode === PLAZA && !c.isRezzed && memory?.has(c.instanceId));
    if (!p) return null;
    runs.set(key, (rec = { T: s.turnNumber, id: p.instanceId, asked: false, couldPay: null, rezzedAtBreach: null, trashOffered: false, trashed: false }));
  }
  if (!rec) return null;
  const p = root.find(c => c.instanceId === rec.id);
  if (p && !run.breached && run.phase === 'approach_server' && !p.isRezzed) rec.couldPay = t.core.availableCredits(s, 'corp') >= t.core.rezCostOf(s, p);
  if (p && run.breached && rec.rezzedAtBreach === null) rec.rezzedAtBreach = p.isRezzed;
  return rec;
}

const differing = (r: Record<Name, Rec>, a: Name, b: Name) => COLUMNS.filter(c => r[a][c].n !== r[b][c].n || r[a][c].h !== r[b][c].h);
const ms: Record<Name, { corp: number; runner: number; steps: number }> = { base: { corp: 0, runner: 0, steps: 0 }, branch: { corp: 0, runner: 0, steps: 0 }, control: { corp: 0, runner: 0, steps: 0 } };

/** MODE=lockstep: the three trees step together to the first step that differs; the base tree's fires at that step. */
function lockstepDeal(pool: string, d: Deal) {
  const g = {} as Record<Name, any>;
  const f = {} as Record<Name, Fires>;
  for (const n of NAMES) {
    T[n].clear();
    g[n] = new T[n].GameRunner(dealStateOf(T[n], d), agentsOf(T[n]));
    f[n] = new Fires(n === 'base');
  }
  const tms = { base: { corp: 0, runner: 0 }, branch: { corp: 0, runner: 0 }, control: { corp: 0, runner: 0 } } as Record<Name, { corp: number; runner: number }>;
  let steps = 0;
  let firedSteps = 0;
  let diff: Record<string, unknown> | null = null;
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.base.state;
    const dec = decisionOf(T.base.core, s);
    const res = {} as Record<Name, Rec>;
    const more = {} as Record<Name, boolean>;
    const dt = {} as Record<Name, number>;
    const order = NAMES.map((_, k) => NAMES[(k + i) % NAMES.length]);
    for (const n of order) {
      res[n] = fresh();
      f[n].begin();
      const stop = listen(T[n], res[n], f[n]);
      const t0 = performance.now();
      try {
        more[n] = g[n].step();
      } finally {
        stop();
      }
      dt[n] = performance.now() - t0;
    }
    if (!more.base && !more.branch && !more.control) break;
    const vb = differing(res, 'base', 'branch');
    const vc = differing(res, 'base', 'control');
    if (more.base !== more.branch || more.base !== more.control || vb.length || vc.length) {
      diff = { step: i, T: s.turnNumber, side: dec?.side, kind: dec?.kind, branchCols: vb, controlCols: vc, fires: [...f.base.step], cards: [...f.base.cards], causes: [...f.base.causes], controlFires: [...f.control.step] };
      break;
    }
    steps++;
    if (f.base.step.size) firedSteps++;
    if (dec) for (const n of NAMES) tms[n][dec.side] += dt[n];
    if (!more.base) break;
  }
  for (const n of NAMES) {
    ms[n].corp += tms[n].corp;
    ms[n].runner += tms[n].runner;
    ms[n].steps += steps;
  }
  const round = (x: { corp: number; runner: number }) => ({ corp: Math.round(x.corp), runner: Math.round(x.runner) });
  out({ kind: 'deal', pool, seed: d.seed, steps, firedSteps, T: g.base.state.turnNumber, diff, ms: { base: round(tms.base), branch: round(tms.branch), control: round(tms.control) } });
}


/** MODE=play: one g3 game on the leg's tree, plain GameRunner, its record and bar 6's counts. */
function playDeal(d: Deal & { game: number }) {
  const t = T[NAMES[0]];
  t.clear();
  const g = new t.GameRunner(dealStateOf(t, d), agentsOf(t));
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  const runs: Record<string, number> = { hq: 0, rd: 0, archives: 0, remote: 0 };
  let bareRemoteRuns = 0;
  const stolen: Record<string, number> = { hq: 0, rd: 0, archives: 0, remote: 0, other: 0 };
  const offered: Record<string, number> = {};
  const trashed: Record<string, number> = {};
  let gained = 0;
  let tags = 0;
  const where = (id: string) => (id === 'hq' || id === 'rd' || id === 'archives' ? id : 'remote');
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const p = t.core.activePrompt(s);
    if (!g.step()) break;
    const n: GameState = g.state;
    const a: any = g.last;
    if (n.corp.credits > s.corp.credits) gained += n.corp.credits - s.corp.credits;
    if (n.runner.tags > s.runner.tags) tags += n.runner.tags - s.runner.tags;
    if (n.runsThisTurn.length > s.runsThisTurn.length && n.turnNumber === s.turnNumber) {
      const id = n.runsThisTurn[n.runsThisTurn.length - 1].server;
      runs[where(id)]++;
      const sv = n.corp.servers[id];
      if (where(id) === 'remote' && sv && sv.root.length > 0 && sv.root.every((c: any) => c.isRezzed || c.faceUp)) bareRemoteRuns++;
    }
    if (n.runner.score > s.runner.score) stolen[s.activeRun ? where(s.activeRun.server) : 'other'] += n.runner.score - s.runner.score;
    if (p?.kind === 'access_trash' && a?.player === 'runner' && a.type === 'RESOLVE_PROMPT' && a.choice?.kind === 'access_trash') {
      const card = [...Object.values(s.corp.servers).flatMap((v: any) => [...v.root, ...v.ice]), ...s.corp.hq, ...s.corp.rd, ...s.corp.archives.faceUp, ...s.corp.archives.faceDown].find((c: any) => c.instanceId === p.cardInstanceId);
      const type = card ? t.core.getCardDefinition(card.cardCode).type_code : 'other';
      offered[type] = (offered[type] ?? 0) + 1;
      if (a.choice.trash || a.choice.alternativeId) trashed[type] = (trashed[type] ?? 0) + 1;
    }
  }
  const B = g.state;
  out({ kind: 'game', seed: d.seed, game: d.game, corpDeck: d.corpDeck, runnerDeck: d.runnerDeck, winner: B.winner ?? null, cr, sc, T: B.turnNumber, runs, bareRemoteRuns, stolen, offered, trashed, gained, tags });
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const dirs = makeTrees();
  T = {} as typeof T;
  for (const n of NAMES) T[n] = await loadTree(n, dirs[n]);
  const batch: Deal[] = JSON.parse(readFileSync('scripts/runner-rework/trash-owner-deals-45553599707.json', 'utf8'));
  const nrdb: Deal[] = JSON.parse(readFileSync('scripts/runner-rework/trash-owner-deals-45555227992.json', 'utf8'));
  const pick = (recs: Deal[]) => recs.filter(r => !DEALS.length || DEALS.includes(String(r.seed))).slice(0, PER_POOL);
  const sources: { pool: string; d: Deal }[] = [];
  if (MODE === 'play') {
    // corp-losses.ts's pairings (shipped decks, no DECKS filter) and seeds, games 0..GAMES-1, stride 10
    const games = Number(process.env.GAMES ?? 3);
    let pairing = 0;
    for (const c of ALL_DECKS.filter(x => x.side === 'corp'))
      for (const r of ALL_DECKS.filter(x => x.side === 'runner')) {
        pairing++;
        for (let game = 0; game < games; game++) {
          const seed = 1000 + (pairing - 1) * Math.max(10, games) + game + 1;
          if (!DEALS.length || DEALS.includes(String(seed))) sources.push({ pool: 'g3', d: { seed, game, corpDeck: c.name, runnerDeck: r.name, winner: null, cr: [], sc: [] } as Deal });
        }
      }
  }
  for (const pool of MODE === 'play' ? [] : POOLS) {
    if (pool === 'batch') for (const d of pick(batch)) sources.push({ pool, d });
    else if (pool === 'nrdb') for (const d of pick(nrdb)) sources.push({ pool, d });
    else throw new Error(`unknown pool ${pool}`);
  }
  const started = Date.now();
  for (const [k, src] of sources.entries()) {
    if (sub >= subs || k % subs !== sub) continue;
    if (Date.now() - started > MAX_MS) break;
    try {
      if (MODE === 'fires') firesDeal(src.pool, src.d);
      else if (MODE === 'play') playDeal(src.d as Deal & { game: number });
      else if (MODE === 'lockstep') lockstepDeal(src.pool, src.d);
      else throw new Error(`unknown MODE ${MODE}`);
    } catch (e) {
      out({ kind: 'error', pool: src.pool, seed: src.d.seed, error: (e as Error).stack?.slice(0, 400) });
    }
  }
  if (MODE === 'lockstep') out({ kind: 'time', ms: Object.fromEntries(NAMES.map(n => [n, { corp: Math.round(ms[n].corp), runner: Math.round(ms[n].runner), steps: ms[n].steps }])) });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
