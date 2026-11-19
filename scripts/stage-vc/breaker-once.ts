/**
 * V-C item 1, count step: a breaker counted on both sides of `evaluate` (found rows 72b, 73b). Brief:
 * /mnt/project-files/netrunner-ai/stage-vc/item1-breaker-double-count/brief.md. Scripts only: nothing in src or tests.
 * Trees and arms: breaker-once-trees.ts (each a patched copy of this checkout's src, its own module graph).
 *
 * Sources (kinds kept apart everywhere: self, humanRunner = the person played the Runner, humanCorp):
 *  (a) the 221 deals of the g1 base 44381468776 (scripts/stage-d/post-pick-deals.json: each game's winner, cr and sc
 *      checked against that record), played by the `source` tree with a plain GameRunner, Normal v Normal, as the batch.
 *      The source tree is never asked or cleared mid-game (found row 71b); its agents' state is copied before each step
 *      into the fresh agents that are asked.
 *  (b) the human files in tests/fixtures/human-games: the recorded moves replayed; at every board where either side
 *      decides, today's AI of that side is asked (fresh agents, no memory). `who`: ai or person.
 *
 * Every decision is asked of beta, control and each arm (one-step GameRunner on a copy, fresh agents, hand caches
 * cleared, tree order rotated, timed). A control answer unlike beta's is a stop. Per ask: the arm's fire count, and at
 * the Corp's top-level prompt the run term's and the fallback's prices (RECORD).
 *
 * A1 (untimed, beta tree's own functions, no decision context): on the first decision board of each half-turn (turn,
 * active side) with a breaker installed, for each installed breaker: runnerRigValue with and without it, corpBoardValue
 * with and without it on the Corp view and the Runner view, the ice part of it (sum of iceWorth), and the rig's
 * movement on the iceOwnsCorp tree's rig term (the part of the coverage that is ice still to come: the rest is the
 * rezzed ice of its type already on the board). The breaker's kind, the rezzed ice of its type out, the breakers.
 * A2 (untimed, beta tree): the class of decisions whose options differ by a breaker in the rig:
 *  - corpPrompt `progTrash`: some legal answer removes a Runner program (each answer simulated by the engine); per
 *    answer the program(s) gone, the rig's movement and the Corp-view ice movement (corpBoardValue less the same board
 *    with the programs back);
 *  - corpMain `lookAhead`: a legal play of a Corp operation that trashes a program (Retribution; by card text);
 *  - corpRez `progIce`: the approached ice has a program-trash subroutine (by card text);
 *  - runnerMain `breakerInstall`: a legal install of an icebreaker; runnerPrompt `breakerLost`: an answer that removes
 *    one of the Runner's own breakers.
 * B: for each arm's changed decision, two GameRunners from the board on the beta tree (fresh agents, copied state, both
 * sides beta's), the arm's action first and beta's, to the end of the game. Class decisions: every one; the rest capped
 * at CAP (default 2) a source and arm. Recorded: the run under way (breach, points stolen), the game's winner and points.
 *
 * Hidden information: agents are asked only through GameRunner (their own views); no arm reads a hidden card. This
 * measuring script reads the Corp's root cards (rootSummary) and prices the Corp view of boards (A1, A2), which reads
 * the Corp's own cards: marked HIDDEN-READ.
 *
 *   SHARD=0/64 npx vite-node scripts/stage-vc/breaker-once.ts
 *   ARGS="DEALS=1601 HUMAN=none CAP=8" npx vite-node scripts/stage-vc/breaker-once.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { dealState } from '../stage-a/harness';
import { ARMS, Arm, ONCE_ARMS, Tree, loadTree, makeTrees } from './breaker-once-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/breaker-once', String(shard));
const CAP = Number(process.env.CAP ?? 2);
const MAXDEC = Number(process.env.MAXDEC ?? Infinity);
const ASK_ARMS: Arm[] = process.env.ARMS_ASK ? (process.env.ARMS_ASK.split(',') as Arm[]) : ONCE_ARMS;
const ASKED: Arm[] = ['beta', 'control', ...ASK_ARMS];
const G = globalThis as any;
const key = (a: unknown) => (a ? JSON.stringify(a) : 'null');
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r2 = (x: number) => Math.round(x * 100) / 100;
const PROG_TRASH = /trash (?:1|an?) installed program|trash 1 installed program or piece of hardware/i;

let trees: Record<string, Tree> = {};

// ------------------------------------------------------------------------------------------------ agents
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
function agents(t: Tree, snaps?: { corp?: Snap; runner?: Snap }) {
  return { corp: restore(t.createAgent('corp', 'normal'), snaps?.corp), runner: restore(t.createAgent('runner', 'normal'), snaps?.runner) };
}

// ------------------------------------------------------------------------------------------------ decisions
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

interface Ask {
  a: GameAction | null;
  k: string;
  ms: number;
  fire: number;
  run: any;
  fb: any;
  decided: number;
  err?: string;
}
function resetG() {
  G.__boTopNext = false;
  G.__boTop = false;
  G.__boRun = null;
  G.__boFb = null;
  G.__boFire = 0;
}
function ask(t: Tree, s: GameState, snaps: { corp?: Snap; runner?: Snap } | undefined): Ask {
  t.clear();
  const ag = agents(t, snaps);
  const g = new t.GameRunner(structuredClone(s), ag);
  resetG();
  const d0 = t.prompts.runTermStats.decided;
  const at = performance.now();
  try {
    g.step();
    const ms = performance.now() - at;
    const a = g.last as GameAction | null;
    return { a, k: key(a), ms, fire: G.__boFire, run: G.__boRun, fb: G.__boFb, decided: t.prompts.runTermStats.decided - d0 };
  } catch (e) {
    return { a: null, k: `error: ${(e as Error).message.slice(0, 80)}`, ms: performance.now() - at, fire: G.__boFire, run: null, fb: null, decided: 0, err: (e as Error).message.slice(0, 160) };
  } finally {
    resetG();
  }
}

function title(t: Tree, s: GameState, id: string): string {
  const c = t.core.findCardAnywhere(s, id);
  return c ? `${t.core.cardDef(c).type_code}:${t.core.cardDef(c).title}` : id;
}
function label(t: Tree, s: GameState, a: GameAction | null | undefined): string {
  if (!a) return 'none';
  const x = a as any;
  if (a.type === 'RESOLVE_PROMPT') {
    const c = x.choice;
    if (c.kind === 'effect_choice') return `prompt:${c.optionId}${c.trashFirst?.length ? '+trashFirst' : ''}`;
    if (c.kind === 'effect_cards') return `prompt:[${c.cardInstanceIds.map((id: string) => title(t, s, id)).join(', ')}]`;
    return `prompt:${c.kind}`;
  }
  const id = x.cardInstanceId;
  if (!id) return a.type + (x.server ? `>${x.server}` : x.targetServerId ? `>${x.targetServerId}` : '');
  return `${a.type} ${title(t, s, id)}${x.targetServerId ? `>${x.targetServerId}` : ''}`;
}
function promptInfo(t: Tree, s: GameState) {
  const p = t.core.activePrompt(s);
  if (!p) return null;
  const src = 'source' in p ? p.source : null;
  return { side: p.side, kind: p.kind, code: src?.cardCode ?? null, step: src?.step ?? null, card: src ? t.core.getCardDefinition(src.cardCode).title : null, run: !!s.activeRun, server: s.activeRun?.server ?? null };
}
function rootSummary(t: Tree, s: GameState, server: string | null) {
  const sv = server ? s.corp.servers[server] : null;
  if (!sv) return null;
  // HIDDEN-READ (measuring script): the types of facedown root cards, to say what the run could reach
  return sv.root.map(c => t.core.cardDef(c).type_code + (t.core.cardDef(c).type_code === 'agenda' ? `:${t.core.cardDef(c).agenda_points}` : '')).join(',');
}

// ------------------------------------------------------------------------------------------------ A1 and A2 measures
const breakerOf = (t: Tree, c: any) => t.core.isIcebreaker?.(c) ?? /icebreaker/i.test(t.core.cardDef(c).keywords ?? '');
function withPrograms(s: GameState, programs: any[]): GameState {
  return { ...s, runner: { ...s.runner, rig: { ...s.runner.rig, programs } } } as GameState;
}
function iceSum(t: Tree, s: GameState, viewer: 'corp' | 'runner', only?: (ice: any) => boolean): number {
  let n = 0;
  for (const sv of Object.values(s.corp.servers)) for (const ice of sv.ice) if (!only || only(ice)) n += t.iceValues.iceWorth(s, ice, viewer);
  return n;
}
/** A1: each installed breaker's two movements on this board. */
function a1(s: GameState): any[] {
  const t = trees.beta;
  const io = trees.iceOwnsCorp;
  const rows: any[] = [];
  const progs = s.runner.rig.programs;
  const breakers = progs.filter(p => breakerOf(t, p));
  if (!breakers.length) return rows;
  t.clear();
  io.clear();
  // HIDDEN-READ (measuring script): the Corp view prices the Corp's own installed cards
  const base = { rig: t.evaluate.runnerRigValue(s), cbC: t.evaluate.corpBoardValue(s, 'corp'), cbR: t.evaluate.corpBoardValue(s, 'runner'), iC: iceSum(t, s, 'corp'), iR: iceSum(t, s, 'runner'), rigIO: io.evaluate.runnerRigValue(s, 'corp') };
  const rezzed = Object.values(s.corp.servers).flatMap(sv => sv.ice.filter(c => c.isRezzed));
  for (const b of breakers) {
    const w = withPrograms(s, progs.filter(p => p.instanceId !== b.instanceId));
    const script = t.core.breakerScript?.(b);
    const breaks: string = script?.breaks ?? '?';
    const oneUse = t.evaluate.isOneUse(b);
    const kind = oneUse ? 'oneUse' : breaks === 'any' ? 'AI' : breaks === '?' ? 'other' : 'typed';
    const ofType = breaks === 'any' ? rezzed.length : rezzed.filter(c => t.core.iceSubtypes(c, s).includes(breaks)).length;
    const sameType = breakers.filter(p => p !== b && (t.core.breakerScript?.(p)?.breaks === breaks || t.core.breakerScript?.(p)?.breaks === 'any')).length;
    // The ice movement split: ice of a type this breaker breaks (an AI breaker: every ice) and the rest (an ice whose own
    // price reads the rig some other way: Ballista's "trash 1 installed program or end the run")
    const mine = (ice: any) => breaks === 'any' || (t.core.iceSubtypes(ice, s) as string[]).includes(breaks);
    const other = (ice: any) => !mine(ice);
    rows.push({
      dIceTypeC: r2(iceSum(t, w, 'corp', mine) - iceSum(t, s, 'corp', mine)),
      dIceOtherC: r2(iceSum(t, w, 'corp', other) - iceSum(t, s, 'corp', other)),
      dIceTypeR: r2(iceSum(t, w, 'runner', mine) - iceSum(t, s, 'runner', mine)),
      card: t.core.cardDef(b).title,
      kind,
      breaks,
      ofType,
      breakers: breakers.length,
      sameType,
      dRig: r2(base.rig - t.evaluate.runnerRigValue(w)),
      dRigToCome: r2(base.rigIO - io.evaluate.runnerRigValue(w, 'corp')),
      dCbC: r2(t.evaluate.corpBoardValue(w, 'corp') - base.cbC),
      dCbR: r2(t.evaluate.corpBoardValue(w, 'runner') - base.cbR),
      dIceC: r2(iceSum(t, w, 'corp') - base.iC),
      dIceR: r2(iceSum(t, w, 'runner') - base.iR),
    });
  }
  return rows;
}
function simulate(t: Tree, s: GameState, a: GameAction): GameState | null {
  try {
    if (!t.core.isLegalAction(s, a)) return null;
    return t.core.executeAction(structuredClone(s), a);
  } catch {
    return null;
  }
}
/** A2: the class of this decision (null when outside it), with its per-answer movements for a Corp program trash. */
function a2(d: Dec): any {
  const t = trees.beta;
  const s = d.s;
  const core = t.core;
  if (d.cls === 'corpPrompt') {
    const legal = core.getLegalActions(s, 'corp').filter((a: GameAction) => a.type === 'RESOLVE_PROMPT').slice(0, 60);
    const opts: any[] = [];
    let any = false;
    t.clear();
    for (const a of legal) {
      const after = simulate(t, s, a);
      if (!after) continue;
      const now = new Set(after.runner.rig.programs.map(p => p.instanceId));
      const gone = s.runner.rig.programs.filter(p => !now.has(p.instanceId));
      const o: any = { a: label(t, s, a), gone: gone.map(p => t.core.cardDef(p).title), breaker: gone.some(p => breakerOf(t, p)) };
      if (gone.length) {
        any = true;
        const back = withPrograms(after, [...after.runner.rig.programs, ...gone]);
        o.dRig = r2(t.evaluate.runnerRigValue(back) - t.evaluate.runnerRigValue(after));
        // HIDDEN-READ (measuring script): Corp view
        o.dIceC = r2(t.evaluate.corpBoardValue(after, 'corp') - t.evaluate.corpBoardValue(back, 'corp'));
      }
      opts.push(o);
    }
    if (!any) return null;
    const p = core.activePrompt(s);
    return { cls: 'progTrash', code: p && 'source' in p ? p.source.cardCode : null, card: p && 'source' in p ? core.getCardDefinition(p.source.cardCode).title : null, opts };
  }
  if (d.cls === 'corpMain') {
    const plays = core.getLegalActions(s, 'corp').filter((a: any) => a.type === 'PLAY_OPERATION_OR_EVENT');
    const hit = plays.map((a: any) => core.findCardAnywhere(s, a.cardInstanceId)).filter((c: any) => c && PROG_TRASH.test(core.cardDef(c).stripped_text ?? ''));
    return hit.length ? { cls: 'lookAhead', cards: [...new Set(hit.map((c: any) => core.cardDef(c).title))] } : null;
  }
  if (d.cls === 'corpRez') {
    const run = s.activeRun;
    const sv = run ? s.corp.servers[run.server] : null;
    const ice = sv && run ? sv.ice[run.icePosition] : null;
    return ice && !ice.isRezzed && PROG_TRASH.test(core.cardDef(ice).stripped_text ?? '') ? { cls: 'progIce', card: core.cardDef(ice).title } : null;
  }
  if (d.cls === 'runnerMain') {
    const ins = core.getLegalActions(s, 'runner').filter((a: any) => a.type === 'INSTALL_CARD' && breakerOf(t, core.findCardAnywhere(s, a.cardInstanceId) ?? {}));
    return ins.length ? { cls: 'breakerInstall', cards: [...new Set(ins.map((a: any) => title(t, s, a.cardInstanceId)))] } : null;
  }
  if (d.cls === 'runnerPrompt') {
    const legal = core.getLegalActions(s, 'runner').filter((a: GameAction) => a.type === 'RESOLVE_PROMPT').slice(0, 60);
    for (const a of legal) {
      const after = simulate(t, s, a);
      if (!after) continue;
      const now = new Set(after.runner.rig.programs.map(p => p.instanceId));
      if (s.runner.rig.programs.some(p => !now.has(p.instanceId) && breakerOf(t, p))) {
        const p = core.activePrompt(s);
        return { cls: 'breakerLost', card: p && 'source' in p ? core.getCardDefinition(p.source.cardCode).title : p?.kind };
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ continuations
interface Cont {
  run: null | { breach: boolean; stolen: number };
  winner: string | null;
  T: number;
  cs: number;
  rs: number;
  err?: string;
}
function cont(s0: GameState, first: GameAction, snaps: { corp?: Snap; runner?: Snap } | undefined): Cont {
  const t = trees.beta;
  t.clear();
  const none: Cont = { run: null, winner: null, T: 0, cs: 0, rs: 0 };
  let s: GameState;
  try {
    if (!t.core.isLegalAction(s0, first)) return { ...none, err: 'not legal' };
    s = t.core.executeAction(structuredClone(s0), first);
  } catch (e) {
    return { ...none, err: (e as Error).message.slice(0, 100) };
  }
  const g = new t.GameRunner(s, agents(t, snaps));
  const server = s0.activeRun?.server ?? null;
  let run: Cont['run'] = null;
  let breach = !!s0.activeRun?.breached || !!s.activeRun?.breached || s.activeRun?.phase === 'access';
  const fin = (x: GameState) => ({ breach, stolen: x.runner.score - s0.runner.score });
  try {
    if (server && !g.state.activeRun) run = fin(g.state);
    for (let n = 0; n < 5000; n++) {
      if (!g.step()) break;
      if (g.state.activeRun?.breached || g.state.activeRun?.phase === 'access') breach = true;
      if (server && !run && (!g.state.activeRun || g.state.activeRun.server !== server)) run = fin(g.state);
    }
  } catch (e) {
    return { run, winner: g.state.winner ?? null, T: g.state.turnNumber, cs: g.state.corp.score, rs: g.state.runner.score, err: (e as Error).message.slice(0, 100) };
  }
  return { run, winner: g.state.winner ?? null, T: g.state.turnNumber, cs: g.state.corp.score, rs: g.state.runner.score };
}

// ------------------------------------------------------------------------------------------------ one decision
let rot = 0;
interface Dec {
  src: string;
  kind: 'self' | 'humanRunner' | 'humanCorp';
  who: 'ai' | 'person';
  i: number;
  s: GameState;
  side: 'corp' | 'runner';
  cls: Cls;
  snaps?: { corp?: Snap; runner?: Snap };
  played?: GameAction | null;
  measure?: boolean;
}
const opts = (t: Tree, s: GameState, rec: any) => (rec ? (Array.isArray(rec) ? rec : rec.opts).map((o: any) => ({ a: label(t, s, o.a), p: r2(o.price ?? o.score), ...(o.v ? { v: o.v } : {}) })) : null);
function decide(d: Dec, perSrc: Record<string, number>) {
  const t = trees.beta;
  const order = [...ASKED.slice(rot % ASKED.length), ...ASKED.slice(0, rot % ASKED.length)];
  rot++;
  const asks: Record<string, Ask> = {};
  for (const arm of order) asks[arm] = ask(trees[arm], d.s, d.snaps);
  const b = asks.beta;
  const changed = ASK_ARMS.filter(a => asks[a].k !== b.k);
  const cls = a2(d);
  const row: Record<string, unknown> = {
    kind: 'd',
    src: d.src,
    sk: d.kind,
    who: d.who,
    i: d.i,
    T: d.s.turnNumber,
    side: d.side,
    c: d.cls,
    ms: ASKED.map(a => r2(asks[a].ms)),
    fire: ASKED.map(a => asks[a].fire),
  };
  if (asks.control.k !== b.k) row.controlDiffers = true;
  if (d.played !== undefined) row.fresh = key(d.played) === b.k;
  for (const a of ASKED) if (asks[a].err) (row.errors ??= {} as any)[a] = asks[a].err;
  if (cls) row.cls = cls;
  if (d.cls === 'corpPrompt') {
    row.p = promptInfo(t, d.s);
    row.by = b.decided ? 'run' : 'fb';
  }
  if (changed.length) {
    row.changed = Object.fromEntries(changed.map(a => [a, label(t, d.s, asks[a].a)]));
    row.beta = label(t, d.s, b.a);
    if (d.s.activeRun) row.root = rootSummary(t, d.s, d.s.activeRun.server);
    // Both prices on each tree (the Corp's top-level prompt: the run term's, or the fallback's)
    if (d.cls === 'corpPrompt') row.prices = Object.fromEntries(['beta', ...changed].map(a => [a, { by: asks[a].decided ? 'run' : 'fb', loss: asks[a].run?.loss, opts: opts(t, d.s, asks[a].decided ? asks[a].run : asks[a].fb) }]));
  } else if (cls?.cls === 'progTrash') {
    row.beta = label(t, d.s, b.a);
    row.prices = { beta: { by: b.decided ? 'run' : 'fb', loss: b.run?.loss, opts: opts(t, d.s, b.decided ? b.run : b.fb) } };
    if (d.s.activeRun) row.root = rootSummary(t, d.s, d.s.activeRun.server);
  }
  if (d.measure) {
    const m = a1(d.s);
    if (m.length) row.a1 = m;
  }
  out(row);
  const conts = new Map<string, Cont>();
  const contOf = (a: GameAction) => conts.get(key(a)) ?? conts.set(key(a), cont(d.s, a, d.snaps)).get(key(a))!;
  for (const arm of changed) {
    const x = asks[arm];
    if (!x.a || !b.a) continue;
    if (!cls) {
      const n = (perSrc[arm] = (perSrc[arm] ?? 0) + 1);
      if (n > CAP) continue;
    }
    const ca = contOf(x.a);
    const cb = contOf(b.a);
    out({ kind: 'c', src: d.src, sk: d.kind, who: d.who, i: d.i, T: d.s.turnNumber, arm, side: d.side, c: d.cls, cls: cls?.cls ?? null, a: label(t, d.s, x.a), b: label(t, d.s, b.a), root: d.s.activeRun ? rootSummary(t, d.s, d.s.activeRun.server) : null, cs0: d.s.corp.score, rs0: d.s.runner.score, ca, cb });
  }
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const dirs = makeTrees(root, ARMS);
  trees = {};
  for (const arm of ARMS) trees[arm] = await loadTree(arm, dirs[arm]);
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
    const perSrc: Record<string, number> = {};
    let decisions = 0;
    const halves = new Set<string>();
    const first = (s: GameState) => {
      const h = `${s.turnNumber}:${s.activePlayer}`;
      if (halves.has(h)) return false;
      halves.add(h);
      return true;
    };
    if (src.kind === 'deal') {
      const rec = src.id as (typeof record)[number];
      const name = `deal:${rec.seed}`;
      const t = trees.source;
      t.clear();
      const ag = { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') };
      const g = new t.GameRunner(dealState(rec.seed), ag);
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
        if (dec && copy) decs.push({ src: name, kind: 'self', who: 'ai', i: decs.length, s: copy, side: dec.side, cls: dec.cls, snaps, played: g.last ?? null, measure: first(copy) });
      }
      const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
      out({ kind: 'g', src: name, decks: `${rec.corpDeck} v ${rec.runnerDeck}`, winner: g.state.winner ?? null, T: g.state.turnNumber, cs: g.state.corp.score, rs: g.state.runner.score, matchesBatch: matches, ...(matches ? {} : { cr, sc, recCr: rec.cr, recSc: rec.sc, recWinner: rec.winner }), decisions: decs.length });
      for (const d of decs.slice(0, MAXDEC)) decide(d, perSrc);
      decisions = decs.length;
    } else {
      const file = join(hdir, src.id as string);
      const r = JSON.parse(readFileSync(file, 'utf8'));
      const kind = r.config.ai === 'corp' ? 'humanRunner' : 'humanCorp';
      const aiSide = r.config.ai === 'corp' ? 'corp' : 'runner';
      const name = `human:${src.id}`;
      if (!r.moves?.length) continue;
      const core = trees.beta.core;
      let s: GameState;
      if (r.startsAt === 'state') s = structuredClone(r.state);
      else {
        s = core.createInitialGameState(trees.beta.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
        if (r.startStops) s = { ...s, stops: r.startStops };
      }
      let stopped: string | null = null;
      for (const [j, move] of (r.moves as GameAction[]).entries()) {
        const dec = decisionOf(core, { ...s, stops: { corp: 'ai', runner: 'ai' } });
        if (dec) {
          const copy = structuredClone(s);
          decide({ src: `${name}#${j}`, kind, who: dec.side === aiSide ? 'ai' : 'person', i: decisions, s: copy, side: dec.side, cls: dec.cls, played: dec.side === aiSide ? move : undefined, measure: first(copy) }, perSrc);
          decisions++;
        }
        try {
          s = core.executeAction(s, move);
        } catch (e) {
          stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
          break;
        }
      }
      out({ kind: 'h', src: name, sk: kind, moves: r.moves.length, decisions, stopped });
    }
    out({ kind: 's', src: src.kind === 'deal' ? `deal:${src.id.seed}` : `human:${src.id}`, ms: Math.round(performance.now() - t0), decisions, pairs: perSrc });
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
