/**
 * F3 / R-80 count (brief /mnt/project-files/netrunner-ai/cache-keys/brief-count.md rev 0): what it costs for a value
 * cache to serve only its own board. Scripts only. Trees and arms: trees.ts.
 *
 * MODE=lockstep (A, B, C, E): one process plays one GROUP (trees.ts GROUPS: ctl beside one map's arms). Per deal:
 *   lockstep  `source` (src unchanged) plays the deal (plain GameRunner, its agents only watched); at every decision each
 *             asked tree of the group (in an order rotated per decision) answers the same question on a structuredClone,
 *             a fresh Normal agent of that tree given a copy of the source agent's own fields. The asked trees' caches
 *             are never cleared mid-game: each sees the game's calls in order, as it would playing. The source is never
 *             asked or cleared. C: decisions where a tree's answer differs from the source's (ctl's count is the noise).
 *   audit     A: in every asked tree, 1 in SAMPLE_<map> entries of each map is tracked: worked out again in the `eval`
 *             tree on its fill board (fill right or wrong) and on the asking board of every hit of it (hit right or
 *             wrong). The eval tree serves no cache; the pricing context of the asking call is copied in. Eval time is
 *             taken off the decision time.
 *   own play  C: every arm tree (not ctl) plays the deal itself from the start, hooks off; its record (winner, the Corp's
 *             credits and score at each Corp turn start) against the base record.
 *   E         E=1: in every asked tree, every hit of buildTargets, iceMeans, deckShares, boardFactCodes and the
 *             hiddenCardOdds memo, worked out again in the eval tree.
 * MODE=driver (D): for each tree of the group (ctl and its arms), each g3 deal (1303, 3203, 1762) played through the batch
 *   driver (the tree's own scripts/lossLog.ts playLogged, the alarm evaluating beside the game) and through a plain
 *   GameRunner: records against each other and the g3 record.
 *
 * Pools: batch (221 deals of g1 45553599707), nrdb (110 of NRDB g1 45555227992), g3 (deals of g3 45606309276 listed in
 * deals-g3.json). Sharding: with GROUPS=t,d,c,all and SHARD=k/n, shard k plays group GROUPS[k % G] on every (n/G)-th deal.
 *
 *   npx vite-node scripts/cache-keys/count.ts -- GROUPS=t POOL=batch DEALS=1001 SAMPLE=1
 *   SHARD=0/64 npx vite-node scripts/cache-keys/count.ts -- GROUPS=t,d,c,all POOL=batch,nrdb SAMPLE_deckAverage=50
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Tree, loadTree } from '../runner-rework/facts-trees';
import { GROUPS, MAPS, MapName, makeTrees } from './trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const i = kv.indexOf('=');
  process.env[kv.slice(0, i)] = kv.slice(i + 1);
}
const env = process.env;
const [shard, shards] = (env.SHARD ?? '0/1').split('/').map(Number);
const GROUP_LIST = (env.GROUPS ?? 't').split(',');
const G_ = GROUP_LIST.length;
const GROUP = GROUP_LIST[shard % G_];
// MODE_<group> overrides MODE for that group's shards (bars 6 and 7 in one run)
const MODES = (env[`MODE_${GROUP}`] ?? env.MODE ?? 'lockstep').split(',');
const SLICE = Math.max(1, Math.floor(shards / G_));
const SLICE_K = Math.floor(shard / G_);
const POOLS = (env.POOL ?? 'batch,nrdb').split(',');
// DEALS_<group> (a top-up run) overrides DEALS for that group's shards
// A value starting with @ names a file holding the comma-separated list (bar 7: the pairs' changed deals)
const DEALS_ARG = env[`DEALS_${(env.GROUPS ?? 't').split(',')[Number((env.SHARD ?? '0/1').split('/')[0]) % (env.GROUPS ?? 't').split(',').length]}`] ?? env.DEALS ?? '';
const DEALS = (DEALS_ARG.startsWith('@') ? readFileSync(DEALS_ARG.slice(1), 'utf8').trim() : DEALS_ARG).split(',').filter(Boolean);
const SAMPLE: Record<MapName, number> = Object.fromEntries(MAPS.map(m => [m, Number(env[`SAMPLE_${m}`] ?? env.SAMPLE ?? 1)])) as Record<MapName, number>;
let AUDIT = env.AUDIT !== '0';
// Own play: '1' every arm on every deal; 'changed' (default) only the arms with a changed decision in this deal's lockstep
// (an arm that answers as the source at every decision plays the source's game: its record is the base record)
const OWN = env.OWN ?? 'changed';
/** The time pass on every TIME_EVERY-th deal of a shard (1: all). */
const TIME_EVERY = Number(env.TIME_EVERY ?? 1);
const E_ON = env.E === '1';
const MAX_MS = Number(env.MAX_MS ?? Infinity);
const OUT_DIR = env.OUT_DIR ?? '';
const root = resolve(env.TROOT ?? 'node_modules/.cache/cache-keys', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const G = globalThis as any;
const started = Date.now();
const ASKED = GROUPS[GROUP];
if (!ASKED) throw new Error(`unknown group ${GROUP}`);
/** The group's control arm: `ctl`, or the group's first tree (ctlP in the point groups). Slow decisions and stale-hit records read it. */
const CTL = ASKED.includes('ctl') ? 'ctl' : ASKED[0];

// ------------------------------------------------------------------------------------------------ no-store maps (eval)
class NoStoreMap {
  get() {
    return undefined;
  }
  has() {
    return false;
  }
  set() {
    return this;
  }
  add() {
    return this;
  }
  delete() {
    return false;
  }
  clear() {}
  get size() {
    return 0;
  }
  forEach() {}
  keys() {
    return [][Symbol.iterator]();
  }
  values() {
    return [][Symbol.iterator]();
  }
  entries() {
    return [][Symbol.iterator]();
  }
  [Symbol.iterator]() {
    return [][Symbol.iterator]();
  }
}
G.__ckNoStore = () => new NoStoreMap();

// ------------------------------------------------------------------------------------------------ trees
let S: Tree;
const T: Record<string, Tree & { po: any }> = {};
let E: { pricing: any; hv: any; ev: any; vm: any; iv: any; evaluate: any } | null = null;
let evalMs = 0;

// ------------------------------------------------------------------------------------------------ counts
const counts = new Map<string, number>();
const inc = (k: string, by = 1) => counts.set(k, (counts.get(k) ?? 0) + by);
const records: Record<string, unknown>[] = [];
const recCount = new Map<string, number>();
function keep(cls: string, rec: Record<string, unknown>, cap = 5) {
  const n = recCount.get(cls) ?? 0;
  recCount.set(cls, n + 1);
  if (n < cap) records.push({ cls, source, ...rec });
}
let source = '';
/** The decision being asked: its side and kind; the asked tree. */
let cur: { side: string; kind: string; tree: string; T: number; i: number } | null = null;
/** ctl's wrong hits in the decision being asked (C's attribution). */
let ctlWrong: Record<string, unknown>[] = [];
const scopes: string[] = [];
function kindNow(tree: string): string {
  const inner = scopes[scopes.length - 1];
  if (inner && inner !== 'top') return inner.startsWith('hard') ? 'hard' : inner;
  return T[tree].pricing.pricing().frozen ? 'lookahead' : 'decider';
}

// ------------------------------------------------------------------------------------------------ the audit
type Verdict = { ok: boolean };
const tracks: Record<string, { str: Map<string, Verdict>; obj: WeakMap<object, Map<string, Verdict>>; fills: number }> = {};
const trackOf = (tree: string, map: string) => (tracks[`${tree}|${map}`] ??= { str: new Map(), obj: new WeakMap(), fills: 0 });
function getTrack(tree: string, map: string, ref: any): Verdict | undefined {
  const t = trackOf(tree, map);
  return typeof ref === 'string' ? t.str.get(ref) : t.obj.get(ref[0])?.get(ref[1]);
}
function setTrack(tree: string, map: string, ref: any, v: Verdict) {
  const t = trackOf(tree, map);
  if (typeof ref === 'string') t.str.set(ref, v);
  else {
    let m = t.obj.get(ref[0]);
    if (!m) t.obj.set(ref[0], (m = new Map()));
    m.set(ref[1], v);
  }
}
/** The asking call's context, copied into the eval tree. */
function ctxOf(tree: string): Record<string, unknown> {
  const c = T[tree].pricing.pricing();
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(c)) patch[k] = c[k];
  patch.diagnostics = null;
  patch.known = { ...c.known };
  patch.rezzingToUse = new Set(c.rezzingToUse);
  patch.leaves = [...c.leaves];
  return patch;
}
function evalIn<X>(tree: string, f: () => X): X {
  const t0 = performance.now();
  try {
    return E!.pricing.withPricing(ctxOf(tree), f);
  } finally {
    evalMs += performance.now() - t0;
  }
}
function own(tree: string, map: MapName, state: GameState, x: any): any {
  const e0 = evalMs;
  try {
    return evalIn(tree, () => (map === 'threats' ? E!.ev.damageThreat(state, x) : map === 'deckAverage' ? E!.hv.drawWorth(state, ...(Array.isArray(x) ? x : [x])) : E!.hv.clickWorth(state, x)));
  } finally {
    inc(`EV|${map}`, evalMs - e0);
  }
}
const differ = (map: MapName, a: any, b: any): number => (map === 'threats' ? Math.max(Math.abs(a.burst - b.burst), Math.abs(a.share - b.share)) : Math.abs(a - b));
const same = (map: MapName, a: any, b: any): boolean => (map === 'threats' ? a.burst === b.burst && a.share === b.share : a === b);
const clsOf = (tree: string, map: string) => `${tree}|${map}|${cur?.side ?? '-'}|${kindNow(tree)}`;

