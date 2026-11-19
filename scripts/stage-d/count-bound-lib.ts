/**
 * The count bound item, step 1 (the count): shared trees and patches.
 * Brief: /mnt/project-files/netrunner-ai/stage-d/count-bound/brief.md. Scripts only; nothing under src/ changes.
 *
 * Trees are copies of this checkout's src/ (beta 872c6f8's src, unchanged on `ai-count-bound`), each loaded as its own
 * module graph (as make-room-fire.ts):
 *  - `base`, `control`: beta as it is (control is the second copy the time is read against, script rule row 69a);
 *  - `arm`: beta with `largestFirst` in hold.ts (ARM below; nothing else changes);
 *  - `instr`: beta with timers and counters (INSTR below; the answers are beta's, only measured), which also exports
 *    the search's pieces (`__cbx`) so a question can be searched again: beta's search, the arm's, and the brute force;
 *  - `source`: beta again, which plays the source games and is never asked or cleared mid-game (found row 71b).
 *
 * The timers are exclusive (a region's own time, its inner regions not counted), on a stack in globalThis.__cb.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const TREES = ['base', 'control', 'arm', 'instr', 'source', 'gm', 'cnt'] as const;
export type TreeName = (typeof TREES)[number];

// ------------------------------------------------------------------------------------------------ the timer hooks
export interface Split {
  [region: string]: number;
}
interface CbState {
  on: boolean;
  split: Split;
  stack: { name: string; t0: number; inner: number }[];
  walksOne: number;
  walksTurn: number;
  collect: { one: Map<string, number>; turn: Map<string, number> }[] | null;
  /** Searches of the decision: per searched question, its walk nodes, walks and kind. */
  searches: { key: string; holds: boolean; nodes: number; walksOne: number; walksTurn: number; ms: number }[];
  entriesNodes: number;
  /** Every question gathered (asked) in the decision, by key: the question object itself. */
  questions: Map<string, unknown>;
}
export const cb: CbState = { on: false, split: {}, stack: [], walksOne: 0, walksTurn: 0, collect: null, searches: [], entriesNodes: 0, questions: new Map() };

function T<R>(name: string, f: () => R): R {
  if (!cb.on) return f();
  const fr = { name, t0: performance.now(), inner: 0 };
  cb.stack.push(fr);
  try {
    return f();
  } finally {
    cb.stack.pop();
    const all = performance.now() - fr.t0;
    cb.split[name] = (cb.split[name] ?? 0) + all - fr.inner;
    const up = cb.stack[cb.stack.length - 1];
    if (up) up.inner += all;
  }
}
(globalThis as any).__cbT = T;
(globalThis as any).__cb = {
  memos(m: { one: Map<string, number>; turn: Map<string, number> }) {
    cb.collect?.push(m);
    return m;
  },
  walk(retries: boolean) {
    if (retries) cb.walksTurn++;
    else cb.walksOne++;
  },
  /** solveTurn of the instr tree: timed, its region named by its answer, its nodes and walks counted. */
  solve(q: unknown, key: string, solve: (q: unknown) => { holds: boolean }) {
    const prev = cb.collect;
    const w0 = [cb.walksOne, cb.walksTurn];
    cb.collect = [];
    const fr = { name: 'search', t0: performance.now(), inner: 0 };
    if (cb.on) cb.stack.push(fr);
    let a: { holds: boolean } | undefined;
    try {
      a = solve(q);
      return a;
    } finally {
      const all = performance.now() - fr.t0;
      if (cb.on) {
        cb.stack.pop();
        const name = a?.holds ? 'searchHolds' : 'searchOpen';
        cb.split[name] = (cb.split[name] ?? 0) + all - fr.inner;
        const up = cb.stack[cb.stack.length - 1];
        if (up) up.inner += all;
      }
      const nodes = cb.collect.reduce((n, m) => n + m.one.size + m.turn.size, 0);
      if (cb.on) cb.searches.push({ key, holds: !!a?.holds, nodes, walksOne: cb.walksOne - w0[0], walksTurn: cb.walksTurn - w0[1], ms: all });
      cb.collect = prev;
    }
  },
  /** sequenceEntries of the instr tree: its walk nodes added (the memos it grows or makes). */
  entries(a: { memos?: { one: Map<string, number>; turn: Map<string, number> } }, f: () => number) {
    const before = a.memos ? a.memos.one.size + a.memos.turn.size : 0;
    const prev = cb.collect;
    cb.collect = [];
    try {
      return T('entries', f);
    } finally {
      const made = cb.collect.reduce((n, m) => n + m.one.size + m.turn.size, 0);
      // a.memos is cleared by the reader after; read before: the reused memo's growth
      cb.entriesNodes += made + (a.memos ? a.memos.one.size + a.memos.turn.size - before : 0);
      cb.collect = prev;
    }
  },
  question(q: unknown, key: string) {
    if (cb.on && !cb.questions.has(key)) cb.questions.set(key, q);
  },
};

