/**
 * R-A A-move (brief netrunner-ai/runner-rework/briefs/a-move.md rev 1a, bar 1a, 1b and 4): the branch's tree against its
 * base, decision by decision. Three trees, each loaded as its own module graph (facts-trees.ts loadTree):
 *   base     the base commit's src (BASE, default beta 920b6fa, src tree fd7831eb), from git;
 *   branch   this checkout's src (ai-runner-facts);
 *   control  the base's src again: the time arm, and a check that the base is reproducible.
 * Every tree gets one RECORD patch, which only writes a global: each HeuristicRunnerAI.chooseAction's answer, so the
 * Runner steps inside a decision (the Corp's reply Runners, the planner's rollouts) are compared too, not only the move.
 *
 * DEALS (POOL=batch: the 221 deals of g1 45444888753; POOL=nrdb: the 110 of NRDB=1 g1 45458221138, both on the base's
 * src): the three trees play each deal by a plain GameRunner in lockstep, one step each in turn. At every step: the action,
 * and the hash and count of the Runner answers made inside it, must be equal in all three; the first step that differs is
 * reported and the deal stops (a stop: the brief's bar 1 is 0). The base game is checked against the batch record
 * (winner, cr, sc of deals.json). Time: ms of every step that asks an agent, by side, per tree.
 * HUMAN (POOL=human: tests/fixtures/human-games): the recorded moves replayed; at every decision either side's AI would be
 * asked (Normal, whatever the file's difficulty), each tree's own persistent agents are asked on a copy, and their
 * answers and inner Runner answers compared; then the recorded move is played.
 * BOARD (ruling B): Malandragem with two counters and two fitting ice, runBypasses in base and branch.
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/facts-lockstep.ts -- POOL=batch,nrdb,human
 *   ARGS="POOL=batch DEALS=1001" npx vite-node scripts/runner-rework/facts-lockstep.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Tree, loadTree } from './facts-trees';
import { createCardInstance } from '../../src/core/engine/gameState';
import { newGame, startRunnerTurn } from '../../tests/helpers';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const BASE = process.env.BASE ?? '920b6fa46e153f8cada66e71fad6c4a098503251';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/runner-facts-lockstep', String(shard));
const POOLS = (process.env.POOL ?? 'batch,nrdb,human').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const MAX_STEPS = 4000;
const MAX_MS = Number(process.env.MAX_MS ?? Infinity); // local trial: stop after this long
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const key = (a: unknown) => (a ? JSON.stringify(a) : 'null');
const G = globalThis as any;
const NAMES = ['base', 'branch', 'control'] as const;
type Name = (typeof NAMES)[number];

// ------------------------------------------------------------------------------------------------ trees
const RECORD_AT = `  chooseAction(state: GameState): GameAction {
    return asSide('runner', () => this.decide(state));
  }`;
const RECORD_TO = (tree: string) => `  chooseAction(state: GameState): GameAction {
    const __answer = asSide('runner', () => this.decide(state));
    (globalThis as any).__lkRunner_${tree}?.push(String(JSON.stringify(__answer))); // an undefined answer is logged as 'undefined'
    return __answer;
  }`;
function makeTrees(): Record<Name, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  // The base's src from git (a shallow checkout fetches the one commit)
  try {
    execSync(`git cat-file -e ${BASE}^{commit}`, { stdio: 'ignore' });
  } catch {
    execSync(`git fetch --depth 1 origin ${BASE}`, { stdio: 'ignore' });
  }
  const dirs = {} as Record<Name, string>;
  for (const name of NAMES) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    if (name === 'branch') cpSync('src', join(dir, 'src'), { recursive: true });
    else execSync(`git archive ${BASE} src | tar -x -C ${dir}`);
    const path = join(dir, 'src', 'ai', 'runnerAI.ts');
    const text = readFileSync(path, 'utf8');
    if (text.split(RECORD_AT).length !== 2) throw new Error(`tree ${name}: the RECORD patch does not match once`);
    writeFileSync(path, text.replace(RECORD_AT, () => RECORD_TO(name)));
    dirs[name] = dir;
  }
  return dirs;
}
let T: Record<Name, Tree>;

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

/** The decision GameRunner.step asks an agent for at `s`, or null (as seen.ts). */
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
const started = Date.now();

// ------------------------------------------------------------------------------------------------ deals
type Rec = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(t: Tree, rec: Rec): GameState {
  const c = DECK_POOL.find(d => d.side === 'corp' && d.name === rec.corpDeck);
  const r = DECK_POOL.find(d => d.side === 'runner' && d.name === rec.runnerDeck);
  if (!c || !r) throw new Error(`deal ${rec.seed}: deck not found (${rec.corpDeck} v ${rec.runnerDeck})`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(rec.seed, c, r));
}

