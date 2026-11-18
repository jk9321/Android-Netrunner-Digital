/**
 * ai-make-room bar (brief: /mnt/project-files/netrunner-ai/stage-d/small-fixes/ai-make-room/brief.md, the bar 4 to 6):
 * the fire count, the one-game-a-deal diverge trace and the time against a control arm, base = beta's src (BASE, default
 * 0dd0930, whose src/ai and src/core are the g1 base run 44353109684's) and branch = this checkout's src.
 *
 * Trees are copies of src/ loaded as their own module graphs (as runner-money-trees.ts makeTrees): `base` and `control`
 * (BASE's src, git archive; fetched at depth 1 if the checkout lacks it), `branch` (this checkout's src) and `source`
 * (BASE's src again: it plays the source games of the time part and is never asked or cleared mid-game, found row 71b).
 * Every tree gets one text patch: a hook at the top of the AI's prompt answers (src/ai/prompts.ts answers) and of the
 * engine's prompt answer listing (legalActions.ts promptAnswers), which counts the make-room prompts met (the trace).
 *
 * A make-room prompt: a Runner effect prompt that installs a card (effect_cards or effect_choice with source.data.install)
 * where a listed program does not fit (memory used + its cost over the limit; rules 8.5.6c).
 *
 * PARTS (default div,time):
 *  - `div` (bar 4 on the deals; bar 5 with DEALS = the g1's differing deals): each deal is played twice from its start,
 *    by the base tree and by the branch tree, each its own Normal Corp and Runner (GameRunner, as the batch). Every agent
 *    call is logged (side, method, answer, a hash of the state). The first call where the answer or the state differs is
 *    printed (`f` line): its source, turn, side, method, the prompt, whether it is a make-room prompt, both answers. If it
 *    is not one, the same call is asked again of both trees (a fresh agent, each on its own clone) with the hook on, and
 *    the make-room prompts met inside that decision are printed (`look`: the trace). A `g` line per game: winner, turns,
 *    and the Corp's credits and score at each of its turn starts (cr, sc, as the batch's deals.json).
 *  - `time` (bar 4 on the human games; bar 6): the source game (a deal played by `source`, or a human game's recorded
 *    moves replayed; report-40b and 40c from their `state`) and, at every state where an agent is asked (both sides, as
 *    GameRunner.step asks), a fresh Normal agent of base, control and branch, each on its own clone, order rotated,
 *    timed. A decision over a stop (branch over 2x control at 0.5 s or more, or 3 s slower) is timed twice more, both,
 *    medians kept. `d` line per decision; a changed one (branch's answer is not base's) carries both answers, whether
 *    it is a make-room prompt, and if not, the make-room prompts met inside the branch's decision.
 * Hidden information: the agents see what GameRunner gives them; nothing here hands an agent the other side's cards.
 *
 *   SHARD=0/64 npx vite-node scripts/stage-d/make-room-fire.ts
 *   DEALS=1081,2561 HUMAN=none PARTS=div npx vite-node scripts/stage-d/make-room-fire.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { deals, dealState, humanFiles } from '../stage-a/harness';

for (const kv of (process.env.ARGS ?? '').split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const BASE = process.env.BASE ?? '0dd09303bdf734f13dabd447692a8b1d6aa4a06c';
const PARTS = new Set((process.env.PARTS ?? 'div,time').split(','));
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/mr-fire', String(shard));
const r1 = (x: number) => Math.round(x * 10) / 10;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const key = (a: unknown) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a as object).sort())) : 'null');
const hash = (s: GameState) => createHash('md5').update(JSON.stringify(s)).digest('hex').slice(0, 12);

const HOOKS: [string, string][] = [
  ['ai/prompts.ts', 'function answers(state: GameState, side: SideCode, synergy = false): GameAction[] {\n'],
  ['core/engine/legalActions.ts', 'function promptAnswers(state: GameState): GameAction[] {\n'],
];

function makeTrees(): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  try {
    execSync(`git cat-file -e ${BASE}^{commit}`, { stdio: 'ignore' });
  } catch {
    execSync(`git fetch -q --depth=1 origin ${BASE}`);
  }
  const dirs: Record<string, string> = {};
  for (const t of ['base', 'control', 'branch', 'source']) {
    const dir = join(root, t);
    mkdirSync(dir, { recursive: true });
    if (t === 'branch') cpSync('src', join(dir, 'src'), { recursive: true });
    else execSync(`git archive ${BASE} src | tar -x -C ${dir}`);
    for (const [f, at] of HOOKS) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length !== 2) throw new Error(`tree ${t}: the hook does not match once in ${f}`);
      writeFileSync(path, text.replace(at, `${at}  (globalThis as any).__mrHook?.(state);\n`));
    }
    dirs[t] = dir;
  }
  return dirs;
}

interface Tree {
  name: string;
  createAgent: (side: string, level: string) => any;
  GameRunner: any;
  rezCandidates: (s: GameState, step: string) => any[];
  core: any;
  memoryLimit: (s: GameState) => number;
  clear: () => void;
}

async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'core/engine/cardEffects.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts']) mods.push(await m(p));
  const [ai, po, core, ce, hv, ev, vm, iv] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    rezCandidates: po.rezCandidates,
    core,
    memoryLimit: ce.memoryLimit,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}

/** The make-room prompt this state is at (rules 8.5.6c), described, or null. */
function makeRoomAt(t: Tree, s: GameState): string | null {
  const p = t.core.activePrompt(s);
  if (!p || p.side !== 'runner' || (p.kind !== 'effect_cards' && p.kind !== 'effect_choice') || !p.source?.data?.install) return null;
  const ids: string[] = p.kind === 'effect_cards' ? p.candidateIds : [String(p.source.data.cardId ?? '')];
  const over: string[] = [];
  for (const id of ids) {
    const c = t.core.findCardAnywhere(s, id);
    if (!c) continue;
    const def = t.core.cardDef(c);
    if (def.type_code !== 'program') continue;
    const by = s.runner.memoryUnitsUsed + (def.memory_cost || 0) - t.memoryLimit(s);
    if (by > 0) over.push(`${def.title} +${by}`);
  }
  return over.length ? `${t.core.cardDef({ cardCode: p.source.cardCode }).title}/${p.source.step}: ${over.join(', ')} (MU ${s.runner.memoryUnitsUsed}/${t.memoryLimit(s)}, rig ${s.runner.rig.programs.length})` : null;
}

