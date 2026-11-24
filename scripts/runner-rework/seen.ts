/**
 * ai-runner-seen measurement (brief /mnt/project-files/netrunner-ai/runner-rework/fixes/runner-seen/brief.md rev 1a, its
 * red team /mnt/project-files/adversarial/2026-11-19-runner-seen/findings.md). Trees: seen-trees.ts. Scripts only.
 *
 * SELF-PLAY (the 221 deals of the g1 base 45086908053, scripts/runner-rework/seen-base-deals.json), per deal:
 *  1. LOCKSTEP REPLAY. The F tree and the base tree each play the deal by a plain GameRunner, Normal v Normal (as the
 *     batch); the control tree (a second base) plays it too, for the timing and as a check that base is reproducible.
 *     The base game is checked against the batch record (winner, cr, sc). Decision by decision (each GameRunner step),
 *     the first step where base's action differs from F's is recorded: side, kind, turn, the two actions, the board.
 *  2. ATTRIBUTION, counterfactual (S4b). At a first differing RUNNER decision, the base Runner's memory (after that
 *     decision's remember) and F's are diffed; each differing entry gets a class: recycled, notAccessed, preAccess,
 *     breachReplaced, installedThisTurn, other (labels as count 1's map-hidden.ts), hiddenZone:<zone> (a never-marked
 *     card the old map took and that is now hidden), added (F holds a marked card the old map lacked). The pBase tree is
 *     asked on the board with the base agents (control: must equal base's action, else a stop) and once per class with
 *     only that class's entries set to F's (FORCE); a class whose ask gives F's action is a cause. If none alone does,
 *     all together ('combined'); else 'unattributed' (a stop). pFdec is asked too (the fix in the deciding Runner only).
 *     At a first differing CORP decision: pBase control, and pFrep (the fix in the reply's Runners only) must give F's
 *     action; the reply samples whose Runner held a root card the marks did not (loop 1) are named with the entry.
 *  3. REPLY COUNTS. At every Corp decision of the base game: the reply and oracle samples whose Runner held such an entry.
 *     At those decisions (CAP_CORP a game), pBase (control), pF and pFrep are asked with the base agents: a pick of pF
 *     unlike the control is a Corp pick changed. For each changed pick, the Corp's part: a paired continuation by
 *     GameRunner on the pF tree from the same board (same seed: the engine's RNG is in the state), the control's pick
 *     against pF's, with the base agents' fields restored into F agents on both sides; Corp points and the winner.
 *  4. preAccess ASKED HONESTLY (M8): at the base game's Runner access_trash decisions whose memory holds a preAccess entry
 *     (CAP_TRASH a game), pBase with those entries taken out.
 *  5. ARM H (sizing, not built): at the F game's Runner decisions whose memory holds entries for cards in HQ, R&D or
 *     facedown Archives (CAP_H a game), pF with all of those taken out; a changed answer is asked again per zone.
 *  6. REAL-PATH PROMPT ANSWERS (S5): promptAnswer's real-state path (the prompt names a stack card or an unknown Corp card),
 *     by the deciding Runner, per game, in each game tree.
 *  7. TIME: ms of every asked decision (GameRunner step that asks an agent), by side, per game tree.
 * HUMAN FILES (tests/fixtures/human-games): the recorded moves replayed; a shadow Runner per tree (pBase, pF, pControl) is
 * shown every Runner decision (observe); each tree is asked with its own shadow's fields (timed); base and F answers
 * compared, a change attributed as in 2 on the shadows' memories. The Hard Runner's files (config.difficulty hard) are a
 * replay check only: the moves replay and the memories are diffed, no asks.
 *
 * Hidden information: the script reads the real board to classify entries (HIDDEN-READ); agents are asked only through
 * GameRunner on copies.
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/seen.ts
 *   ARGS="DEALS=1001 HUMAN=none" npx vite-node scripts/runner-rework/seen.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GameAction, GameState } from "../../src/core";
import { dealState } from "../stage-a/harness";
import { SeenTree, TreeName, seenTrees } from "./seen-trees";

for (const kv of `${process.env.ARGS ?? ""} ${process.argv.slice(2).join(" ")}`
  .split(/\s+/)
  .filter((x) => x.includes("="))) {
  const [k, v] = kv.split("=");
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? "0/1").split("/").map(Number);
const root = resolve(
  process.env.TROOT ?? "node_modules/.cache/runner-seen",
  String(shard),
);
const CAP_CORP = Number(process.env.CAP_CORP ?? 40);
const CAP_TRASH = Number(process.env.CAP_TRASH ?? 30);
const CAP_H = Number(process.env.CAP_H ?? 40);
const MAX_STEPS = 4000;
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const key = (a: unknown) => (a ? JSON.stringify(a) : "null");
const G = globalThis as any;

let T: Record<TreeName, SeenTree>;

// ------------------------------------------------------------------------------------------------ agents
type Snap = Record<string, unknown>;
function snapAgent(agent: any): Snap {
  const s: Snap = {};
  for (const [k, v] of Object.entries(agent)) {
    if (typeof v === "function") continue;
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
    if (
      cur &&
      typeof cur === "object" &&
      !Array.isArray(cur) &&
      !(cur instanceof Map) &&
      !(cur instanceof Set) &&
      Object.getPrototypeOf(cur) !== Object.prototype
    )
      Object.assign(cur, structuredClone(v));
    else fresh[k] = structuredClone(v);
  }
  return fresh;
}
interface Snaps {
  corp: Snap;
  runner: Snap;
}
/** The private fields an agent carries from one decision to the next, other than the Runner's `memory`. */
const CARRY = {
  runner: ["digForBreakers", "savingFor", "planMemory", "freeActions"],
  corp: ["memory", "planMemory", "freeActions"],
} as const;
function carried(agent: any, side: "corp" | "runner"): Snap {
  const s: Snap = {};
  for (const k of CARRY[side])
    s[k] = structuredClone(
      agent[k] instanceof Object && !(agent[k] instanceof Map)
        ? { ...agent[k] }
        : agent[k],
    );
  return s;
}
const sig = (agent: any, side: "corp" | "runner") => key(carried(agent, side));
function agentsOf(t: SeenTree, snaps?: Snaps) {
  return {
    corp: restore(t.createAgent("corp", "normal"), snaps?.corp),
    runner: restore(t.createAgent("runner", "normal"), snaps?.runner),
  };
}
function resetGlobals(tree: TreeName) {
  G[`__seenLeak_${tree}`] = undefined;
  G[`__seenForce_${tree}`] = undefined;
  G[`__seenTop_${tree}`] = undefined;
  G[`__seenReal_${tree}`] = 0;
}
/** One decision asked of tree `t` on a copy of `s` with the agents restored from `snaps` (FORCE `force` if given). */
function ask(
  t: SeenTree,
  s: GameState,
  snaps: Snaps,
  force?: Map<string, string | null>,
): { a: string; ms: number; r?: string; c?: string } {
  t.clear();
  resetGlobals(t.tree);
  if (force) G[`__seenForce_${t.tree}`] = force;
  const ag = agentsOf(t, snaps);
  G[`__seenTop_${t.tree}`] = ag.runner;
  const g = new t.GameRunner(structuredClone(s), ag);
  const t0 = performance.now();
  try {
    g.step();
    return {
      a: key(g.last),
      ms: performance.now() - t0,
      r: sig(ag.runner, "runner"),
      c: sig(ag.corp, "corp"),
    };
  } catch (e) {
    return {
      a: `error: ${(e as Error).message.slice(0, 80)}`,
      ms: performance.now() - t0,
    };
  } finally {
    resetGlobals(t.tree);
  }
}