// ------------------------------------------------------------------------------------------------ the patches
type Patch = [string, string];

/** Rename `function NAME(` to NAME0 and put a timed wrapper of the same name before it. */
const wrap = (head: string, name: string, region: string, exported = false): Patch => {
  const fn = head.match(/function (\w+)\(/)![1];
  const params = head.slice(head.indexOf('(') + 1, head.lastIndexOf('):'));
  const args = params
    .split(/,(?![^<{]*[>}])/)
    .map(p => p.trim().split(/[?:= ]/)[0])
    .filter(Boolean);
  void name;
  return [head, `${exported ? 'export ' : ''}function ${fn}(${params}): any {\n  return (globalThis as any).__cbT('${region}', () => ${fn}0(${args.join(', ')}));\n}\n${head.replace(`function ${fn}(`, `function ${fn}0(`).replace(/^export /, '')}`];
};

/** solveTurn takes its memos (so the arm can hand on the ones it filled); beta's call is unchanged. */
const SOLVE_MEMOS: Patch = ['function solveTurn(q: TurnQuestion): TurnAnswer {\n  holdCacheStats.searched++;\n  const memos = walkMemos();', 'function solveTurn(q: TurnQuestion, memos = walkMemos()): TurnAnswer {\n  holdCacheStats.searched++;'];

/**
 * The arm `largestFirst` (brief B2): the maximal affordable sets (no affordable set strictly contains them) are walked
 * first, in beta's order (cheapest first, ties in mask order). If none holds, the answer is "does not hold" with no other
 * set walked: `set` is the maximal set with the greatest single-run need (ties: the first in that order, the cheaper),
 * `need` that need, its memos kept for `entries` (sequenceEntries reads `set`, as on beta). If one holds, the search goes
 * on as today (solveTurn from the cheapest set, the memos the maximal walks filled shared), so the answer is beta's.
 */
export const ARM_FN = `
/** The arm largestFirst (scripts/stage-d/count-bound-lib.ts ARM_FN; measuring only). */
export function solveLargest(q: TurnQuestion): TurnAnswer {
  const memos = walkMemos();
  const aff: number[] = [];
  for (let k = 0; k < q.sets.length; k++) if (q.sets[k].affordable) aff.push(k);
  let most = -Infinity;
  let mostSet = -1;
  for (const k of aff) {
    const m = q.sets[k].mask;
    if (aff.some(j => j !== k && (q.sets[j].mask & m) === m)) continue;
    const target = [setTarget(q, k)];
    const need = turnNeed(q, target, memos.one) + q.sets[k].price;
    if (need > q.budget && turnNeed(q, target, memos.turn, true) + q.sets[k].price > q.budget) return solveTurn(q, memos);
    if (need > most) [most, mostSet] = [need, k];
  }
  return { holds: false, set: mostSet < 0 ? q.sets.findIndex(x => x.mask === 0) : mostSet, need: most === -Infinity ? 0 : most, memos };
}
`;

const HOLD = 'ai/corp/hold.ts';
/**
 * The arm `gatherMemo` (brief B3: the gather before the cache key, which A's split shows costs more than the search):
 * a turn question is gathered once per board object and ask (valueModel's memo: the board's fingerprint and the pricing
 * context in its key, as turnIce and the walk's plans are already kept), and its key is worked out once per question
 * object. Nothing else changes: the same question, so the same answer.
 */
const GATHER_MEMO: Patch[] = [
  [
    'function turnQuestion(state: GameState, server: string, corpCredits: number, from: TurnFrom, picked?: string[]): TurnQuestion {',
    "function turnQuestion(state: GameState, server: string, corpCredits: number, from: TurnFrom, picked?: string[]): TurnQuestion {\n  return memo(state, `cbTurnQ:${server}|${corpCredits}|${from.rest ? 1 : 0}|${from.clicks}|${from.credits}|${picked ? picked.join(',') : '-'}`, () => turnQuestion0(state, server, corpCredits, from, picked));\n}\nconst cbKeys = new WeakMap<object, string>();\nconst cbKeyOf = (q: object): string => {\n  let k = cbKeys.get(q);\n  if (k === undefined) cbKeys.set(q, (k = questionKey(q)));\n  return k;\n};\nfunction turnQuestion0(state: GameState, server: string, corpCredits: number, from: TurnFrom, picked?: string[]): TurnQuestion {",
  ],
  ["  const key = cache ? questionKey(q) : '';\n", '  const key = cache ? cbKeyOf(q) : \'\';\n'],
];
/**
 * Step 2 (brief-2.md, Part E): the `cnt` tree counts the planner's work and the repeats within a decision by a board
 * fingerprint (count-bound-prof.ts defines globalThis.__cp; every hook only counts and returns the original result).
 */
const G = '(globalThis as any).__cp';
const CNT: Record<string, Patch[]> = {
  'core/engine/gameEngine.ts': [
    ['export function executeAction(prevState: GameState, action: GameAction): GameState {\n', `export function executeAction(prevState: GameState, action: GameAction): GameState {\n  return ${G}.exec(prevState, action, () => executeAction0(prevState, action));\n}\nfunction executeAction0(prevState: GameState, action: GameAction): GameState {\n`],
    ['  const cached = known.get(key);\n  if (cached !== undefined) return cached;\n', `  const cached = known.get(key);\n  ${G}.isLegal(state, key, cached !== undefined);\n  if (cached !== undefined) return cached;\n`],
  ],
  'core/engine/legalActions.ts': [['  bySide[side] ??= candidateActions(state, side)', `  ${G}.legal(state, side, !!bySide[side]);\n  bySide[side] ??= candidateActions(state, side)`]],
  'ai/turnPlanner.ts': [
    ["  tally('planner', 'decisions');\n", `  tally('planner', 'decisions');\n  ${G}.plan(candidates.length);\n`],
    ['export function playout(start: GameState, side: SideCode, first: GameAction, ai: PlannerAI, line: Line = [], ends?: Ends, mode: LineMode = \'rule\'): number {\n', `export function playout(start: GameState, side: SideCode, first: GameAction, ai: PlannerAI, line: Line = [], ends?: Ends, mode: LineMode = 'rule'): number {\n  ${G}.playout(start, first, mode);\n`],
    ['  const step = (state: GameState, action: GameAction): GameState | null => {\n', `  const step = (state: GameState, action: GameAction): GameState | null => {\n    ${G}.pstep();\n`],
    ['function leafValue(state: GameState, side: SideCode): number {\n  return ', `function leafValue(state: GameState, side: SideCode): number {\n  return ${G}.leaf(state, side, () => leafValue0(state, side));\n}\nfunction leafValue0(state: GameState, side: SideCode): number {\n  return `],
  ],
  'ai/runnerReply.ts': [
    ['      const gr = new GameRunner(guessHidden(end, k), {', `      ${G}.reply(end, k);\n      const gr = new GameRunner(guessHidden(end, k), {`],
    ['          if (!gr.step()) break;\n', `          ${G}.rstep();\n          if (!gr.step()) break;\n`],
  ],
  'ai/corpAI.ts': [
    ["  rankMainActions(state: GameState, legal = getLegalActions(state, 'corp'), held: CorpMemory['heldLine'] = this.memory.heldLine): ScoredAction[] {\n", `  rankMainActions(state: GameState, legal = getLegalActions(state, 'corp'), held: CorpMemory['heldLine'] = this.memory.heldLine): ScoredAction[] {\n    return ${G}.rank(state, held, () => this.rankMainActions0(state, legal, held));\n  }\n  rankMainActions0(state: GameState, legal: GameAction[], held: CorpMemory['heldLine']): ScoredAction[] {\n`],
  ],
  'ai/runnerAI.ts': [['  chooseAction(state: GameState): GameAction {\n    return asSide(', `  chooseAction(state: GameState): GameAction {\n    return ${G}.runner(state, () => this.chooseAction0(state));\n  }\n  chooseAction0(state: GameState): GameAction {\n    return asSide(`]],
};
const PATCHES: Record<string, Record<string, Patch[]>> = {
  cnt: CNT,
  gm: { [HOLD]: GATHER_MEMO },
  arm: {
    [HOLD]: [SOLVE_MEMOS, ['    a = solveTurn(q);\n', '    a = solveLargest(q);\n']],
  },
  instr: {
    [HOLD]: [
      SOLVE_MEMOS,
      wrap('function turnQuestion(state: GameState, server: string, corpCredits: number, from: TurnFrom, picked?: string[]): TurnQuestion {', 'turnQuestion', 'gather'),
      // The gather's parts (exclusive time; runTarget and walkBoard serve the reach questions too)
      wrap('export function runTarget(state: GameState, base: WalkIce[], server: string, set: Set<string>, clicks = state.runner.maxClicks): { target: WalkTarget; price: number } {', 'runTarget', 'g.runTarget', true),
      wrap('export function walkBoard(state: GameState, start: WalkStart, targets: WalkTarget[]): WalkBoard {', 'walkBoard', 'g.walkBoard', true),
      wrap('export function walkStart(state: GameState, runnerTurn: boolean, fresh = runnerTurn, picked?: string[]): WalkStart {', 'walkStart', 'g.walkStart', true),
      wrap('function turnIce(state: GameState, start: WalkStart, server: string): WalkIce[] {', 'turnIce', 'g.turnIce'),
      wrap('export function turnEndDerezPicks(state: GameState, servers?: string[]): string[][] {', 'turnEndDerezPicks', 'g.picks', true),
      ['const walkMemos = (): WalkMemos => ({ one: new Map(), turn: new Map() });', 'const walkMemos = (): WalkMemos => (globalThis as any).__cb.memos({ one: new Map(), turn: new Map() });'],
      ['function turnNeed(input: TurnInput, targets: SearchTarget[], memo?: Map<string, number>, retries = false): number {\n', 'function turnNeed(input: TurnInput, targets: SearchTarget[], memo?: Map<string, number>, retries = false): number {\n  (globalThis as any).__cb.walk(retries);\n'],
      ['  const key = cache ? questionKey(q) : \'\';\n  let a = cache?.get(key);\n  if (!a) {\n    a = solveTurn(q);\n', "  const key = (globalThis as any).__cbT('key', () => questionKey(q));\n  (globalThis as any).__cb.question(q, key);\n  let a = cache?.get(key);\n  if (!a) {\n    a = (globalThis as any).__cb.solve(q, key, solveTurn);\n"],
      ['        answer.entries = sequenceEntries(q, answer);\n', "        answer.entries = (globalThis as any).__cb.entries(answer, () => sequenceEntries(q, answer));\n"],
      ["  return solveRun(runQuestion(state, server, opts));\n}", "  return (globalThis as any).__cbT('thisRun', () => solveRun(runQuestion(state, server, opts)));\n}"],
      ["        v = qs.some(q => solveRun(q).holds) ? 'out' : 'in';\n", "        v = (globalThis as any).__cbT('runStands', () => (qs.some(q => solveRun(q).holds) ? 'out' : 'in'));\n"],
      wrap('export function runStands(state: GameState, server: string): RunStand | null {', 'runStands', 'runStands', true),
      wrap('export function reachQuestion(state: GameState, servers: string[], from: TurnFrom = nextTurn(state)): ReachQuestion {', 'reachQuestion', 'reach', true),
      [
        'function reachSetsOf(q: ReachQuestion): (set: string[]) => boolean {\n',
        "function reachSetsOf(q: ReachQuestion): (set: string[]) => boolean {\n  const f = (globalThis as any).__cbT('reach', () => reachSetsOf0(q));\n  return (set: string[]) => (globalThis as any).__cbT('reach', () => f(set));\n}\nfunction reachSetsOf0(q: ReachQuestion): (set: string[]) => boolean {\n",
      ],
    ],
  },
};
/** Appended to hold.ts in both changed trees (the instr tree exports the pieces a question's searches use). */
const APPEND: Record<string, string> = {
  arm: ARM_FN,
  instr: `${ARM_FN}\nexport const __cbx = { solveTurn, solveLargest, setTarget, turnNeed, sequenceEntries, walkMemos, questionKey };\n`,
};

export function makeTrees(rootDir: string, names: readonly TreeName[] = TREES): Record<string, string> {
  const root = resolve(rootDir);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  for (const t of names) {
    const dir = join(root, t);
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    for (const [f, list] of Object.entries(PATCHES[t] ?? {})) {
      const path = join(dir, 'src', f);
      let text = readFileSync(path, 'utf8');
      for (const [at, to] of list) {
        if (text.split(at).length !== 2) throw new Error(`tree ${t}: a patch does not match once in ${f}: ${at.slice(0, 80)}`);
        text = text.replace(at, () => to);
      }
      if (APPEND[t]) text += APPEND[t];
      writeFileSync(path, text);
    }
    if (!PATCHES[t] && APPEND[t]) writeFileSync(join(dir, 'src', HOLD), readFileSync(join(dir, 'src', HOLD), 'utf8') + APPEND[t]);
    dirs[t] = dir;
  }
  return dirs;
}

export interface Tree {
  name: string;
  createAgent: (side: string, level: string) => any;
  GameRunner: any;
  rezCandidates: (s: any, step: string) => any[];
  core: any;
  hold: any;
  asSide: (side: string, f: () => unknown) => unknown;
  decisionContext: (s: any, side: string) => void;
  decks: any;
  clear: () => void;
}

export async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts', 'ai/corp/hold.ts', 'ai/pricing.ts', 'data/decks.ts']) mods.push(await m(p));
  const [ai, po, core, hv, ev, vm, iv, hold, pricing, decks] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    rezCandidates: po.rezCandidates,
    core,
    hold,
    asSide: pricing.asSide,
    decisionContext: hv.decisionContext,
    decks,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}

export const r1 = (x: number) => Math.round(x * 10) / 10;
export const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
export const key = (a: unknown) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a as object).sort())) : 'null');

