/**
 * R-14h fix, bar 2 and step 0.5 (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/r14h-last-credits-fix.md rev 2):
 * this checkout's tree (`branch`) against BASE, step by step, on the base pools; `control` is BASE again (the base is
 * reproducible: base against base). Each tree carries R-B's lockstep hooks (core-hooks.ts HOOKS: every rez, off-turn and
 * chooseAction answer and every applied action of every GameRunner scope, the planner's rank lists and prompt answers, the
 * Runner's own rank lists), hashed into one stream per step; a deal stops at the first step whose stream differs, and
 * reports that step (index, turn, deciding side and kind), so bar 2's reading can look it up in step 0's records
 * (last-credits-fix-step0.ts: whether a 'later' value moved at that decision).
 * FAULT=<name> plants one fault (FAULTS below, step 0.5) in the branch tree only; FAULT=a,b,... gives shard s the fault
 * s % n ('none' = no fault), each over every source with the shards that carry it.
 *
 * PICKS=1 hashes only the top-level game's actions and answers (no rank lists, no look-ahead scopes): the first differing
 * step is then the first changed pick (step 0.2's Corp list; bar 2 reads the default, every value). BRANCH_SRC=<dir>: the
 * branch tree's src from that directory instead of this checkout's. DRAFT=<runner form>,<corp form> writes commit 3's draft
 * drawMoney into the branch tree first (last-credits-fix-draft.py; forms none, 1, 2, today).
 *
 * Pools: batch (the 221 deals of g1 45617829233), nrdb (the 110 of NRDB=1 g1 45621322301); RECORDS=<batch run>,<nrdb run>
 * reads another pair of base runs' deal records (scripts/runner-rework/last-credits-fix-deals-<run>.json: the same deals,
 * the records a base on another tree played). LIMIT=n: the first n deals of each pool (step 0.5: 20).
 *
 * Bar 2's reading of commit 3 against commit 2 (rulings 16): every tree also hashes its 'later' drawWorth answers into a
 * second stream per step (side, value). A differing deal reports `later`: whether the 'later' answers already differed at
 * the first differing step (`atStep`), at an earlier step only (`before`, the first such step), or not at all: a first
 * difference with no 'later' move at its step is accepted only with a cache path shown (why script, CLEARAT).
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/last-credits-fix-lockstep.ts -- BASE=<sha> POOL=batch,nrdb
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Tree, loadTree } from './facts-trees';
import { HOOKS, Patch, applyPatches } from './core-hooks';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const BASE = process.env.BASE ?? '4d85e9fb14ed90097892af14d71184a6ac6d667d';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/last-credits-fix-lockstep', String(shard));
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const LIMIT = Number(process.env.LIMIT ?? Infinity);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 6000);
const PICKS = process.env.PICKS === '1';
const BRANCH_SRC = process.env.BRANCH_SRC ?? 'src';
const DRAFT = (process.env.DRAFT ?? '').split(',').filter(Boolean);
const FAULT_LIST = (process.env.FAULT ?? '').split(',').filter(Boolean);
const FAULT = FAULT_LIST.length ? FAULT_LIST[shard % FAULT_LIST.length].replace(/^none$/, '') : '';
const [sub, subs] = FAULT_LIST.length > 1 ? [Math.floor(shard / FAULT_LIST.length), Math.floor(shards / FAULT_LIST.length)] : [shard, shards];
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(FAULT_LIST.length ? { fault: FAULT || 'none', ...x } : x));
const key = (a: unknown) => (a === undefined ? 'undefined' : JSON.stringify(a));
const G = globalThis as any;
const NAMES = ['base', 'branch', 'control'] as const;
const RECORDS = (process.env.RECORDS ?? '45617829233,45621322301').split(',');
/** The 'later' stream's hook: drawWorth's answers, both trees (the signature line is commit 2's and commit 3's). */
const LATER: Patch[] = [
  [
    'ai/handValues.ts',
    `function drawWorth(state: GameState, side: SideCode, when: DrawWhen): number {\n`,
    `function drawWorth(state: GameState, side: SideCode, when: DrawWhen): number {\n  const __v = drawWorthLk(state, side, when);\n  if (when === 'later') (globalThis as any).__lkLater?.(side, __v);\n  return __v;\n}\nfunction drawWorthLk(state: GameState, side: SideCode, when: DrawWhen): number {\n`,
  ],
];
type Name = (typeof NAMES)[number];