const promptOf = (t: Tree, s: GameState) => {
  const p = t.core.activePrompt(s);
  return p ? `${p.side} ${p.kind} ${p.source?.cardCode ? t.core.cardDef({ cardCode: p.source.cardCode }).title : '?'}/${p.source?.step}` : null;
};

/** Runs `f` with the hook counting the make-room prompts met (by any tree: the hook is global). */
function traced<T>(t: Tree, f: () => T): { out: T; met: string[] } {
  const met = new Map<string, number>();
  (globalThis as any).__mrHook = (s: GameState) => {
    const d = makeRoomAt(t, s);
    if (d) met.set(d, (met.get(d) ?? 0) + 1);
  };
  try {
    return { out: f(), met: [...met].map(([d, n]) => `${n}x ${d}`) };
  } finally {
    (globalThis as any).__mrHook = undefined;
  }
}

/** What GameRunner.step would ask at `s` (stops forced to 'ai' as the GameRunner does): the side, method and args. */
function askAt(t: Tree, s0: GameState): { side: string; fn: string; args: unknown[] } | null {
  const s = { ...s0, stops: { corp: 'ai', runner: 'ai' } } as GameState;
  const side = t.core.actingSide(s);
  if (!side || s.winner) return null;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
    if (!t.core.wantsStop(s, side, w)) return null;
    if (side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server')) return { side, fn: 'chooseRez', args: [s, t.rezCandidates(s, w.step)] };
    if (side === 'runner' && w.step === 'corp_action') return { side, fn: 'chooseOffTurn', args: [s] };
    return null;
  }
  return { side, fn: 'chooseAction', args: [s] };
}