type Kind = "main" | "prompt" | "rez" | "off";
/** The decision GameRunner.step asks an agent for at `s`, or null (no side, or a pass the engine makes for it). */
function decisionOf(
  core: any,
  s: GameState,
): { side: "corp" | "runner"; kind: Kind } | null {
  const side = core.actingSide(s);
  if (!side || s.winner) return null;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
    const want = core.wantsStop(s, side, w);
    if (
      want &&
      side === "corp" &&
      (w.step === "approach_ice" || w.step === "approach_server")
    )
      return { side, kind: "rez" };
    if (want && side === "runner" && w.step === "corp_action")
      return { side, kind: "off" };
    return null;
  }
  return { side, kind: core.activePrompt(s) ? "prompt" : "main" };
}

// ------------------------------------------------------------------------------------------------ classes (HIDDEN-READ)
type Where = { zone: string; card?: any; server?: string };
function whereIs(s: GameState, id: string): Where {
  for (const [sid, sv] of Object.entries(s.corp.servers)) {
    const r = sv.root.find((c) => c.instanceId === id);
    if (r) return { zone: "root", card: r, server: sid };
    const i = sv.ice.find((c) => c.instanceId === id);
    if (i) return { zone: "ice", card: i, server: sid };
  }
  const zones: [string, any[]][] = [
    ["hq", s.corp.hq],
    ["rd", s.corp.rd],
    ["archivesDown", s.corp.archives.faceDown],
    ["archivesUp", s.corp.archives.faceUp],
    ["corpScore", s.corp.scoreArea],
    ["runnerScore", s.runner.scoreArea],
  ];
  for (const [z, list] of zones) {
    const c = list.find((x: any) => x.instanceId === id);
    if (c) return { zone: z, card: c };
  }
  return { zone: "elsewhere" };
}
const HIDDEN = new Set(["hq", "rd", "archivesDown"]);
const marked = (c: any) => !!(c.isRezzed || c.faceUp || c.runnerKnows);

