/**
 * Stage D found row 59, count step (brief /mnt/project-files/netrunner-ai/stage-d/prompt-chain/brief.md): the trees.
 *
 * A tree is a copy of this checkout's src/ (beta ad54114) with text patches, loaded as its own module graph (as
 * post-pick-trees.ts). Every tree gets the RECORD patch, which only writes globals the script reads:
 *  - answerPrompt is wrapped: a depth counter, and `__pcTop` true only inside the deciding agent's own top-level prompt
 *    answer (corp/core.ts Q0, runnerAI.ts promptAnswer set `__pcTopNext` just before calling it). Calls from the
 *    look-ahead, the playouts, the run term's settle, scoreNow's search or followChain itself are never top level.
 *  - the fallback's loop (todayAnswer, "try each answer and keep the best outcome") counts its calls (`__pcCalls`) in
 *    every call, and, at the top level with `__pcArm` set, leaves each answer's one-step score (exactly the score the
 *    fallback compared), whether the answer leaves the same card's next prompt pending for the same side (`cont`), and,
 *    with `__pcSettle` set (an untimed extra ask on the beta tree only), the score of the settled board: the same card's
 *    chain followed with today's answers, same side, depth 3 as followChain, for any card (the identity condition
 *    dropped). Also the run term's answer count (`run`: 1 = the run term decided; the fallback is not reached then).
 *  - followChain counts the chains it actually follows (`__pcFollow`).
 * Arms (`ARM` is written into prompts.ts; followChain gets the board's run and whether the fallback called it):
 *  - beta, control, source: RECORD only (source plays the source games and is never asked or cleared, found row 71b).
 *  - chainRun: followChain also follows the chain of a Corp prompt answered during a run (fallback, greedyCards and the
 *    run term's runPrice all call followChain, so the run term's price reads the same board as the fallback).
 *  - chainCorp: followChain follows the chain of every Corp prompt (the identity condition widened to "the Corp's").
 *  - chainRunFb: chainRun for the fallback (and greedyCards) only; the run term's runPrice keeps today's one-step board.
 *    Narrower than chainRun: it removes the fallback's tie (the Anoetic Void "yes" on remotes with runLoss 0) and leaves
 *    the run term's price of a paid answer as it is, so the two effects can be told apart.
 * The Runner's prompts are never followed further by any arm (the Runner rework owns them).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ARMS = ['beta', 'control', 'source', 'chainRun', 'chainCorp', 'chainRunFb'] as const;
export type Arm = (typeof ARMS)[number];
export const CHAIN_ARMS: Arm[] = ['chainRun', 'chainCorp', 'chainRunFb'];

type Patch = [file: string, at: string, to: string];

function patches(arm: Arm): Patch[] {
  const A = JSON.stringify(arm);
  return [
    // ---- answerPrompt: depth and top-level flag
    [
      'ai/prompts.ts',
      `export function answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {`,
      `export function answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {
  const __G = globalThis as any;
  const __top = !!__G.__pcTopNext;
  __G.__pcTopNext = false;
  const __was = __G.__pcTop;
  __G.__pcTop = __top;
  try {
    return __answerPrompt(state, side, memory, synergy);
  } finally {
    __G.__pcTop = __was;
  }
}

function __answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {`,
    ],
    [
      'ai/prompts.ts',
      `  const run = side === 'corp' ? runAnswer(state, memory, synergy) : null;
  if (run?.length === 1) return run[0];`,
      `  const run = side === 'corp' ? runAnswer(state, memory, synergy) : null;
  if ((globalThis as any).__pcTop) (globalThis as any).__pcRunLen = run?.length ?? 0;
  if (run?.length === 1) return run[0];`,
    ],
    // ---- the fallback: record
    [
      'ai/prompts.ts',
      `  const simulated = side === 'corp' ? runAfters.get(state) : undefined;
  for (const action of options) {
    const after = simulated?.get(JSON.stringify(action)) ?? simulate(state, action);
    if (!after) continue;
    let score = scoreOutcome(state, followChain(prompt, after, side, memory, synergy), side, memory, synergy);
    if (side === 'corp') score += freeRezSaving(state, after);
    if (skip && after.activeRun?.encounter?.iceId === skip.iceId) score -= skip.cost;`,
      `  const simulated = side === 'corp' ? runAfters.get(state) : undefined;
  const __G = globalThis as any;
  __G.__pcCalls = (__G.__pcCalls ?? 0) + 1;
  const __rec: { a: GameAction; after: GameState; score: number }[] | null = __G.__pcTop && __G.__pcArm ? [] : null;
  for (const action of options) {
    const after = simulated?.get(JSON.stringify(action)) ?? simulate(state, action);
    if (!after) continue;
    let score = scoreOutcome(state, followChain(prompt, after, side, memory, synergy, !!state.activeRun, true), side, memory, synergy);
    if (side === 'corp') score += freeRezSaving(state, after);
    if (skip && after.activeRun?.encounter?.iceId === skip.iceId) score -= skip.cost;
    if (__rec) __rec.push({ a: action, after, score });`,
    ],
    [
      'ai/prompts.ts',
      `    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}`,
      `    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  if (__rec) {
    const __settle = !!__G.__pcSettle;
    __G.__pcTop = false;
    try {
      __G.__pcRec = {
        side,
        code: 'source' in prompt ? prompt.source.cardCode : null,
        step: 'source' in prompt ? prompt.source.step : null,
        kind: prompt.kind,
        run: !!state.activeRun,
        runLen: __G.__pcRunLen ?? 0,
        identity: 'source' in prompt && getCardDefinition(prompt.source.cardCode).type_code === 'identity',
        n: options.length,
        pick: best,
        opts: __rec.map(o => {
          const cont = __continues(prompt, o.after, side);
          let settled: number | null = null;
          let board: any = null;
          if (__settle) {
            const s = cont ? __settleChain(prompt, o.after, side, memory, synergy) : o.after;
            settled = scoreOutcome(state, s, side, memory, synergy) + (side === 'corp' ? freeRezSaving(state, o.after) : 0) - (skip && o.after.activeRun?.encounter?.iceId === skip.iceId ? skip.cost : 0);
            board = { cr: s.corp.credits, hq: s.corp.hq.length, rcr: s.runner.credits, grip: s.runner.grip.length, run: !!s.activeRun, pend: activePrompt(s) ? activePrompt(s)!.side : null };
          }
          return { a: o.a, one: o.score, cont, settled, board, cr1: o.after.corp.credits, hq1: o.after.corp.hq.length };
        }),
      };
    } finally {
      __G.__pcTop = true;
    }
  }
  return best;
}

/** RECORD: the answer leaves the same card's next prompt pending for the same side (followChain's own test of a chain). */
function __continues(prompt: Prompt, after: GameState, side: SideCode): boolean {
  if (!('source' in prompt)) return false;
  const next = activePrompt(after);
  return !!next && next.side === side && 'source' in next && next.source.instanceId === prompt.source.instanceId;
}

