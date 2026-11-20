/**
 * V-C item 1 build, "Judged by" 2, 3 and 5 (brief /mnt/project-files/netrunner-ai/stage-vc/item1-breaker-double-count/
 * build/brief.md): identity where the correction cannot reach, the changed decisions with their pairs, and time.
 * Trees: run-term-once-trees.ts (source, beta and control = the merge base's src; branch; topOnly). The count's pattern
 * (scripts/stage-vc/breaker-once.ts), with these trees and the build's classes.
 *
 * Sources (kinds kept apart: self, humanRunner = the person played the Runner, humanCorp):
 *  (a) the 221 deals of the g1 base 44381468776 (scripts/stage-d/post-pick-deals.json), played by the `source` tree with
 *      a plain GameRunner, Normal v Normal, as the batch. The source tree is never asked or cleared mid-game (found row
 *      71b); its agents' state is copied before each step into the fresh agents that are asked. Whether each game
 *      matches that record is reported only: the engine fix 33c3511c moved some games after it was played.
 *  (b) the human files in tests/fixtures/human-games: the recorded moves replayed; at every board where either side
 *      decides, today's AI of that side is asked (fresh agents, no memory).
 *
 * Every decision (both sides) is asked of beta, control, branch and topOnly in one call sequence (one-step GameRunner on
 * a copy, fresh agents with the source's agent state, hand caches cleared, tree order rotated, timed), so the Corp
 * agent's own path answers (red team M5): no continuation is played between compared asks. Classes of a decision whose
 * branch answer is not beta's (brief, "Judged by" 2):
 *  (i)  a top-level Corp prompt the branch answered by the run term (`__boRun` recorded) on which at least one legal
 *       answer has a Runner program gone after one engine step;
 *  (ii) a Corp decision that is beta's on topOnly (the change is carried by the Corp's model of itself);
 *  other: anything else (a stop). A control answer unlike beta's is a stop.
 * Each changed decision gets two paired continuations from its board (the branch's action first, beta's), both sides
 * beta's agents to the end of the game: the run under way (breach, points stolen in it) and the final score.
 *
 * Hidden information: agents are asked only through GameRunner (their own views). This measuring script reads the
 * Corp's root cards (rootSummary) and simulates the Corp's answers on the full state: marked HIDDEN-READ.
 *
 *   SHARD=0/64 npx vite-node scripts/stage-vc/run-term-once.ts
 *   ARGS="DEALS=1601 HUMAN=none" npx vite-node scripts/stage-vc/run-term-once.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { dealState } from '../stage-a/harness';
import { TREES, Tree, TreeName, loadTree, makeTrees } from './run-term-once-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const i = kv.indexOf('=');
  process.env[kv.slice(0, i)] = kv.slice(i + 1);
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/run-term-once', String(shard));
const ASKED: TreeName[] = ['beta', 'control', 'branch', 'topOnly'];
const G = globalThis as any;
const key = (a: unknown) => (a ? JSON.stringify(a) : 'null');
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r2 = (x: number) => Math.round(x * 100) / 100;

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
  const at = performance.now();
  try {
    g.step();
    const ms = performance.now() - at;
    const a = g.last as GameAction | null;
    return { a, k: key(a), ms, fire: G.__boFire, run: G.__boRun, fb: G.__boFb };
  } catch (e) {
    return { a: null, k: `error: ${(e as Error).message.slice(0, 80)}`, ms: performance.now() - at, fire: G.__boFire, run: null, fb: null, err: (e as Error).message.slice(0, 160) };
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
  return { kind: p.kind, code: src?.cardCode ?? null, step: src?.step ?? null, card: src ? t.core.getCardDefinition(src.cardCode).title : null };
}
function rootSummary(t: Tree, s: GameState, server: string | null) {
  const sv = server ? s.corp.servers[server] : null;
  if (!sv) return null;
  // HIDDEN-READ (measuring script): the types of facedown root cards, to say what the run could reach
  return sv.root.map(c => t.core.cardDef(c).type_code + (t.core.cardDef(c).type_code === 'agenda' ? `:${t.core.cardDef(c).agenda_points}` : '')).join(',');
}
/** The kind of server run (brief, "Judged by" 3, M4): remote, HQ, R&D, Archives, or none. */
const serverKind = (s: GameState) => {
  const sv = s.activeRun?.server;
  return !sv ? 'none' : sv === 'hq' ? 'HQ' : sv === 'rd' ? 'R&D' : sv === 'archives' ? 'Archives' : 'remote';
};
function simulate(t: Tree, s: GameState, a: GameAction): GameState | null {
  try {
    if (!t.core.isLegalAction(s, a)) return null;
    return t.core.executeAction(structuredClone(s), a);
  } catch {
    return null;
  }
}
/** The Corp prompt's legal answers that leave a Runner program gone after one engine step (beta tree), by label. */
function programGone(s: GameState): { a: string; gone: string[] }[] {
  const t = trees.beta;
  // HIDDEN-READ (measuring script): the engine steps the full state
  const legal = t.core.getLegalActions(s, 'corp').filter((a: GameAction) => a.type === 'RESOLVE_PROMPT').slice(0, 60);
  const res: { a: string; gone: string[] }[] = [];
  for (const a of legal) {
    const after = simulate(t, s, a);
    if (!after) continue;
    const now = new Set(after.runner.rig.programs.map(p => p.instanceId));
    const gone = s.runner.rig.programs.filter(p => !now.has(p.instanceId));
    if (gone.length) res.push({ a: label(t, s, a), gone: gone.map(p => t.core.cardDef(p).title) });
  }
  return res;
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
}
const opts = (t: Tree, s: GameState, rec: any) => (rec ? (Array.isArray(rec) ? rec : rec.opts).map((o: any) => ({ a: label(t, s, o.a), p: r2(o.price ?? o.score), ...(o.v ? { v: o.v } : {}) })) : null);
function decide(d: Dec) {
  const t = trees.beta;
  const order = [...ASKED.slice(rot % ASKED.length), ...ASKED.slice(0, rot % ASKED.length)];
  rot++;
  const asks: Record<string, Ask> = {};
  for (const tree of order) asks[tree] = ask(trees[tree], d.s, d.snaps);
  const b = asks.beta;
  const row: Record<string, unknown> = { kind: 'd', src: d.src, sk: d.kind, who: d.who, i: d.i, T: d.s.turnNumber, side: d.side, c: d.cls, sv: serverKind(d.s), ms: ASKED.map(x => r2(asks[x].ms)), fire: ASKED.map(x => asks[x].fire) };
  if (asks.control.k !== b.k) row.controlDiffers = label(t, d.s, asks.control.a);
  for (const x of ASKED) if (asks[x].err) (row.errors ??= {} as any)[x] = asks[x].err;
  if (d.cls === 'corpPrompt') row.p = promptInfo(t, d.s);
  const branchChanged = asks.branch.k !== b.k;
  const topChanged = asks.topOnly.k !== b.k;
  if (branchChanged || topChanged) {
    const gone = d.cls === 'corpPrompt' ? programGone(d.s) : [];
    const topRun = d.cls === 'corpPrompt' && !!asks.branch.run;
    row.class = !branchChanged ? 'topOnlyOnly' : topRun && gone.length ? 'i' : d.side === 'corp' && !topChanged ? 'ii' : 'other';
    row.beta = label(t, d.s, b.a);
    row.branch = label(t, d.s, asks.branch.a);
    row.topOnly = label(t, d.s, asks.topOnly.a);
    row.gone = gone;
    if (d.s.activeRun) row.root = rootSummary(t, d.s, d.s.activeRun.server);
    // Both prices on each tree (the Corp's top-level prompt: the run term's, or the fallback's)
    if (d.cls === 'corpPrompt') row.prices = Object.fromEntries(['beta', 'branch', 'topOnly'].map(x => [x, { by: asks[x].run ? 'run' : 'fb', loss: asks[x].run?.loss, opts: opts(t, d.s, asks[x].run ?? asks[x].fb) }]));
  }
  out(row);
  if (branchChanged && asks.branch.a && b.a) {
    const ca = cont(d.s, asks.branch.a, d.snaps);
    const cb = cont(d.s, b.a, d.snaps);
    out({ kind: 'c', src: d.src, sk: d.kind, who: d.who, i: d.i, T: d.s.turnNumber, side: d.side, c: d.cls, class: row.class, sv: row.sv, a: row.branch, b: row.beta, root: row.root ?? null, cs0: d.s.corp.score, rs0: d.s.runner.score, ca, cb });
  }
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const dirs = makeTrees(root, TREES);
  trees = {};
  for (const tree of TREES) trees[tree] = await loadTree(tree, dirs[tree]);
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
        if (dec && copy) decs.push({ src: name, kind: 'self', who: 'ai', i: decs.length, s: copy, side: dec.side, cls: dec.cls, snaps, played: g.last ?? null });
      }
      const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
      out({ kind: 'g', src: name, decks: `${rec.corpDeck} v ${rec.runnerDeck}`, winner: g.state.winner ?? null, T: g.state.turnNumber, cs: g.state.corp.score, rs: g.state.runner.score, matchesRecord: matches, cr, sc, decisions: decs.length });
      for (const d of decs) decide(d);
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
          decide({ src: `${name}#${j}`, kind, who: dec.side === aiSide ? 'ai' : 'person', i: decisions, s: structuredClone(s), side: dec.side, cls: dec.cls, played: dec.side === aiSide ? move : undefined });
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
    out({ kind: 's', src: src.kind === 'deal' ? `deal:${src.id.seed}` : `human:${src.id}`, ms: Math.round(performance.now() - t0), decisions });
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
