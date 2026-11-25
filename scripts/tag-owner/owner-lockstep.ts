/**
 * F108 build (brief /mnt/project-files/netrunner-ai/tag-owner/brief-build.md rev 1): step 0.1, 0.4, 0.6 and bar 2.
 * Every tree is a scratch copy (trees.ts patches; the repo's src is never written). The patched trees are built from
 * the merge base's src (ARM_BASE, a full SHA: trees.ts armSource), the leg's tree from this checkout's src.
 *
 * MODE=lockstep (step 0.1, 0.6, bar 2): four trees play each deal by a plain GameRunner, one step each in a turn that
 * rotates:
 *   leg         this checkout's src (LEG=branch), or that src with one planted fault (LEG=<a FAULTS name>);
 *   ownerOnce5  the merge base's src with the counted arm's patches plus item 5 (trees.ts PATCHES.ownerOnce5);
 *   control     ownerOnce5 again: the time control, and a check that the counted tree is reproducible;
 *   base        the merge base's src as it is: stepped beside the leg only until its first difference (the report of
 *               where each deal first moves; BASE=0 leaves it out).
 * Every tree has one RECORD patch, which only writes a global: each HeuristicRunnerAI.chooseAction's answer, so the
 * Runner steps inside a decision (the Corp's reply Runners, the planner's rollouts) are compared too. At every step the
 * action and the hash of the inner Runner answers must be equal in leg, ownerOnce5 and control: the first step that
 * differs is a STOP, reported, and the deal ends there. Time: ms of every step that asks an agent, by side and kind
 * (main, prompt, rez, off), per tree, over the steps played alike.
 * LEGS=a,b,...: shard s runs leg (s % n) over the deals k with k % (shards / n) == floor(s / n). PER_POOL=n: the first
 * n deals of each pool only (step 0: 10).
 *
 * MODE=report (bar 2's report, not a bar): a copy of this checkout's src plays each deal (GameRunner, its agents only
 * watched, never asked or cleared); at every decision two trees decide on a structuredClone, each a fresh Normal agent
 * given the playing agent's own fields, caches cleared: `vs` and `ctl` (the checkout's src again; the asking's own
 * noise). VS=base (default): the merge base's src with FIRE hooks. VS=ownerOnce (step 0.3, what item 5 moves): the
 * merge base's src with the counted ownerOnce patches; every difference is written with the board's tags and whether a
 * B-1001 is installed, rezzed and known to the Runner. The share of decisions where vs's answer differs from ctl's, by
 * side and kind; and (VS=base) the share of decisions with a value-changing fire on the base tree under its answer:
 *   perTurn     perTurn for a Runner card at the tagged rate (effectValues.ts tagRisk true, owner 'runner');
 *   payoutWait  payoutWait for a Runner card on a tagged board (not `left`);
 *   evaluate    evaluate on a tagged board (the Corp strength's tagsWorth line);
 *   b1001       B-1001's entry while the Runner is tagged.
 *
 *   ARGS="MODE=lockstep LEGS=branch,turn001,hq001 PER_POOL=10 ARM_BASE=<sha>"   (step 0.1, 0.4, 0.6)
 *   ARGS="MODE=lockstep LEGS=branch ARM_BASE=<sha>"                             (bar 2, every g1 deal of both pools)
 *   ARGS="MODE=report ARM_BASE=<sha>"                                           (bar 2's report)
 *   ARGS="MODE=report VS=ownerOnce PER_POOL=10 ARM_BASE=<sha>"                  (step 0.3)
 *
 * No hidden read: the script compares answers the agents gave and the game's public record.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { PATCHES, Patch, armSource } from './trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const MODE = process.env.MODE ?? 'lockstep';
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const PER_POOL = Number(process.env.PER_POOL ?? 0);
const LEGS = (process.env.LEGS ?? 'branch').split(',');
const WITH_BASE = process.env.BASE !== '0';
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 4000);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/tag-owner-lockstep', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const key = (a: unknown) => (a ? JSON.stringify(a) : 'null');
const G = globalThis as any;
const RUNS: Record<string, string> = { batch: '45553599707', nrdb: '45555227992' };

// ------------------------------------------------------------------------------------------------ patches
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
/**
 * Step 0.6's planted faults, on the leg's tree (this checkout's text), each touching no tag:
 *   turn001  0.01 on a Runner card's per-turn risk (perTurn's untagged rate, which the build now reads tagged or not)
 *   hq001    0.01 added to HQ's term of the run's price (runs.ts, as O1a's step 0.3 fault)
 */
