/**
 * R-105 step 0 (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/r105-upkeep-skip.md rev 0a), parts 1 and 2 and
 * ruling 4's count: measurement only, no src change. Notes: /mnt/project-files/netrunner-ai/runner-rework/r105/step0.md.
 *
 * Two scratch trees, `base` (3680b7f, before B4a) and `branch` (bae7c82, B4a merged), each with core-hooks.ts HOOKS (the
 * GameRunner scope, used here only to tell the top-level executeAction from simulated ones) and the count patches below.
 * Each deal is played lockstep-style (b4/lockstep.ts CLEAR=1 FOLLOW=1): both trees step, caches cleared before each step,
 * and where the branch's pick differs it takes base's, so both count on the base game's boards.
 *
 *  - copy (both trees): per executeAction call, the objects and arrays copyPlain copies, by path (corp.* and runner.* by
 *    their field, everything else by its top-level key), and copyPlain's own time.
 *  - hand (branch): per updateHandKnowledge call, the conditions of the brief's part 1 table evaluated on (prev, state),
 *    and whether each of the three walks changed a list (a JSON compare of knownToRunner, knownToCorp, archKnownToRunner
 *    before and after it). A hit on a walk that changed a list is `unsafe` (the condition is wrong; should be 0).
 *  - exec (both trees): executeAction calls and inclusive time by the top-level step's decision kind, and the time of
 *    updateRdKnowledge and updateHandKnowledge inside it (performance.now around each call).
 *  - marks (branch, ruling 4): calls and time of turnPlanner.ts's `marks` line (runnerDecisionView's view key).
 *
 * PROTO=1 (PROTO=loose: with the looser open test as a fallback) applies proto.ts's prototype of part 1 to the branch tree (with BASE=BRANCH=bae7c82: the prototype's own clock).
 * TIME=1 leaves out the hand hook and the object count, so the clocks (exec, upkeep, copyPlain) are not inflated by them.
 *
 *   SHARD=0/4 npx vite-node scripts/runner-rework/r105/step0.ts -- DEALS=1001,1641,2281,2921
 *   node scripts/runner-rework/r105/step0-sum.mjs <files...>
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CardInstance, GameState } from '../../../src/core';
import { ALL_DECKS } from '../../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../../nrdb-test-decks';
import { Tree, loadTree } from '../facts-trees';
import { HOOKS, Patch, applyPatches } from '../core-hooks';
import { PROTO, PROTO_LOOSE } from './proto';

for (const kv of process.argv.slice(2).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const SHAS = { base: process.env.BASE ?? '3680b7f21c012f4fa1fbec38f4817cdf49bec654', branch: process.env.BRANCH ?? 'bae7c8256aad1dde2ca7df15d8a3fd596b529cf2' };
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const DEALS = (process.env.DEALS ?? '1001,1641,2281,2921').split(',').map(Number);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 6000);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/r105-step0', String(shard));
const G = globalThis as any;
/** TIME=1: the clean timing pass: no hand-condition hook and no object count (both allocate or walk), only the clocks. */
const TIME = process.env.TIME === '1';
type Name = 'base' | 'branch';
const NAMES: Name[] = ['base', 'branch'];

