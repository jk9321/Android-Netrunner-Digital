/**
 * Runner rework R0, count 3: getting in this turn, looking ahead through runs, and the lines the Runner misses. Brief:
 * /mnt/project-files/netrunner-ai/runner-rework/r0/count3-get-in/brief.md; shared rules ../standing-rules.md. Scripts
 * only: nothing in src or tests. Trees and arms: get-in-trees.ts (each a patched copy of this checkout's src).
 *
 * Sources (kinds kept apart everywhere: self, humanRunner = a person played the Runner, humanCorp = our Runner against
 * a person):
 *  (a) the 221 deals of the g1 base 44381468776 (scripts/stage-d/post-pick-deals.json: winner, cr and sc checked against
 *      that record), played by the `source` tree with a plain GameRunner, Normal v Normal, as the batch. The source tree
 *      is never asked or cleared mid-game (found row 71b); its agents' state is copied (structuredClone) before each step
 *      into the fresh agents that are asked.
 *  (b) tests/fixtures/human-games: the recorded moves replayed (a split part from its recorded state). The deciding
 *      Runner asked at a person's board is a fresh beta Runner that has watched every board of the game so far
 *      (`observe`: what it would have accessed), with no plan memory.
 *
 * Output, one JSON line each (kind):
 *  'g'/'h'  a source: the batch match (self-play), the moves replayed;
 *  'turn'   a Runner turn's record (L): its actions in order (type, card, server, credits and clicks before and after),
 *           its runs (server, how started: 'click' or the card that started it, success, accessed card codes, credits
 *           spent in the run, Runner points before and after, Corp credits before and after, ice rezzed during it);
 *           HIDDEN-READ: the accessed codes and the rez costs of unrezzed ice are read to say what was true;
 *  'v'      the three voices (G) at a board (turn start, and before each run): per server runScore and runCreditSpend
 *           on the deciding Runner's own view, serverValue, the Corp's serverHold 'restOfTurn' (Corp context, its
 *           credits now), and the hold-inputs classes the board meets (Knickknack, Audrey v2 installed: brief
 *           hold-inputs fixes 1 and 2; fixes 3 to 5 are boards with a run under way, never asked here);
 *  'q'      a deciding-Runner decision (Q): per tree (control and the arms) the pick, ms, whether it planned, the
 *           picked line, runs per playout, played runs; per tree with FLIP, the picks at 8 seeds; (a)'s time;
 *  'c'      a paired continuation (Q): from a self-play board where an arm's pick differs from control's, beta's
 *           agents both sides to the end, the arm's pick first and control's: winner, Runner points.
 *  's'      a source's time split by part (ms): play, G, Q per tree, flip per tree, (a), continuations.
 *
 * Hidden information: agents are asked only through GameRunner (their own views); no arm reads a hidden card. The
 * measuring script reads the accessed cards and unrezzed ice (HIDDEN-READ, marked), never inside an ask.
 *
 *   SHARD=0/32 npx vite-node scripts/runner-rework/get-in.ts
 *   ARGS="DEALS=1001 HUMAN=none TURNS=5 FLIP=1 CAP=2" npx vite-node scripts/runner-rework/get-in.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { dealState } from '../stage-a/harness';
import { Arm, GETIN_ARMS, Tree, loadTree, makeTrees } from './get-in-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/get-in', String(shard));
const CAP = Number(process.env.CAP ?? 2);
/** Runner turns a source is measured on (from its first; the source game is still played to its end for the batch match). */
const TURNS = Number(process.env.TURNS ?? Infinity);
/** The first Runner turn measured (1 = the first). */
const FROM = Number(process.env.FROM ?? 1);
const inWindow = (n: number) => n >= FROM && n < FROM + TURNS;
/** Share of Q decisions (seeded by source and index) asked at 8 seeds: one number, or by source kind ("self:0.1,humanRunner:0.25"). */
const shareBy = (v: string | undefined, dflt: number) => (sk: string) => {
  if (!v) return dflt;
  if (!v.includes(':')) return Number(v);
  const m = Object.fromEntries(v.split(',').map(x => x.split(':')));
  return Number(m[sk] ?? dflt);
};
const FLIP = shareBy(process.env.FLIP, 0.25);
/** (c, 8 deals) only: its own seeded flip sample (step 0 ruling 1: about 50 decisions a source kind, the first 50 by hash kept in the sums). */
const C8FLIP = shareBy(process.env.C8FLIP, 0);
/** Continuation pairs a source and arm: one number or by arm ("repeatRepaired:2,runsPlayed:1"; step 0 ruling 2). */
const capOf = (arm: string) => shareBy(process.env.CAPS, CAP)(arm);
const PARTS = new Set((process.env.PARTS ?? 'G,L,Q,A,C').split(','));
const ASK_ARMS: Arm[] = process.env.ARMS_ASK ? (process.env.ARMS_ASK.split(',') as Arm[]) : GETIN_ARMS;
const ASKED: Arm[] = ['control', ...ASK_ARMS];
const GG = globalThis as any;
const key = (a: unknown) => (a ? JSON.stringify(a) : 'null');
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r2 = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const SALTS = [0, 1, 2, 3, 4, 5, 6, 7].map(k => (k === 0 ? 0 : Math.imul(k, 0x2545f491) >>> 0));

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
const agents = (t: Tree, snaps?: { corp?: Snap; runner?: Snap }) => ({
  corp: restore(t.createAgent('corp', 'normal'), snaps?.corp),
  runner: restore(t.createAgent('runner', 'normal'), snaps?.runner),
});

