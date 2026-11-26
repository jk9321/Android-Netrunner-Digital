/**
 * B3 commit 2, bar 3 (brief runner-rework/briefs/b3-prompt-view.md rev 2; rulings 19.6): this checkout's tree (`branch`,
 * the honest prompt view) against BASE (beta), step by step, on the base pools of g1 45766648425 and NRDB g1 45782846477
 * (the bases for beta 9c10d7f); `control` is BASE again. lockstep.ts's hashing (core-hooks.ts HOOKS, one stream per step).
 *
 * The first difference, by the decision: `prompt` (the deciding Runner's answer at a prompt, labelled by its source card
 * and step and whether a run is on, and whether step 0.2 listed the kind), or anything else (side.kind), traced. A Corp
 * first difference is a stop unless traced (Corp side condition 2: commit 2 moves 0 Corp decisions).
 *
 * On the branch tree, every deciding Runner's prompt answer reports (a hook on runner/prompt.ts honestPromptAnswer):
 *   path     view / again / last / today, by kind (every fallback counted by kind, the brief)
 *   classes  where the view is built: the cards it keeps real against those core/view.ts shows face up plus the entry's
 *            in-place ones, among the cards the Runner can't see and the stack (the classes test over the lockstep); a
 *            mismatch or an unkept card is listed
 * Time per tree by the deciding side and kind over the identical prefix; control against base is the spread.
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/b3/c2-lockstep.ts -- BASE=<sha> POOL=batch,nrdb
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
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
const BASE = process.env.BASE ?? '9c10d7f';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/c2-lockstep', String(shard));
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const LIMIT = Number(process.env.LIMIT ?? Infinity);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 6000);
const RECORDS = (process.env.RECORDS ?? '45766648425,45782846477').split(',');
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const key = (a: unknown) => (a === undefined ? 'undefined' : JSON.stringify(a));
const G = globalThis as any;
const NAMES = ['base', 'branch', 'control'] as const;
type Name = (typeof NAMES)[number];
/** Step 0.2's kinds (runner-rework/b3/step0.md, 0.2), by source title and step. */
const LISTED = new Set(
  [
    'MuslihaT: Multifarious Marketeer:top',
    'Tāo Salonga: Telepresence Magician:swap',
    'Mutual Favor:search',
    'Topan: Ormas Leader:host',
    'Scrounge:host',
    'Pantograph:host',
    'Magdalene Keino-Chemutai: Cryptarchitect:host',
    'Hermes:bounce',
    'Muse:install',
    'Cataloguer:arrange',
    'Burner:where',
    'Bahia Bands:host',
    'Privileged Access:host-program',
  ],
);

const HEAD = `export function honestPromptAnswer(state: GameState, ports: PromptViewPorts): { action: GameAction; path: PromptPath } {\n`;
const PATH: Patch[] = [
  [
    'ai/runner/prompt.ts',
    HEAD,
    `${HEAD}  const __r = __c2Honest(state, ports);\n  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n  (globalThis as any).__c2Path?.(state, __r.path, { honestPromptView, promptShownIds, promptInPlaceIds, ports, today: todayPathKind(state) });\n  return __r;\n}\nfunction __c2Honest(state: GameState, ports: PromptViewPorts): { action: GameAction; path: PromptPath } {\n`,
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
    applyPatches(dir, name === 'branch' ? [...HOOKS, ...PATH] : HOOKS, `tree ${name}`, read, write);
    dirs[name] = dir;
  }
  return dirs;
}
let T: Record<Name, Tree>;