const COPY: Patch = [
  'core/engine/gameEngine.ts',
  `  const { log, ...rest } = prevState;\n  const state: GameState = { ...(copyPlain(rest) as typeof rest), log: log.slice() };`,
  `  const { log, ...rest } = prevState;\n  (globalThis as any).__r105Copy?.(rest);\n  const __c0 = performance.now();\n  const state: GameState = { ...(copyPlain(rest) as typeof rest), log: log.slice() };\n  (globalThis as any).__r105CopyMs?.(performance.now() - __c0);`,
];
// Both trees: executeAction's own time (inclusive) and the two knowledge upkeeps' time, per call
const EXEC: Patch[] = [
  [
    'core/engine/gameEngine.ts',
    `export function executeAction(prevState: GameState, action: GameAction): GameState {`,
    `export function executeAction(prevState: GameState, action: GameAction): GameState {\n  const __e0 = performance.now();\n  try {\n    return __executeAction(prevState, action);\n  } finally {\n    (globalThis as any).__r105Time?.('exec', performance.now() - __e0);\n  }\n}\nfunction __executeAction(prevState: GameState, action: GameAction): GameState {`,
  ],
  [
    'core/engine/gameEngine.ts',
    `  updateRdKnowledge(prevState, state);\n  updateHandKnowledge(prevState, state);`,
    `  const __u0 = performance.now();\n  updateRdKnowledge(prevState, state);\n  const __u1 = performance.now();\n  updateHandKnowledge(prevState, state);\n  (globalThis as any).__r105Time?.('rd', __u1 - __u0);\n  (globalThis as any).__r105Time?.('hand', performance.now() - __u1);`,
  ],
];
const HAND: Patch[] = [
  [
    'core/engine/helpers.ts',
    `export function updateHandKnowledge(prev: GameState, state: GameState): void {\n  updateArchivesKnowledge(prev, state);\n  noteOpenArrivals(prev, state);`,
    `export function updateHandKnowledge(prev: GameState, state: GameState): void {\n  (globalThis as any).__r105Hand?.(0, prev, state);\n  try {\n    __updateHandKnowledge(prev, state);\n  } finally {\n    (globalThis as any).__r105Hand?.(3, prev, state);\n  }\n}\nfunction __updateHandKnowledge(prev: GameState, state: GameState): void {\n  updateArchivesKnowledge(prev, state);\n  (globalThis as any).__r105Hand?.(1, prev, state);\n  noteOpenArrivals(prev, state);\n  (globalThis as any).__r105Hand?.(2, prev, state);`,
  ],
  [
    'ai/turnPlanner.ts',
    `  const marks = JSON.stringify([state.corp.knownToRunner, state.corp.rdKnownToRunner, state.corp.archKnownToRunner]);`,
    `  const __m0 = performance.now();\n  const marks = JSON.stringify([state.corp.knownToRunner, state.corp.rdKnownToRunner, state.corp.archKnownToRunner]);\n  (globalThis as any).__r105Marks?.(performance.now() - __m0, marks.length);`,
  ],
];

function makeTrees(): Record<Name, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs = {} as Record<Name, string>;
  for (const n of NAMES) {
    const dir = join(root, n);
    mkdirSync(dir, { recursive: true });
    execSync(`set -o pipefail; git archive ${SHAS[n]} src | tar -x -C ${dir}`, { shell: '/bin/bash', stdio: 'ignore' });
    if (n === 'branch' && process.env.PROTO) applyPatches(dir, process.env.PROTO === 'loose' ? PROTO_LOOSE : PROTO, 'r105 prototype', p => readFileSync(p, 'utf8'), (p, t) => writeFileSync(p, t));
    const patches = n === 'branch' ? [...HOOKS, COPY, ...EXEC, ...(TIME ? HAND.slice(1) : HAND)] : [...HOOKS, COPY, ...EXEC];
    applyPatches(dir, patches, `tree ${n}`, p => readFileSync(p, 'utf8'), (p, t) => writeFileSync(p, t));
    dirs[n] = dir;
  }
  return dirs;
}

// --- tallies -------------------------------------------------------------------------------------------------------
type Scope = 'top' | 'sim';
const tally: Record<string, number> = {};
const bump = (k: string, x = 1) => (tally[k] = (tally[k] ?? 0) + x);
let cur: Name = 'base';
let topNext = false;
let scope: Scope = 'sim';
let decSide = 'none';
/** The GameRunner scopes an executeAction call is inside (core-hooks' __lkIn): T the top-level game, reply / oracle /
 * hardR / hardC the labelled playouts, gr any other GameRunner; a call outside every inner GameRunner is the deciding
 * agent's own simulation (the planner's rollouts call executeAction directly). */
const scopes: string[] = [];
let topRunner: unknown = null;
G.__lkIn = (gr: any) => {
  scopes.push(gr === topRunner ? 'T' : (gr.__lkScope ?? 'gr'));
  return () => void scopes.pop();
};