// ------------------------------------------------------------------------------------------------ decisions
type Cls = 'corpPrompt' | 'corpMain' | 'corpRez' | 'runnerPrompt' | 'runnerMain' | 'runnerOff' | 'runnerRun';
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
  if (core.activePrompt(s)) return { side, cls: `${side}Prompt` as Cls };
  if (side === 'runner' && s.activeRun) return { side, cls: 'runnerRun' };
  return { side, cls: `${side}Main` as Cls };
}

interface Ask {
  a: GameAction | null;
  ms: number;
  planned: boolean | null;
  plan: GameAction[] | null;
  runs: number[] | null;
  played: number;
  err?: string;
}
function ask(t: Tree, s: GameState, snap: Snap | undefined, salt = 0): Ask {
  t.clear();
  const ag = agents(t, { runner: snap });
  const g = new t.GameRunner(structuredClone(s), ag);
  GG.__giSalt = salt;
  GG.__giPlan = null;
  GG.__giPlanned = null;
  GG.__giRuns = null;
  GG.__giPlayed = 0;
  const at = performance.now();
  try {
    g.step();
    const ms = performance.now() - at;
    return { a: g.last ?? null, ms, planned: GG.__giPlanned, plan: GG.__giPlan, runs: GG.__giRuns, played: GG.__giPlayed };
  } catch (e) {
    return { a: null, ms: performance.now() - at, planned: null, plan: null, runs: null, played: 0, err: (e as Error).message.slice(0, 160) };
  } finally {
    GG.__giSalt = 0;
  }
}

// ------------------------------------------------------------------------------------------------ labels
function cardOf(t: Tree, s: GameState, id?: string): string | null {
  if (!id) return null;
  const c = t.core.findCardAnywhere(s, id);
  return c ? c.cardCode : null;
}
function label(t: Tree, s: GameState, a: GameAction | null): string {
  if (!a) return 'null';
  const x = a as any;
  if (a.type === 'INITIATE_RUN') return `RUN:${x.targetServerId}`;
  const code = cardOf(t, s, x.cardInstanceId);
  let name = '';
  if (code) {
    try {
      name = t.core.getCardDefinition(code).title;
    } catch {
      name = code;
    }
  }
  return `${a.type}${name ? ':' + name : ''}${x.abilityIndex !== undefined ? '#' + x.abilityIndex : ''}`;
}
const planLabel = (t: Tree, s: GameState, p: GameAction[] | null) => (p ? p.map(a => label(t, s, a)) : null);