type Acc = { n: number; h: number; list?: string[] };
const TRACE = !!process.env.TRACE;
const fresh = (): Acc => ({ n: 0, h: 0x811c9dc5, list: TRACE ? [] : undefined });
const fnv = (acc: Acc, x: string) => {
  acc.list?.push(x);
  let h = acc.h;
  for (let i = 0; i < x.length; i++) {
    h ^= x.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= 0x1f;
  acc.h = Math.imul(h, 0x01000193) >>> 0;
  acc.n++;
};
const title = (t: Tree, code: string) => t.core.getCardDefinition(code)?.title ?? code;
/** A Runner prompt's kind: its source card's title and step, and whether a run is on. */
function kindOf(t: Tree, s: GameState): string | null {
  const p: any = t.core.activePrompt(s);
  if (!p || p.side !== 'runner') return null;
  const src = p.source ? `${title(t, p.source.cardCode)}:${p.source.step}` : p.kind;
  return `${p.kind} | ${src}${s.activeRun ? ' (run)' : ''}`;
}
const listed = (kind: string) => LISTED.has(kind.split(' | ')[1]?.replace(' (run)', '') ?? '');

/** The branch tree's answers, per kind: paths, and the classes where the view is built. */
const answers: Record<string, { path: Record<string, number>; classes: number; mismatch: number; unkept: number; ex: unknown[] }> = {};
function listenPaths(t: Tree) {
  G.__c2Path = (s: GameState, path: string, m: any) => {
    const kind = kindOf(t, s) ?? '?';
    const r = (answers[kind] ??= { path: {}, classes: 0, mismatch: 0, unkept: 0, ex: [] });
    r.path[path] = (r.path[path] ?? 0) + 1;
    if (m.today || process.env.NOCLASS) return;
    const { kept, unkept } = m.honestPromptView(s, m.ports);
    const slots = m.ports.slots(s);
    const pool = new Set([...slots.ice, ...slots.root, ...slots.loose, ...s.runner.stack].map((c: any) => c.instanceId));
    const want = new Set([...m.promptShownIds(s), ...m.promptInPlaceIds(s)].filter((id: string) => pool.has(id)));
    r.classes++;
    const same = kept.size === want.size && [...want].every(id => kept.has(id));
    if (!same) r.mismatch++;
    if (unkept.length) r.unkept++;
    if ((!same || unkept.length) && r.ex.length < 3) r.ex.push({ T: s.turnNumber, kept: [...kept], want: [...want], unkept });
  };
}

/** Every hook writes into one stream, each record labelled with its kind and scope path. */
function listen(t: Tree, rec: Acc): () => void {
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
  return () => {
    G.__lkIn = G.__lk = G.__lkRank = G.__lkAns = G.__lkDecRank = G.__lkOffRank = undefined;
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

const KINDS = ['main', 'prompt', 'run', 'off', 'rez'];
type Tm = Record<string, number>;
const zeroTm = (): Tm => Object.fromEntries(['corp', 'runner'].flatMap(sd => KINDS.map(k => [`${sd}.${k}`, 0])));
const ms: Record<Name, Tm> = { base: zeroTm(), branch: zeroTm(), control: zeroTm() };
function deal(pool: string, d: Deal) {
  const g = {} as Record<Name, any>;
  for (const n of NAMES) {
    T[n].clear();
    g[n] = new T[n].GameRunner(dealStateOf(T[n], d), { corp: T[n].createAgent('corp', 'normal'), runner: T[n].createAgent('runner', 'normal') });
  }
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  let diff: Record<string, unknown> | null = null;
  let steps = 0;
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
    const order = NAMES.map((_, k) => NAMES[(k + i) % NAMES.length]);
    const tm = {} as Record<Name, number>;
    for (const n of order) {
      res[n] = fresh();
      if (process.env.CLEAR === '1') T[n].clear();
      else if (process.env.CLEAR) {
        const t: any = T[n];
        for (const c of process.env.CLEAR.split(','))
          ({ hand: () => t.handValues.clearHandCaches(), damage: () => t.effectValues.clearDamageThreats(), build: () => t.valueModel?.clearBuildTargets?.(), deck: () => t.iceValues.clearDeckShares?.() })[c]?.();
      }
      const stop = listen(T[n], res[n]);
      if (n === 'branch') listenPaths(T[n]);
      const t0 = performance.now();
      try {
        more[n] = g[n].step();
      } finally {
        stop();
        G.__c2Path = undefined;
      }
      tm[n] = performance.now() - t0;
    }
    steps++;
    const same = (a: Name, b: Name) => res[a].n === res[b].n && res[a].h === res[b].h && more[a] === more[b];
    if (!same('base', 'branch') || !same('base', 'control')) {
      const kind = dec?.side === 'runner' && dec.kind === 'prompt' ? kindOf(T.base, s) : null;
      diff = {
        step: i,
        T: s.turnNumber,
        side: dec?.side ?? null,
        kind: dec?.kind ?? null,
        first: kind ? (listed(kind) ? 'prompt:listed' : 'prompt:other') : `${dec?.side ?? '-'}.${dec?.kind ?? '-'}`,
        prompt: kind,
        branch: !same('base', 'branch'),
        control: !same('base', 'control'),
        picks: { base: key(g.base.last).slice(0, 200), branch: key(g.branch.last).slice(0, 200) },
        pickDiffers: key(g.base.last) !== key(g.branch.last),
      };
      if (TRACE) {
        const [a, b] = [res.base.list!, res.branch.list!];
        const at = a.findIndex((x, k) => x !== b[k]);
        diff.trace = { at, of: [a.length, b.length], base: a.slice(Math.max(0, at - 2), at + 3).map(x => x.slice(0, 400)), branch: b.slice(Math.max(0, at - 2), at + 3).map(x => x.slice(0, 400)) };
      }
      break;
    }
    if (dec) for (const n of NAMES) ms[n][`${dec.side}.${dec.kind}`] += tm[n];
    if (!more.base) break;
  }
  const B = g.base.state;
  const recordSame = !diff ? (B.winner ?? null) === d.winner && key(cr) === key(d.cr) && key(sc) === key(d.sc) : null;
  out({ kind: 'deal', pool, seed: d.seed, steps, diff, recordSame });
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
  out({ kind: 'answers', answers });
  out({ kind: 'time', ms: Object.fromEntries(NAMES.map(n => [n, Object.fromEntries(Object.entries(ms[n]).map(([k, v]) => [k, Math.round(v)]))])) });
  if (process.env.OUT_DIR) writeFileSync(join(process.env.OUT_DIR, `done-${shard}.txt`), 'ok');
}
main();
