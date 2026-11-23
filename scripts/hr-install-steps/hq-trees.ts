/**
 * ai-hr-install-steps (Jeff 2026-11-22, Humanoid Resources), the bar's measure
 * (/mnt/project-files/netrunner-ai/hr-install-steps/spec-ruling.md section 5): V-C item 4's trees
 * (scripts/stage-vc/install-prompt-trees.ts, copied here so item 4's record stays as run) with this branch's arms.
 *
 * Run on the branch: every tree is a copy of the branch's src. The RECORD patch is item 4's (top-level flag, the
 * fallback's record, the planner's per-candidate trace; no arm widens followChain here). Arms:
 *  - beta, control, source: Q0a (corp/core.ts hqStepAnswer) taken out, so the tree is beta's src plus the
 *    incomeLine.ts `nets` refactor only. `source` plays the g1 base's deals and must match that record (C6: M1 unchanged).
 *  - hq: the branch as built (P, S and O); hqPS: the install pair (P the install pick, S the install step's server);
 *    hqP: the pick alone (the server the fallback's); hqO: the operation pick alone. The other parts give today's
 *    answer. Since spec-ruling.md 7 R5 the server step is Q0a's only after Q0a's own pick, so S has no arm of its own:
 *    S is read as hqPS against hqP. Each hq tree marks a top-level Q0a answer (`__hqFire`), so a changed decision
 *    without one is outside the class.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ARMS = ['beta', 'control', 'source', 'hq', 'hqPS', 'hqP', 'hqO'] as const;
export type Arm = (typeof ARMS)[number];
export const HQ_ARMS: Arm[] = ['hq', 'hqPS', 'hqP', 'hqO'];
const PARTS: Partial<Record<Arm, string>> = { hq: 'PSO', hqPS: 'PS', hqP: 'P', hqO: 'O' };

type Patch = [file: string, at: string, to: string];

function patches(arm: Arm): Patch[] {
  const A = JSON.stringify(arm);
  return [
    // ---- answerPrompt: top-level flag
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
  const __rec: any[] | null = __G.__pcTop && __G.__pcArm ? [] : null;
  for (const action of options) {
    const after = simulated?.get(JSON.stringify(action)) ?? simulate(state, action);
    if (!after) continue;
    const __board = followChain(prompt, after, side, memory, synergy, !!state.activeRun);
    const __so = scoreOutcome(state, __board, side, memory, synergy);
    let score = __so;
    if (side === 'corp') score += freeRezSaving(state, after);
    if (skip && after.activeRun?.encounter?.iceId === skip.iceId) score -= skip.cost;
    if (__rec) {
      const __n = activePrompt(after);
      const __cont = !!__n && __n.side === side && 'source' in prompt && 'source' in __n && __n.source.instanceId === prompt.source.instanceId;
      __G.__pcTop = false;
      try {
        __rec.push({ a: action, score, hk: __so - evaluate(__board, side), cont: __cont, inst: __cont && !!(__n as any).source.data?.install });
      } finally {
        __G.__pcTop = true;
      }
    }`,
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
  if (__rec)
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
      opts: __rec,
    };
  return best;
}`,
    ],
    // ---- followChain: the arm's condition, and the follow counts
    [
      'ai/prompts.ts',
      `function followChain(prompt: Prompt, after: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameState {
  // Identities only: following every card's chain made AI games about 4x slower
  if (!('source' in prompt) || getCardDefinition(prompt.source.cardCode).type_code !== 'identity') return after;
  let state = after;`,
      `function followChain(prompt: Prompt, after: GameState, side: SideCode, memory?: RunnerMemory, synergy = false, during = false): GameState {
  const __arm: string = ${A};
  const __next = activePrompt(after);
  const __same = !!__next && __next.side === side && 'source' in prompt && 'source' in __next && __next.source.instanceId === prompt.source.instanceId;
  const __wide =
    __arm === 'chainCorp' ? side === 'corp' : __arm === 'chainOut' ? side === 'corp' && !during : __arm === 'chainInstall' ? side === 'corp' && __same && !!(__next as any).source.data?.install : false;
  const __identity = 'source' in prompt && getCardDefinition(prompt.source.cardCode).type_code === 'identity';
  // Identities only: following every card's chain made AI games about 4x slower
  if (!('source' in prompt) || (!__identity && !__wide)) return after;
  if (__same) {
    const __G = globalThis as any;
    __G.__pcFollow = (__G.__pcFollow ?? 0) + 1;
    if (!__identity) __G.__pcWide = (__G.__pcWide ?? 0) + 1;
  }
  let state = after;`,
    ],
    [
      'ai/prompts.ts',
      `    const board = followChain(prompt, after, 'corp', memory, synergy);`,
      `    const board = followChain(prompt, after, 'corp', memory, synergy, !!state.activeRun);`,
    ],
    [
      'ai/prompts.ts',
      `    return after ? scoreOutcome(state, followChain(prompt, after, side, memory, synergy), side, memory, synergy) : -Infinity;`,
      `    return after ? scoreOutcome(state, followChain(prompt, after, side, memory, synergy, !!state.activeRun), side, memory, synergy) : -Infinity;`,
    ],
    // ---- the planner: per root candidate, the wide follows its playout made (outermost call only)
    [
      'ai/turnPlanner.ts',
      `    for (const c of candidates) {
      const line: Line = [];
      const ends: Ends = {};
      const value = playout(root, side, c.action, ai, line, ends);`,
      `    const __G = globalThis as any;
    const __outer = !__G.__pcPlanDepth;
    __G.__pcPlanDepth = (__G.__pcPlanDepth ?? 0) + 1;
    if (__outer) __G.__pcCand = [];
    for (const c of candidates) {
      const line: Line = [];
      const ends: Ends = {};
      const __w0 = __G.__pcWide ?? 0;
      const value = playout(root, side, c.action, ai, line, ends);
      if (__outer) __G.__pcCand.push({ k: JSON.stringify(c.action), w: (__G.__pcWide ?? 0) - __w0, v: value });`,
    ],
    [
      'ai/turnPlanner.ts',
      `    if (side === 'corp' && plan().replyContenders && ai.reply && sampledReply()) best = contenders(scored, side, synergy) ?? best;`,
      `    __G.__pcPlanDepth--;
    if (side === 'corp' && plan().replyContenders && ai.reply && sampledReply()) best = contenders(scored, side, synergy) ?? best;`,
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
    // ---- Q0a: out of beta, control and source; marked (and its parts gated) in the hq trees
    ...(PARTS[arm]
      ? ([
          [
            'ai/corp/core.ts',
            `  if (hqStep) return { action: hqStep.action, note: false, hqPick: hqStep.pick };`,
            `  if (hqStep) {
    (globalThis as any).__hqFire = true;
    return { action: hqStep.action, note: false, hqPick: hqStep.pick };
  }`,
          ],
          ['ai/corp/hqSteps.ts', `    if (steps.length > 0) {`, `    if (steps.length > 0) {
      if (!${JSON.stringify(PARTS[arm])}.includes('P')) return null;`],
          ['ai/corp/hqSteps.ts', `    if (prompt.max === 1 && prompt.candidateIds.every(`, `    if (${JSON.stringify(PARTS[arm])}.includes('O') && prompt.max === 1 && prompt.candidateIds.every(`],
          ['ai/corp/hqSteps.ts', `  if (prompt.kind === 'effect_choice' && prompt.source.data?.install) {`, `  if (${JSON.stringify(PARTS[arm])}.includes('S') && prompt.kind === 'effect_choice' && prompt.source.data?.install) {`],
        ] as Patch[])
      : ([
          [
            'ai/corp/core.ts',
            `  const hqStep = ctx.counted && activePrompt(view) ? hqStepAnswer(view, ctx.memory.heldLine, ctx.memory.hqPick ?? null) : null;`,
            `  const hqStep = false as boolean ? hqStepAnswer(view, ctx.memory.heldLine, ctx.memory.hqPick ?? null) : null;`,
          ],
        ] as Patch[])),
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
  core: any;
  decks: any;
  /** corp/rezMoney.ts rezMoney (bar line (f), spec-ruling.md 7: the Corp's keep at the Runner's turn). */
  rezMoney: (s: any) => { keep: number };
  clear: () => void;
}

export async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts', 'ai/corp/rezMoney.ts']) mods.push(await m(p));
  const [ai, po, core, decks, hv, ev, vm, iv, rm] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    core,
    decks,
    rezMoney: rm.rezMoney,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
