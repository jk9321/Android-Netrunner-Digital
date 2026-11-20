/**
 * Bundle H build (netrunner-ai/review-fixes-1119/hold-inputs/brief.md rev 2, "Judged by", time): decision time of the
 * branch against a control arm (found row 69a: identical trees read 3-4% apart in self-play, so a ratio is read against
 * a control, never alone).
 *
 * Trees (each its own module graph, breaker-once-trees' loadTree): `base` = this checkout's src with hold.ts,
 * rezMoney.ts and runs.ts from BASE (the merge base; the branch changes no other src file, checked); `control` = the same
 * again; `head` = this checkout's src; `source` = base again, which plays the source games and is never asked or cleared
 * (found row 71b).
 *
 * Sources (kinds kept apart: self, humanRunner = the person played the Runner, humanCorp):
 *  - the 221 deals of scripts/stage-d/post-pick-deals.json, Normal v Normal, played by `source` with a plain GameRunner;
 *  - the human files in tests/fixtures/human-games, the recorded moves replayed.
 * Every decision of either side (as breaker-once's decisionOf) is asked of base, control and head: a one-step GameRunner
 * on a copy, fresh agents (a deal's agents' state copied in), hand caches cleared, the tree order rotated, timed. A
 * decision where head takes over 2x control and at least 0.5 s is asked of all three twice more (`re`: the three times
 * each). A base answer unlike control's is counted (`baseControl`): the trees are the same code.
 * The Runner's deck is flagged `knick` (Knickknack) or `audrey` (Audrey v2) from its cards (HIDDEN-READ: the measuring
 * script reads the Runner's stack; no AI does).
 *
 *   SHARD=0/64 BASE=<sha> npx vite-node scripts/review-fixes/hold-inputs-time.ts
 *   ARGS="BASE=<sha> DEALS=1001 HUMAN=none" npx vite-node scripts/review-fixes/hold-inputs-time.ts
 * Sum with hold-inputs-time-sum.mjs.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { dealState } from '../stage-a/harness';
import { Tree, loadTree } from '../stage-vc/breaker-once-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const BASE = process.env.BASE ?? '';
if (!/^[0-9a-f]{40}$/.test(BASE)) throw new Error('BASE=<full sha of the merge base>');
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/hold-inputs-time', String(shard));
const MAXDEC = Number(process.env.MAXDEC ?? Infinity);
const FILES = ['ai/corp/hold.ts', 'ai/corp/rezMoney.ts', 'ai/runs.ts'];
const ASKED = ['base', 'control', 'head'] as const;
const key = (a: unknown) => (a ? JSON.stringify(a) : 'null');
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r2 = (x: number) => Math.round(x * 100) / 100;

function fetchSha(sha: string) {
  for (let k = 0; ; k++) {
    try {
      execSync(`git cat-file -e ${sha}^{commit}`, { stdio: 'ignore' });
      return;
    } catch {
      if (k >= 10) throw new Error(`hold-inputs-time: could not fetch ${sha}`);
      try {
        execSync(`git fetch -q --depth=1 origin ${sha}`, { stdio: 'ignore' });
      } catch {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 + Math.floor(Math.random() * 1500));
      }
    }
  }
}
function makeDirs(): Record<string, string> {
  fetchSha(BASE);
  const changed = execSync(`git diff --name-only ${BASE} HEAD -- src`, { encoding: 'utf8' }).split('\n').filter(Boolean);
  const other = changed.filter(f => !FILES.includes(f.replace(/^src\//, '')));
  if (other.length) throw new Error(`the branch changes src files this script does not swap: ${other.join(', ')}`);
  rmSync(root, { recursive: true, force: true });
  const dirs: Record<string, string> = {};
  for (const name of ['source', ...ASKED]) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    if (name !== 'head') for (const f of FILES) writeFileSync(join(dir, 'src', f), execSync(`git show ${BASE}:src/${f}`, { maxBuffer: 1 << 26 }));
    dirs[name] = dir;
  }
  return dirs;
}

// ------------------------------------------------------------------------------------------------ agents (as breaker-once)
type Snap = Record<string, unknown>;
function snapAgent(agent: any): Snap {
  const s: Snap = {};
  for (const [k, v] of Object.entries(agent)) {
    if (typeof v === 'function') continue;
    try {
      s[k] = structuredClone(v);
    } catch {
      /* not cloneable: left as the fresh agent has it */
    }
  }
  return s;
}
function restore(fresh: any, snap: Snap | undefined) {
  if (!snap) return fresh;
  for (const [k, v] of Object.entries(snap)) {
    const cur = fresh[k];
    if (cur && typeof cur === 'object' && !Array.isArray(cur) && !(cur instanceof Map) && !(cur instanceof Set) && Object.getPrototypeOf(cur) !== Object.prototype) Object.assign(cur, structuredClone(v));
    else fresh[k] = structuredClone(v);
  }
  return fresh;
}
const agents = (t: Tree, snaps?: { corp?: Snap; runner?: Snap }) => ({ corp: restore(t.createAgent('corp', 'normal'), snaps?.corp), runner: restore(t.createAgent('runner', 'normal'), snaps?.runner) });

