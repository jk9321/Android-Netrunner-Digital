/**
 * Review fixes 2026-11-19, bundle P (placement wiring), count step. Brief:
 * /mnt/project-files/netrunner-ai/review-fixes-1119/placement-count/brief.md. Scripts only: nothing in src or tests.
 * Trees and arms: placement-wiring-trees.ts (each a patched copy of this checkout's src, its own module graph).
 * Built from stage-d/bait-run.ts (sources, asks, continuations).
 *
 * Sources (kinds kept apart everywhere: self, humanRunner = the person played the Runner, humanCorp):
 *  (a) the 221 deals of the g1 base 44381468776 (stage-d/post-pick-deals.json: each game's winner, cr and sc checked
 *      against that record), played by the `source` tree with a plain GameRunner, Normal v Normal, as the batch. The
 *      source tree is never asked or cleared mid-game; its agents' state is copied (structuredClone) before each step
 *      into the fresh agents that are asked.
 *  (b) the human files in tests/fixtures/human-games: the recorded moves replayed; at every board where the Corp decides,
 *      today's AI Corp is asked (fresh agents, no memory). `who`: ai (the AI played the Corp) or person.
 *
 * Every Corp decision (main phase, prompt, rez window) is asked of beta, control and each arm: a one-step GameRunner on
 * a copy of the board with fresh agents of that tree, hand caches cleared first, the order of the trees rotated per
 * decision, timed (top level, and inside the planner). A control answer unlike beta's is a stop. Runner decisions are
 * not asked: no arm's patch is reachable from the Runner's agent (the Corp order, place and the playout line are read
 * by the Corp agent and the Corp's prompt answers only; rezMoney's `except` patch is behaviour-neutral).
 * S, C, D: at each Corp main-phase decision the beta tree is asked once more, untimed, with `__pwMeasure` (the measure
 * reads the deciding Corp's own view inside its order). What followed in the source (self-play: the game played; human:
 * the recorded moves): steals and accesses by server over the Runner's turns T and T+1, and the fate of the scoring
 * remote's agendas.
 * Continuations: for each arm's changed decision (capped at CAP a source and arm), from the board on the beta tree
 * (fresh agents, copied state), the arm's action first against beta's, beta's agents both sides to the end of the game;
 * steals and accesses by server tracked (the window T, T+1 and the whole game).
 *
 * Hidden information: agents are asked only through GameRunner (their own views). This measuring script reads the
 * score areas and the runs (public) and nothing else of the real board. No arm reads hidden information.
 *
 *   SHARD=0/64 npx vite-node scripts/review-fixes/placement-wiring.ts
 *   ARGS="DEALS=1001 HUMAN=none CAP=8" npx vite-node scripts/review-fixes/placement-wiring.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { dealState } from '../stage-a/harness';
import { ARMS, Arm, PW_ARMS, Tree, loadTree, makeTrees } from './placement-wiring-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/placement-wiring', String(shard));
const CAP = Number(process.env.CAP ?? 8);
const ASKED: Arm[] = ['beta', 'control', ...(process.env.ARMS_ASK ? (process.env.ARMS_ASK.split(',') as Arm[]) : PW_ARMS)];
const ASKED_ARMS = ASKED.slice(2);
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
    if (cur && typeof cur === 'object' && !Array.isArray(cur) && !(cur instanceof Map) && !(cur instanceof Set) && Object.getPrototypeOf(cur) !== Object.prototype)
      Object.assign(cur, structuredClone(v));
    else fresh[k] = structuredClone(v);
  }
  return fresh;
}
function agents(t: Tree, snaps?: { corp?: Snap; runner?: Snap }) {
  return {
    corp: restore(t.createAgent('corp', 'normal'), snaps?.corp),
    runner: restore(t.createAgent('runner', 'normal'), snaps?.runner),
  };
}

// ------------------------------------------------------------------------------------------------ decisions
type Cls = 'corpPrompt' | 'corpMain' | 'corpRez';
/** Whether GameRunner.step asks the Corp's agent on this board, and which kind of decision (as playout.ts step). */
function decisionOf(core: any, s: GameState): { side: 'corp' | 'runner'; cls: Cls } | null {
  const side = core.actingSide(s);
  if (!side || s.winner) return null;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
    const ask = core.wantsStop(s, side, w);
    if (ask && side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server')) return { side, cls: 'corpRez' };
    return null;
  }
  if (side !== 'corp') return null;
  return { side, cls: core.activePrompt(s) ? 'corpPrompt' : 'corpMain' };
}

