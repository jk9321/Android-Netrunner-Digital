/**
 * Stage D exploit F3 (the bait run), count step. Brief: /mnt/project-files/netrunner-ai/stage-d/bait-run/brief.md.
 * Scripts only: nothing in src or tests. Trees and arms: bait-run-trees.ts (each a patched copy of this checkout's src,
 * its own module graph); the hunt's boards: bait-run-boards.ts.
 *
 * Sources (kinds kept apart everywhere: self, humanRunner = the person played the Runner, humanCorp):
 *  (a) the 221 deals of the g1 base 44381468776 (post-pick-deals.json: each game's winner, cr and sc checked against
 *      that record), played by the `source` tree with a plain GameRunner, Normal v Normal, as the batch. The source tree
 *      is never asked or cleared mid-game (found row 71b); its agents' state is copied (structuredClone) before each step
 *      into the fresh agents that are asked.
 *  (b) the human files in tests/fixtures/human-games: the recorded moves replayed; at every board where either side
 *      decides, today's AI of that side is asked (fresh agents, no memory). `who`: ai (the AI played that side) or person.
 *
 * Every decision (a step where GameRunner asks an agent) is asked of beta, control and each arm: a one-step GameRunner
 * on a copy of the board with fresh agents of that tree, hand caches cleared first, the order of the trees rotated per
 * decision, timed. A control answer unlike beta's is a stop. Per ask: the deciding Corp's own countedRez calls (rule,
 * answer) and run-term pricing, and the arms' fire counts (inside the look-ahead too).
 * A1/A2: at a Corp rez window where beta's countedRez answered by a stop rule (R2, R3s, R4s, MPrez), and at a Corp
 * prompt in a run where beta's run term priced, the beta tree is asked once more, untimed, with the worlds measured
 * (`__brMeasure`): both worlds of A1 (bait-run-trees.ts `__worlds`) and A2's rest-of-turn hold of each "out" answer.
 * A3: what followed in the source (self-play: the game played; human: the recorded moves): the runs made later that
 * turn (server, got in) and the agenda points the Runner took that turn after this board.
 * B: for each arm's changed decision (capped at CAP a source and arm), from the board on the beta tree (fresh agents,
 * copied state), the arm's action first against beta's: (i) beta's agents both sides to the end of the game; (ii) at a
 * Corp rez window or prompt during a Runner's run on its own turn, the bait line (the Runner, for the rest of this turn
 * only, clicks for credits with every click but its last and runs the target with its last; its in-run choices are
 * beta's Runner's), then beta's agents to the end.
 *
 * Hidden information: agents are asked only through GameRunner (their own views). This measuring script reads the
 * Corp's root cards to say what a run could reach and to pick the bait line's target at R3s/R4s (the remote with the
 * most agenda points in its root): marked HIDDEN-READ. No arm reads it.
 *
 *   SHARD=0/64 npx vite-node scripts/stage-d/bait-run.ts
 *   ARGS="DEALS=1321 HUMAN=none CAP=8" npx vite-node scripts/stage-d/bait-run.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GameAction, GameState } from "../../src/core";
import { dealState } from "../stage-a/harness";
import {
  ARMS,
  Arm,
  BAIT_ARMS,
  Tree,
  loadTree,
  makeTrees,
} from "./bait-run-trees";

for (const kv of `${process.env.ARGS ?? ""} ${process.argv.slice(2).join(" ")}`
  .split(/\s+/)
  .filter((x) => x.includes("="))) {
  const [k, v] = kv.split("=");
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? "0/1").split("/").map(Number);
const root = resolve(
  process.env.TROOT ?? "node_modules/.cache/bait-run",
  String(shard),
);
const CAP = Number(process.env.CAP ?? 8);
const ASKED: Arm[] = ["beta", "control", ...BAIT_ARMS];
const STOP_RULES = ["R2", "R3s", "R4s", "MPrez"];
const G = globalThis as any;
const key = (a: unknown) => (a ? JSON.stringify(a) : "null");
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r2 = (x: number) => Math.round(x * 100) / 100;

let trees: Record<string, Tree> = {};

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
function agents(t: Tree, snaps?: { corp?: Snap; runner?: Snap }) {
  return {
    corp: restore(t.createAgent("corp", "normal"), snaps?.corp),
    runner: restore(t.createAgent("runner", "normal"), snaps?.runner),
  };
}

// ------------------------------------------------------------------------------------------------ decisions
type Cls =
  | "corpPrompt"
  | "corpMain"
  | "corpRez"
  | "runnerPrompt"
  | "runnerMain"
  | "runnerOff";
/** Whether GameRunner.step asks an agent on this board, and which kind of decision (as playout.ts step). */
function decisionOf(
  core: any,
  s: GameState,
): { side: "corp" | "runner"; cls: Cls } | null {
  const side = core.actingSide(s);
  if (!side || s.winner) return null;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
    const ask = core.wantsStop(s, side, w);
    if (
      ask &&
      side === "corp" &&
      (w.step === "approach_ice" || w.step === "approach_server")
    )
      return { side, cls: "corpRez" };
    if (ask && side === "runner" && w.step === "corp_action")
      return { side, cls: "runnerOff" };
    return null;
  }
  return {
    side,
    cls: core.activePrompt(s)
      ? (`${side}Prompt` as Cls)
      : (`${side}Main` as Cls),
  };
}