function ask(t: Tree, q: { side: string; fn: string; args: unknown[] }, trace = false): { a: string; ms: number; met?: string[] } {
  t.clear();
  const agent = t.createAgent(q.side, 'normal');
  const args = structuredClone(q.args);
  const at = performance.now();
  try {
    if (trace) {
      const r = traced(t, () => agent[q.fn](...args));
      return { a: key(r.out), ms: performance.now() - at, met: r.met };
    }
    return { a: key(agent[q.fn](...args)), ms: performance.now() - at };
  } catch (e) {
    return { a: `error: ${(e as Error).message.slice(0, 80)}`, ms: 0 };
  }
}

async function main() {
  const dirs = makeTrees();
  const trees: Record<string, Tree> = {};
  for (const t of ['base', 'control', 'branch', 'source']) trees[t] = await loadTree(t, dirs[t]);
  const { base, branch } = trees;
  const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));

  // ------------------------------------------------------------------------------------------------ div
  type Call = { side: string; fn: string; T: number; a: string; h: string };
  const play = (t: Tree, seed: number, compare?: Call[]) => {
    t.clear();
    const log: Call[] = [];
    let first: { k: number; call: Call; args: unknown[]; s: GameState } | null = null;
    const wrap = (side: string, inner: any) =>
      new Proxy(inner, {
        get(target, prop, recv) {
          const v = Reflect.get(target, prop, recv);
          if (typeof v !== 'function' || typeof prop !== 'string' || !prop.startsWith('choose')) return v;
          return (...args: unknown[]) => {
            const s = args[0] as GameState;
            const h = hash(s);
            const copy = !first && compare ? structuredClone(args) : null;
            const r = v.apply(target, args);
            const call: Call = { side, fn: prop, T: s.turnNumber, a: key(r), h };
            const k = log.length;
            log.push(call);
            if (compare && !first) {
              const b = compare[k];
              if (!b || b.a !== call.a || b.h !== call.h || b.fn !== call.fn) first = { k, call, args: copy!, s: copy![0] as GameState };
            }
            return r;
          };
        },
      });
    const g = new t.GameRunner(dealState(seed), { corp: wrap('corp', t.createAgent('corp', 'normal')), runner: wrap('runner', t.createAgent('runner', 'normal')) });
    const cr: number[] = [];
    const sc: number[] = [];
    let lastTurn = -1;
    for (let n = 0; n < 4000; n++) {
      const s: GameState = g.state;
      if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
        cr.push(s.corp.credits);
        sc.push(s.corp.score);
        lastTurn = s.turnNumber;
      }
      if (!g.step()) break;
    }
    return { log, first: first as typeof first, rec: { winner: g.state.winner ?? null, T: g.state.turnNumber, cr, sc } };
  };

  const sources: { kind: 'deal' | 'human'; id: string | number }[] = [...deals().map(seed => ({ kind: 'deal' as const, id: seed })), ...humanFiles().map(f => ({ kind: 'human' as const, id: f }))];
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    const t0 = performance.now();
    if (PARTS.has('div') && src.kind === 'deal') {
      const seed = src.id as number;
      const b = play(base, seed);
      const n = play(branch, seed, b.log);
      out({ kind: 'g', src: `deal:${seed}`, base: b.rec, branch: n.rec, calls: [b.log.length, n.log.length] });
      if (!n.first) out({ kind: 'f', src: `deal:${seed}`, same: true });
      else {
        const f = n.first;
        const bc = b.log[f.k];
        const mk = makeRoomAt(branch, f.s);
        const row: Record<string, unknown> = { kind: 'f', src: `deal:${seed}`, at: f.k, T: f.call.T, side: f.call.side, fn: f.call.fn, prompt: promptOf(branch, f.s), makeRoom: mk, base: bc?.a.slice(0, 220), branch: f.call.a.slice(0, 220), sameState: bc?.h === f.call.h };
        if (!mk) {
          const q = { side: f.call.side, fn: f.call.fn, args: f.args };
          const rb = ask(base, q, true);
          const rn = ask(branch, q, true);
          row.look = { base: rb.met, branch: rn.met, again: { base: rb.a.slice(0, 160), branch: rn.a.slice(0, 160) } };
        }
        out(row);
      }
    }
    if (PARTS.has('time')) {
      const order0 = ['base', 'control', 'branch'];
      let i = 0;
      const decide = (srcName: string, s: GameState) => {
        const q = askAt(branch, s);
        if (!q) return;
        const rot = i % 3;
        const order = [...order0.slice(rot), ...order0.slice(0, rot)];
        const r: Record<string, { a: string; ms: number }> = {};
        for (const t of order) r[t] = ask(trees[t], q);
        const retimed: string[] = [];
        const over = (r.branch.ms >= 500 && r.branch.ms > 2 * r.control.ms) || r.branch.ms > r.control.ms + 3000;
        if (over) {
          const bm = [r.branch.ms, ask(branch, q).ms, ask(branch, q).ms];
          const cm = [r.control.ms, ask(trees.control, q).ms, ask(trees.control, q).ms];
          retimed.push(`branch:${bm.map(r1).join('/')}|control:${cm.map(r1).join('/')}`);
          r.branch = { ...r.branch, ms: median(bm) };
          r.control = { ...r.control, ms: median(cm) };
        }
        const row: Record<string, unknown> = { kind: 'd', src: srcName, i: i++, T: s.turnNumber, side: q.side, fn: q.fn, ms: { base: r1(r.base.ms), control: r1(r.control.ms), branch: r1(r.branch.ms) } };
        if (retimed.length) row.retimed = retimed;
        if (r.control.a !== r.base.a) row.controlDiffers = true;
        const mk = makeRoomAt(branch, s);
        if (mk) row.makeRoom = mk;
        if (r.branch.a !== r.base.a) {
          row.changed = true;
          row.prompt = promptOf(branch, s);
          row.base = r.base.a.slice(0, 220);
          row.branch = r.branch.a.slice(0, 220);
          if (!mk) row.look = { branch: ask(branch, q, true).met, base: ask(base, q, true).met };
        }
        out(row);
      };
      if (src.kind === 'deal') {
        const seed = src.id as number;
        const t = trees.source;
        t.clear();
        const g = new t.GameRunner(dealState(seed), { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') });
        for (let n = 0; n < 4000 && !g.state.winner; n++) {
          decide(`deal:${seed}`, g.state);
          if (!g.step()) break;
        }
      } else {
        const file = src.id as string;
        const report = JSON.parse(readFileSync(file, 'utf8'));
        const name = `human:${file.split('/').pop()}`;
        if (report.moves?.length) {
          const core = branch.core;
          let s: GameState;
          if (report.startsAt === 'state') s = structuredClone(report.state);
          else {
            const { deckGameSetup } = await import(/* @vite-ignore */ join(dirs.branch, 'src', 'data/decks.ts'));
            s = core.createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
            if (report.startStops) s = { ...s, stops: report.startStops };
          }
          let stopped: string | null = null;
          for (const [j, move] of (report.moves as GameAction[]).entries()) {
            decide(name, s);
            try {
              s = core.executeAction(s, move);
            } catch (e) {
              stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
              break;
            }
          }
          out({ kind: 'h', src: name, moves: report.moves.length, stopped });
        }
      }
    }
    out({ kind: 's', src: `${src.kind}:${src.id}`, ms: Math.round(performance.now() - t0) });
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