/** Step 0.5's planted faults (branch tree only, after the hooks), each 0.01 on one input. Against commit 2's SHA every one must stop. */
const FAULTS: Record<string, Patch[]> = {
  // HQ's term of a run's worth (runs.ts serverValue, the HQ branch): 0.01 more when HQ holds a card to access
  hqRun: [
    [
      'ai/runs.ts',
      `    value = unchosen === 0 ? 0 : Math.min(accesses, unchosen) * hqAgendaOdds(state, odds) * central * 0.5 ** repeat;`,
      `    value = unchosen === 0 ? 0 : Math.min(accesses, unchosen) * hqAgendaOdds(state, odds) * central * 0.5 ** repeat + 0.01;`,
    ],
  ],
  // a held card's worth: heldWorth's played worth, 0.01 more
  held: [
    [
      'ai/handValues.ts',
      `  return heldFromPlayed(card, playedWorth(state, card) + (freeInstall ? CLICK : 0), side === 'corp' ? state.corp.credits : state.runner.credits);`,
      `  return heldFromPlayed(card, playedWorth(state, card) + (freeInstall ? CLICK : 0) + 0.01, side === 'corp' ? state.corp.credits : state.runner.credits);`,
    ],
  ],
  // a 'now' read: the deck card in a damage price, 0.01 more
  damageNow: [['ai/effectValues.ts', `  const card = cardRate(state, 'runner', 'now');\n  // The damage clock`, `  const card = cardRate(state, 'runner', 'now') + 0.01;\n  // The damage clock`]],
};

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
    if (name === 'branch') cpSync(BRANCH_SRC, join(dir, 'src'), { recursive: true });
    else execSync(`git archive ${BASE} src | tar -x -C ${dir}`);
    if (name === 'branch' && DRAFT.length) execSync(`python3 scripts/runner-rework/last-credits-fix-draft.py ${DRAFT[0]} ${DRAFT[1]} ${dir}`);
    applyPatches(dir, HOOKS, `tree ${name}`, read, write);
    applyPatches(dir, LATER, `later ${name}`, read, write);
    if (name === 'branch' && FAULT) {
      const fault = FAULTS[FAULT];
      if (!fault) throw new Error(`no fault ${FAULT} (${Object.keys(FAULTS).join(', ')})`);
      applyPatches(dir, fault, `fault ${FAULT}`, read, write);
    }
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
/** Every hook writes into one stream, each record labelled with its kind and scope path. */
function listen(t: Tree, rec: Acc, later: Acc): () => void {
  const scopes: string[] = [];
  const path = () => scopes.join('>');
  const core = t.core;
  G.__lkIn = (gr: any) => {
    scopes.push(gr.__lkScope ?? 'top');
    return () => void scopes.pop();
  };
  const top = () => !PICKS || path() === 'top';
  G.__lk = (_gr: any, kind: string, state: GameState, action: unknown) => top() && fnv(rec, `${path()}|${kind}|${kind === 'act' ? core.actingSide(state) : ''}|${key(action)}`);
  const scoreList = (ranked: { action: unknown; score: number }[]) => JSON.stringify(ranked.map(r => [r.action, Object.is(r.score, -0) ? '-0' : String(r.score)]));
  G.__lkDecRank = (_s: GameState, ranked: any[]) => !PICKS && fnv(rec, `${path()}|drank|${scoreList(ranked)}`);
  G.__lkOffRank = (_s: GameState, ranked: any[]) => !PICKS && fnv(rec, `${path()}|offrank|${scoreList(ranked)}`);
  G.__lkRank = (_s: GameState, ranked: any[]) => !PICKS && fnv(rec, `${path()}|rank|${scoreList(ranked)}`);
  G.__lkAns = (where: string, _s: GameState, action: unknown) => top() && fnv(rec, `${path()}>${where}|ans|${key(action)}`);
  G.__lkLater = (side: string, v: number) => fnv(later, `${side}|${Object.is(v, -0) ? '-0' : String(v)}`);
  return () => {
    G.__lkIn = G.__lk = G.__lkRank = G.__lkAns = G.__lkDecRank = G.__lkOffRank = G.__lkLater = undefined;
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
  let laterFirst: number | null = null; // the first step whose 'later' answers differ, base against branch
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.base.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const dec = decisionOf(T.base.core, s);
    const res = {} as Record<Name, Acc>;
    const lat = {} as Record<Name, Acc>;
    const more = {} as Record<Name, boolean>;
    const order = NAMES.map((_, k) => NAMES[(k + i) % NAMES.length]);
    for (const n of order) {
      res[n] = fresh();
      lat[n] = fresh();
      const stop = listen(T[n], res[n], lat[n]);
      const t0 = performance.now();
      try {
        more[n] = g[n].step();
      } finally {
        stop();
      }
      if (dec) tms[n][dec.side] += performance.now() - t0;
    }
    steps++;
    const same = (a: Name, b: Name) => res[a].n === res[b].n && res[a].h === res[b].h && more[a] === more[b];
    const laterAt = lat.base.n !== lat.branch.n || lat.base.h !== lat.branch.h;
    if (laterAt && laterFirst === null) laterFirst = i;
    if (!same('base', 'branch') || !same('base', 'control')) {
      const pick = (n: Name) => key(g[n].last).slice(0, 160);
      const later = { atStep: laterAt, before: laterFirst !== null && laterFirst < i ? laterFirst : null };
      diff = { step: i, T: s.turnNumber, side: dec?.side ?? null, kind: dec?.kind ?? null, branch: !same('base', 'branch'), control: !same('base', 'control'), later, picks: { base: pick('base'), branch: pick('branch') } };
      break;
    }
    if (!more.base) break;
  }
  const B = g.base.state;
  const recordSame = !diff ? (B.winner ?? null) === d.winner && key(cr) === key(d.cr) && key(sc) === key(d.sc) : null;
  for (const n of NAMES) for (const side of ['corp', 'runner'] as const) ms[n][side] += tms[n][side];
  const r1 = (x: number) => Math.round(x);
  out({ kind: 'deal', pool, seed: d.seed, steps, diff, recordSame, ms: Object.fromEntries(NAMES.map(n => [n, { corp: r1(tms[n].corp), runner: r1(tms[n].runner) }])) });
}

async function main() {
  const dirs = makeTrees();
  T = {} as Record<Name, Tree>;
  for (const n of NAMES) T[n] = await loadTree(n, dirs[n]);
  const batch: Deal[] = JSON.parse(readFileSync(`scripts/runner-rework/last-credits-fix-deals-${RECORDS[0]}.json`, 'utf8'));
  const nrdb: Deal[] = JSON.parse(readFileSync(`scripts/runner-rework/last-credits-fix-deals-${RECORDS[1]}.json`, 'utf8'));
  const sources: { pool: string; d: Deal }[] = [];
  for (const pool of POOLS) (pool === 'batch' ? batch : nrdb).filter(d => !DEALS.length || DEALS.includes(String(d.seed))).slice(0, LIMIT).forEach(d => sources.push({ pool, d }));
  for (let i = sub; i < sources.length; i += subs) {
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