interface Ask {
  a: GameAction | null;
  k: string;
  ms: number;
  rez: any[];
  run: any;
  fire: Record<string, number>;
  err?: string;
}
function resetG() {
  G.__brRez = [];
  G.__brRun = null;
  G.__brFire = {};
  G.__brTopNext = false;
  G.__brPTop = false;
  G.__brRTop = false;
  G.__brSettling = false;
}
function ask(
  t: Tree,
  s: GameState,
  snaps: { corp?: Snap; runner?: Snap } | undefined,
  measure = false,
): Ask {
  t.clear();
  const ag = agents(t, snaps);
  const g = new t.GameRunner(structuredClone(s), ag);
  resetG();
  G.__brArm = true;
  G.__brMeasure = measure;
  const at = performance.now();
  try {
    g.step();
    const ms = performance.now() - at;
    const a = g.last as GameAction | null;
    return {
      a,
      k: key(a),
      ms,
      rez: G.__brRez ?? [],
      run: G.__brRun,
      fire: G.__brFire ?? {},
    };
  } catch (e) {
    return {
      a: null,
      k: `error: ${(e as Error).message.slice(0, 80)}`,
      ms: performance.now() - at,
      rez: [],
      run: null,
      fire: G.__brFire ?? {},
      err: (e as Error).message.slice(0, 160),
    };
  } finally {
    G.__brArm = false;
    G.__brMeasure = false;
    resetG();
  }
}

function label(
  t: Tree,
  s: GameState,
  a: GameAction | null | undefined,
): string {
  if (!a) return "none";
  const x = a as any;
  if (a.type === "RESOLVE_PROMPT") {
    const c = x.choice;
    if (c.kind === "effect_choice") return `prompt:${c.optionId}`;
    if (c.kind === "effect_cards")
      return `prompt:[${c.cardInstanceIds.map((id: string) => title(t, s, id)).join(", ")}]`;
    return `prompt:${c.kind}`;
  }
  const id = x.cardInstanceId;
  if (!id) return a.type + (x.targetServerId ? `>${x.targetServerId}` : "");
  return `${a.type} ${title(t, s, id)}`;
}
function title(t: Tree, s: GameState, id: string): string {
  const c = t.core.findCardAnywhere(s, id);
  return c ? `${t.core.cardDef(c).type_code}:${t.core.cardDef(c).title}` : id;
}
function promptInfo(t: Tree, s: GameState) {
  const p = t.core.activePrompt(s);
  if (!p) return null;
  const src = "source" in p ? p.source : null;
  return {
    side: p.side,
    kind: p.kind,
    code: src?.cardCode ?? null,
    step: src?.step ?? null,
    card: src ? t.core.getCardDefinition(src.cardCode).title : null,
  };
}
/** HIDDEN-READ (measuring script): the root's card types and agenda points, to say what the run could reach. */
function rootSummary(t: Tree, s: GameState, server: string | null) {
  const sv = server ? s.corp.servers[server] : null;
  if (!sv) return null;
  return sv.root
    .map(
      (c) =>
        t.core.cardDef(c).type_code +
        (t.core.cardDef(c).type_code === "agenda"
          ? `:${t.core.cardDef(c).agenda_points}`
          : ""),
    )
    .join(",");
}
/** HIDDEN-READ (measuring script): the remote with the most agenda points in its root, for the bait line's target at R3s/R4s. */
function richestRemote(t: Tree, s: GameState): string | null {
  let best: string | null = null;
  let pts = 0;
  for (const v of Object.values(s.corp.servers) as any[]) {
    if (!v.isRemote) continue;
    const p = v.root.reduce(
      (n: number, c: any) =>
        n +
        (t.core.cardDef(c).type_code === "agenda"
          ? (t.core.cardDef(c).agenda_points ?? 0)
          : 0),
      0,
    );
    if (p > pts) {
      pts = p;
      best = v.id;
    }
  }
  return best;
}