interface Entry {
  label: string;
  wentHidden: boolean;
}
/** After each step: how each entry of a (base) memory got there (count 1's labels) and whether it has been hidden since. */
function track(
  s: GameState,
  memory: Map<string, string>,
  entries: Map<string, Entry>,
) {
  const run = s.activeRun as any;
  for (const id of memory.keys()) {
    const w = whereIs(s, id);
    let e = entries.get(id);
    if (!e) {
      let label = "other";
      if (w.zone === "root" && marked(w.card)) label = "marked";
      else if (
        w.zone === "root" &&
        run?.isSuccessful &&
        run.server === w.server
      )
        label = run.breachInstead ? "breachReplaced" : "preAccess";
      else if (w.zone === "root") {
        const runs = (s.runsThisTurn ?? []).filter(
          (r: any) => r.successful && r.server === w.server,
        );
        label = runs.length
          ? w.card.installedTurn === `${s.turnNumber}-${s.activePlayer}`
            ? "installedThisTurn"
            : "notAccessed"
          : "other";
      }
      e = { label, wentHidden: false };
      entries.set(id, e);
    }
    if (HIDDEN.has(w.zone)) e.wentHidden = true;
  }
}
/** The class of an unmarked root entry of the base memory. */
function rootClass(
  s: GameState,
  id: string,
  w: Where,
  e: Entry | undefined,
): string {
  const run = s.activeRun as any;
  if (!e) return "other";
  if (e.wentHidden) return "recycled";
  const candidate =
    run?.server === w.server &&
    (run?.isSuccessful || run?.breached) &&
    !(run.accessed ?? []).some((x: any) => x.id === id);
  if (e.label === "preAccess") return candidate ? "preAccess" : "notAccessed";
  if (e.label === "marked") return "other";
  return e.label;
}
interface Diff {
  id: string;
  code: string;
  cls: string;
  zone: string;
  /** F's value: the code, or null when F holds no entry */
  to: string | null;
}
function diffMemories(
  s: GameState,
  base: Map<string, string>,
  f: Map<string, string>,
  entries: Map<string, Entry>,
): Diff[] {
  const d: Diff[] = [];
  for (const id of new Set([...base.keys(), ...f.keys()])) {
    const b = base.get(id);
    const v = f.get(id);
    if (b === v) continue;
    const w = whereIs(s, id);
    let cls: string;
    if (b !== undefined && v === undefined)
      cls =
        w.zone === "root"
          ? rootClass(s, id, w, entries.get(id))
          : `hiddenZone:${w.zone}`;
    else if (b === undefined) cls = "added";
    else cls = "changedCode";
    d.push({ id, code: (b ?? v)!, cls, zone: w.zone, to: v ?? null });
  }
  return d;
}
/** Unmarked root entries of a memory, by class (the base memory's leaks of the installed classes). */
function rootLeaks(
  s: GameState,
  memory: Map<string, string>,
  entries: Map<string, Entry>,
): Diff[] {
  const d: Diff[] = [];
  for (const [id, code] of memory) {
    const w = whereIs(s, id);
    if (w.zone !== "root" || marked(w.card)) continue;
    d.push({
      id,
      code,
      cls: rootClass(s, id, w, entries.get(id)),
      zone: "root",
      to: null,
    });
  }
  return d;
}
const title = (t: SeenTree, code: string) =>
  t.core.getCardDefinition(code)?.title ?? code;
const force = (ds: Diff[]) =>
  new Map(ds.map((x) => [x.id, x.to] as [string, string | null]));

/** Counterfactual attribution of a Runner decision: which class's entries, set to F's, turn base's answer into F's. */
function attribute(
  s: GameState,
  snaps: Snaps,
  diffs: Diff[],
  baseAct: string,
  fAct: string,
) {
  const control = ask(T.pBase, s, snaps).a;
  if (control !== baseAct) return { verdict: "stop:control", control };
  const classes = [...new Set(diffs.map((x) => x.cls))];
  const flips: string[] = [];
  const asks: Record<string, string> = {};
  for (const c of classes) {
    const a = ask(T.pBase, s, snaps, force(diffs.filter((x) => x.cls === c))).a;
    asks[c] = a === fAct ? "F" : a === baseAct ? "base" : a;
    if (a === fAct) flips.push(c);
  }
  if (flips.length) return { verdict: flips.join("+"), asks };
  if (classes.length > 1 && ask(T.pBase, s, snaps, force(diffs)).a === fAct)
    return { verdict: "combined", asks };
  return { verdict: "unattributed", asks };
}

// ------------------------------------------------------------------------------------------------ one game
interface StepRec {
  i: number;
  side: "corp" | "runner";
  kind: Kind;
  T: number;
  s: GameState;
  snaps: Snaps;
  act: string;
}
interface GameRec {
  acts: string[];
  /** The deciding Runner's memory after each step (mems: true) */
  mems: Map<string, string>[];
  /** The agents' carried fields after each step: the signature, and the fields themselves (mems: true) */
  sigs: { r: string; c: string }[];
  carry: { runner: Snap; corp: Snap }[];
  winner: string | null;
  turns: number;
  cr: number[];
  sc: number[];
  real: number;
  ms: { corp: number[]; runner: number[] };
  steps: number;
}
type Hook = (r: {
  i: number;
  d: { side: "corp" | "runner"; kind: Kind } | null;
  before: GameState | null;
  snaps: Snaps | null;
  g: any;
  ag: any;
  leaks: any[];
  replyN: number;
}) => void;
let captured: {
  s: GameState;
  snaps: Snaps;
  d: { side: "corp" | "runner"; kind: Kind } | null;
} | null = null;
/** The board and the agents just before step `j` of tree t's game of `seed` (the game replayed: it is deterministic). */
/**
 * The base game replayed on tree t (caches kept across steps, as in a game) up to step `upto`, with the deciding Runner's
 * memory differences of class `cls` (or "all") set to F's at every step: the action played at `upto`.
 */