interface Ask {
  a: GameAction | null;
  k: string;
  ms: number;
  planMs: number;
  main: any;
  plan: any;
  fire: Record<string, number>;
  swaps: number;
  err?: string;
}
function resetG() {
  G.__pwTop = false;
  G.__pwMain = null;
  G.__pwPlan = null;
  G.__pwPlanMs = 0;
  G.__pwFire = {};
  G.__pwFirstSwap = 0;
  G.__pwLast = null;
}
function ask(t: Tree, s: GameState, snaps: { corp?: Snap; runner?: Snap } | undefined, measure = false): Ask {
  t.clear();
  const ag = agents(t, snaps);
  const g = new t.GameRunner(structuredClone(s), ag);
  resetG();
  G.__pwMeasure = measure;
  const at = performance.now();
  try {
    g.step();
    const ms = performance.now() - at;
    const a = g.last as GameAction | null;
    return { a, k: key(a), ms, planMs: G.__pwPlanMs ?? 0, main: G.__pwMain, plan: G.__pwPlan, fire: G.__pwFire ?? {}, swaps: G.__pwFirstSwap ?? 0 };
  } catch (e) {
    return { a: null, k: `error: ${(e as Error).message.slice(0, 80)}`, ms: performance.now() - at, planMs: G.__pwPlanMs ?? 0, main: null, plan: null, fire: G.__pwFire ?? {}, swaps: 0, err: (e as Error).message.slice(0, 160) };
  } finally {
    G.__pwMeasure = false;
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
    if (c.kind === 'effect_choice') return `prompt:${c.optionId}`;
    if (c.kind === 'effect_cards') return `prompt:[${c.cardInstanceIds.map((id: string) => title(t, s, id)).join(', ')}]`;
    return `prompt:${c.kind}`;
  }
  const id = x.cardInstanceId;
  const to = a.type === 'INSTALL_CARD' ? `>${x.asNewRemote || !x.targetServerId ? 'new' : x.targetServerId}${x.trashFirst?.length ? '(trash)' : ''}` : x.targetServerId ? `>${x.targetServerId}` : '';
  if (!id) return a.type + to;
  return `${a.type} ${title(t, s, id)}${to}`;
}
function promptInfo(t: Tree, s: GameState) {
  const p = t.core.activePrompt(s);
  if (!p) return null;
  const src = 'source' in p ? p.source : null;
  return { kind: p.kind, code: src?.cardCode ?? null, step: src?.step ?? null, card: src ? t.core.getCardDefinition(src.cardCode).title : null };
}