// ------------------------------------------------------------------------------------------------ continuations
interface Cont {
  thisRunIn: boolean | null;
  stolenTurn: number;
  turnRuns: { server: string; in: boolean }[];
  ccrTurnEnd: number | null;
  winner: string | null;
  T: number;
  cs: number;
  rs: number;
  err?: string;
}
function baitRunner(t: Tree, base: any, T0: number, target: string) {
  return new Proxy(base, {
    get(tg, p) {
      if (p === "chooseAction")
        return (s: GameState) => {
          if (
            !s.activeRun &&
            s.pendingPrompts.length === 0 &&
            s.activePlayer === "runner" &&
            s.turnNumber === T0 &&
            s.runner.clicks > 0
          ) {
            const a = (
              s.runner.clicks > 1
                ? { type: "GAIN_CREDIT", player: "runner" }
                : {
                    type: "INITIATE_RUN",
                    player: "runner",
                    targetServerId: target,
                  }
            ) as GameAction;
            if (t.core.isLegalAction(s, a)) return a;
          }
          return base.chooseAction(s);
        };
      const v = (tg as any)[p];
      return typeof v === "function" ? v.bind(tg) : v;
    },
  });
}
function cont(
  s0: GameState,
  first: GameAction,
  snaps: { corp?: Snap; runner?: Snap } | undefined,
  bait: string | null,
): Cont {
  const t = trees.beta;
  t.clear();
  const none: Cont = {
    thisRunIn: null,
    stolenTurn: 0,
    turnRuns: [],
    ccrTurnEnd: null,
    winner: null,
    T: 0,
    cs: 0,
    rs: 0,
  };
  let s: GameState;
  try {
    if (!t.core.isLegalAction(s0, first)) return { ...none, err: "not legal" };
    s = t.core.executeAction(structuredClone(s0), first);
  } catch (e) {
    return { ...none, err: (e as Error).message.slice(0, 100) };
  }
  const ag = agents(t, snaps);
  const T0 = s0.turnNumber;
  const P0 = s0.activePlayer;
  if (bait) ag.runner = baitRunner(t, ag.runner, T0, bait);
  const g = new t.GameRunner(s, ag);
  const runIdx = s0.activeRun ? s0.runsThisTurn.length - 1 : -1;
  const n0 = s0.runsThisTurn.length;
  let res: Partial<Cont> | null = null;
  const turnOver = (x: GameState) =>
    x.turnNumber !== T0 || x.activePlayer !== P0 || !!x.winner;
  const take = (prev: GameState) => {
    const runs = prev.runsThisTurn ?? [];
    res = {
      thisRunIn:
        runIdx >= 0
          ? !!runs[runIdx]?.successful ||
            (!!prev.winner && prev.winner === "runner")
          : null,
      stolenTurn: prev.runner.score - s0.runner.score,
      turnRuns: runs
        .slice(n0)
        .map((r) => ({ server: r.server, in: !!r.successful })),
      ccrTurnEnd: prev.corp.credits,
    };
  };
  try {
    let prev: GameState = g.state;
    if (turnOver(g.state)) take(g.state);
    for (let n = 0; n < 5000; n++) {
      if (!g.step()) break;
      if (!res && turnOver(g.state)) take(g.state.winner ? g.state : prev);
      prev = g.state;
    }
    if (!res) take(g.state);
  } catch (e) {
    if (!res) take(g.state);
    return {
      ...(res as any),
      winner: g.state.winner ?? null,
      T: g.state.turnNumber,
      cs: g.state.corp.score,
      rs: g.state.runner.score,
      err: (e as Error).message.slice(0, 100),
    };
  }
  return {
    ...(res as any),
    winner: g.state.winner ?? null,
    T: g.state.turnNumber,
    cs: g.state.corp.score,
    rs: g.state.runner.score,
  };
}