function countObjects(v: unknown): number {
  if (typeof v !== 'object' || v === null) return 0;
  let n = 1;
  if (Array.isArray(v)) for (const x of v) n += countObjects(x);
  else for (const k in v as Record<string, unknown>) n += countObjects((v as Record<string, unknown>)[k]);
  return n;
}
G.__r105Copy = (rest: Record<string, any>) => {
  scope = topNext ? 'top' : 'sim';
  topNext = false;
  bump(`copy|${cur}|${scope}|calls`);
  bump(`exec|${cur}|${decSide}|calls`);
  bump(`where|${cur}|${decSide}|${scopes.join('>') || '-'}`);
  if (TIME) return;
  for (const k in rest) {
    if ((k === 'corp' || k === 'runner') && rest[k]) {
      bump(`copy|${cur}|${scope}|obj|${k}`);
      for (const k2 in rest[k]) bump(`copy|${cur}|${scope}|obj|${k}.${k2}`, countObjects(rest[k][k2]));
    } else bump(`copy|${cur}|${scope}|obj|${k}`, countObjects(rest[k]));
  }
};
G.__r105CopyMs = (ms: number) => bump(`copy|${cur}|${scope}|ms`, ms);
G.__r105Time = (what: string, ms: number) => bump(`time|${cur}|${decSide}|${what}`, ms);
G.__r105Marks = (ms: number, len: number) => {
  bump(`marks|${decSide}|calls`);
  bump(`marks|${decSide}|ms`, ms);
  bump(`marks|${decSide}|len`, len);
};

// The part 1 conditions, as the brief's table states them
const sameIds = (a: CardInstance[], b: CardInstance[]) => a.length === b.length && a.every((c, i) => c.instanceId === b[i].instanceId);
const isOpen = (c: CardInstance) => !!(c.isRezzed || c.faceUp || c.runnerKnows);
const hosted = (c: CardInstance) => (c.hostedCards ?? []).map(h => h.instanceId).join(',');
const sameCards = (a: CardInstance[], b: CardInstance[], flag: boolean) =>
  a.length === b.length && a.every((c, i) => c.instanceId === b[i].instanceId && hosted(c) === hosted(b[i]) && (!flag || isOpen(c) === isOpen(b[i])));