function replayForced(
  t: SeenTree,
  seed: number,
  upto: number,
  bMems: Map<string, string>[],
  fMems: Map<string, string>[],
  entriesAt: Map<string, Entry>[],
  cls: string,
): string {
  t.clear();
  resetGlobals(t.tree);
  const ag = agentsOf(t);
  const g = new t.GameRunner(dealState(seed), ag);
  try {
    for (let j = 0; j <= upto; j++) {
      const ds = diffMemories(
        g.state,
        bMems[j],
        fMems[j],
        entriesAt[j] ?? new Map(),
      ).filter((x) => cls === "all" || x.cls === cls);
      G[`__seenForce_${t.tree}`] = ds.length ? force(ds) : undefined;
      if (!g.step()) return "ended";
      if (j === upto) return key(g.last);
    }
    return "ended";
  } catch (e) {
    return `error: ${(e as Error).message.slice(0, 80)}`;
  } finally {
    resetGlobals(t.tree);
  }
}
function captureAt(t: SeenTree, seed: number, j: number) {
  captured = null;
  playGame(t, seed, { stopAt: j });
  return captured as unknown as {
    s: GameState;
    snaps: Snaps;
    d: { side: "corp" | "runner"; kind: Kind } | null;
  };
}
function playGame(
  t: SeenTree,
  seed: number,
  opts: {
    mems?: boolean;
    stopAt?: number;
    snapsAt?: (
      d: { side: "corp" | "runner"; kind: Kind },
      s: GameState,
      i: number,
    ) => boolean;
    hook?: Hook;
  },
): GameRec {
  t.clear();
  resetGlobals(t.tree);
  const ag = agentsOf(t);
  const g = new t.GameRunner(dealState(seed), ag);
  const rec: GameRec = {
    acts: [],
    mems: [],
    sigs: [],
    carry: [],
    winner: null,
    turns: 0,
    cr: [],
    sc: [],
    real: 0,
    ms: { corp: [], runner: [] },
    steps: 0,
  };
  let lastTurn = -1;
  G[`__seenTop_${t.tree}`] = ag.runner;
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === "corp") {
      rec.cr.push(s.corp.credits);
      rec.sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const d = decisionOf(t.core, s);
    if (opts.stopAt === i) {
      captured = {
        s: structuredClone(s),
        snaps: { corp: snapAgent(ag.corp), runner: snapAgent(ag.runner) },
        d,
      };
      break;
    }
    const want = !!(d && opts.snapsAt?.(d, s, i));
    const before = want ? structuredClone(s) : null;
    const snaps = want
      ? { corp: snapAgent(ag.corp), runner: snapAgent(ag.runner) }
      : null;
    const leaks: any[] = [];
    // Reply leaks are logged at every decision (a Runner decision can reach the reply too, through the Corp's answers)
    if (d) G[`__seenLeak_${t.tree}`] = leaks;
    const n0 = G[`__seenReplyN_${t.tree}`] ?? 0;
    const t0 = performance.now();
    const more = g.step();
    const ms = performance.now() - t0;
    G[`__seenLeak_${t.tree}`] = undefined;
    if (!more) break;
    rec.steps++;
    if (d) rec.ms[d.side].push(Math.round(ms * 10) / 10);
    rec.acts.push(key(g.last));
    if (opts.mems) {
      rec.mems.push(new Map((ag.runner as any).memory));
      const cr = carried(ag.runner, "runner");
      const cc = carried(ag.corp, "corp");
      rec.sigs.push({ r: key(cr), c: key(cc) });
      rec.carry.push({ runner: cr, corp: cc });
    }
    opts.hook?.({
      i,
      d,
      before,
      snaps,
      g,
      ag,
      leaks,
      replyN: (G[`__seenReplyN_${t.tree}`] ?? 0) - n0,
    });
  }
  rec.winner = g.state.winner ?? null;
  rec.turns = g.state.turnNumber;
  rec.real = G[`__seenReal_${t.tree}`] ?? 0;
  resetGlobals(t.tree);
  return rec;
}

/** A continuation on tree t from `s` after `pick`, both agents restored from `snaps`, to the end. */
function continuation(
  t: SeenTree,
  s: GameState,
  snaps: Snaps,
  pick: GameAction,
) {
  t.clear();
  resetGlobals(t.tree);
  const ag = agentsOf(t, snaps);
  const g = new t.GameRunner(structuredClone(s), ag);
  try {
    g.apply(pick);
    for (let i = 0; i < MAX_STEPS && g.step(); i++);
  } catch (e) {
    return { error: (e as Error).message.slice(0, 80) };
  } finally {
    resetGlobals(t.tree);
  }
  return {
    winner: g.state.winner ?? null,
    corpPts: g.state.corp.score,
    runnerPts: g.state.runner.score,
    T: g.state.turnNumber,
  };
}

const msStats = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return {
    n: a.length,
    sum: Math.round(a.reduce((n, x) => n + x, 0)),
    p95: a.length ? a[Math.floor(0.95 * (a.length - 1))] : 0,
  };
};

