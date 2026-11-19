/**
 * Stage D exploit F3 (the bait run), count step (brief /mnt/project-files/netrunner-ai/stage-d/bait-run/brief.md): the
 * trees. A tree is a copy of this checkout's src/ (beta ad54114) with text patches, loaded as its own module graph (as
 * prompt-chain-trees.ts). Every tree gets the RECORD patch, which only writes globals the script reads, and the world
 * functions (`__worlds`, `__outOverTurn`), which only the arms' conditions and the untimed measuring asks call.
 *
 * RECORD (top level only: the deciding Corp's own rez window, corpAI.ts chooseRez with the planner on, and its own prompt
 * answer, corp/core.ts Q0; never the look-ahead's, the playouts' or a nested ask):
 *  - countedRez: each call's answer and the rule that gave it (`MPrez`, `MPpass`, `R5`, `bypass`, `R2`, `R3s`, `R3t`,
 *    `R4s`, `R4t`, or null), and with `__brMeasure` (an untimed extra ask on the beta tree) both worlds of A1 at the
 *    stop rules (R2, R3s, R4s, MPrez);
 *  - runAnswer (the run term): when it prices (the answers separate "in" and "out"), each answer's verdict, price,
 *    loss charged and, with `__brMeasure`, the settled board's rest-of-turn hold for every "out" answer (A2).
 *  - arm fire counts (`__brFire`), inside the look-ahead too.
 *
 * The worlds (A1; the arm stopOverTurn reads the same function, so the count and the arm cannot differ):
 *  - rez world: this ice rezzed with the cheapest set the 'thisRun' count stops this run with (mustRez this ice; with
 *    no further rezzes first, then with the set further in as R2's rezStops counts it), the run over (activeRun null),
 *    the Corp's credits after that set's rez cost, the Runner's credits and clicks as they are now (the run's click is
 *    paid; the credits it would still spend before the run ends are not taken: toward the Runner, "does not hold");
 *  - pass world: this ice left unrezzed; the run goes on against the ice further in: the 'thisRun' count without this
 *    ice (mustRez none, further rezzes allowed); if a set stops it, that set rezzed, the Corp's credits after its cost,
 *    the run over, the Runner's credits as now; if none stops it, the Runner gets in on this run: the board with the
 *    run over and the Corp's credits as now, and the run's own server counted as not held;
 *  - each world's rest of the turn: rezMoney's keep with `restOfTurn` (the hold owner's 'restOfTurn' walk: the Runner's
 *    clicks left, retries on, the Corp's money unbounded for byServer, keepFor's run sequence), the run's own server
 *    INCLUDED (no `except`); "holds" = the run's own server is in byServer (some rez set holds it) and the world's Corp
 *    credits pay the keep.
 *  - arm stopOverTurn (spendsKept's question, asked for a stop, the run's own server included): with the Runner's
 *    clicks left after this run, the stop rez is passed when (1) the rez world's credits do not pay its keep, (2) every
 *    server of the rez world's byServer is in the pass world's (the pass world holds every server the rez world could),
 *    and (3) the pass world's credits pay its keep. Otherwise the rez is made as on beta. Asked at R2, R3s and R4s.
 *  - arm outOverTurn (the run term): an answer the walk reads "out" is charged runLoss as "in" is, unless the server holds
 *    through the rest of the turn on its settled board (the same run's Corp follow-ups answered with today's answers,
 *    depth 3 as settledStand; the run over; serverHold 'restOfTurn' with the Corp's and the Runner's credits there), or
 *    the Runner has no click left there.
 *  - both: the two together.
 *  - stopLiteral (my narrower arm, from the first run's changed decisions): stopOverTurn with the brief's class as the
 *    condition: the stop rez is passed only when the rez world does not hold and the pass world does (both by the
 *    `holds` above: the run's own server held and the keep paid). spendsKept's condition (2) is vacuous when the run's
 *    own server is unholdable in the rez world, so stopOverTurn passes a stop that lets the Runner in on this run
 *    (human report-23 #79; door B); this arm does not.
 *  - outSettled (my narrower-than-a-new-term arm, from the door C trace): outOverTurn, and an "out" answer it charges is
 *    priced on its settled board (runPrice of the board the settle reached: Anoetic Void's 2 credits and 2 HQ cards
 *    paid) instead of the one-step board. Without it a charged "yes" and a charged "no" tie on the one-step price
 *    (found row 59's cause) and today's "yes" stands.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ARMS = ['beta', 'control', 'source', 'stopOverTurn', 'outOverTurn', 'both', 'outSettled'] as const;
export type Arm = (typeof ARMS)[number];
export const BAIT_ARMS: Arm[] = ['stopOverTurn', 'outOverTurn', 'both', 'outSettled'];

type Patch = [file: string, at: string, to: string];

function patches(arm: Arm): Patch[] {
  const STOP = arm === 'stopOverTurn' || arm === 'both' || arm === 'stopLiteral';
  const LITERAL = arm === 'stopLiteral';
  const OUT = arm === 'outOverTurn' || arm === 'both' || arm === 'outSettled';
  const SETTLED = arm === 'outSettled';
  return [
    // ---- answerPrompt: the top-level flag (as prompt-chain-trees.ts)
    [
      'ai/prompts.ts',
      `export function answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {`,
      `export function answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {
  const __G = globalThis as any;
  const __top = !!__G.__brTopNext;
  __G.__brTopNext = false;
  const __was = __G.__brPTop;
  __G.__brPTop = __top;
  try {
    return __answerPrompt(state, side, memory, synergy);
  } finally {
    __G.__brPTop = __was;
  }
}

function __answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {`,
    ],
    // ---- the run term: record, and the arm outOverTurn
    [
      'ai/prompts.ts',
      `  const priced = outs.map((o, k) => runPrice(state, prompt, o.action, o.after, memory, synergy) - (verdicts[k] === 'in' ? loss : 0));`,
      `  const __G = globalThis as any;
  const __top = !!__G.__brPTop && !!__G.__brArm;
  const __arm = ${OUT} && !__G.__brSettling;
  const __ot = __arm || (__top && __G.__brMeasure) ? outs.map((o, k) => (verdicts[k] === 'out' ? __outOverTurn(o.after, run.server, synergy) : null)) : null;
  const __charged = outs.map((_, k) => verdicts[k] === 'in' || (__arm && !!__ot?.[k] && !__ot[k]!.holds));
  if (__arm && __charged.some((c, k) => c && verdicts[k] === 'out')) __G.__brFire = { ...(__G.__brFire ?? {}), out: (__G.__brFire?.out ?? 0) + 1 };
  const __settledAt = (k: number) => (${SETTLED} && __arm && __charged[k] && verdicts[k] === 'out' && __ot?.[k] ? __ot[k]!.board : outs[k].after);
  const priced = outs.map((o, k) => runPrice(state, prompt, o.action, __settledAt(k), memory, synergy) - (__charged[k] ? loss : 0));
  if (__top) {
    __G.__brRun = { server: run.server, loss, clicks: state.runner.clicks, opts: outs.map((o, k) => ({ a: o.action, v: verdicts[k], price: priced[k], charged: __charged[k], ot: __ot?.[k] ? { ...__ot[k], board: undefined } : null })) };
  }`,
    ],
    [
      'ai/prompts.ts',
      `/** The expected loss of \`x\` cards of HQ at random`,
      `/**
 * BAIT-RUN (count step): the rest of the Runner's turn on an "out" answer's settled board (see bait-run-trees.ts). The
 * same run's Corp follow-ups answered with today's answers (depth 3), the run over, serverHold 'restOfTurn' with the
 * board's credits both sides. No click left: holds (nothing more this turn).
 */