const FAULTS: Record<string, Patch[]> = {
  turn001: [
    [
      'ai/effectValues.ts',
      `  const risk = typeof owner === 'number' ? owner : owner === 'corp' ? PAYOUT_RISK.corpBare : PAYOUT_RISK.runnerUntagged;`,
      `  const risk = typeof owner === 'number' ? owner : owner === 'corp' ? PAYOUT_RISK.corpBare : PAYOUT_RISK.runnerUntagged + 0.01;`,
    ],
  ],
  hq001: [
    [
      'ai/runs.ts',
      `    value = unchosen === 0 ? 0 : Math.min(accesses, unchosen) * hqAgendaOdds(state, odds) * central * 0.5 ** repeat;`,
      `    value = unchosen === 0 ? 0 : Math.min(accesses, unchosen) * hqAgendaOdds(state, odds) * central * 0.5 ** repeat + 0.01;`,
    ],
  ],
};
/** MODE=report: the base tree's value-changing fires, each a flag set on the global __fire while one is set. */
const F = `(globalThis as any).__fire`;
const FIRE: Patch[] = [
  [
    'ai/effectValues.ts',
    `  const tagRisk = state.runner.tags > 0 && !(plan().ownTrashRisk && actingSide() === 'corp');\n`,
    `  const tagRisk = state.runner.tags > 0 && !(plan().ownTrashRisk && actingSide() === 'corp');\n  if (tagRisk && owner === 'runner' && ${F}) ${F}.perTurn = 1;\n`,
  ],
  [
    'ai/cardProfiles.ts',
    `  const risk = owner === 'corp' ? assetRisk(state, iced) : (state.runner.tags > 0 ? PAYOUT_RISK.runnerTagged : PAYOUT_RISK.runnerUntagged);`,
    `  if (owner === 'runner' && state.runner.tags > 0 && ${F}) ${F}.payoutWait = 1;\n  const risk = owner === 'corp' ? assetRisk(state, iced) : (state.runner.tags > 0 ? PAYOUT_RISK.runnerTagged : PAYOUT_RISK.runnerUntagged);`,
  ],
  [
    'ai/evaluate.ts',
    `  if (state.winner) return logValue('gameEnd', 'evaluate', state, state.winner === side ? 1000 : -1000, side);\n`,
    `  if (state.winner) return logValue('gameEnd', 'evaluate', state, state.winner === side ? 1000 : -1000, side);\n  if (state.runner.tags > 0 && ${F}) ${F}.evaluate = 1;\n`,
  ],
  [
    'ai/cards/liberation.ts',
    `    corp: (state, _code, { cost, tag }) => ({ keep: Math.max(0.3, (state.runner.tags > 0 ? tag + 2 : 0.5) - cost) }),`,
    `    corp: (state, _code, { cost, tag }) => {\n      if (state.runner.tags > 0 && ${F}) ${F}.b1001 = 1;\n      return { keep: Math.max(0.3, (state.runner.tags > 0 ? tag + 2 : 0.5) - cost) };\n    },`,
  ],
];
const FIRE_CLASSES = ['perTurn', 'payoutWait', 'evaluate', 'b1001'] as const;