/** What GameRunner.step would ask at `s` (stops forced to 'ai' as the GameRunner does): the side, method and args. */
export function askAt(t: Tree, s0: any): { side: string; fn: string; args: unknown[] } | null {
  const s = { ...s0, stops: { corp: 'ai', runner: 'ai' } };
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

/** A fresh Normal agent of the tree answers the ask on its own clone, timed. */
export function ask(t: Tree, q: { side: string; fn: string; args: unknown[] }): { a: string; ms: number } {
  t.clear();
  const agent = t.createAgent(q.side, 'normal');
  const args = structuredClone(q.args);
  const at = performance.now();
  try {
    return { a: key(agent[q.fn](...args)), ms: performance.now() - at };
  } catch (e) {
    return { a: `error: ${(e as Error).message.slice(0, 80)}`, ms: performance.now() - at };
  }
}

/** The instr tree's ask with its split, searches and questions recorded. */
export function askInstr(t: Tree, q: { side: string; fn: string; args: unknown[] }) {
  cb.on = true;
  cb.split = {};
  cb.stack = [];
  cb.searches = [];
  cb.entriesNodes = 0;
  cb.questions = new Map();
  const h0 = { ...t.hold.holdCacheStats };
  const r0 = { ...t.hold.runStandStats };
  try {
    const r = ask(t, q);
    const inHold = Object.values(cb.split).reduce((a, b) => a + b, 0);
    return {
      ...r,
      split: { ...cb.split, outside: Math.max(0, r.ms - inHold) },
      asked: t.hold.holdCacheStats.asked - h0.asked,
      searched: t.hold.holdCacheStats.searched - h0.searched,
      runStands: t.hold.runStandStats.asked - r0.asked,
      searches: cb.searches,
      entriesNodes: cb.entriesNodes,
      questions: cb.questions,
    };
  } finally {
    cb.on = false;
  }
}

// ------------------------------------------------------------------------------------------------ one question's searches
export interface SetRow {
  k: number;
  mask: number;
  rez: number;
  need: number;
  holds: boolean;
}
/**
 * A question searched three ways on the instr tree (each with its own memos): beta's search, the arm's, and the brute
 * force (every affordable set walked, no early stop: each set's single-run need and whether it holds, as beta decides
 * "holds": the retry walk only where a single run falls short). Then the violations of B1 among comparable sets.
 */
export function searchQuestion(t: Tree, q: any) {
  const x = t.hold.__cbx;
  const timed = <R>(f: () => R) => {
    const prev = cb.collect;
    cb.collect = [];
    const w0 = [cb.walksOne, cb.walksTurn];
    const t0 = performance.now();
    const out = f();
    const ms = performance.now() - t0;
    const nodes = cb.collect.reduce((n, m) => n + m.one.size + m.turn.size, 0);
    const walks = [cb.walksOne - w0[0], cb.walksTurn - w0[1]];
    cb.collect = prev;
    return { out, ms, nodes, walks };
  };
  const answer = (solve: (q: any) => any) => {
    const s = timed(() => solve(q));
    const a = s.out;
    const e = a.holds ? { out: 0, ms: 0, nodes: 0, walks: [0, 0] } : timed(() => x.sequenceEntries(q, a));
    const rez = q.sets[a.set]?.mask ?? -1;
    return { holds: a.holds, mask: rez, rezCost: q.sets[a.set]?.rez, need: a.need, entries: e.out, ms: r1(s.ms), entriesMs: r1(e.ms), nodes: s.nodes, entriesNodes: e.nodes, walks: s.walks };
  };
  const beta = answer(x.solveTurn);
  const arm = answer(x.solveLargest);
  // The arm with beta's tie fill (a variant of B2's fill, answers only): on "does not hold", the sets below the maximal
  // ones walked single-run in beta's order up to the first whose need reaches the maximal sets' most (beta's set when
  // the need never falls as ice is added)
  const armTie = answer((qq: any) => {
    const a = x.solveLargest(qq);
    if (a.holds) return a;
    for (let k = 0; k < qq.sets.length; k++) {
      if (!qq.sets[k].affordable) continue;
      if (k === a.set) return a;
      const need = x.turnNeed(qq, [x.setTarget(qq, k)], a.memos.one) + qq.sets[k].price;
      if (need >= a.need) return { ...a, set: k, need };
    }
    return a;
  });
  const b = timed(() => {
    const memos = x.walkMemos();
    const rows: SetRow[] = [];
    for (let k = 0; k < q.sets.length; k++) {
      const st = q.sets[k];
      if (!st.affordable) continue;
      const target = [x.setTarget(q, k)];
      const need = x.turnNeed(q, target, memos.one) + st.price;
      const holds = need > q.budget && x.turnNeed(q, target, memos.turn, true) + st.price > q.budget;
      rows.push({ k, mask: st.mask, rez: st.rez, need, holds });
    }
    return rows;
  });
  const rows = b.out;
  // Beta's answer as the brute force reads it: the first set that holds, else the first with the greatest need
  const first = rows.find(r => r.holds);
  let most: SetRow | undefined;
  for (const r of rows) if (!most || r.need > most.need) most = r;
  const bruteBeta = first ? { holds: true, mask: first.mask, need: first.need } : { holds: false, mask: most?.mask ?? 0, need: most?.need ?? 0 };
  // B1: pairs S strictly inside T (both affordable)
  const v1: [number, number][] = [];
  const v2: [number, number, number, number][] = [];
  for (const s of rows)
    for (const tt of rows) {
      if (s === tt || (tt.mask & s.mask) !== s.mask) continue;
      if (s.holds && !tt.holds) v1.push([s.mask, tt.mask]);
      if (s.need > tt.need) v2.push([s.mask, tt.mask, s.need, tt.need]);
    }
  const aff = rows.map(r => r.mask);
  const maximal = rows.filter(r => !aff.some(m => m !== r.mask && (m & r.mask) === r.mask));
  const unrezzed = q.ice.filter((c: any) => !c.rezzed).length;
  return {
    facts: { server: q.server, ice: q.ice.length, unrezzed, sets: q.sets.length, affordable: rows.length, maximal: maximal.length, rig: q.board.rig.length, budget: q.budget, clicks: q.maxClicks, corp: q.first.corp },
    beta,
    arm,
    armTie,
    cls: questionClass(q),
    brute: { ms: r1(b.ms), nodes: b.nodes, holdsSets: rows.filter(r => r.holds).length, answer: bruteBeta, agrees: bruteBeta.holds === beta.holds && bruteBeta.mask === beta.mask && bruteBeta.need === beta.need },
    v1,
    v2,
    rows,
  };
}

/** The ice of a question by index, as the B1 classes read them (what each fact of an added ice is). */
export function iceFacts(q: any) {
  return q.ice.map((c: any, i: number) => ({
    i,
    id: c.id,
    rezzed: c.rezzed,
    rezCost: c.rezCost,
    saci: c.rezPays?.length ? c.rezPays : undefined,
    liability: c.liability || undefined,
    rezFacts: c.rezFacts,
    rezGains: c.rezGains ? true : undefined,
    choices: c.choices ? c.choices.length : undefined,
    encounter: c.encounterFacts ? Object.keys(c.encounterFacts) : undefined,
    bioroid: c.bioroid || undefined,
    subs: c.subs.map((f: any) => f.does.map((e: any) => e.kind).join('+') + (f.orEndRun ? '|or-etr' : '') + (f.when ? `|when:${f.when.kind}` : '')),
  }));
}

/**
 * A question whose walk reads the Corp's credits in a condition (Valentão: "End the run if the Corp has more credits than
 * the Runner"): any fact of its ice (subroutines, a gained subroutine, encounter facts) or of the ice it may borrow from
 * (the lenders) names the Corp's credits. A rez spends them (Walk.approach: ws.corp), so a larger set can weaken it.
 */
export function readsCorpCredits(q: any): boolean {
  const facts = JSON.stringify([q.ice.map((c: any) => [c.subs, c.rezGains ?? null, c.encounterFacts ?? null]), q.board.lenders]);
  return /corpCredits(MoreThan|AtLeast|AtMost|LessThan)/.test(facts);
}
/** The question's facts that B1 found can make a larger rez set weaker (one answer per question). */
export function questionClass(q: any): string[] {
  const out: string[] = [];
  if (q.ice.some((c: any) => !c.rezzed && c.rezPays?.length)) out.push('saci');
  if (readsCorpCredits(q)) out.push('corpCredits');
  return out;
}

/** The added ice T\S and the features that could break monotonicity, for a B1 pair. */
export function pairCause(q: any, s: number, t: number, rowsByMask: Map<number, SetRow>) {
  const added = q.ice.map((c: any, i: number) => ({ c, i })).filter(({ i }: { i: number }) => t & (1 << i) && !(s & (1 << i)));
  const causes = new Set<string>();
  const ks = rowsByMask.get(s)!.k;
  const kt = rowsByMask.get(t)!.k;
  const ss = q.sets[ks];
  const st = q.sets[kt];
  if (ss.price !== st.price) causes.add(`bypass price ${ss.price}->${st.price}`);
  if ((ss.bypassed & ~st.bypassed) !== 0) causes.add('a bypass of S lost in T');
  if ((st.bypassed & ~ss.bypassed) !== 0) causes.add('a bypass gained in T');
  for (const { c } of added) {
    if (c.rezPays?.length) causes.add('Saci (rez pays the Runner)');
    if (c.liability) causes.add('liability rez (bad publicity or a tag)');
    if (c.rezFacts?.purgeVirus) causes.add('rez purges virus');
    if (c.rezFacts?.tags) causes.add('rez gives tags');
    if (c.rezFacts?.corpMayTrashInstalled) causes.add('rez trashes a trojan');
    if (c.choices) causes.add('rez chooses subtypes (Lycian)');
    if (c.rezGains) causes.add('rez gains a subroutine');
    if (c.rezCost === 0) causes.add('rez for 0');
    if (c.subs.some((f: any) => f.does.some((e: any) => e.kind === 'trashThisIce'))) causes.add('ice trashes itself');
    if (c.subs.some((f: any) => f.does.some((e: any) => e.kind === 'borrow'))) causes.add('ice borrows');
  }
  if (readsCorpCredits(q)) causes.add("a condition reads the Corp's credits (a rez spends them)");
  if (!causes.size) causes.add('none of the named facts');
  return { added: added.map(({ c }: any) => c.id), causes: [...causes] };
}

export const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