function listen() {
  G.__lkIn = (gr: any) => {
    scopes.push(gr.__lkScope ?? 'top');
    return () => void scopes.pop();
  };
  G.__ck = {
    call(tree: string, map: string) {
      inc(`N|${tree}|${map}|${cur?.side ?? '-'}|call`);
    },
    miss(tree: string, map: string) {
      inc(`N|${tree}|${map}|${cur?.side ?? '-'}|miss`);
    },
    clear(tree: string, map: string) {
      inc(`N|${tree}|${map}|-|capClear`);
      const t = trackOf(tree, map);
      t.str.clear();
    },
    fill(tree: string, map: MapName, value: any, state: GameState, x: any, ref: any) {
      if (!AUDIT || !E) return;
      const t = trackOf(tree, map);
      if (t.fills++ % SAMPLE[map] !== 0) return;
      const fresh = own(tree, map, state, x);
      const ok = same(map, value, fresh);
      if (ref !== null) setTrack(tree, map, ref, { ok });
      const cls = clsOf(tree, map);
      inc(`F|${cls}|checked`);
      if (!ok) {
        inc(`F|${cls}|wrong`);
        keep(`fill|${tree}|${map}`, { T: state.turnNumber, side: cur?.side, kind: kindNow(tree), stored: value, own: fresh });
      }
    },
    hit(tree: string, map: MapName, served: any, state: GameState, x: any, ref: any) {
      inc(`N|${tree}|${map}|${cur?.side ?? '-'}|hit`);
      if (!AUDIT || !E) return served;
      const v = getTrack(tree, map, ref);
      if (!v) return served;
      const fresh = own(tree, map, state, x);
      const cls = clsOf(tree, map);
      inc(`A|${cls}|checked`);
      if (!same(map, served, fresh)) {
        const d = differ(map, served, fresh);
        // "key": the entry was right on its own board and is served to another; "fill": it was wrong when stored
        const why = v.ok ? 'key' : 'fill';
        inc(`A|${cls}|wrong|${why}`);
        if (d > 0.001) inc(`A|${cls}|wrong>0.001|${why}`);
        inc(`Z|${tree}|${map}|${Number(d.toPrecision(2))}`);
        const rec = { tree, map, side: cur?.side, kind: kindNow(tree), T: state.turnNumber, decision: cur?.i, why, served: map === 'threats' ? { ...served } : served, own: fresh };
        keep(`hit|${tree}|${map}|${why}`, rec);
        if (tree === CTL && ctlWrong.length < 3) ctlWrong.push(rec);
      }
      return served;
    },
    other: E_ON ? other : undefined,
  };
}
/** E: a hit of another map, worked out again in the eval tree. */
function other(tree: string, name: string, cached: any, state: GameState, side?: string): any {
  if (!E) return cached;
  const fresh = evalIn(tree, () => {
    switch (name) {
      case 'iceMeans':
        return E!.vm.corpIceMean(state);
      case 'buildTargets':
        return E!.vm.buildTarget(state, side);
      case 'deckShares':
        return E!.iv.deckIceShare(state);
      case 'boardFactCodes':
        return E!.ev.__bfCodes(state);
      default:
        return E!.evaluate.hiddenCardOddsOf(state);
    }
  });
  const cls = `${tree}|${name}|${cur?.side ?? '-'}|${kindNow(tree)}`;
  inc(`O|${cls}|checked`);
  if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
    inc(`O|${cls}|wrong`);
    keep(`other|${tree}|${name}`, { arg: side, side: cur?.side, kind: kindNow(tree), T: state.turnNumber, served: cached, own: fresh });
  }
  return cached;
}