function sameOpen(p: GameState, s: GameState): boolean {
  const pk = Object.keys(p.corp.servers), sk = Object.keys(s.corp.servers);
  if (pk.length !== sk.length || sk.some(k => !p.corp.servers[k])) return false;
  for (const k of sk) if (!sameCards(p.corp.servers[k].root, s.corp.servers[k].root, true) || !sameCards(p.corp.servers[k].ice, s.corp.servers[k].ice, true)) return false;
  const lists = (x: GameState) => [x.corp.archives.faceUp, x.corp.scoreArea, x.runner.scoreArea, x.runner.heap, x.runner.rig.programs, x.runner.rig.hardware, x.runner.rig.resources, x.removedFromGame];
  const lp = lists(p), ls = lists(s);
  return lp.every((l, i) => sameCards(l, ls[i], false));
}
/** publicCards' ids (helpers.ts), for the looser test: no id open in `s` that was not open in `p` */
function openIds(x: GameState): Set<string> {
  const ids = new Set<string>();
  const add = (l: CardInstance[]) => l.forEach(c => (ids.add(c.instanceId), (c.hostedCards ?? []).forEach(h => ids.add(h.instanceId))));
  for (const v of Object.values(x.corp.servers)) add([...v.root, ...v.ice].filter(isOpen));
  [x.corp.archives.faceUp, x.corp.scoreArea, x.runner.scoreArea, x.runner.heap, x.runner.rig.programs, x.runner.rig.hardware, x.runner.rig.resources, x.removedFromGame].forEach(add);
  return ids;
}
const lists = (s: GameState) => [s.corp.knownToRunner, s.runner.knownToCorp, (s.corp as any).archKnownToRunner].map(l => (l === undefined ? 'absent' : JSON.stringify(l)));
const snap: string[][] = [];
let cond: Record<string, boolean> = {};
G.__r105Hand = (stage: number, prev: GameState, state: GameState) => {
  snap[stage] = lists(state);
  if (stage === 0) {
    const c = state.corp, r = state.runner;
    const corpList = (c.knownToRunner ?? []) as any[], runnerList = (r.knownToCorp ?? []) as any[];
    const arch = ((c as any).archKnownToRunner ?? []) as any[];
    const marks = new Set((c.rdKnownToRunner ?? []).map(e => e.id));
    const hqIds = new Set(c.hq.map(x => x.instanceId));
    const before = openIds(prev);
    cond = {
      hq: sameIds(prev.corp.hq, c.hq),
      grip: sameIds(prev.runner.grip, r.grip),
      arcIds: sameIds(prev.corp.archives.faceDown, c.archives.faceDown),
      arcLen: arch.length <= c.archives.faceDown.length,
      corpListOk: corpList.every(e => typeof e === 'object') && corpList.length <= c.hq.length,
      runnerListOk: runnerList.every(e => typeof e === 'object') && runnerList.length <= r.grip.length,
      lists: corpList.every(e => typeof e === 'object') && runnerList.every(e => typeof e === 'object') && corpList.length <= c.hq.length && runnerList.length <= r.grip.length,
      rdMark: !corpList.some(e => typeof e === 'object' && !hqIds.has(e.id) && marks.has(e.id)),
      open: sameOpen(prev, state),
      openLoose: [...openIds(state)].every(id => before.has(id)),
    };
    return;
  }
  if (stage !== 3) return;
  const sc = scope;
  bump(`hand|${sc}|calls`);
  for (const [k, v] of Object.entries(cond)) if (v) bump(`hand|${sc}|same|${k}`);
  // Archives walk: lists[2] from stage 0 to 1
  const arcHit = cond.arcIds && cond.arcLen;
  const arcChanged = snap[0][2] !== snap[1][2];
  bump(`hand|${sc}|arc|${arcHit ? 'hit' : 'miss'}`);
  if (arcChanged) bump(`hand|${sc}|arc|changed`);
  if (arcHit && arcChanged) bump(`hand|${sc}|arc|unsafe`);
  if (!arcHit && !arcChanged) bump(`hand|${sc}|arc|missIdle`);
  if (!arcHit) bump(`hand|${sc}|arc|why|${!cond.arcIds ? 'faceDown differs' : 'list longer than Archives'}`);
  // noteOpenArrivals, per owner: lists[0] (HQ) and lists[1] (grip) from stage 1 to 2
  for (const [i, owner, same] of [[0, 'corp', cond.hq], [1, 'runner', cond.grip]] as const) {
    const changed = snap[1][i] !== snap[2][i];
    bump(`hand|${sc}|arrivals.${owner}|${same ? 'hit' : 'miss'}`);
    if (changed) bump(`hand|${sc}|arrivals.${owner}|changed`);
    if (same && changed) bump(`hand|${sc}|arrivals.${owner}|unsafe`);
    if (!same && !changed) bump(`hand|${sc}|arrivals.${owner}|missIdle`);
  }
  // the main walk: lists[0..1] from stage 2 to 3; both empty at stage 2 is today's early return
  const empty = [0, 1].every(i => snap[2][i] === 'absent' || snap[2][i] === '[]' || !JSON.parse(snap[2][i]).some((e: unknown) => typeof e === 'object'));
  const changed = snap[2][0] !== snap[3][0] || snap[2][1] !== snap[3][1];
  const order = ['hq', 'grip', 'lists', 'rdMark', 'open'] as const;
  const failed = order.filter(k => !cond[k]);
  const hit = empty || failed.length === 0;
  const looseFailed = (['hq', 'grip', 'lists', 'rdMark', 'openLoose'] as const).filter(k => !cond[k]);
  const looseHit = empty || looseFailed.length === 0;
  bump(`hand|${sc}|main|${empty ? 'empty' : hit ? 'hit' : 'miss'}`);
  if (changed) bump(`hand|${sc}|main|changed`);
  if (hit && changed) bump(`hand|${sc}|main|unsafe`);
  if (!hit && !changed) bump(`hand|${sc}|main|missIdle`);
  if (!hit) bump(`hand|${sc}|main|first|${failed[0]}`);
  if (!hit) bump(`hand|${sc}|main|only|${failed.length === 1 ? failed[0] : 'several'}`);
  // Finding 11's per-owner condition: each owner with a list skips its part when its own hand and list pass and the open
  // zones are the same (the other hand is not an input of that part)
  const has = [0, 1].map(i => !(snap[2][i] === 'absent' || snap[2][i] === '[]'));
  const ownerOk = (i: number) => !has[i] || (i === 0 ? cond.hq && cond.corpListOk && cond.rdMark : cond.grip && cond.runnerListOk);
  const perOwnerHit = empty || (cond.open && ownerOk(0) && ownerOk(1));
  if (perOwnerHit) bump(`hand|${sc}|main|perOwnerHit`);
  if (perOwnerHit && changed) bump(`hand|${sc}|main|perOwnerUnsafe`);
  const perOwnerLooseHit = empty || (cond.openLoose && ownerOk(0) && ownerOk(1));
  if (perOwnerLooseHit) bump(`hand|${sc}|main|perOwnerLooseHit`);
  if (perOwnerLooseHit && changed) bump(`hand|${sc}|main|perOwnerLooseUnsafe`);
  if (looseHit) bump(`hand|${sc}|main|looseHit`);
  if (looseHit && changed) bump(`hand|${sc}|main|looseUnsafe`);
  if (arcHit && cond.hq && cond.grip && hit) bump(`hand|${sc}|all3`);
  if (arcHit && cond.hq && cond.grip && looseHit) bump(`hand|${sc}|all3loose`);
};