// ------------------------------------------------------------------------------------------------ G: the three voices
const KNICKKNACK = '35033'; // "Knickknack" O'Brian (src/ai/cards/elevation.ts)
const AUDREY = '34004'; // Audrey v2 (runs.ts AUDREY)
function holdClasses(s: GameState): string[] {
  const rig = [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].map(c => c.cardCode);
  const out: string[] = [];
  if (rig.includes(KNICKKNACK)) out.push('knickknack');
  if (rig.includes(AUDREY)) out.push('audrey');
  return out;
}

function voices(t: Tree, s: GameState, memory: Map<string, string>, where: string, src: string, who: string, T: number, sk: string, timing: Record<string, number>, played: GameAction | null) {
  const t0 = performance.now();
  t.clear();
  const ids = Object.keys(s.corp.servers);
  const runner = t.pricing.asSide('runner', () => {
    t.handValues.decisionContext(s, 'runner');
    const view = t.turnPlanner.runnerDecisionView(s, memory);
    const opts = { memory, wary: t.synergy.tuning?.wary ?? false };
    return ids.map(id => {
      let score: number | null = null;
      let spend: number | null = null;
      let worth: number | null = null;
      try {
        score = r2(t.runs.runScore(view, id, opts));
        spend = r2(t.runs.runCreditSpend(view, id, {}));
        worth = r2(t.runs.serverValue(view, id, 0, memory, opts.wary));
      } catch {
        /* left null */
      }
      return { score, spend, worth };
    });
  });
  const t1 = performance.now();
  t.clear();
  const corp = t.pricing.asSide('corp', () => {
    t.handValues.decisionContext(s, 'corp');
    return ids.map(id => {
      try {
        const h = t.hold.serverHold(s, id, { when: 'restOfTurn', corpCredits: s.corp.credits });
        return { holds: h.holds, need: r2(h.need), budget: r2(h.budget), entries: h.entries };
      } catch {
        return null;
      }
    });
  });
  const t2 = performance.now();
  timing.Grunner = (timing.Grunner ?? 0) + (t1 - t0);
  timing.Ghold = (timing.Ghold ?? 0) + (t2 - t1);
  const servers = ids.map((id, i) => {
    const v = s.corp.servers[id];
    return {
      id,
      ice: v.ice.length,
      rezzed: v.ice.filter(c => c.isRezzed).length,
      root: v.root.length,
      adv: v.root.reduce((n, c) => n + (c.advancementCounters ?? 0), 0),
      ...runner[i],
      hold: corp[i],
    };
  });
  const tr = where === 'start' ? null : trace(t, s, memory, played);
  timing.Gtrace = (timing.Gtrace ?? 0) + (performance.now() - t2);
  out({ kind: 'v', src, sk, who, T, where, rc: s.runner.credits, rk: s.runner.clicks, cc: s.corp.credits, grip: s.runner.grip.length, cls: holdClasses(s), runs: s.runsThisTurn, played: played ? label(t, s, played) : null, trace: tr, servers, ms: Math.round(t2 - t0) });
}

/**
 * The trace of the move played at a board (a run's start): where the deciding Runner's rule ranking put it (beta tree, a
 * fresh Runner with the memory the deciding Runner had), whether it was among the planner's candidates (the first 4 of
 * the open moves), its score, and for a run on a server the rule or price that put it out.
 */