// ------------------------------------------------------------------------------------------------ asking
const classInstance = (v: any) => v && typeof v === 'object' && !(v instanceof Map) && !(v instanceof Set) && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype;
/** The source agent's own fields, copied into a fresh agent of another tree (class instances field by field). */
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
/** FIELDS=1 (bar 7): an answer also carries the agent's fields after it (its plan memory), so a decision that keeps the
 * answer but changes the plan the agent stores for its next decision counts as changed. */
const FIELDS = env.FIELDS === '1';
const fieldsKey = (agent: any) => pickKey(Object.fromEntries(Object.keys(agent).filter(k => typeof agent[k] !== 'function').map(k => [k, agent[k]])));
function ask(tree: string, side: string, method: Method, s: GameState, from: any): { a: string; ms: number; f?: string } {
  const t = T[tree];
  const agent: any = t.createAgent(side, 'normal');
  copyFields(from, agent);
  const st = structuredClone(s);
  const args = method === 'chooseRez' ? [st, t.po.rezCandidates(st, st.priority?.step)] : [st];
  const e0 = evalMs;
  const t0 = performance.now();
  try {
    const a = agent[method](...args);
    const ms = performance.now() - t0 - (evalMs - e0);
    return { a: pickKey(a), ms, f: FIELDS ? fieldsKey(agent) : undefined };
  } catch (e) {
    return { a: `error: ${(e as Error).message.slice(0, 100)}`, ms: performance.now() - t0 - (evalMs - e0) };
  }
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
const key = (a: unknown) => JSON.stringify(a);
const kindOf = (s: GameState, method: Method) => (method === 'chooseRez' ? 'rez' : method === 'chooseOffTurn' ? 'off' : s.pendingPrompts.length ? 'prompt' : 'main');

/** Plays `d` on tree t (plain GameRunner, its own agents); the record. */
function playOwn(t: Tree, d: Deal): { winner: string | null; cr: number[]; sc: number[]; steps: number; ms: number } {
  t.clear();
  const t0 = performance.now();
  const g = new t.GameRunner(dealStateOf(t, d), { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') });
  const cr: number[] = [];
  const sc: number[] = [];
  let last = -1;
  let steps = 0;
  for (let i = 0; i < 4000; i++) {
    const s: GameState = g.state;
    if (s.turnNumber !== last && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      last = s.turnNumber;
    }
    if (!g.step()) break;
    steps++;
  }
  return { winner: g.state.winner ?? null, cr, sc, steps, ms: Math.round(performance.now() - t0) };
}

function lockstep(pool: string, d: Deal, timing: boolean) {
  source = `${pool}:${d.seed}`;
  // The time pass: no hook at all (every patched line takes its plain path), no own play; its counts are kept apart
  const ck = G.__ck;
  if (timing) G.__ck = undefined;
  const P = timing ? 'time:' : '';
  try {
    lockstepIn(pool, d, timing, P);
  } finally {
    G.__ck = ck;
  }
}
function lockstepIn(pool: string, d: Deal, timing: boolean, P: string) {
  S.clear();
  for (const n of ASKED) T[n].clear();
  for (const k of Object.keys(tracks)) delete tracks[k];
  let i = 0;
  const diffs: Record<string, unknown>[] = [];
  const changedTrees = new Set<string>();
  const decide = (side: string, method: Method, s: GameState, from: any, mine: () => unknown) => {
    const idx = i++;
    const kind = kindOf(s, method);
    const order = ASKED.map((_, k) => ASKED[(k + idx) % ASKED.length]);
    const r: Record<string, { a: string; ms: number; f?: string }> = {};
    ctlWrong = [];
    for (const n of order) {
      cur = { side, kind, tree: n, T: s.turnNumber, i: idx };
      r[n] = ask(n, side, method, s, from);
    }
    cur = null;
    const result = mine();
    const sa = pickKey(result);
    const k = `${side}|${kind}`;
    inc(`${P}D|${k}|n`);
    const slow = r[CTL].ms > 1000;
    if (slow) inc(`${P}D|${k}|slow`);
    for (const n of ASKED) {
      inc(`${P}MS|${n}|${k}`, r[n].ms);
      if (slow) inc(`${P}MSslow|${n}|${k}`, r[n].ms);
      if (r[n].a !== sa) {
        changedTrees.add(n);
        inc(`${P}CH|${n}|${k}`);
        if (diffs.length < 40) diffs.push({ timing, tree: n, side, kind, T: s.turnNumber, decision: idx, answer: r[n].a.slice(0, 300), source: sa.slice(0, 300), ctlWrong: n === CTL ? undefined : ctlWrong });
      } else if (FIELDS && r[n].f !== undefined && r[n].f !== fieldsKey(from)) {
        changedTrees.add(n);
        inc(`${P}CHF|${n}|${k}`);
        if (diffs.length < 40) diffs.push({ timing, tree: n, side, kind, T: s.turnNumber, decision: idx, fields: true, answer: r[n].f!.slice(0, 600), source: fieldsKey(from).slice(0, 600), ctlWrong: n === CTL ? undefined : ctlWrong });
      }
      if (r[n].a.startsWith('error')) inc(`${P}ERR|${n}`);
    }
    return result;
  };
  const corpAgent = S.createAgent('corp', 'normal');
  const runnerAgent = S.createAgent('runner', 'normal');
  const t0 = performance.now();
  const g = new S.GameRunner(dealStateOf(S, d), { corp: watchedSide(corpAgent, 'corp'), runner: watchedSide(runnerAgent, 'runner') });
  function watchedSide(agent: any, side: string) {
    return new Proxy(agent, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (prop !== 'chooseAction' && prop !== 'chooseRez' && prop !== 'chooseOffTurn') return v;
        return (s: GameState, ...rest: unknown[]) => decide(side, prop as Method, s, target, () => v.apply(target, [s, ...rest]));
      },
    });
  }
  const cr: number[] = [];
  const sc: number[] = [];
  let last = -1;
  let steps = 0;
  for (let n = 0; n < 4000; n++) {
    const s: GameState = g.state;
    if (s.turnNumber !== last && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      last = s.turnNumber;
    }
    if (!g.step()) break;
    steps++;
  }
  const recordSame = (g.state.winner ?? null) === d.winner && key(cr) === key(d.cr) && key(sc) === key(d.sc);
  const lockMs = Math.round(performance.now() - t0);
  // Own play: each arm plays the deal itself, hooks off
  const plays: Record<string, unknown> = {};
  if (OWN !== '0' && !timing) {
    const ck = G.__ck;
    G.__ck = undefined;
    try {
      for (const n of ASKED) {
        if (n === CTL && env.OWN_CTL !== '1') continue;
        if (OWN === 'changed' && !changedTrees.has(n)) continue;
        const p = playOwn(T[n], d);
        const firstTurn = p.cr.findIndex((c, k) => c !== d.cr[k] || p.sc[k] !== d.sc[k]);
        plays[n] = { same: p.winner === d.winner && key(p.cr) === key(d.cr) && key(p.sc) === key(d.sc), winner: p.winner, firstTurn: firstTurn < 0 && p.cr.length !== d.cr.length ? Math.min(p.cr.length, d.cr.length) : firstTurn, turns: p.cr.length, ms: p.ms };
      }
    } finally {
      G.__ck = ck;
    }
  }
  out({ kind: timing ? 'timedeal' : 'deal', group: GROUP, pool, seed: d.seed, steps, decisions: i, recordSame, winner: g.state.winner ?? null, recWinner: d.winner, lockMs, evalMs: Math.round(evalMs), plays, diffs, ms: Date.now() - started });
}

/**
 * People's games (tests/fixtures/human-games, C only, the coordinator's addition 2): the person's game replayed move by
 * move; before each move of the AI's side, a Normal agent that watched every board (its fields copied, as in the
 * lockstep) is asked chooseAction on a copy, in the source and in every asked tree. A tree's answer is compared with
 * the source's (not with the recorded move). The asks are chooseAction at every AI move (a recorded rez is asked as
 * chooseAction too: the same question in every tree). Counts under pool 'people': D, CH, MS, ERR as the lockstep's.
 */
function person(file: string) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const name = file.split('/').pop()!.replace('.json', '');
  source = `people:${name}`;
  for (const n of ASKED) T[n].clear();
  S.clear();
  let s: GameState = S.core.createInitialGameState(S.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  if (r.startsAt === 'state') s = structuredClone(r.state);
  const aiSide: string = r.config.ai;
  const watcher: any = S.createAgent(aiSide, 'normal');
  const diffs: Record<string, unknown>[] = [];
  let i = 0;
  const t0 = performance.now();
  for (const [j, move] of (r.moves as any[]).entries()) {
    watcher.observe?.(s);
    if (move.player === aiSide) {
      const idx = i++;
      const kind = `${s.pendingPrompts.length ? 'prompt' : 'main'}:${move.type === 'REZ_CARD' ? 'rez' : 'act'}`;
      const sAgent: any = S.createAgent(aiSide, 'normal');
      copyFields(watcher, sAgent);
      let sa: string;
      try {
        sa = pickKey(sAgent.chooseAction(structuredClone(s)));
      } catch (e) {
        sa = `error: ${(e as Error).message.slice(0, 100)}`;
      }
      const k = `${aiSide}|${kind}`;
      inc(`D|${k}|n`);
      const order = ASKED.map((_, q) => ASKED[(q + idx) % ASKED.length]);
      for (const n of order) {
        cur = { side: aiSide, kind, tree: n, T: s.turnNumber, i: idx };
        const a = ask(n, aiSide, 'chooseAction', s, watcher);
        cur = null;
        inc(`MS|${n}|${k}`, a.ms);
        if (a.a !== sa) {
          inc(`CH|${n}|${k}`);
          if (diffs.length < 40) diffs.push({ tree: n, kind, T: s.turnNumber, move: j, answer: a.a.slice(0, 300), source: sa.slice(0, 300) });
        }
        if (a.a.startsWith('error')) inc(`ERR|${n}`);
      }
    }
    try {
      s = S.core.executeAction(s, move);
    } catch (e) {
      out({ kind: 'error', pool: 'people', seed: name, at: j, error: (e as Error).message.slice(0, 120) });
      break;
    }
  }
  out({ kind: 'person', group: GROUP, pool: 'people', file: name, decisions: i, lockMs: Math.round(performance.now() - t0), diffs, ms: Date.now() - started });
}

/** D: the batch driver against plain play, on every tree of the group and the source. */
async function driver(d: Deal) {
  for (const n of ['source', ...ASKED]) {
    const t = n === 'source' ? S : T[n];
    const dir = dirs[n];
    const loss = await import(/* @vite-ignore */ join(dir, 'scripts/lossLog.ts'));
    G.__ck = undefined;
    t.clear();
    const plain = playOwn(t, d);
    t.clear();
    const start = dealStateOf(t, d);
    const rec = loss.playLogged(start, { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') }, { corp: d.corpDeck, runner: d.runnerDeck });
    const logged = { winner: rec.winner ?? null, cr: rec.money.creditsAtTurnStart, sc: rec.money.scoreAtTurnStart };
    const eq = (a: any, b: any) => a.winner === b.winner && key(a.cr) === key(b.cr) && key(a.sc) === key(b.sc);
    out({ kind: 'driver', group: GROUP, tree: n, seed: d.seed, plainEqualsLogged: eq(plain, logged), loggedEqualsRecord: eq(logged, d), plainEqualsRecord: eq(plain, d), plain: { w: plain.winner, cr: plain.cr.slice(10, 22) }, logged: { w: logged.winner, cr: logged.cr.slice(10, 22) }, rec: { w: d.winner, cr: d.cr.slice(10, 22) } });
  }
}

// ------------------------------------------------------------------------------------------------ pair (bar 7's dig)
/** MODE=pair: the source and each asked tree play the deal themselves, step by step; at the first decision where the
 * tree's answer leaves the source's, it says whether the tree answers as the source when asked lockstep-style (fresh
 * agent, the source agent's fields, a copy of the board) and which agent fields differ between the two games. */
function pair(pool: string, d: Deal) {
  for (const n of ASKED) {
    S.clear();
    T[n].clear();
    const src: { a: string; snap: any; after: any }[] = [];
    let fieldsAt: Record<string, unknown> | null = null;
    const mine: string[] = [];
    let found: Record<string, unknown> | null = null;
    const wrap = (t: Tree, agent: any, side: string, own: boolean) =>
      new Proxy(agent, {
        get(target, prop, recv) {
          const v = Reflect.get(target, prop, recv);
          if (prop !== 'chooseAction' && prop !== 'chooseRez' && prop !== 'chooseOffTurn') return v;
          return (s: GameState, ...rest: unknown[]) => {
            const snap = own ? null : (() => {
              const x: any = S.createAgent(side, 'normal');
              copyFields(target, x);
              return { agent: x, state: structuredClone(s), method: prop };
            })();
            const r = v.apply(target, [s, ...rest]);
            if (!own) {
              const after: any = {};
              for (const k of Object.keys(target)) if (typeof target[k] !== 'function') after[k] = structuredClone(classInstance(target[k]) ? { ...target[k] } : target[k]);
              src.push({ a: pickKey(r), snap, after });
            }
            else {
              const i = mine.length;
              mine.push(pickKey(r));
              if (!fieldsAt && src[i]) {
                const sa = src[i].after;
                const diff = Object.keys(target).filter(k => typeof target[k] !== 'function' && pickKey(target[k]) !== pickKey(sa?.[k]));
                if (diff.length) fieldsAt = { decision: i, side, method: prop, T: s.turnNumber, answerSame: src[i].a === mine[i], fields: Object.fromEntries(diff.map(k => [k, { own: pickKey(target[k]).slice(0, 600), source: pickKey(sa?.[k]).slice(0, 600) }])) };
              }
              if (!found && src[i] && src[i].a !== mine[i]) {
                const sn = src[i].snap;
                const lock = ask(n, side, sn.method, sn.state, sn.agent);
                const fields = Object.keys(target).filter(k => typeof target[k] !== 'function' && pickKey(target[k]) !== pickKey(sn.agent[k]));
                found = { decision: i, side, method: prop, T: s.turnNumber, own: mine[i].slice(0, 200), source: src[i].a.slice(0, 200), lockstepSame: lock.a === src[i].a, lockstep: lock.a.slice(0, 200), stateSame: pickKey(s) === pickKey(sn.state), fields };
              }
            }
            return r;
          };
        },
      });
    const gs = new S.GameRunner(dealStateOf(S, d), { corp: wrap(S, S.createAgent('corp', 'normal'), 'corp', false), runner: wrap(S, S.createAgent('runner', 'normal'), 'runner', false) });
    const t = T[n];
    const gb = new t.GameRunner(dealStateOf(t, d), { corp: wrap(t, t.createAgent('corp', 'normal'), 'corp', true), runner: wrap(t, t.createAgent('runner', 'normal'), 'runner', true) });
    const ck = G.__ck;
    G.__ck = undefined;
    try {
      let a = true;
      let b = true;
      for (let k = 0; k < 4000 && (a || b) && !found; k++) {
        if (a) a = gs.step();
        while (b && mine.length < src.length && !found) b = gb.step();
        if (!a && b && !found) b = gb.step();
      }
    } finally {
      G.__ck = ck;
    }
    out({ kind: 'pair', pool, seed: d.seed, tree: n, decisions: src.length, found, fieldsAt });
  }
}

// ------------------------------------------------------------------------------------------------ main
let dirs: Record<string, string> = {};
async function main() {
  dirs = makeTrees(root, ASKED, MODES.includes('lockstep') && (AUDIT || E_ON));
  S = await loadTree('source', dirs.source);
  for (const n of ASKED) {
    const t = await loadTree(n, dirs[n]);
    const po = await import(/* @vite-ignore */ join(dirs[n], 'src/ai/playout.ts'));
    T[n] = Object.assign(t, { po });
  }
  if (dirs.eval) {
    const e = (f: string) => import(/* @vite-ignore */ join(dirs.eval, 'src', f));
    await loadTree('eval', dirs.eval);
    E = { pricing: await e('ai/pricing.ts'), hv: await e('ai/handValues.ts'), ev: await e('ai/effectValues.ts'), vm: await e('ai/valueModel.ts'), iv: await e('ai/iceValues.ts'), evaluate: await e('ai/evaluate.ts') };
  }
  listen();
  const lists: Record<string, Deal[]> = {
    batch: JSON.parse(readFileSync('scripts/pricing-context/deals-45553599707.json', 'utf8')),
    nrdb: JSON.parse(readFileSync('scripts/pricing-context/deals-45555227992.json', 'utf8')),
    g3: JSON.parse(readFileSync('scripts/cache-keys/deals-g3.json', 'utf8')),
  };
  // REC_<pool>=<deals.json> (REC_<group>_<pool> for one group's shards): that pool's deals and records from another batch
  // (bars 6 and 7: the pairs' records)
  for (const p of Object.keys(lists)) {
    const f = env[`REC_${GROUP}_${p}`] ?? env[`REC_${p}`];
    if (f) lists[p] = JSON.parse(readFileSync(f, 'utf8'));
  }
  const units: { pool: string; d: Deal }[] = [];
  for (const pool of POOLS.filter(p => p !== 'people')) for (const d of lists[pool]) if (!DEALS.length || DEALS.includes(String(d.seed)) || DEALS.includes(`${pool}:${d.seed}`)) units.push({ pool, d });
  out({ kind: 'start', group: GROUP, asked: ASKED, units: units.filter((_, k) => k % SLICE === SLICE_K).length, sample: SAMPLE, audit: AUDIT, e: E_ON, modes: MODES });
  let pool = '';
  const flush = () => {
    if (!pool) return;
    out({ kind: 'counts', group: GROUP, pool, counts: Object.fromEntries(counts), records, evalMs: Math.round(evalMs) });
    counts.clear();
    records.length = 0;
    recCount.clear();
    evalMs = 0;
  };
  let nth = 0;
  for (const [k, u] of units.entries()) {
    if (k % SLICE !== SLICE_K) continue;
    if (Date.now() - started > MAX_MS) {
      out({ kind: 'stopped', at: `${u.pool}:${u.d.seed}`, reason: 'MAX_MS' });
      break;
    }
    if (u.pool !== pool) {
      flush();
      pool = u.pool;
    }
    try {
      if (MODES.includes('lockstep')) lockstep(u.pool, u.d, false);
      if (MODES.includes('time') && (nth++ % TIME_EVERY === 0)) lockstep(u.pool, u.d, true);
      if (MODES.includes('driver') && u.pool === 'g3') await driver(u.d);
      if (MODES.includes('pair')) pair(u.pool, u.d);
      // MODE=own (bar 6): each asked tree plays the deal itself, hooks off, against the pool's record
      if (MODES.includes('own')) for (const n of ASKED) {
        const p = playOwn(T[n], u.d);
        const firstTurn = p.cr.findIndex((c, k) => c !== u.d.cr[k] || p.sc[k] !== u.d.sc[k]);
        out({ kind: 'own', group: GROUP, pool: u.pool, seed: u.d.seed, tree: n, same: p.winner === u.d.winner && key(p.cr) === key(u.d.cr) && key(p.sc) === key(u.d.sc), winner: p.winner, recWinner: u.d.winner, firstTurn, turns: p.cr.length, ms: p.ms });
      }
    } catch (e) {
      out({ kind: 'error', pool: u.pool, seed: u.d.seed, error: (e as Error).stack?.slice(0, 800) });
    }
  }
  // People's games after the deals, sharded the same way (C only: run with AUDIT=0)
  if (POOLS.includes('people')) {
    flush();
    pool = 'people';
    AUDIT = false;
    const files = readdirSync('tests/fixtures/human-games')
      .filter(f => f.endsWith('.json'))
      .filter(f => !DEALS.length || DEALS.includes(`people:${f.replace('.json', '')}`))
      .sort();
    for (const [k, f] of files.entries()) {
      if (k % SLICE !== SLICE_K) continue;
      if (Date.now() - started > MAX_MS) {
        out({ kind: 'stopped', at: `people:${f}`, reason: 'MAX_MS' });
        break;
      }
      try {
        person(join('tests/fixtures/human-games', f));
      } catch (e) {
        out({ kind: 'error', pool: 'people', seed: f, error: (e as Error).stack?.slice(0, 800) });
      }
    }
  }
  flush();
  if (OUT_DIR && existsSync(OUT_DIR)) writeFileSync(join(OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