function deal(pool: string, rec: Rec) {
  const g = {} as Record<Name, any>;
  const tms = {} as Record<Name, { corp: number[]; runner: number[] }>;
  for (const n of NAMES) {
    T[n].clear();
    g[n] = new T[n].GameRunner(dealStateOf(T[n], rec), { corp: T[n].createAgent('corp', 'normal'), runner: T[n].createAgent('runner', 'normal') });
    tms[n] = { corp: [], runner: [] };
  }
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  let steps = 0;
  let diff: Record<string, unknown> | null = null;
  let inner = 0;
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.base.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const d = decisionOf(T.base.core, s);
    const res = {} as Record<Name, { more: boolean; act: string; inner: string }>;
    // One step each, in a turn that rotates (no tree always first)
    const order = NAMES.map((_, k) => NAMES[(k + i) % NAMES.length]);
    for (const n of order) {
      const log: string[] = [];
      G[`__lkRunner_${n}`] = log;
      const t0 = performance.now();
      const more = g[n].step();
      const dt = performance.now() - t0;
      G[`__lkRunner_${n}`] = undefined;
      if (d && more) tms[n][d.side].push(Math.round(dt * 10) / 10);
      res[n] = { more, act: key(g[n].last), inner: hash(log) };
    }
    if (!res.base.more && !res.branch.more && !res.control.more) break;
    steps++;
    inner += Number(res.base.inner.split(':')[0]);
    const same = (a: Name, b: Name) => res[a].more === res[b].more && res[a].act === res[b].act && res[a].inner === res[b].inner;
    if (!same('base', 'branch') || !same('base', 'control')) {
      diff = { step: i, T: s.turnNumber, side: d?.side, kind: d?.kind, base: res.base, branch: res.branch, control: res.control };
      break;
    }
    if (!res.base.more) break;
  }
  const B = g.base.state;
  const recordSame = !diff && (B.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
  for (const n of NAMES) for (const side of ['corp', 'runner'] as const) ms[n][side].push(...tms[n][side]);
  out({ kind: 'deal', pool, seed: rec.seed, steps, inner, recordSame, winner: B.winner ?? null, T: B.turnNumber, diff, ms: tms });
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
    agents[n] = { corp: T[n].createAgent('corp', 'normal'), runner: T[n].createAgent('runner', 'normal') };
  }
  const tms = { base: { corp: [], runner: [] }, branch: { corp: [], runner: [] }, control: { corp: [], runner: [] } } as Record<Name, { corp: number[]; runner: number[] }>;
  let decisions = 0;
  let inner = 0;
  const diffs: Record<string, unknown>[] = [];
  const errors: string[] = [];
  let stopped: string | null = null;
  for (const [j, move] of (r.moves as any[]).entries()) {
    const ai = { ...s, stops: { corp: 'ai', runner: 'ai' } } as GameState;
    const d = decisionOf(core, ai);
    if (d) {
      decisions++;
      const res = {} as Record<Name, string>;
      const order = NAMES.map((_, k) => NAMES[(k + j) % NAMES.length]);
      for (const n of order) {
        const log: string[] = [];
        G[`__lkRunner_${n}`] = log;
        const g = new T[n].GameRunner(structuredClone(ai), agents[n]);
        const t0 = performance.now();
        try {
          g.step();
          res[n] = `${key(g.last)} | ${hash(log)}`;
        } catch (e) {
          res[n] = `error: ${(e as Error).message.slice(0, 120)}`;
          errors.push(`${n} moves[${j}]: ${res[n]}`);
        }
        tms[n][d.side].push(Math.round((performance.now() - t0) * 10) / 10);
        G[`__lkRunner_${n}`] = undefined;
        if (n === 'base') inner += log.length;
      }
      if (res.base !== res.branch || res.base !== res.control) diffs.push({ at: j, T: s.turnNumber, side: d.side, kind: d.kind, ...res });
    }
    try {
      s = core.executeAction(s, move);
    } catch (e) {
      stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
      break;
    }
  }
  for (const n of NAMES) for (const side of ['corp', 'runner'] as const) ms[n][side].push(...tms[n][side]);
  out({ kind: 'human', src, moves: r.moves.length, stopped, decisions, inner, diffs: diffs.length, first: diffs.slice(0, 3), errors: errors.slice(0, 3), ms: tms });
}

// ------------------------------------------------------------------------------------------------ ruling B's board
function malandragemBoard() {
  const s = structuredClone(newGame(1));
  startRunnerTurn(s);
  s.runner.credits = 10;
  s.corp.credits = 10;
  for (const code of ['30047', '30047']) {
    const ice = createCardInstance(s, code);
    ice.isRezzed = true;
    ice.runnerKnows = true;
    s.corp.servers.hq.ice.push(ice);
  }
  const mal = createCardInstance(s, '34081');
  mal.isRezzed = true;
  mal.tokens = { ...mal.tokens, power: 2 };
  s.runner.rig.programs.push(mal);
  const read = (n: Name) => {
    T[n].clear();
    const b = T[n].runs.runBypasses(structuredClone(s), 'hq');
    return { ids: [...b.ids].sort(), price: b.price };
  };
  const base = read('base');
  const branch = read('branch');
  out({ kind: 'board', name: 'Malandragem, 2 counters, 2 fitting ice', base, branch, same: key(base) === key(branch) });
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const dirs = makeTrees();
  T = {} as Record<Name, Tree>;
  for (const n of NAMES) T[n] = await loadTree(n, dirs[n]);
  const sources: { pool: string; id: any }[] = [];
  for (const pool of POOLS) {
    if (pool === 'batch' || pool === 'nrdb') {
      const run = pool === 'batch' ? '45444888753' : '45458221138';
      const recs: Rec[] = JSON.parse(readFileSync(`scripts/runner-rework/facts-deals-${run}.json`, 'utf8'));
      for (const r of recs) if (!DEALS.length || DEALS.includes(String(r.seed))) sources.push({ pool, id: r });
    } else if (pool === 'human') {
      const dir = 'tests/fixtures/human-games';
      for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) sources.push({ pool, id: join(dir, f) });
    }
  }
  if (shard === 0) malandragemBoard();
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    if (Date.now() - started > MAX_MS) break;
    try {
      if (src.pool === 'human') human(src.id);
      else deal(src.pool, src.id);
    } catch (e) {
      out({ kind: 'error', pool: src.pool, src: src.pool === 'human' ? src.id : src.id.seed, error: (e as Error).stack?.slice(0, 400) });
    }
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