function trace(t: Tree, s: GameState, memory: Map<string, string>, played: GameAction | null) {
  if (!played) return null;
  t.clear();
  const r: any = t.createAgent('runner', 'normal');
  r.memory = new Map(memory);
  let ranked: { action: GameAction; score: number }[];
  try {
    ranked = t.pricing.asSide('runner', () => r.rankMainActions(s));
  } catch (e) {
    return { err: (e as Error).message.slice(0, 120) };
  }
  const open = ranked.filter(x => x.score > -Infinity && x.action.type !== 'END_TURN' && x.action.type !== 'START_TURN');
  const k = key(played);
  const at = ranked.findIndex(x => key(x.action) === k);
  const openAt = open.findIndex(x => key(x.action) === k);
  let cause: string | null = null;
  if (played.type === 'INITIATE_RUN') {
    const id = (played as any).targetServerId as string;
    const prior = s.runsThisTurn.filter(x => x.server === id);
    const isRemote = !!s.corp.servers[id]?.isRemote;
    if (prior.some(x => !x.successful)) cause = 'rule:failedZero';
    else if (prior.length && isRemote) cause = 'rule:remoteRepeat';
    else if (prior.length && id === 'archives') cause = 'rule:archivesRepeat';
    else if (prior.length && id === 'hq') cause = 'rule:hqHalved';
    if (at >= 0 && ranked[at].score === -Infinity && !cause) {
      const view = t.turnPlanner.runnerDecisionView(s, memory);
      const worth = t.pricing.asSide('runner', () => t.runs.serverValue(view, id, 0, memory, t.synergy.tuning?.wary ?? false));
      cause = worth <= 0 ? 'price:worthNone' : 'price:cost';
    }
  }
  if (!cause) cause = at < 0 ? 'notListed' : ranked[at].score === -Infinity ? 'price:out' : openAt < 0 ? 'cut' : openAt >= 4 ? 'rank' : 'candidate';
  return { at, openAt, open: open.length, score: at >= 0 ? r2(ranked[at].score) : null, top: open.slice(0, 4).map(x => [label(t, s, x.action), r2(x.score)]), cause };
}

// ------------------------------------------------------------------------------------------------ L: the turn record
interface RunRec {
  server: string;
  by: string;
  ok: boolean | null;
  acc: string[];
  spent: number;
  rs0: number;
  rs1: number;
  cc0: number;
  cc1: number;
  rezzed: string[];
  rk0: number;
  /** the index in the turn's acts of the move that started it */
  at: number;
  /** unrezzed ice on the run's server at its start, and the least rez cost among them (HIDDEN-READ) */
  unrez: number;
  minRez: number | null;
}
interface TurnRec {
  src: string;
  sk: string;
  who: string;
  T: number;
  acts: { a: string; rc0: number; rc1: number; rk0: number; rk1: number }[];
  runs: RunRec[];
  rc0: number;
  rk0: number;
  rs0: number;
  cs0: number;
  cc0: number;
  rig: string[];
}
function turnWatcher(t: Tree, src: string, sk: string, who: string) {
  let open: TurnRec | null = null;
  let run: (RunRec & { logSeen: Set<string>; iceBefore: Set<string> }) | null = null;
  const close = (s: GameState) => {
    if (!open) return;
    out({ kind: 'turn', ...open, rs1: s.runner.score, cs1: s.corp.score, rc1: s.runner.credits, end: s.winner ? `win:${s.winner}` : 'end' });
    open = null;
  };
  const endRun = (s: GameState) => {
    if (!run || !open) return;
    const recs = s.activePlayer === 'runner' && s.turnNumber === open.T ? s.runsThisTurn : s.runnerLastTurnRuns;
    const rec = recs[open.runs.length];
    const acc = (s.log ?? []).filter(e => e.event === 'access' && !run!.logSeen.has(e.id)).map(e => e.cardCode ?? '?'); // HIDDEN-READ
    const rezzed = Object.values(s.corp.servers)
      .flatMap(v => v.ice)
      .filter(c => c.isRezzed && run!.iceBefore.has(c.instanceId))
      .map(c => c.cardCode);
    const r: Partial<typeof run> = { ...run };
    delete r.logSeen;
    delete r.iceBefore;
    open.runs.push({ ...(r as RunRec), ok: rec ? rec.successful : null, acc, spent: run.spent - s.runner.credits, rs1: s.runner.score, cc1: s.corp.credits, rezzed });
    run = null;
  };
  return {
    /** `prev`: the board before `move`; `s`: after. */
    see(prev: GameState | null, move: GameAction | null, s: GameState) {
      if (open && (s.turnNumber !== open.T || s.activePlayer !== 'runner' || s.winner)) {
        if (run) endRun(s);
        close(s);
      }
      if (!open && s.activePlayer === 'runner' && !s.winner && !s.activeRun && s.runner.clicks > 0 && s.runner.clicks === s.runner.maxClicks && s.turnNumber > 0) {
        open = { src, sk, who, T: s.turnNumber, acts: [], runs: [], rc0: s.runner.credits, rk0: s.runner.clicks, rs0: s.runner.score, cs0: s.corp.score, cc0: s.corp.credits, rig: [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].map(c => c.cardCode) };
      }
      if (!open || !prev || !move) return;
      if (move.player === 'runner' && prev.activePlayer === 'runner' && !prev.activeRun && !t.core.activePrompt(prev))
        open.acts.push({ a: label(t, prev, move), rc0: prev.runner.credits, rc1: s.runner.credits, rk0: prev.runner.clicks, rk1: s.runner.clicks });
      if (!prev.activeRun && s.activeRun && s.activePlayer === 'runner') {
        const by = move.type === 'INITIATE_RUN' ? 'click' : (cardOf(t, prev, (move as any).cardInstanceId) ?? (t.core.activePrompt(prev)?.source?.cardCode as string | undefined) ?? move.type);
        run = {
          server: s.activeRun.server,
          by,
          ok: null,
          acc: [],
          spent: prev.runner.credits,
          rs0: prev.runner.score,
          rs1: 0,
          cc0: prev.corp.credits,
          cc1: 0,
          rezzed: [],
          rk0: prev.runner.clicks,
          at: open.acts.length - 1,
          unrez: (s.corp.servers[s.activeRun.server]?.ice ?? []).filter(c => !c.isRezzed).length,
          minRez: (() => {
            const costs = (s.corp.servers[s.activeRun.server]?.ice ?? []).filter(c => !c.isRezzed).map(c => t.core.rezCostOf(s, c)); // HIDDEN-READ
            return costs.length ? Math.min(...costs) : null;
          })(),
          logSeen: new Set((prev.log ?? []).map(e => e.id)),
          iceBefore: new Set(Object.values(prev.corp.servers).flatMap(v => v.ice).filter(c => !c.isRezzed).map(c => c.instanceId)),
        };
      } else if (run && prev.activeRun && !s.activeRun) endRun(s);
    },
    end(s: GameState) {
      if (run) endRun(s);
      close(s);
    },
  };
}