function __outOverTurn(after: GameState, server: string, synergy: boolean): { holds: boolean; clicks: number; cr: number; rcr: number; hq: number; settled: number; board: GameState } {
  const G = globalThis as any;
  let board = after;
  let settled = 0;
  const was = G.__brSettling;
  G.__brSettling = true;
  try {
    for (; settled < 3; settled++) {
      const p = activePrompt(board);
      if (!p || p.side !== 'corp' || board.activeRun?.server !== server || board.winner) break;
      const next = simulate(board, answerPrompt(board, 'corp', undefined, synergy));
      if (!next) break;
      board = next;
    }
  } finally {
    G.__brSettling = was;
  }
  const out = { clicks: board.runner.clicks, cr: board.corp.credits, rcr: board.runner.credits, hq: board.corp.hq.length, settled, board };
  if (board.winner) return { holds: board.winner === 'corp', ...out };
  if (board.runner.clicks <= 0 || board.activePlayer !== 'runner') return { holds: true, ...out };
  const h = __serverHold({ ...board, activeRun: null }, server, { when: 'restOfTurn', corpCredits: board.corp.credits, runnerCredits: board.runner.credits });
  return { holds: h.holds, ...out };
}

/** The expected loss of \`x\` cards of HQ at random`,
    ],
    [
      'ai/prompts.ts',
      `import { SHRED_STEP } from '../core/engine/runEnd';`,
      `import { SHRED_STEP } from '../core/engine/runEnd';
import { serverHold as __serverHold } from './corp/hold';`,
    ],
    // ---- the deciding Corp's own prompt answer and rez window
    [
      'ai/corp/core.ts',
      `  if (activePrompt(view)) return { action: answerPrompt(view, 'corp', undefined, ctx.synergy), note: false };`,
      `  if (activePrompt(view)) {
    if (ctx.counted) (globalThis as any).__brTopNext = true;
    return { action: answerPrompt(view, 'corp', undefined, ctx.synergy), note: false };
  }`,
    ],
    [
      'ai/corpAI.ts',
      `      const action = decideRez(view, cards, this.synergy);
      if (view === state || !action || isLegalAction(state, action)) return action;`,
      `      const __was = (globalThis as any).__brRTop;
      (globalThis as any).__brRTop = this.planner;
      let action: GameAction | null;
      try {
        action = decideRez(view, cards, this.synergy);
      } finally {
        (globalThis as any).__brRTop = __was;
      }
      if (view === state || !action || isLegalAction(state, action)) return action;`,
    ],
    // ---- decideRez: the top flag reaches only its own countedRez calls (never modelRezGain's playouts)
    [
      'ai/corp/rez.ts',
      `  const importance = serverImportance(state, server, synergy);
  let best: { card: CardInstance; score: number } | null = null;`,
      `  const importance = serverImportance(state, server, synergy);
  const __G = globalThis as any;
  const __top = !!__G.__brRTop;
  __G.__brRTop = false;
  let best: { card: CardInstance; score: number } | null = null;`,
    ],
    [
      'ai/corp/rez.ts',
      `      const call = countedRez(state, card);`,
      `      __G.__brRTop = __top;
      const call = countedRez(state, card);
      __G.__brRTop = false;`,
    ],
    // ---- countedRez: record the rule, and the arm stopOverTurn
    [
      'ai/corp/rez.ts',
      `export function countedRez(state: GameState, ice: CardInstance): 'rez' | 'pass' | null {
  const run = state.activeRun;`,
      `export function countedRez(state: GameState, ice: CardInstance): 'rez' | 'pass' | null {
  const G = globalThis as any;
  const was = G.__brRTop;
  const top = !!was && !!G.__brArm;
  G.__brRTop = false;
  G.__brRule = null;
  G.__brArmed = null;
  try {
    const r = __countedRez(state, ice);
    if (top) {
      const rule = G.__brRule as string | null;
      const rec: any = { ice: ice.instanceId, title: cardDef(ice).title, r, rule, armed: G.__brArmed, clicks: state.runner.clicks, cr: state.corp.credits, rcr: state.runner.credits, server: state.activeRun?.server ?? null };
      if (G.__brMeasure && rule && ['R2', 'R3s', 'R4s', 'MPrez'].includes(rule)) rec.worlds = __worlds(state, ice);
      (G.__brRez ??= []).push(rec);
    }
    return r;
  } finally {
    G.__brRTop = was;
  }
}

function __countedRez(state: GameState, ice: CardInstance): 'rez' | 'pass' | null {
  const G = globalThis as any;
  const run = state.activeRun;`,
    ],
    [
      'ai/corp/rez.ts',
      `  if (atMatch) return atMatch;`,
      `  if (atMatch) {
    G.__brRule = atMatch === 'rez' ? 'MPrez' : 'MPpass';
    return atMatch;
  }`,
    ],
    [
      'ai/corp/rez.ts',
      `  if (run.server === 'archives' && !archivesWantsIce(state)) return 'pass';`,
      `  if (run.server === 'archives' && !archivesWantsIce(state)) {
    G.__brRule = 'R5';
    return 'pass';
  }`,
    ],
    [
      'ai/corp/rez.ts',
      `  if (server.root.some(isAgenda) && rezStops(state, ice, true)) return 'rez';`,
      `  if (server.root.some(isAgenda) && rezStops(state, ice, true)) {
    G.__brRule = 'R2';
    return __stopKept(state, ice, 'R2') ? 'pass' : 'rez';
  }`,
    ],
    [
      'ai/corp/rez.ts',
      `  if (run.server === 'hq' && hqAgendas > 0) return stops || !spendsKept(state, ice) ? 'rez' : 'pass';`,
      `  if (run.server === 'hq' && hqAgendas > 0) {
    G.__brRule = stops ? 'R3s' : 'R3t';
    if (stops) return __stopKept(state, ice, 'R3s') ? 'pass' : 'rez';
    return !spendsKept(state, ice) ? 'rez' : 'pass';
  }`,
    ],
    [
      'ai/corp/rez.ts',
      `  if (run.server === 'rd' && hqAgendas === 0 && agendasUnseen(state) > 0) return stops || !spendsKept(state, ice) ? 'rez' : 'pass';`,
      `  if (run.server === 'rd' && hqAgendas === 0 && agendasUnseen(state) > 0) {
    G.__brRule = stops ? 'R4s' : 'R4t';
    if (stops) return __stopKept(state, ice, 'R4s') ? 'pass' : 'rez';
    return !spendsKept(state, ice) ? 'rez' : 'pass';
  }`,
    ],
    [
      'ai/corp/rez.ts',
      `/** The Runner wins with 7 or more agenda points in its score area (rules 1.7.2a). */`,
      `/** BAIT-RUN: a world of A1 (see bait-run-trees.ts): its board's Corp credits, keep, byServer and whether it holds. */