function patchTree(dir: string, name: string, patches: Patch[]) {
  for (const [f, at, to] of patches) {
    const path = join(dir, 'src', f);
    const text = readFileSync(path, 'utf8');
    if (text.split(at).length !== 2) throw new Error(`${name} tree: a patch does not match once in ${f}: ${at.slice(0, 90)}`);
    writeFileSync(path, text.replace(at, () => to));
  }
}
/** A tree: a copy of `from` (a src directory) with the patches, under root/name. */
function tree(name: string, from: string, patches: Patch[]): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  cpSync(from, join(dir, 'src'), { recursive: true });
  patchTree(dir, name, patches);
  return dir;
}

interface T {
  name: string;
  createAgent: any;
  GameRunner: any;
  po: any;
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
    po,
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
  return { side, kind: core.activePrompt(s) ? 'prompt' : s.activeRun ? 'run' : 'main' };
}

// ------------------------------------------------------------------------------------------------ deals
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

// ------------------------------------------------------------------------------------------------ lockstep
const LK = ['leg', 'ownerOnce5', 'control', 'base'] as const;
type Lk = (typeof LK)[number];
function lockDeal(T: Record<Lk, T>, leg: string, pool: string, rec: Rec) {
  const names: Lk[] = WITH_BASE ? [...LK] : ['leg', 'ownerOnce5', 'control'];
  const g = {} as Record<Lk, any>;
  const ms = {} as Record<Lk, Tally>;
  for (const n of names) {
    T[n].clear();
    g[n] = new T[n].GameRunner(dealStateOf(T[n], rec), { corp: T[n].createAgent('corp', 'normal'), runner: T[n].createAgent('runner', 'normal') });
    ms[n] = {};
  }
  let baseOn = WITH_BASE;
  let baseDiff: Record<string, unknown> | null = null;
  let stop: Record<string, unknown> | null = null;
  let steps = 0;
  let decisions = 0;
  let inner = 0;
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.ownerOnce5.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const d = decisionOf(T.ownerOnce5.core, s);
    const live = names.filter(n => n !== 'base' || baseOn);
    const res = {} as Record<Lk, { more: boolean; act: string; inner: string; ms: number }>;
    const order = live.map((_, k) => live[(k + i) % live.length]);
    for (const n of order) {
      const log: string[] = [];
      G[`__lkRunner_${n}`] = log;
      const t0 = performance.now();
      const more = g[n].step();
      const dt = performance.now() - t0;
      G[`__lkRunner_${n}`] = undefined;
      res[n] = { more, act: key(g[n].last), inner: hash(log), ms: dt };
    }
    const same = (a: Lk, b: Lk) => res[a].more === res[b].more && res[a].act === res[b].act && res[a].inner === res[b].inner;
    if (!res.ownerOnce5.more && !res.leg.more && !res.control.more) break;
    steps++;
    if (d) {
      decisions++;
      for (const n of live) inc(ms[n], `${d.side}:${d.kind}`, res[n].ms);
      inc(ms.leg, `n ${d.side}:${d.kind}`);
    }
    inner += Number(res.ownerOnce5.inner.split(':')[0]);
    if (baseOn && !same('base', 'leg')) {
      baseDiff = { step: i, decision: decisions, T: s.turnNumber, side: d?.side, kind: d?.kind, tags: s.runner.tags, base: res.base.act.slice(0, 160), leg: res.leg.act.slice(0, 160), innerSame: res.base.inner === res.leg.inner };
      baseOn = false;
    }
    if (!same('leg', 'ownerOnce5') || !same('control', 'ownerOnce5')) {
      stop = { step: i, decision: decisions, T: s.turnNumber, side: d?.side, kind: d?.kind, tags: s.runner.tags, leg: res.leg, ownerOnce5: res.ownerOnce5, control: res.control };
      break;
    }
    if (!res.ownerOnce5.more) break;
  }
  const B: GameState = g.ownerOnce5.state;
  const r1 = (t: Tally) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  out({ kind: 'deal', leg, pool, seed: rec.seed, steps, decisions, inner, stop, baseDiff, baseSameToEnd: WITH_BASE && baseOn, winner: B.winner ?? null, T: B.turnNumber, recordSame: (B.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc), ms: Object.fromEntries(names.map(n => [n, r1(ms[n])])) });
}