type Cls = 'corpPrompt' | 'corpMain' | 'corpRez' | 'runnerPrompt' | 'runnerMain' | 'runnerOff';
function decisionOf(core: any, s: GameState): { side: 'corp' | 'runner'; cls: Cls } | null {
  const side = core.actingSide(s);
  if (!side || s.winner) return null;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
    const ask = core.wantsStop(s, side, w);
    if (ask && side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server')) return { side, cls: 'corpRez' };
    if (ask && side === 'runner' && w.step === 'corp_action') return { side, cls: 'runnerOff' };
    return null;
  }
  return { side, cls: core.activePrompt(s) ? (`${side}Prompt` as Cls) : (`${side}Main` as Cls) };
}

let trees: Record<string, Tree> = {};
function ask(t: Tree, s: GameState, snaps?: { corp?: Snap; runner?: Snap }): { k: string; ms: number } {
  t.clear();
  const g = new t.GameRunner(structuredClone(s), agents(t, snaps));
  const at = performance.now();
  try {
    g.step();
    return { k: key(g.last), ms: performance.now() - at };
  } catch (e) {
    return { k: `error: ${(e as Error).message.slice(0, 80)}`, ms: performance.now() - at };
  }
}
let rot = 0;
function askAll(s: GameState, snaps?: { corp?: Snap; runner?: Snap }) {
  const order = [...ASKED.slice(rot % 3), ...ASKED.slice(0, rot % 3)];
  rot++;
  const r: Record<string, { k: string; ms: number }> = {};
  for (const name of order) r[name] = ask(trees[name], s, snaps);
  return r;
}

interface Dec {
  src: string;
  sk: 'self' | 'humanRunner' | 'humanCorp';
  who: 'ai' | 'person';
  s: GameState;
  side: 'corp' | 'runner';
  cls: Cls;
  snaps?: { corp?: Snap; runner?: Snap };
  deck: { knick: boolean; audrey: boolean };
}
function decide(d: Dec) {
  const a = askAll(d.s, d.snaps);
  const row: Record<string, unknown> = { kind: 'd', src: d.src, sk: d.sk, who: d.who, T: d.s.turnNumber, side: d.side, c: d.cls, run: !!d.s.activeRun, ...d.deck, ms: ASKED.map(n => r2(a[n].ms)) };
  if (a.base.k !== a.control.k) row.baseControl = true;
  if (a.head.k !== a.base.k) row.headDiffers = true;
  if (a.head.ms > 2 * a.control.ms && a.head.ms >= 500) {
    const re = [askAll(d.s, d.snaps), askAll(d.s, d.snaps)];
    row.re = re.map(x => ASKED.map(n => r2(x[n].ms)));
  }
  out(row);
}

/** The Runner deck's flags (HIDDEN-READ: the measuring script reads the stack). */
function deckFlags(core: any, s: GameState) {
  const r = s.runner as any;
  const titles = [...r.stack, ...r.grip, ...r.heap, ...r.rig.programs, ...r.rig.hardware, ...r.rig.resources].map((c: any) => core.getCardDefinition(c.cardCode).title as string);
  return { knick: titles.some(t => /Knickknack/.test(t)), audrey: titles.some(t => /^Audrey v2$/.test(t)) };
}