// ------------------------------------------------------------------------------------------------ what followed
/** Steals, scores and accesses by server, from consecutive boards (public: the score areas and the runs). */
interface Ev {
  T: number;
  side: string;
  kind: 'steal' | 'score' | 'access';
  server: string;
  pts: number;
  id?: string;
}
class Tracker {
  ev: Ev[] = [];
  private runsSeen = new Map<string, number>();
  feed(prev: GameState, next: GameState, core: any) {
    const was = new Set(prev.runner.scoreArea.map(c => c.instanceId));
    for (const c of next.runner.scoreArea)
      if (!was.has(c.instanceId)) {
        const server = prev.activeRun?.server ?? next.activeRun?.server ?? next.runsThisTurn?.[next.runsThisTurn.length - 1]?.server ?? '?';
        this.ev.push({ T: prev.turnNumber, side: prev.activePlayer, kind: 'steal', server, pts: core.cardDef(c).agenda_points ?? 0, id: c.instanceId });
      }
    const cwas = new Set(prev.corp.scoreArea.map(c => c.instanceId));
    for (const c of next.corp.scoreArea) if (!cwas.has(c.instanceId)) this.ev.push({ T: prev.turnNumber, side: prev.activePlayer, kind: 'score', server: '', pts: core.cardDef(c).agenda_points ?? 0, id: c.instanceId });
    this.runs(prev);
    if (next.turnNumber !== prev.turnNumber || next.activePlayer !== prev.activePlayer || next.winner) this.runs(next);
  }
  /** Successful runs this turn (each counted once). */
  private runs(s: GameState) {
    const k = `${s.turnNumber}:${s.activePlayer}`;
    const runs = s.runsThisTurn ?? [];
    const done = runs.filter(r => r.successful).length;
    const seen = this.runsSeen.get(k) ?? 0;
    if (done > seen) {
      for (const r of runs.filter(r => r.successful).slice(seen)) this.ev.push({ T: s.turnNumber, side: s.activePlayer, kind: 'access', server: r.server, pts: 0 });
      this.runsSeen.set(k, done);
    }
  }
  /** The Runner's turns T0 and T0 + 1 (and the rest of the Corp's turn T0), by server. */
  window(T0: number, from = 0) {
    const w = this.ev.slice(from).filter(e => e.T === T0 || (e.T === T0 + 1 && e.side === 'runner'));
    const by: Record<string, { acc: number; stolen: number }> = {};
    for (const e of w) {
      if (e.kind === 'score') continue;
      const b = (by[e.server] ??= { acc: 0, stolen: 0 });
      if (e.kind === 'access') b.acc++;
      else b.stolen += e.pts;
    }
    return by;
  }
  stolenBy(from = 0) {
    const by: Record<string, number> = {};
    for (const e of this.ev.slice(from)) if (e.kind === 'steal') by[e.server] = (by[e.server] ?? 0) + e.pts;
    return by;
  }
  fate(id: string, from = 0) {
    const e = this.ev.slice(from).find(x => x.id === id);
    return e ? { by: e.kind, T: e.T, server: e.server } : null;
  }
}

// ------------------------------------------------------------------------------------------------ continuations
interface Cont {
  winner: string | null;
  T: number;
  cs: number;
  rs: number;
  win: Record<string, { acc: number; stolen: number }>;
  stolenBy: Record<string, number>;
  err?: string;
}
function cont(s0: GameState, first: GameAction, snaps: { corp?: Snap; runner?: Snap } | undefined): Cont {
  const t = trees.beta;
  t.clear();
  const none: Cont = { winner: null, T: 0, cs: 0, rs: 0, win: {}, stolenBy: {} };
  const tr = new Tracker();
  let s: GameState;
  try {
    if (!t.core.isLegalAction(s0, first)) return { ...none, err: 'not legal' };
    s = t.core.executeAction(structuredClone(s0), first);
    tr.feed(s0, s, t.core);
  } catch (e) {
    return { ...none, err: (e as Error).message.slice(0, 100) };
  }
  const g = new t.GameRunner(s, agents(t, snaps));
  const done = (err?: string): Cont => ({
    winner: g.state.winner ?? null,
    T: g.state.turnNumber,
    cs: g.state.corp.score,
    rs: g.state.runner.score,
    win: tr.window(s0.turnNumber),
    stolenBy: tr.stolenBy(),
    ...(err ? { err } : {}),
  });
  try {
    for (let n = 0; n < 5000; n++) {
      const prev: GameState = g.state;
      if (!g.step()) break;
      tr.feed(prev, g.state, t.core);
    }
  } catch (e) {
    return done((e as Error).message.slice(0, 100));
  }
  return done();
}