interface __World {
  set: string[];
  cost: number;
  cr: number;
  keep: number;
  byServer: Record<string, number>;
  unholdable: string[];
  ownIn: boolean;
  holds: boolean;
  thisRunIn?: boolean;
}

function __board(state: GameState, server: string, ids: string[], credits: number): GameState {
  const sv = state.corp.servers[server];
  return {
    ...state,
    activeRun: null,
    corp: { ...state.corp, credits, servers: { ...state.corp.servers, [server]: { ...sv, ice: sv.ice.map(c => (ids.includes(c.instanceId) ? { ...c, isRezzed: true } : c)) } } },
  };
}

function __world(state: GameState, server: string, ids: string[], cost: number, thisRunIn: boolean): __World {
  const board = __board(state, server, ids, state.corp.credits - cost);
  const m = rezMoney(board, { restOfTurn: { runnerCredits: state.runner.credits }, ...(thisRunIn ? { except: server } : {}) });
  const ownIn = !thisRunIn && server in m.byServer;
  return { set: ids, cost, cr: board.corp.credits, keep: m.keep, byServer: m.byServer, unholdable: m.unholdable, ownIn, holds: ownIn && board.corp.credits >= m.keep, ...(thisRunIn ? { thisRunIn } : {}) };
}

/** BAIT-RUN: both worlds of A1 at a stop rez (null when the rez does not stop this run by the count). */
export function __worlds(state: GameState, ice: CardInstance): { rez: __World; pass: __World; clicks: number; passes: boolean } | null {
  const run = state.activeRun;
  if (!run) return null;
  let hr = serverHold(state, run.server, { when: 'thisRun', mustRez: [ice.instanceId], further: false });
  if (!hr.holds) hr = serverHold(state, run.server, { when: 'thisRun', mustRez: [ice.instanceId], further: true });
  if (!hr.holds || !hr.rez) return null;
  const rez = __world(state, run.server, hr.rez, hr.rezCost, false);
  const hp = serverHold(state, run.server, { when: 'thisRun', mustRez: [], further: true });
  const pass = hp.holds && hp.rez ? __world(state, run.server, hp.rez, hp.rezCost, false) : __world(state, run.server, [], 0, true);
  // spendsKept's three conditions, the run's own server included
  const passes = rez.cr < rez.keep && Object.keys(rez.byServer).every(id => id in pass.byServer) && pass.cr >= pass.keep;
  return { rez, pass, clicks: state.runner.clicks, passes };
}