// ------------------------------------------------------------------------------------------------ report
const classInstance = (v: any) => v && typeof v === 'object' && !(v instanceof Map) && !(v instanceof Set) && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype;
function copyFields(from: any, to: any) {
  for (const k of Object.keys(from)) {
    const v = from[k];
    if (typeof v === 'function') continue;
    if (classInstance(v) && to[k] && typeof to[k] === 'object') Object.assign(to[k], structuredClone({ ...v }));
    else to[k] = structuredClone(v);
  }
}
type Method = 'chooseAction' | 'chooseRez' | 'chooseOffTurn';
function ask(t: T, side: 'corp' | 'runner', method: Method, s: GameState, from: any): string {
  t.clear();
  const agent: any = t.createAgent(side, 'normal');
  copyFields(from, agent);
  const st = structuredClone(s);
  const args = method === 'chooseRez' ? [st, t.po.rezCandidates(st, st.priority?.step)] : [st];
  try {
    return key(agent[method](...args));
  } catch (e) {
    return `error: ${(e as Error).message.slice(0, 100)}`;
  }
}
const VS = process.env.VS ?? 'base';
/** B-1001s on the board: installed, rezzed, known to the Runner (step 0.3). */
const b1001 = (s: GameState) =>
  Object.values(s.corp.servers)
    .flatMap(v => v.root)
    .filter(c => c.cardCode === '34065')
    .map(c => `${c.isRezzed ? 'rezzed' : 'unrezzed'}${c.isRezzed || (c as any).runnerKnows ? ' known' : ''}`);