// ------------------------------------------------------------------------------------------------ one decision
let rot = 0;
interface Dec {
  src: string;
  kind: 'self' | 'humanRunner' | 'humanCorp';
  who: 'ai' | 'person';
  i: number;
  s: GameState;
  cls: Cls;
  snaps?: { corp?: Snap; runner?: Snap };
  played?: GameAction | null;
  tracker: Tracker;
}
const intakeOf = (x: Ask, a: GameAction | null) => {
  if (!x.plan || !a) return null;
  if (x.plan.memo) return { memo: true, pick: key(x.plan.pick) === key(a) };
  const i = (x.plan.intake as GameAction[]).findIndex(c => key(c) === key(a));
  return { in: i >= 0, v: i >= 0 ? r2(x.plan.values[i]) : null, best: r2(Math.max(...x.plan.values)), n: x.plan.intake.length };
};
function decide(d: Dec, perSrc: Record<string, number>) {
  const t = trees.beta;
  const order = [...ASKED.slice(rot % ASKED.length), ...ASKED.slice(0, rot % ASKED.length)];
  rot++;
  const asks: Record<string, Ask> = {};
  for (const arm of order) asks[arm] = ask(trees[arm], d.s, d.snaps);
  const b = asks.beta;
  const changed = ASKED_ARMS.filter(a => asks[a].k !== b.k);
  const row: Record<string, unknown> = {
    kind: 'd',
    src: d.src,
    sk: d.kind,
    who: d.who,
    i: d.i,
    T: d.s.turnNumber,
    c: d.cls,
    cr: d.s.corp.credits,
    cl: d.s.corp.clicks,
    ms: ASKED.map(a => r2(asks[a].ms)),
    pms: ASKED.map(a => r2(asks[a].planMs)),
  };
  const fires = ASKED.map(a => ({ ...asks[a].fire, ...(asks[a].swaps ? { swap: asks[a].swaps } : {}) }));
  if (fires.some(f => Object.keys(f).length)) row.fire = fires;
  if (asks.control.k !== b.k) row.controlDiffers = true;
  if (d.played !== undefined) row.fresh = key(d.played) === b.k;
  for (const a of ASKED) if (asks[a].err) (row.errors ??= {} as any)[a] = asks[a].err;
  if (d.cls === 'corpPrompt') row.p = promptInfo(t, d.s);
  row.beta = label(t, d.s, b.a);
  if (d.cls === 'corpMain') {
    const m = ask(t, d.s, d.snaps, true);
    if (m.k !== b.k) row.measureDiffers = true;
    const mm = m.main?.m;
    if (mm) {
      row.m = mm;
      // What followed in the source: the window (Runner turns T and T+1) by server, and the scoring remote's agendas' fate
      const n0 = (d as any).evAt as number;
      row.followed = d.tracker.window(d.s.turnNumber, n0);
      if (mm.s?.agendaIds?.length) row.fate = mm.s.agendaIds.map((id: string) => ({ id, ...(d.tracker.fate(id, n0) ?? { by: 'none' }) }));
    }
    // C: the planner's intake and values for the cover candidate, beta's and coverAtPlace's
    if (mm?.c?.length) {
      const cov = asks.coverAtPlace ?? asks.shortCover;
      row.cPlan = mm.c.map((c: any) => {
        const bAct = (b.main?.placements ?? []).find((p: any) => p.card === c.card);
        return {
          card: c.card,
          betaPick: label(t, d.s, b.a),
          betaIntake: (b.plan?.intake ?? []).map((a: GameAction) => label(t, d.s, a)),
          betaValues: (b.plan?.values ?? []).map(r2),
          armPick: cov ? label(t, d.s, cov.a) : null,
          armIntake: cov ? (cov.plan?.intake ?? []).map((a: GameAction) => label(t, d.s, a)) : null,
          armValues: cov ? (cov.plan?.values ?? []).map(r2) : null,
          armSwaps: cov?.swaps ?? 0,
          betaReturned: bAct?.returned ?? null,
        };
      });
    }
  }
  if (changed.length) {
    row.changed = Object.fromEntries(changed.map(a => [a, label(t, d.s, asks[a].a)]));
    row.armPlacements = Object.fromEntries(changed.map(a => [a, (asks[a].main?.placements ?? []).filter((p: any) => p.counted || p.returned.length > 1)]));
    row.betaPlacements = (b.main?.placements ?? []).filter((p: any) => p.counted);
    row.intake = Object.fromEntries(['beta', ...changed].map(a => [a, intakeOf(asks[a], asks[a].a)]));
    row.orders = Object.fromEntries(['beta', ...changed].map(a => [a, (asks[a].main?.order ?? []).map((o: any) => `${o.line}${o.behind ? 'b' : ''} ${label(t, d.s, o.a)}`)]));
  }
  out(row);
  // Continuations of the changed decisions (one per distinct action: arms that agree share it)
  const conts = new Map<string, Cont>();
  const contOf = (a: GameAction) => conts.get(key(a)) ?? conts.set(key(a), cont(d.s, a, d.snaps)).get(key(a))!;
  for (const arm of changed) {
    const x = asks[arm];
    if (!x.a || !b.a) continue;
    const n = (perSrc[arm] = (perSrc[arm] ?? 0) + 1);
    if (n > CAP) continue;
    out({
      kind: 'c',
      src: d.src,
      sk: d.kind,
      who: d.who,
      i: d.i,
      T: d.s.turnNumber,
      arm,
      c: d.cls,
      a: label(t, d.s, x.a),
      b: label(t, d.s, b.a),
      cs0: d.s.corp.score,
      rs0: d.s.runner.score,
      cr0: d.s.corp.credits,
      cl0: d.s.corp.clicks,
      ca: contOf(x.a),
      cb: contOf(b.a),
    });
  }
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const used = ARMS.filter(a => a === 'source' || ASKED.includes(a));
  const dirs = makeTrees(root, used);
  trees = {};
  for (const arm of used) trees[arm] = await loadTree(arm, dirs[arm]);
  if (shard === 0) out({ kind: 'meta', asked: ASKED });
  const record: { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] }[] = JSON.parse(
    readFileSync('scripts/stage-d/post-pick-deals.json', 'utf8'),
  );
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
    const tracker = new Tracker();
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
        const evAt = tracker.ev.length;
        if (!g.step()) break;
        tracker.feed(s, g.state, t.core);
        if (dec && copy) {
          const d: Dec = { src: name, kind: 'self', who: 'ai', i: decs.length, s: copy, cls: dec.cls, snaps, played: g.last ?? null, tracker };
          (d as any).evAt = evAt;
          decs.push(d);
        }
      }
      const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
      out({
        kind: 'g',
        src: name,
        decks: `${rec.corpDeck} v ${rec.runnerDeck}`,
        winner: g.state.winner ?? null,
        T: g.state.turnNumber,
        cs: g.state.corp.score,
        rs: g.state.runner.score,
        matchesBatch: matches,
        ...(matches ? {} : { cr, sc, recCr: rec.cr, recSc: rec.sc, recWinner: rec.winner }),
        decisions: decs.length,
        stolenBy: tracker.stolenBy(),
      });
      for (const d of decs) decide(d, perSrc);
      decisions = decs.length;
    } else {
      const file = join(hdir, src.id as string);
      const r = JSON.parse(readFileSync(file, 'utf8'));
      const kind = r.config.ai === 'corp' ? 'humanRunner' : 'humanCorp';
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
      const boards: { s: GameState; evAt: number }[] = [];
      for (const [j, move] of (r.moves as GameAction[]).entries()) {
        boards.push({ s, evAt: tracker.ev.length });
        let next: GameState;
        try {
          next = core.executeAction(s, move);
        } catch (e) {
          stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
          break;
        }
        tracker.feed(s, next, core);
        s = next;
      }
      for (const [j, { s: b0, evAt }] of boards.entries()) {
        const dec = decisionOf(core, { ...b0, stops: { corp: 'ai', runner: 'ai' } });
        if (!dec) continue;
        const d: Dec = {
          src: `${name}#${j}`,
          kind,
          who: kind === 'humanRunner' ? 'ai' : 'person',
          i: decisions,
          s: structuredClone(b0),
          cls: dec.cls,
          played: kind === 'humanRunner' ? r.moves[j] : undefined,
          tracker,
        };
        (d as any).evAt = evAt;
        decide(d, perSrc);
        decisions++;
      }
      out({ kind: 'h', src: name, sk: kind, moves: r.moves.length, decisions, stopped, stolenBy: tracker.stolenBy() });
    }
    out({ kind: 's', src: src.kind === 'deal' ? `deal:${src.id.seed}` : `human:${src.id}`, ms: Math.round(performance.now() - t0), decisions, pairs: perSrc });
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