// ------------------------------------------------------------------------------------------------ Q
interface Dec {
  src: string;
  sk: string;
  who: string;
  i: number;
  s: GameState;
  snap?: Snap;
  snaps?: { corp?: Snap; runner?: Snap };
  played?: GameAction | null;
}
function hash(x: string): number {
  let h = 2166136261;
  for (let i = 0; i < x.length; i++) h = Math.imul(h ^ x.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}
function decide(d: Dec, timing: Record<string, number>) {
  const res: Record<string, any> = {};
  const h = hash(`${d.src}#${d.i}`);
  const flip = h < FLIP(d.sk);
  const c8flip = h < C8FLIP(d.sk);
  // the order of the trees rotated per decision (time)
  const order = ASKED.map((_, k) => ASKED[(k + d.i) % ASKED.length]);
  for (const arm of order) {
    const t = trees[arm];
    const x = ask(t, d.s, d.snap);
    timing[`Q:${arm}`] = (timing[`Q:${arm}`] ?? 0) + x.ms;
    res[arm] = { a: label(t, d.s, x.a), ms: Math.round(x.ms), planned: x.planned, plan: planLabel(t, d.s, x.plan), runs: x.runs, played: x.played, err: x.err };
  }
  if (flip || c8flip) {
    for (const arm of order) {
      if (arm === 'runsPlayed8' ? !c8flip : !flip) continue;
      const t = trees[arm];
      const picks: string[] = [res[arm].a];
      const plans: (string[] | null)[] = [res[arm].plan];
      let ms = 0;
      for (const salt of SALTS.slice(1)) {
        const x = ask(t, d.s, d.snap, salt);
        ms += x.ms;
        picks.push(label(t, d.s, x.a));
        plans.push(planLabel(t, d.s, x.plan));
      }
      timing[`F:${arm}`] = (timing[`F:${arm}`] ?? 0) + ms;
      res[arm].seeds = picks;
      res[arm].seedPlans = plans;
    }
  }
  // (a): one serverHold ask on the Runner's dealt view per server (Corp context: the walk as it is)
  let aMs: number | null = null;
  if (PARTS.has('A')) {
    const t = trees.control;
    t.clear();
    const memory = (d.snap?.memory as Map<string, string>) ?? new Map();
    const view = t.pricing.asSide('runner', () => {
      t.handValues.decisionContext(d.s, 'runner');
      return t.turnPlanner.runnerDecisionView(d.s, memory);
    });
    t.clear();
    const t0 = performance.now();
    t.pricing.asSide('corp', () => {
      for (const id of Object.keys(view.corp.servers)) {
        try {
          t.hold.serverHold(view, id, { when: 'restOfTurn', corpCredits: view.corp.credits });
        } catch {
          /* timed only */
        }
      }
    });
    aMs = performance.now() - t0;
    timing.A = (timing.A ?? 0) + aMs;
  }
  const ctl = res.control.a;
  const changed = ASK_ARMS.filter(a => res[a].a !== ctl);
  out({ kind: 'q', src: d.src, sk: d.sk, who: d.who, i: d.i, T: d.s.turnNumber, rk: d.s.runner.clicks, rc: d.s.runner.credits, played: d.played ? label(trees.control, d.s, d.played) : null, flip, c8flip, h: Math.round(h * 1e6), res, aMs: aMs === null ? null : Math.round(aMs), changed });
  return { res, changed };
}

function contOf(t: Tree, s: GameState, first: GameAction, snaps?: { corp?: Snap; runner?: Snap }) {
  t.clear();
  const g = new t.GameRunner(structuredClone(s), agents(t, snaps));
  try {
    g.apply(first);
    for (let n = 0; n < 4000; n++) {
      t.clear();
      if (!g.step()) break;
    }
  } catch (e) {
    return { err: (e as Error).message.slice(0, 120) };
  }
  return { w: g.state.winner ?? null, rs: g.state.runner.score, cs: g.state.corp.score, T: g.state.turnNumber };
}

function continuations(d: Dec, q: { res: Record<string, any>; changed: Arm[] }, perSrc: Record<string, number>, timing: Record<string, number>) {
  if (!PARTS.has('C') || d.sk !== 'self') return;
  const done = new Map<string, any>();
  for (const arm of q.changed) {
    if ((perSrc[arm] ?? 0) >= capOf(arm)) continue;
    perSrc[arm] = (perSrc[arm] ?? 0) + 1;
    const t = trees.beta;
    // the picks again, as actions (asked on the arm and control trees: a label is not an action)
    const xa = ask(trees[arm], d.s, d.snap).a;
    const xc = ask(trees.control, d.s, d.snap).a;
    if (!xa || !xc || key(xa) === key(xc)) continue;
    const t0 = performance.now();
    const pair = done.get(key(xa)) ?? { ca: contOf(t, d.s, xa, d.snaps), cb: contOf(t, d.s, xc, d.snaps) };
    done.set(key(xa), pair);
    timing.C = (timing.C ?? 0) + (performance.now() - t0);
    out({ kind: 'c', src: d.src, i: d.i, T: d.s.turnNumber, arm, a: label(t, d.s, xa), b: label(t, d.s, xc), rs0: d.s.runner.score, cs0: d.s.corp.score, ...pair });
  }
}

/**
 * L's openings in self-play (rule 1 of the brief's reading): a deciding-Runner board where a return is legal and a repeat
 * rule prices it: a server run this turn (failed: rule failedZero; successful remote or Archives: the repeat rules). The
 * return is played first against control's pick, beta's agents both sides to the end (capped CAPL a source).
 */
const CAPL = Number(process.env.CAPL ?? 2);
function openings(d: Dec, q: { res: Record<string, any> }, perSrc: Record<string, number>, timing: Record<string, number>) {
  if (d.sk !== 'self') return;
  const t = trees.beta;
  const ids = [...new Set(d.s.runsThisTurn.map(r => r.server))];
  for (const id of ids) {
    const prior = d.s.runsThisTurn.filter(r => r.server === id);
    const rule = prior.some(r => !r.successful) ? 'failedZero' : d.s.corp.servers[id]?.isRemote ? 'remoteRepeat' : id === 'archives' ? 'archivesRepeat' : id === 'hq' ? 'hqHalved' : null;
    if (!rule) continue;
    const run: GameAction = { type: 'INITIATE_RUN', player: 'runner', targetServerId: id } as GameAction;
    if (!t.core.isLegalAction(d.s, run)) continue;
    const ctl = q.res.control.a;
    const taken = ctl === `RUN:${id}`;
    const rec: Record<string, unknown> = { kind: 'o', src: d.src, i: d.i, T: d.s.turnNumber, server: id, rule, rk: d.s.runner.clicks, rc: d.s.runner.credits, control: ctl, taken };
    if (!taken && PARTS.has('C') && (perSrc[`o:${rule}`] ?? 0) < CAPL) {
      perSrc[`o:${rule}`] = (perSrc[`o:${rule}`] ?? 0) + 1;
      const xc = ask(trees.control, d.s, d.snap).a;
      if (xc) {
        const t0 = performance.now();
        rec.ca = contOf(t, d.s, run, d.snaps);
        rec.cb = contOf(t, d.s, xc, d.snaps);
        rec.rs0 = d.s.runner.score;
        timing.O = (timing.O ?? 0) + (performance.now() - t0);
      }
    }
    out(rec);
  }
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const need: Arm[] = ['beta', 'source', ...ASKED];
  const dirs = makeTrees(root, need);
  trees = {};
  for (const arm of need) trees[arm] = await loadTree(arm, dirs[arm]);
  const record: { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] }[] = JSON.parse(readFileSync('scripts/stage-d/post-pick-deals.json', 'utf8'));
  const want = (process.env.DEALS ?? '').split(',').filter(Boolean);
  const dealList = want.includes('none') ? [] : record.filter(r => !want.length || want.includes(String(r.seed)));
  const hdir = 'tests/fixtures/human-games';
  const hwant = (process.env.HUMAN ?? '').split(',').filter(Boolean);
  const humans = hwant.includes('none')
    ? []
    : readdirSync(hdir)
        .filter(f => f.endsWith('.json') && (!hwant.length || hwant.some(w => f.replace('.json', '') === w || f.startsWith(w + '.'))))
        .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b));
  const sources: { kind: 'deal' | 'human'; id: any }[] = [...humans.map(f => ({ kind: 'human' as const, id: f })), ...dealList.map(r => ({ kind: 'deal' as const, id: r }))];

  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    const t0 = performance.now();
    const timing: Record<string, number> = {};
    const perSrc: Record<string, number> = {};
    let qs = 0;
    let turns: number;
    const bt = trees.beta;
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
      const boards: { s: GameState; where: string; memory: Map<string, string>; played: GameAction | null }[] = [];
      const w = turnWatcher(bt, name, 'self', 'ai');
      const runnerTurns = new Set<number>();
      const tp = performance.now();
      w.see(null, null, g.state);
      for (let n = 0; n < 4000; n++) {
        const s: GameState = g.state;
        if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
          cr.push(s.corp.credits);
          sc.push(s.corp.score);
          lastTurn = s.turnNumber;
        }
        const dec = decisionOf(t.core, s);
        const mine = dec?.side === 'runner' && dec.cls === 'runnerMain';
        if (mine) runnerTurns.add(s.turnNumber);
        const copy = mine && inWindow(runnerTurns.size) ? structuredClone(s) : null;
        const snaps = copy ? { corp: snapAgent(ag.corp), runner: snapAgent(ag.runner) } : undefined;
        if (!g.step()) break;
        if (copy) {
          decs.push({ src: name, sk: 'self', who: 'ai', i: decs.length, s: copy, snap: snaps!.runner, snaps, played: g.last ?? null });
          const startOfTurn = copy.runner.clicks === copy.runner.maxClicks && copy.runsThisTurn.length === 0 && !boards.some(b => b.s.turnNumber === copy.turnNumber);
          const runStarts = !g.state.activeRun ? false : !copy.activeRun;
          if (startOfTurn || runStarts) boards.push({ s: copy, where: startOfTurn && !runStarts ? 'start' : startOfTurn ? 'start+run' : 'run', memory: (snaps!.runner.memory as Map<string, string>) ?? new Map(), played: g.last ?? null });
        }
        w.see(s, g.last ?? null, g.state);
      }
      w.end(g.state);
      timing.play = performance.now() - tp;
      const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
      out({ kind: 'g', src: name, decks: `${rec.corpDeck} v ${rec.runnerDeck}`, winner: g.state.winner ?? null, T: g.state.turnNumber, cs: g.state.corp.score, rs: g.state.runner.score, matchesBatch: matches, ...(matches ? {} : { cr, sc, recCr: rec.cr, recSc: rec.sc, recWinner: rec.winner }), decisions: decs.length });
      turns = Math.max(0, Math.min(runnerTurns.size - FROM + 1, TURNS));
      if (PARTS.has('G')) for (const b of boards) voices(bt, b.s, b.memory, b.where, name, 'ai', b.s.turnNumber, 'self', timing, b.played);
      if (PARTS.has('Q') && matches)
        for (const d of decs) {
          const q = decide(d, timing);
          continuations(d, q, perSrc, timing);
          if (PARTS.has('L')) openings(d, q, perSrc, timing);
          qs++;
        }
    } else {
      const file = join(hdir, src.id as string);
      const r = JSON.parse(readFileSync(file, 'utf8'));
      const sk = r.config.ai === 'corp' ? 'humanRunner' : 'humanCorp';
      const runnerWho = sk === 'humanRunner' ? 'person' : 'ai';
      const name = `human:${src.id}`;
      if (!r.moves?.length) continue;
      const core = bt.core;
      let s: GameState;
      if (r.startsAt === 'state') s = structuredClone(r.state);
      else {
        s = core.createInitialGameState(bt.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
        if (r.startStops) s = { ...s, stops: r.startStops };
      }
      // the deciding Runner that watched the game (its memory of what it accessed)
      const watcher: any = bt.createAgent('runner', 'normal');
      const w = turnWatcher(bt, name, sk, runnerWho);
      w.see(null, null, s);
      let stopped: string | null = null;
      const runnerTurns = new Set<number>();
      const seenBoards = new Set<number>();
      let i = 0;
      for (const [j, move] of (r.moves as GameAction[]).entries()) {
        try {
          watcher.observe?.(s);
        } catch {
          /* observe reads the board only */
        }
        const dec = decisionOf(core, { ...s, stops: { corp: 'ai', runner: 'ai' } });
        const mine = dec?.side === 'runner' && dec.cls === 'runnerMain';
        if (mine) runnerTurns.add(s.turnNumber);
        let next: GameState;
        try {
          next = core.executeAction(s, move);
        } catch (e) {
          stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
          break;
        }
        if (mine && inWindow(runnerTurns.size)) {
          const snap = snapAgent(watcher);
          const startOfTurn = s.runner.clicks === s.runner.maxClicks && s.runsThisTurn.length === 0 && !seenBoards.has(s.turnNumber);
          const runStarts = !s.activeRun && !!next.activeRun;
          if (PARTS.has('G') && (startOfTurn || runStarts)) {
            seenBoards.add(s.turnNumber);
            voices(bt, s, (snap.memory as Map<string, string>) ?? new Map(), startOfTurn && !runStarts ? 'start' : startOfTurn ? 'start+run' : 'run', name, runnerWho, s.turnNumber, sk, timing, move);
          }
          if (PARTS.has('Q')) {
            decide({ src: name, sk, who: runnerWho, i: i++, s: structuredClone(s), snap, played: move }, timing);
            qs++;
          }
        }
        w.see(s, move, next);
        s = next;
      }
      w.end(s);
      turns = Math.max(0, Math.min(runnerTurns.size - FROM + 1, TURNS));
      out({ kind: 'h', src: name, sk, moves: r.moves.length, stopped });
    }
    const ms = Math.round(performance.now() - t0);
    const tm: Record<string, number> = {};
    for (const [k2, v] of Object.entries(timing)) tm[k2] = Math.round(v);
    out({ kind: 's', src: src.kind === 'deal' ? `deal:${src.id.seed}` : `human:${src.id}`, ms, turns, qs, timing: tm });
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