// --- the deals -----------------------------------------------------------------------------------------------------
type Deal = { seed: number; corpDeck: string; runnerDeck: string };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(t: Tree, d: Deal): GameState {
  const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck);
  const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck);
  if (!c || !r) throw new Error(`deal ${d.seed}: deck not found`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r));
}
function decisionOf(core: any, s: GameState): string {
  const side = core.actingSide(s);
  if (!side || s.winner) return 'none';
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
    const want = core.wantsStop(s, side, w);
    if (want && side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server')) return 'corp|rez';
    if (want && side === 'runner' && w.step === 'corp_action') return 'runner|off';
    return 'none';
  }
  return `${side}|${core.activePrompt(s) ? 'prompt' : s.activeRun ? 'run' : 'main'}`;
}
const key = (a: unknown) => (a === undefined ? 'undefined' : JSON.stringify(a));

async function main() {
  const dirs = makeTrees();
  const T = {} as Record<Name, Tree>;
  for (const n of NAMES) T[n] = await loadTree(n, dirs[n]);
  const batch: (Deal & { seed: number })[] = JSON.parse(readFileSync('scripts/runner-rework/b4/deals-45794820047.json', 'utf8'));
  const mine = DEALS.filter((_, i) => i % shards === shard);
  for (const seed of mine) {
    const d = batch.find(x => x.seed === seed);
    if (!d) throw new Error(`deal ${seed} not in the batch pool`);
    const g = {} as Record<Name, any>;
    for (const n of NAMES) {
      T[n].clear();
      g[n] = new T[n].GameRunner(dealStateOf(T[n], d), { corp: T[n].createAgent('corp', 'normal'), runner: T[n].createAgent('runner', 'normal') });
    }
    let forced = 0;
    for (let i = 0; i < MAX_STEPS; i++) {
      decSide = decisionOf(T.base.core, g.base.state);
      bump(`dec|${decSide}`);
      const prevBranch = g.branch.state;
      const more = {} as Record<Name, boolean>;
      for (const n of NAMES) {
        cur = n;
        T[n].clear();
        const top = g[n];
        topRunner = top;
        G.__lk = (gr: any, kind: string) => {
          if (gr === top && kind === 'step') topNext = true;
        };
        const t0 = performance.now();
        try {
          more[n] = g[n].step();
        } finally {
          bump(`step|${n}|${decSide}`, performance.now() - t0);
          G.__lk = undefined;
          topNext = false;
        }
      }
      if (more.base !== more.branch || key(g.base.last) !== key(g.branch.last)) {
        if (!more.base || !more.branch) break;
        forced++;
        cur = 'branch';
        topNext = true;
        g.branch.state = T.branch.core.executeAction(prevBranch, g.base.last);
        g.branch.last = g.base.last;
        topNext = false;
      }
      if (!more.base) break;
    }
    bump('deals');
    bump('forced', forced);
    console.log(JSON.stringify({ kind: 'deal', seed, forced, T: g.base.state.turnNumber, winner: g.base.state.winner ?? null }));
  }
  console.log(JSON.stringify({ kind: 'tally', shard, tally }));
}
main();