async function main() {
  const dirs = makeDirs();
  trees = {};
  for (const name of ['source', ...ASKED]) trees[name] = await loadTree(name, dirs[name]);
  const record: { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] }[] = JSON.parse(readFileSync('scripts/stage-d/post-pick-deals.json', 'utf8'));
  const want = (process.env.DEALS ?? '').split(',').filter(Boolean);
  const dealList = want.includes('none') ? [] : record.filter(r => !want.length || want.includes(String(r.seed)));
  const hdir = 'tests/fixtures/human-games';
  const hwant = (process.env.HUMAN ?? '').split(',').filter(Boolean);
  const humans = hwant.includes('none')
    ? []
    : readdirSync(hdir)
        .filter(f => f.endsWith('.json') && (!hwant.length || hwant.some(w => f.startsWith(w))))
        .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b));
  const sources: { kind: 'deal' | 'human'; id: any }[] = [...humans.map(f => ({ kind: 'human' as const, id: f })), ...dealList.map(r => ({ kind: 'deal' as const, id: r }))];

  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    const t0 = performance.now();
    let decisions = 0;
    if (src.kind === 'deal') {
      const rec = src.id as (typeof record)[number];
      const name = `deal:${rec.seed}`;
      const t = trees.source;
      t.clear();
      const ag = { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') };
      const g = new t.GameRunner(dealState(rec.seed), ag);
      const deck = deckFlags(t.core, g.state);
      const cr: number[] = [];
      const sc: number[] = [];
      let lastTurn = -1;
      const decs: Dec[] = [];
      for (let n = 0; n < 4000; n++) {
        const s: GameState = g.state;
        if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
          cr.push(s.corp.credits);
          sc.push(s.corp.score);
          lastTurn = s.turnNumber;
        }
        const dec = decisionOf(t.core, s);
        const copy = dec ? structuredClone(s) : null;
        const snaps = dec ? { corp: snapAgent(ag.corp), runner: snapAgent(ag.runner) } : undefined;
        if (!g.step()) break;
        if (dec && copy) decs.push({ src: name, sk: 'self', who: 'ai', s: copy, side: dec.side, cls: dec.cls, snaps, deck });
      }
      const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
      out({ kind: 'g', src: name, decks: `${rec.corpDeck} v ${rec.runnerDeck}`, ...deck, matchesBatch: matches, decisions: decs.length });
      for (const d of decs.slice(0, MAXDEC)) decide(d);
      decisions = decs.length;
    } else {
      const file = join(hdir, src.id as string);
      const r = JSON.parse(readFileSync(file, 'utf8'));
      const sk = r.config.ai === 'corp' ? 'humanRunner' : 'humanCorp';
      const aiSide = r.config.ai === 'corp' ? 'corp' : 'runner';
      const name = `human:${src.id}`;
      if (!r.moves?.length) continue;
      const core = trees.base.core;
      let s: GameState;
      if (r.startsAt === 'state') s = structuredClone(r.state);
      else {
        s = core.createInitialGameState(trees.base.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
        if (r.startStops) s = { ...s, stops: r.startStops };
      }
      const deck = deckFlags(core, s);
      let stopped: string | null = null;
      for (const [j, move] of (r.moves as GameAction[]).entries()) {
        const dec = decisionOf(core, { ...s, stops: { corp: 'ai', runner: 'ai' } });
        if (dec && decisions < MAXDEC) {
          decide({ src: `${name}#${j}`, sk, who: dec.side === aiSide ? 'ai' : 'person', s: structuredClone(s), side: dec.side, cls: dec.cls, deck });
          decisions++;
        }
        try {
          s = core.executeAction(s, move);
        } catch (e) {
          stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
          break;
        }
      }
      out({ kind: 'h', src: name, sk, ...deck, moves: r.moves.length, decisions, stopped });
    }
    out({ kind: 's', src: src.kind === 'deal' ? `deal:${src.id.seed}` : `human:${src.id}`, ms: Math.round(performance.now() - t0), decisions });
  }
  rmSync(root, { recursive: true, force: true });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}
await main();