/** BAIT-RUN arm stopOverTurn: true when the stop rez is passed (the Runner has clicks left after this run and __worlds passes). */
function __stopKept(state: GameState, ice: CardInstance, rule: string): boolean {
  if (!${STOP} || state.runner.clicks <= 0) return false;
  const G = globalThis as any;
  const w = __worlds(state, ice);
  // stopLiteral: the brief's class itself (the rez world does not hold, the pass world does)
  const passes = ${LITERAL} ? !!w && !w.rez.holds && w.pass.holds : !!w?.passes;
  G.__brArmed = passes;
  if (passes) G.__brFire = { ...(G.__brFire ?? {}), [rule]: (G.__brFire?.[rule] ?? 0) + 1 };
  return passes;
}

/** The Runner wins with 7 or more agenda points in its score area (rules 1.7.2a). */`,
    ],
  ];
}

/** Copies this checkout's src into root/<arm>/src with the arm's patches; each patch must match exactly once. */
export function makeTrees(root: string, arms: readonly Arm[], from = 'src'): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  for (const arm of arms) {
    const dir = join(root, arm);
    mkdirSync(dir, { recursive: true });
    cpSync(from, join(dir, 'src'), { recursive: true });
    for (const [f, at, to] of patches(arm)) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length !== 2) throw new Error(`tree ${arm}: a patch does not match once in ${f}: ${at.slice(0, 80)}`);
      writeFileSync(
        path,
        text.replace(at, () => to),
      );
    }
    dirs[arm] = dir;
  }
  return dirs;
}

export interface Tree {
  name: string;
  createAgent: (side: string, level: string) => any;
  GameRunner: any;
  rezCandidates: any;
  core: any;
  decks: any;
  rez: any;
  clear: () => void;
}

export async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts', 'ai/corp/rez.ts'])
    mods.push(await m(p));
  const [ai, po, core, decks, hv, ev, vm, iv, rez] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    rezCandidates: po.rezCandidates,
    core,
    decks,
    rez,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