async function deal(
  rec: {
    seed: number;
    corpDeck: string;
    runnerDeck: string;
    winner: string | null;
    cr: number[];
    sc: number[];
  },
  k: number,
) {
  const src = `deal:${rec.seed}`;
  const t0 = performance.now();
  // The game trees in a rotating order (timing: no tree always runs first)
  const order = (["F", "base", "control"] as const).map(
    (_, j, a) => a[(j + k) % 3],
  );
  let F!: GameRec;
  let C!: GameRec;
  let B!: GameRec;
  const entries = new Map<string, Entry>();
  let first: {
    i: number;
    side: "corp" | "runner";
    kind: Kind;
    act: string;
    fAct: string;
    baseMem: Map<string, string>;
    fMem: Map<string, string>;
    leaks: any[];
    entriesAt: Map<string, Entry>;
  } | null = null;
  /** The base game's reply leaks at each Corp step that had any */
  const leaksAt = new Map<number, any[]>();
  /** The base game's entry labels after each step (for a memory diff at an earlier step) */
  const entriesAtStep: Map<string, Entry>[] = [];
  const corpLeak: (StepRec & { leaks: any[] })[] = [];
  const corpLeakCount = {
    decisions: 0,
    withLeak: 0,
    samples: 0,
    leakSamples: 0,
    byWhy: {} as Record<string, number>,
  };
  const trash: (StepRec & { pre: Diff[] })[] = [];
  const hCands: (StepRec & { hidden: Diff[] })[] = [];
  const playF = () => {
    // F first or not, the first difference needs F's actions: F's game is kept whole
    F = playGame(T.F, rec.seed, {
      mems: true,
      snapsAt: (d) => d.side === "runner" && hCands.length < CAP_H,
      hook: ({ i, d, before, snaps, g, ag }) => {
        if (!d || d.side !== "runner" || !before || !snaps) return;
        const mem: Map<string, string> = ag.runner.memory;
        const hidden: Diff[] = [];
        for (const [id, code] of mem) {
          const w = whereIs(g.state, id);
          if (HIDDEN.has(w.zone))
            hidden.push({ id, code, cls: w.zone, zone: w.zone, to: null });
        }
        if (hidden.length && hCands.length < CAP_H)
          hCands.push({
            i,
            side: d.side,
            kind: d.kind,
            T: before.turnNumber,
            s: before,
            snaps,
            act: key(g.last),
            hidden,
          });
      },
    });
  };
  const playBase = (fActs: string[], fMems: Map<string, string>[]) => {
    B = playGame(T.base, rec.seed, {
      mems: true,
      snapsAt: (d) =>
        (d.side === "corp" && corpLeak.length < CAP_CORP) ||
        (d.side === "runner" &&
          d.kind === "prompt" &&
          trash.length < CAP_TRASH),
      hook: ({ i, d, before, snaps, g, ag, leaks, replyN }) => {
        const mem: Map<string, string> = ag.runner.memory;
        track(g.state, mem, entries);
        const act = key(g.last);
        if (!first)
          entriesAtStep.push(
            new Map([...entries].map(([id, x]) => [id, { ...x }])),
          );
        if (leaks.length) leaksAt.set(i, leaks);
        if (!first && i < fActs.length && act !== fActs[i] && d)
          first = {
            i,
            side: d.side,
            kind: d.kind,
            act,
            fAct: fActs[i],
            baseMem: new Map(mem),
            fMem: fMems[i],
            leaks,
            entriesAt: entriesAtStep[i],
          };
        if (d?.side === "corp") {
          corpLeakCount.decisions++;
          corpLeakCount.samples += replyN;
          const samples = new Set(leaks.map((x) => x.k));
          if (samples.size) {
            corpLeakCount.withLeak++;
            corpLeakCount.leakSamples += samples.size;
            for (const x of leaks)
              corpLeakCount.byWhy[x.why] =
                (corpLeakCount.byWhy[x.why] ?? 0) + 1;
            if (before && snaps && corpLeak.length < CAP_CORP)
              corpLeak.push({
                i,
                side: d.side,
                kind: d.kind,
                T: before.turnNumber,
                s: before,
                snaps,
                act,
                leaks,
              });
          }
        }
        if (
          d?.side === "runner" &&
          d.kind === "prompt" &&
          before &&
          snaps &&
          trash.length < CAP_TRASH &&
          T.base.core.activePrompt(before)?.kind === "access_trash"
        ) {
          // preAccess entries held at this trash decision (after its remember: the memory as the decision read it)
          const pre = rootLeaks(before, mem, entries).filter(
            (x) => x.cls === "preAccess",
          );
          if (pre.length)
            trash.push({
              i,
              side: d.side,
              kind: d.kind,
              T: before.turnNumber,
              s: before,
              snaps,
              act,
              pre,
            });
        }
      },
    });
  };
  for (const name of order) {
    if (name === "control") C = playGame(T.control, rec.seed, {});
    else if (name === "F") playF();
    else if (!F) {
      // base before F: play F now (its actions are needed), then base; F's place in the order is then a no-op
      playF();
      playBase(F.acts, F.mems);
    } else playBase(F.acts, F.mems);
  }
  if (!B) playBase(F.acts, F.mems);
  const matches =
    B.winner === rec.winner &&
    key(B.cr) === key(rec.cr) &&
    key(B.sc) === key(rec.sc);
  const controlSame = key(C.acts) === key(B.acts);
  const differs = key(F.acts) !== key(B.acts);
  out({
    kind: "g",
    src,
    decks: `${rec.corpDeck} v ${rec.runnerDeck}`,
    base: { winner: B.winner, T: B.turns, real: B.real, steps: B.steps },
    F: {
      winner: F.winner,
      T: F.turns,
      real: F.real,
      steps: F.steps,
      cr: F.cr,
      sc: F.sc,
    },
    control: { winner: C.winner, real: C.real },
    matchesBatch: matches,
    controlSame,
    differs,
  });
  out({
    kind: "time",
    src,
    base: { corp: msStats(B.ms.corp), runner: msStats(B.ms.runner) },
    F: { corp: msStats(F.ms.corp), runner: msStats(F.ms.runner) },
    control: { corp: msStats(C.ms.corp), runner: msStats(C.ms.runner) },
    raw: { base: B.ms, F: F.ms, control: C.ms },
  });

  // ---- 2. the first differing decision
  if (first) {
    const f = first as NonNullable<typeof first>;
    const at = captureAt(T.base, rec.seed, f.i);
    const r: Record<string, unknown> = {
      kind: "first",
      src,
      i: f.i,
      side: f.side,
      dk: f.kind,
      T: at.s.turnNumber,
      base: f.act,
      F: f.fAct,
      run: at.s.activeRun
        ? { server: at.s.activeRun.server, phase: at.s.activeRun.phase }
        : null,
      prompt: T.base.core.activePrompt(at.s)?.kind ?? null,
    };
    const fwd = (x: string) => (x === f.fAct ? "F" : x === f.act ? "base" : x);
    let done: boolean;
    if (f.side === "runner") {
      const diffs = diffMemories(at.s, f.baseMem, f.fMem, f.entriesAt);
      r.diffs = diffs.map((x) => ({ ...x, title: title(T.base, x.code) }));
      const v = attribute(at.s, at.snaps, diffs, f.act, f.fAct);
      Object.assign(r, v);
      r.Fdec = fwd(ask(T.pFdec, at.s, at.snaps).a);
      done = v.verdict !== "unattributed";
      if (!done) {
        // Not the deciding Runner's own map: the fix in the reply's and the oracle's Runners only (reached from this
        // decision through the Corp's modelled answers)
        const frep = ask(T.pFrep, at.s, at.snaps).a;
        r.Frep = fwd(frep);
        r.leaks = f.leaks
          .slice(0, 12)
          .map((x: any) => ({ ...x, title: title(T.base, x.code) }));
        r.leakSamples = new Set(f.leaks.map((x: any) => x.k)).size;
        if (frep === f.fAct) {
          r.verdict = `reply:${[...new Set(f.leaks.map((x: any) => x.why))].join("+") || "none"}`;
          done = true;
        }
      }
      if (!done) {
        // Is F's move reproducible by a fresh ask at all? The F tree with the base agents, then with F's own agents
        r.pFbase = fwd(ask(T.pF, at.s, at.snaps).a);
        const atF = captureAt(T.F, rec.seed, f.i);
        r.pFown = fwd(ask(T.pF, atF.s, atF.snaps).a);
        r.pBaseFsnaps = fwd(ask(T.pBase, atF.s, atF.snaps).a);
        r.sameBoard = key(atF.s) === key(at.s);
        if (r.pFown !== "F") {
          // F's move is not reproduced by a fresh ask in either tree: it comes from the value caches the game built up
          // over earlier decisions (keyed by the board, shared by every reader: Corp-side found row 90), whose values
          // were computed with the deciding Runner's memory of that time. Counterfactual over the history: the base
          // game replayed on the pBase tree without clearing caches, with one class's differences forced at every
          // step up to this one; the class whose replay gives F's move here is the cause.
          const cls = [
            ...new Set(
              B.mems
                .slice(0, f.i + 1)
                .flatMap((m, j) => [
                  ...diffMemories(
                    at.s,
                    m,
                    F.mems[j],
                    entriesAtStep[j] ?? f.entriesAt,
                  ).map((x) => x.cls),
                ]),
            ),
          ];
          const hist: Record<string, string> = {};
          const flips: string[] = [];
          for (const c of [...cls, "all"]) {
            const a = replayForced(
              T.pBase,
              rec.seed,
              f.i,
              B.mems,
              F.mems,
              entriesAtStep,
              c,
            );
            hist[c] = fwd(a);
            if (a === f.fAct && c !== "all") flips.push(c);
          }
          r.history = hist;
          if (flips.length) r.verdict = `cacheHistory:${flips.join("+")}`;
          else if (hist.all === "F") r.verdict = "cacheHistory:combined";
        }
      }
    } else {
      const control = ask(T.pBase, at.s, at.snaps).a;
      const frep = ask(T.pFrep, at.s, at.snaps).a;
      r.control = fwd(control);
      r.Frep = fwd(frep);
      r.leaks = f.leaks
        .slice(0, 12)
        .map((x: any) => ({ ...x, title: title(T.base, x.code) }));
      r.leakSamples = new Set(f.leaks.map((x: any) => x.k)).size;
      r.verdict =
        control !== f.act
          ? "stop:control"
          : frep === f.fAct
            ? `reply:${[...new Set(f.leaks.map((x: any) => x.why))].join("+") || "none"}`
            : "unattributed";
      done = r.verdict !== "unattributed";
    }
    // Carried state: an earlier decision played the same move but left different private fields (the Runner's savingFor or
    // planned line, the Corp's held line), which this decision reads. Ask with F's carried fields; then find the first step
    // whose fields differ and attribute it counterfactually there.
    const prev = f.i - 1;
    if (
      !done &&
      prev >= 0 &&
      (B.sigs[prev].r !== F.sigs[prev].r || B.sigs[prev].c !== F.sigs[prev].c)
    ) {
      const snaps2: Snaps = {
        runner: { ...at.snaps.runner, ...F.carry[prev].runner },
        corp: { ...at.snaps.corp, ...F.carry[prev].corp },
      };
      const diffs = diffMemories(at.s, f.baseMem, f.fMem, f.entriesAt);
      const withCarry = ask(
        f.side === "runner" ? T.pBase : T.pFrep,
        at.s,
        snaps2,
        f.side === "runner" ? force(diffs) : undefined,
      ).a;
      r.withCarried = fwd(withCarry);
      if (withCarry === f.fAct) {
        let j = 0;
        while (
          j < prev &&
          B.sigs[j].r === F.sigs[j].r &&
          B.sigs[j].c === F.sigs[j].c
        )
          j++;
        const side = B.sigs[j].r !== F.sigs[j].r ? "runner" : "corp";
        const atj = captureAt(T.base, rec.seed, j);
        const o: Record<string, unknown> = {
          j,
          T: atj.s.turnNumber,
          side,
          dk: atj.d?.kind ?? null,
          act: B.acts[j],
        };
        if (side === "runner") {
          const dj = diffMemories(
            atj.s,
            B.mems[j],
            F.mems[j],
            entriesAtStep[j] ?? f.entriesAt,
          );
          o.diffs = dj.map((x) => ({
            cls: x.cls,
            title: title(T.base, x.code),
          }));
          const flips = [...new Set(dj.map((x) => x.cls))].filter(
            (c) =>
              ask(
                T.pBase,
                atj.s,
                atj.snaps,
                force(dj.filter((x) => x.cls === c)),
              ).r === F.sigs[j].r,
          );
          o.origin = flips.length
            ? flips.join("+")
            : ask(T.pBase, atj.s, atj.snaps, force(dj)).r === F.sigs[j].r
              ? "combined"
              : "unattributed";
        } else {
          const lj = leaksAt.get(j) ?? [];
          o.leaks = lj
            .slice(0, 8)
            .map((x: any) => ({ ...x, title: title(T.base, x.code) }));
          o.origin =
            ask(T.pFrep, atj.s, atj.snaps).c === F.sigs[j].c
              ? `reply:${[...new Set(lj.map((x: any) => x.why))].join("+") || "none"}`
              : "unattributed";
        }
        r.carriedFrom = o;
        r.verdict = `carried:${side}:${o.origin}`;
      }
    }
    out(r);
  }

  // ---- 3. reply counts and the Corp picks changed, with the paired continuations
  let changed = 0;
  let controlStops = 0;
  for (const c of corpLeak) {
    const control = ask(T.pBase, c.s, c.snaps).a;
    if (control !== c.act) {
      controlStops++;
      out({ kind: "corpStop", src, i: c.i, T: c.T, played: c.act, control });
      continue;
    }
    const pf = ask(T.pF, c.s, c.snaps).a;
    const pr = ask(T.pFrep, c.s, c.snaps).a;
    if (pf === control) continue;
    changed++;
    const rec2: Record<string, unknown> = {
      kind: "corpPick",
      src,
      i: c.i,
      T: c.T,
      dk: c.kind,
      base: control,
      F: pf,
      Frep: pr === pf ? "F" : pr === control ? "base" : pr,
      samples: new Set(c.leaks.map((x) => x.k)).size,
      leaks: c.leaks
        .slice(0, 8)
        .map((x) => ({ ...x, title: title(T.base, x.code) })),
    };
    if (!pf.startsWith("error")) {
      rec2.contBase = continuation(T.pF, c.s, c.snaps, JSON.parse(control));
      rec2.contF = continuation(T.pF, c.s, c.snaps, JSON.parse(pf));
    }
    out(rec2);
  }
  out({
    kind: "reply",
    src,
    ...corpLeakCount,
    asked: corpLeak.length,
    controlStops,
    changed,
  });

  // ---- 4. preAccess asked honestly on trash decisions
  let tChanged = 0;
  let tStops = 0;
  for (const c of trash) {
    const control = ask(T.pBase, c.s, c.snaps).a;
    if (control !== c.act) {
      tStops++;
      continue;
    }
    const h = ask(T.pBase, c.s, c.snaps, force(c.pre)).a;
    if (h !== control) {
      tChanged++;
      out({
        kind: "trashFlip",
        src,
        i: c.i,
        T: c.T,
        base: control,
        honest: h,
        pre: c.pre.map((x) => ({ id: x.id, title: title(T.base, x.code) })),
      });
    }
  }
  out({
    kind: "trash",
    src,
    asked: trash.length,
    stops: tStops,
    changed: tChanged,
  });

  // ---- 5. arm H
  const hz: Record<string, number> = {};
  let hChanged = 0;
  let hStops = 0;
  for (const c of hCands) {
    const control = ask(T.pF, c.s, c.snaps).a;
    if (control !== c.act) {
      hStops++;
      continue;
    }
    if (ask(T.pF, c.s, c.snaps, force(c.hidden)).a === control) continue;
    hChanged++;
    const zones = [...new Set(c.hidden.map((x) => x.zone))];
    const by = zones.filter(
      (z) =>
        ask(T.pF, c.s, c.snaps, force(c.hidden.filter((x) => x.zone === z)))
          .a !== control,
    );
    for (const z of by.length ? by : ["combined"]) hz[z] = (hz[z] ?? 0) + 1;
    out({
      kind: "hFlip",
      src,
      i: c.i,
      T: c.T,
      zones: by,
      hidden: c.hidden.map((x) => ({
        zone: x.zone,
        title: title(T.F, x.code),
      })),
    });
  }
  out({
    kind: "H",
    src,
    asked: hCands.length,
    stops: hStops,
    changed: hChanged,
    byZone: hz,
  });
  out({ kind: "done", src, ms: Math.round(performance.now() - t0) });
}