// ------------------------------------------------------------------------------------------------ one decision
let rot = 0;
interface Dec {
  src: string;
  kind: "self" | "humanRunner" | "humanCorp";
  who: "ai" | "person";
  i: number;
  s: GameState;
  side: "corp" | "runner";
  cls: Cls;
  snaps?: { corp?: Snap; runner?: Snap };
  played?: GameAction | null;
  /** A3: what followed in the source the rest of this turn (runs after this board's, the points the Runner took). */
  after?: () => {
    runs: { server: string; in: boolean }[];
    stolen: number;
  } | null;
}
function decide(d: Dec, perSrc: Record<string, number>) {
  const t = trees.beta;
  const order = [
    ...ASKED.slice(rot % ASKED.length),
    ...ASKED.slice(0, rot % ASKED.length),
  ];
  rot++;
  const asks: Record<string, Ask> = {};
  for (const arm of order) asks[arm] = ask(trees[arm], d.s, d.snaps);
  const b = asks.beta;
  const changed = BAIT_ARMS.filter((a) => asks[a].k !== b.k);
  const row: Record<string, unknown> = {
    kind: "d",
    src: d.src,
    sk: d.kind,
    who: d.who,
    i: d.i,
    T: d.s.turnNumber,
    side: d.side,
    c: d.cls,
    ms: ASKED.map((a) => r2(asks[a].ms)),
  };
  const fires = ASKED.map((a) => asks[a].fire);
  if (fires.some((f) => Object.keys(f).length)) row.fire = fires;
  if (asks.control.k !== b.k) row.controlDiffers = true;
  if (d.played !== undefined) row.fresh = key(d.played) === b.k;
  for (const a of ASKED)
    if (asks[a].err) (row.errors ??= {} as any)[a] = asks[a].err;
  const isPrompt = d.cls === "corpPrompt" || d.cls === "runnerPrompt";
  if (isPrompt) row.p = promptInfo(t, d.s);
  if (d.s.activeRun)
    row.run = {
      server: d.s.activeRun.server,
      clicks: d.s.runner.clicks,
      rcr: d.s.runner.credits,
      ccr: d.s.corp.credits,
      rt: d.s.activePlayer === "runner",
      root: rootSummary(t, d.s, d.s.activeRun.server),
    };
  // Beta's own countedRez calls and run term (the deciding Corp's)
  if (b.rez.length)
    row.rez = b.rez.map((r: any) => ({ t: r.title, r: r.r, rule: r.rule }));
  if (b.run)
    row.term = {
      loss: r2(b.run.loss),
      clicks: b.run.clicks,
      pick: label(t, d.s, b.a),
      opts: b.run.opts.map((o: any) => ({ a: label(t, d.s, o.a), v: o.v })),
    };
  // A1 / A2: the measuring ask
  const stopRez = b.rez.some((r: any) => STOP_RULES.includes(r.rule));
  if ((d.cls === "corpRez" && stopRez) || (d.cls === "corpPrompt" && b.run)) {
    const m = ask(t, d.s, d.snaps, true);
    if (m.k !== b.k) row.measureDiffers = true;
    if (stopRez)
      row.worlds = m.rez
        .filter((r: any) => r.worlds !== undefined)
        .map((r: any) => ({
          t: r.title,
          rule: r.rule,
          r: r.r,
          clicks: r.clicks,
          cr: r.cr,
          rcr: r.rcr,
          server: r.server,
          w: r.worlds,
        }));
    if (b.run && m.run)
      row.term = {
        ...(row.term as any),
        opts: m.run.opts.map((o: any) => ({
          a: label(t, d.s, o.a),
          v: o.v,
          ot: o.ot,
        })),
      };
    const after = d.after?.();
    if (after) row.followed = after;
  }
  if (changed.length) {
    row.changed = Object.fromEntries(
      changed.map((a) => [a, label(t, d.s, asks[a].a)]),
    );
    row.beta = label(t, d.s, b.a);
    for (const a of changed)
      if (asks[a].rez.length)
        (row.armRez ??= {} as any)[a] = asks[a].rez.map((r: any) => ({
          t: r.title,
          r: r.r,
          rule: r.rule,
          armed: r.armed,
        }));
  }
  out(row);
  // B: continuations of the changed decisions (one per distinct action and kind: arms that agree share it)
  const inRun =
    !!d.s.activeRun &&
    d.s.activePlayer === "runner" &&
    (d.cls === "corpRez" || d.cls === "corpPrompt");
  const conts = new Map<string, Cont>();
  const contOf = (a: GameAction, bait: string | null) => {
    const k = key(a) + "|" + bait;
    return conts.get(k) ?? conts.set(k, cont(d.s, a, d.snaps, bait)).get(k)!;
  };
  for (const arm of changed) {
    const x = asks[arm];
    if (!x.a || !b.a) continue;
    const n = (perSrc[arm] = (perSrc[arm] ?? 0) + 1);
    if (n > CAP) continue;
    const ca = contOf(x.a, null);
    const cb = contOf(b.a, null);
    let bait: string | null = null;
    if (inRun) {
      const rule = asks.beta.rez.find((r: any) =>
        STOP_RULES.includes(r.rule),
      )?.rule;
      bait =
        rule === "R3s" || rule === "R4s"
          ? (richestRemote(t, d.s) ?? d.s.activeRun!.server)
          : d.s.activeRun!.server;
    }
    const ba = bait ? contOf(x.a, bait) : null;
    const bb = bait ? contOf(b.a, bait) : null;
    out({
      kind: "c",
      src: d.src,
      sk: d.kind,
      who: d.who,
      i: d.i,
      T: d.s.turnNumber,
      arm,
      side: d.side,
      c: d.cls,
      p: isPrompt ? promptInfo(t, d.s) : null,
      a: label(t, d.s, x.a),
      b: label(t, d.s, b.a),
      run: row.run ?? null,
      cs0: d.s.corp.score,
      rs0: d.s.runner.score,
      cr0: d.s.corp.credits,
      ca,
      cb,
      bait,
      ba,
      bb,
    });
  }
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const dirs = makeTrees(root, ARMS);
  trees = {};
  for (const arm of ARMS) trees[arm] = await loadTree(arm, dirs[arm]);
  const record: {
    seed: number;
    corpDeck: string;
    runnerDeck: string;
    winner: string | null;
    cr: number[];
    sc: number[];
  }[] = JSON.parse(
    readFileSync("scripts/stage-d/post-pick-deals.json", "utf8"),
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
    ...humans.map((f) => ({ kind: "human" as const, id: f })),
    ...dealList.map((r) => ({ kind: "deal" as const, id: r })),
  ];

  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    const t0 = performance.now();
    const perSrc: Record<string, number> = {};
    let decisions = 0;
    // A3: per turn (number and side), the last board of that turn in the source
    const turnEnd = new Map<string, GameState>();
    const tk = (s: GameState) => `${s.turnNumber}:${s.activePlayer}`;
    const afterOf = (s: GameState) => () => {
      const e = turnEnd.get(tk(s));
      if (!e) return null;
      return {
        runs: (e.runsThisTurn ?? [])
          .slice(s.runsThisTurn.length)
          .map((r) => ({ server: r.server, in: !!r.successful })),
        stolen: e.runner.score - s.runner.score,
        thisRunIn: s.activeRun
          ? !!e.runsThisTurn?.[s.runsThisTurn.length - 1]?.successful
          : null,
      };
    };
    if (src.kind === "deal") {
      const rec = src.id as (typeof record)[number];
      const name = `deal:${rec.seed}`;
      const t = trees.source;
      t.clear();
      const ag = {
        corp: t.createAgent("corp", "normal"),
        runner: t.createAgent("runner", "normal"),
      };
      const g = new t.GameRunner(dealState(rec.seed), ag);
      const cr: number[] = [];
      const sc: number[] = [];
      let lastTurn = -1;
      const decs: Dec[] = [];
      for (let n = 0; n < 4000; n++) {
        const s: GameState = g.state;
        if (s.turnNumber !== lastTurn && s.activePlayer === "corp") {
          cr.push(s.corp.credits);
          sc.push(s.corp.score);
          lastTurn = s.turnNumber;
        }
        const dec = decisionOf(t.core, s);
        const copy = dec ? structuredClone(s) : null;
        const snaps = dec
          ? { corp: snapAgent(ag.corp), runner: snapAgent(ag.runner) }
          : undefined;
        if (!g.step()) break;
        turnEnd.set(
          tk(s),
          g.state.turnNumber === s.turnNumber &&
            g.state.activePlayer === s.activePlayer
            ? g.state
            : s,
        );
        if (g.state.winner) turnEnd.set(tk(s), g.state);
        if (dec && copy)
          decs.push({
            src: name,
            kind: "self",
            who: "ai",
            i: decs.length,
            s: copy,
            side: dec.side,
            cls: dec.cls,
            snaps,
            played: g.last ?? null,
            after: afterOf(copy),
          });
      }
      const matches =
        (g.state.winner ?? null) === rec.winner &&
        key(cr) === key(rec.cr) &&
        key(sc) === key(rec.sc);
      out({
        kind: "g",
        src: name,
        decks: `${rec.corpDeck} v ${rec.runnerDeck}`,
        winner: g.state.winner ?? null,
        T: g.state.turnNumber,
        cs: g.state.corp.score,
        rs: g.state.runner.score,
        matchesBatch: matches,
        ...(matches
          ? {}
          : { cr, sc, recCr: rec.cr, recSc: rec.sc, recWinner: rec.winner }),
        decisions: decs.length,
      });
      for (const d of decs) decide(d, perSrc);
      decisions = decs.length;
    } else {
      const file = join(hdir, src.id as string);
      const r = JSON.parse(readFileSync(file, "utf8"));
      const kind = r.config.ai === "corp" ? "humanRunner" : "humanCorp";
      const aiSide = r.config.ai === "corp" ? "corp" : "runner";
      const name = `human:${src.id}`;
      if (!r.moves?.length) continue;
      const core = trees.beta.core;
      let s: GameState;
      if (r.startsAt === "state") s = structuredClone(r.state);
      else {
        s = core.createInitialGameState(
          trees.beta.decks.deckGameSetup(
            r.config.seed,
            r.config.corpDeck,
            r.config.runnerDeck,
          ),
        );
        if (r.startStops) s = { ...s, stops: r.startStops };
      }
      // Replay once for the turn ends (A3), then again for the decisions
      let stopped: string | null = null;
      const boards: GameState[] = [];
      for (const [j, move] of (r.moves as GameAction[]).entries()) {
        boards.push(s);
        let next: GameState;
        try {
          next = core.executeAction(s, move);
        } catch (e) {
          stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
          break;
        }
        turnEnd.set(
          tk(s),
          next.turnNumber === s.turnNumber &&
            next.activePlayer === s.activePlayer
            ? next
            : s,
        );
        if (next.winner) turnEnd.set(tk(s), next);
        s = next;
      }
      for (const [j, b0] of boards.entries()) {
        const dec = decisionOf(core, {
          ...b0,
          stops: { corp: "ai", runner: "ai" },
        });
        if (!dec) continue;
        const copy = structuredClone(b0);
        decide(
          {
            src: `${name}#${j}`,
            kind,
            who: dec.side === aiSide ? "ai" : "person",
            i: decisions,
            s: copy,
            side: dec.side,
            cls: dec.cls,
            played: dec.side === aiSide ? r.moves[j] : undefined,
            after: afterOf(copy),
          },
          perSrc,
        );
        decisions++;
      }
      out({
        kind: "h",
        src: name,
        sk: kind,
        moves: r.moves.length,
        decisions,
        stopped,
      });
    }
    out({
      kind: "s",
      src: src.kind === "deal" ? `deal:${src.id.seed}` : `human:${src.id}`,
      ms: Math.round(performance.now() - t0),
      decisions,
      pairs: perSrc,
    });
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR))
    writeFileSync(join(process.env.OUT_DIR, "done"), "ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