function reportDeal(T: { play: T; base: T; ctl: T }, pool: string, rec: Rec) {
  const counts: Tally = {};
  const firstDiff: Record<string, unknown>[] = [];
  let i = 0;
  const decide = (side: 'corp' | 'runner', method: Method, s: GameState, agent: any, own: () => unknown) => {
    const kind = method === 'chooseRez' ? 'rez' : method === 'chooseOffTurn' ? 'off' : s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main';
    const k = `${side}:${kind}`;
    G.__fire = {};
    const b = ask(T.base, side, method, s, agent);
    const fire = G.__fire;
    G.__fire = undefined;
    const c = ask(T.ctl, side, method, s, agent);
    const result = own();
    inc(counts, `n ${k}`);
    if (s.runner.tags > 0) inc(counts, `n ${k} tagged`);
    if (b !== c) {
      inc(counts, `differ ${k}`);
      if (s.runner.tags > 0) inc(counts, `differ ${k} tagged`);
      if (VS !== 'base') out({ kind: 'diff', pool, seed: rec.seed, i, T: s.turnNumber, k, tags: s.runner.tags, b1001: b1001(s), vs: b.slice(0, 160), ctl: c.slice(0, 160) });
      else if (firstDiff.length < 1) firstDiff.push({ i, T: s.turnNumber, k, tags: s.runner.tags, base: b.slice(0, 120), ctl: c.slice(0, 120) });
    }
    if (c !== key(result)) inc(counts, `ctlNoise ${k}`);
    const fired = FIRE_CLASSES.filter(f => fire[f]);
    if (fired.length) inc(counts, `fire ${k}`);
    for (const f of fired) inc(counts, `fire ${f} ${k}`);
    if (fired.length && b !== c) inc(counts, `fireDiffer ${k}`);
    i++;
    return result;
  };
  const watched = (side: 'corp' | 'runner', agent: any) =>
    new Proxy(agent, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (prop !== 'chooseAction' && prop !== 'chooseRez' && prop !== 'chooseOffTurn') return v;
        return (s: GameState, ...rest: unknown[]) => decide(side, prop as Method, s, target, () => v.apply(target, [s, ...rest]));
      },
    });
  T.play.clear();
  const run = new T.play.GameRunner(dealStateOf(T.play, rec), { corp: watched('corp', T.play.createAgent('corp', 'normal')), runner: watched('runner', T.play.createAgent('runner', 'normal')) });
  for (let n = 0; n < MAX_STEPS; n++) if (!run.step()) break;
  out({ kind: 'report', pool, seed: rec.seed, decisions: i, winner: run.state.winner ?? null, T: run.state.turnNumber, counts, firstDiff });
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const started = Date.now();
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const armSrc = armSource(root, shard);
  if (armSrc === 'src') throw new Error('ARM_BASE (the merge base, a full SHA) is required: the counted trees are built from its src');
  const sources: { pool: string; rec: Rec }[] = [];
  for (const pool of POOLS) {
    const recs: Rec[] = JSON.parse(readFileSync(`scripts/tag-owner/deals-${RUNS[pool]}.json`, 'utf8'));
    let n = 0;
    for (const r of recs) {
      if (DEALS.length && !DEALS.includes(String(r.seed))) continue;
      if (PER_POOL && n >= PER_POOL) break;
      n++;
      sources.push({ pool, rec: r });
    }
  }
  if (MODE === 'lockstep') {
    const nLegs = LEGS.length;
    const leg = LEGS[shard % nLegs];
    const per = Math.max(1, Math.floor(shards / nLegs));
    const slot = Math.floor(shard / nLegs);
    if (leg !== 'branch' && !FAULTS[leg]) throw new Error(`unknown leg ${leg}`);
    if (shard >= per * nLegs) return out({ kind: 's', shard, idle: true });
    const dirs: Record<Lk, string> = {
      leg: tree('leg', 'src', [RECORD('leg'), ...(FAULTS[leg] ?? [])]),
      ownerOnce5: tree('ownerOnce5', armSrc, [...PATCHES.ownerOnce5, RECORD('ownerOnce5')]),
      control: tree('control', armSrc, [...PATCHES.ownerOnce5, RECORD('control')]),
      base: tree('base', armSrc, [RECORD('base')]),
    };
    const T = {} as Record<Lk, T>;
    for (const n of LK) if (n !== 'base' || WITH_BASE) T[n] = await loadTree(n, dirs[n]);
    for (const [k, src] of sources.entries()) {
      if (k % per !== slot) continue;
      if (Date.now() - started > MAX_MS) break;
      try {
        lockDeal(T, leg, src.pool, src.rec);
      } catch (e) {
        out({ kind: 'error', leg, pool: src.pool, seed: src.rec.seed, error: (e as Error).stack?.slice(0, 400) });
      }
    }
  } else if (MODE === 'report') {
    const dirs = { play: tree('play', 'src', []), base: tree('vs', armSrc, VS === 'base' ? FIRE : VS === 'ownerOnce' ? PATCHES.ownerOnce : (null as never)), ctl: tree('ctl', 'src', []) };
    const T = { play: await loadTree('play', dirs.play), base: await loadTree('base', dirs.base), ctl: await loadTree('ctl', dirs.ctl) };
    for (const [k, src] of sources.entries()) {
      if (k % shards !== shard) continue;
      if (Date.now() - started > MAX_MS) break;
      try {
        reportDeal(T, src.pool, src.rec);
      } catch (e) {
        out({ kind: 'error', pool: src.pool, seed: src.rec.seed, error: (e as Error).stack?.slice(0, 400) });
      }
    }
  } else throw new Error(`unknown MODE ${MODE}`);
  out({ kind: 's', shard, mode: MODE, ms: Date.now() - started, rss: Math.round(process.memoryUsage().rss / 1e6) });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