// ------------------------------------------------------------------------------------------------ human files
function human(file: string) {
  const t0 = performance.now();
  const r = JSON.parse(readFileSync(file, "utf8"));
  if (!r.moves?.length) return;
  const src = `human:${file.split("/").pop()}`;
  const aiRunner = r.config.ai !== "corp";
  const hard = r.config.difficulty === "hard";
  const sk = (aiRunner ? "humanCorp" : "humanRunner") + (hard ? ":hard" : "");
  const core = T.pBase.core;
  let s: GameState;
  if (r.startsAt === "state") s = structuredClone(r.state);
  else {
    s = core.createInitialGameState(
      T.pBase.decks.deckGameSetup(
        r.config.seed,
        r.config.corpDeck,
        r.config.runnerDeck,
      ),
    );
    if (r.startStops) s = { ...s, stops: r.startStops };
  }
  const shadows = {
    pBase: T.pBase.createAgent("runner", "normal"),
    pF: T.pF.createAgent("runner", "normal"),
    pControl: T.pControl.createAgent("runner", "normal"),
  } as Record<"pBase" | "pF" | "pControl", any>;
  const entries = new Map<string, Entry>();
  const ms: Record<string, number[]> = { pBase: [], pF: [], pControl: [] };
  let decisions = 0;
  let memDiff = 0;
  let changed = 0;
  let stopped: string | null = null;
  const byVerdict: Record<string, number> = {};
  for (const [j, move] of (r.moves as GameAction[]).entries()) {
    const ai = { ...s, stops: { corp: "ai", runner: "ai" } } as GameState;
    const d = decisionOf(core, ai);
    if (d?.side === "runner") {
      decisions++;
      const snaps = Object.fromEntries(
        Object.entries(shadows).map(([n, a]) => [n, snapAgent(a)]),
      ) as Record<string, Snap>;
      for (const a of Object.values(shadows)) a.observe(s);
      track(s, shadows.pBase.memory, entries);
      const diffs = diffMemories(
        s,
        shadows.pBase.memory,
        shadows.pF.memory,
        entries,
      );
      if (diffs.length) memDiff++;
      if (!hard) {
        const res: Record<string, string> = {};
        for (const n of ["pBase", "pF", "pControl"] as const) {
          const x = ask(T[n], ai, { corp: {}, runner: snaps[n] });
          ms[n].push(Math.round(x.ms * 10) / 10);
          res[n] = x.a;
        }
        if (res.pBase !== res.pF) {
          changed++;
          // Attribution on the shadows' memories after this decision's observe (the agent's own remember re-runs inside)
          const at = diffs.length
            ? attribute(
                ai,
                { corp: {}, runner: snaps.pBase },
                diffs,
                res.pBase,
                res.pF,
              )
            : { verdict: "no-memory-diff" };
          byVerdict[at.verdict] = (byVerdict[at.verdict] ?? 0) + 1;
          out({
            kind: "hChange",
            src,
            sk,
            at: j,
            T: s.turnNumber,
            dk: d.kind,
            base: res.pBase,
            F: res.pF,
            controlSame: res.pControl === res.pBase,
            diffs: diffs.map((x) => ({
              cls: x.cls,
              title: title(T.pBase, x.code),
            })),
            ...at,
          });
        }
      }
    }
    try {
      s = core.executeAction(s, move);
    } catch (e) {
      stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
      break;
    }
  }
  out({
    kind: "human",
    src,
    sk,
    moves: r.moves.length,
    stopped,
    decisions,
    memDiff,
    changed,
    byVerdict,
    time: {
      base: msStats(ms.pBase),
      F: msStats(ms.pF),
      control: msStats(ms.pControl),
    },
    raw: ms,
    ms: Math.round(performance.now() - t0),
  });
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  T = await seenTrees(root);
  const record: {
    seed: number;
    corpDeck: string;
    runnerDeck: string;
    winner: string | null;
    cr: number[];
    sc: number[];
  }[] = JSON.parse(
    readFileSync("scripts/runner-rework/seen-base-deals.json", "utf8"),
  );
  const want = (process.env.DEALS ?? "").split(",").filter(Boolean);
  const dealList = want.includes("none")
    ? []
    : record.filter((r) => !want.length || want.includes(String(r.seed)));
  const hdir = "tests/fixtures/human-games";
  const hwant = (process.env.HUMAN ?? "").split(",").filter(Boolean);
  const humans = hwant.includes("none")
    ? []
    : readdirSync(hdir)
        .filter(
          (f) =>
            f.endsWith(".json") &&
            (!hwant.length || hwant.some((w) => f.startsWith(w))),
        )
        .sort(
          (a, b) =>
            Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")) ||
            a.localeCompare(b),
        );
  const sources: { kind: "deal" | "human"; id: any }[] = [
    ...dealList.map((r) => ({ kind: "deal" as const, id: r })),
    ...humans.map((f) => ({ kind: "human" as const, id: f })),
  ];
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    try {
      if (src.kind === "deal") await deal(src.id, k);
      else human(join(hdir, src.id));
    } catch (e) {
      out({
        kind: "error",
        src: src.kind === "deal" ? `deal:${src.id.seed}` : `human:${src.id}`,
        error: (e as Error).stack?.slice(0, 400),
      });
    }
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR))
    writeFileSync(join(process.env.OUT_DIR, "done"), "ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