/** RECORD: followChain without its identity condition (the settled board of A2; beta's answers, depth 3). */
function __settleChain(prompt: Prompt, after: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameState {
  if (!('source' in prompt)) return after;
  let state = after;
  for (let depth = 0; depth < 3; depth++) {
    const next = activePrompt(state);
    if (!next || next.side !== side || !('source' in next) || next.source.instanceId !== prompt.source.instanceId) break;
    const resolved = simulate(state, answerPrompt(state, side, memory, synergy));
    if (!resolved) break;
    state = resolved;
  }
  return state;
}`,
    ],
    // ---- followChain: the arm's condition, and the follow count
    [
      'ai/prompts.ts',
      `function followChain(prompt: Prompt, after: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameState {
  // Identities only: following every card's chain made AI games about 4x slower
  if (!('source' in prompt) || getCardDefinition(prompt.source.cardCode).type_code !== 'identity') return after;
  let state = after;`,
      `function followChain(prompt: Prompt, after: GameState, side: SideCode, memory?: RunnerMemory, synergy = false, during = false, fallback = false): GameState {
  const __arm: string = ${A};
  const __wide = __arm === 'chainCorp' ? side === 'corp' : __arm === 'chainRun' ? side === 'corp' && during : __arm === 'chainRunFb' ? side === 'corp' && during && fallback : false;
  // Identities only: following every card's chain made AI games about 4x slower
  if (!('source' in prompt) || (getCardDefinition(prompt.source.cardCode).type_code !== 'identity' && !__wide)) return after;
  {
    const __n = activePrompt(after);
    if (__n && __n.side === side && 'source' in __n && __n.source.instanceId === prompt.source.instanceId) (globalThis as any).__pcFollow = ((globalThis as any).__pcFollow ?? 0) + 1;
  }
  let state = after;`,
    ],
    [
      'ai/prompts.ts',
      `  if (!shredTrash) return scoreOutcome(state, followChain(prompt, after, 'corp', memory, synergy), 'corp', memory, synergy) + freeRezSaving(state, after);`,
      `  if (!shredTrash) return scoreOutcome(state, followChain(prompt, after, 'corp', memory, synergy, true, false), 'corp', memory, synergy) + freeRezSaving(state, after);`,
    ],
    [
      'ai/prompts.ts',
      `    return after ? scoreOutcome(state, followChain(prompt, after, side, memory, synergy), side, memory, synergy) : -Infinity;`,
      `    return after ? scoreOutcome(state, followChain(prompt, after, side, memory, synergy, !!state.activeRun, true), side, memory, synergy) : -Infinity;`,
    ],
    // ---- the deciding agents' own top-level prompt answers
    [
      'ai/corp/core.ts',
      `  if (activePrompt(view)) return { action: answerPrompt(view, 'corp', undefined, ctx.synergy), note: false };`,
      `  if (activePrompt(view)) {
    if (ctx.counted) (globalThis as any).__pcTopNext = true;
    return { action: answerPrompt(view, 'corp', undefined, ctx.synergy), note: false };
  }`,
    ],
    [
      'ai/runnerAI.ts',
      `    const real = () => answerPrompt(state, 'runner', this.memory, this.synergy);`,
      `    const real = () => {
      if (this.planner) (globalThis as any).__pcTopNext = true;
      return answerPrompt(state, 'runner', this.memory, this.synergy);
    };`,
    ],
    [
      'ai/runnerAI.ts',
      `    const answer = answerPrompt(view, 'runner', this.memory, this.synergy);`,
      `    if (this.planner) (globalThis as any).__pcTopNext = true;
    const answer = answerPrompt(view, 'runner', this.memory, this.synergy);`,
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
      writeFileSync(path, text.replace(at, () => to));
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
  prompts: any;
  clear: () => void;
}

export async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts', 'ai/prompts.ts']) mods.push(await m(p));
  const [ai, po, core, decks, hv, ev, vm, iv, prompts] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    rezCandidates: po.rezCandidates,
    core,
    decks,
    prompts,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
