/**
 * V-C item 1 build, the trees (brief stage-vc/item1-breaker-double-count/build/brief.md, "Judged by" 2). A tree is a copy
 * of a src/ loaded as its own module graph (the count's pattern, scripts/stage-vc/breaker-once-trees.ts):
 *  - source, beta, control: the merge base's src (git archive of BASE: the branch's own parent on beta, never this
 *    checkout's src). source plays the source games and is never asked or cleared (found row 71b).
 *  - branch: this checkout's src (the correction, `rigMove` in src/ai/prompts.ts).
 *  - topOnly: the branch with the correction applied only inside the deciding Corp's own top-level prompt answer
 *    (`__boTop`, below); off inside every nested answerPrompt (the planner's Runner reply, the rez follow-ups,
 *    followChain, candidates, the money line), and so off at every main-phase and rez decision.
 * Every tree gets the RECORD patch, which only writes globals the script reads (the count's, unchanged):
 *  - `__boTop` is true only inside the deciding Corp's own top-level prompt answer (corp/core.ts Q0 with the counted
 *    questions on sets `__boTopNext` just before calling answerPrompt);
 *  - at the top level: the run term's priced answers (`__boRun`) and the fallback's scores (`__boFb`);
 *  - `__boFire` (branch trees): how many times the correction moved a price (inside the look-ahead too).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TREES = ['source', 'beta', 'control', 'branch', 'topOnly'] as const;
export type TreeName = (typeof TREES)[number];
/** The merge base the branch was cut from (origin/beta when the build started); BASE=<sha> overrides it. */
export const BASE = process.env.BASE ?? 'b450b50d97ce7a7026f7f7e5aed4ad714715a06e';

type Patch = [file: string, at: string, to: string];

const RECORD: Patch[] = [
  [
    'ai/corp/core.ts',
    `  if (activePrompt(view)) return { action: answerPrompt(view, 'corp', undefined, ctx.synergy), note: false };`,
    `  if (activePrompt(view)) {
    if (ctx.counted) (globalThis as any).__boTopNext = true;
    return { action: answerPrompt(view, 'corp', undefined, ctx.synergy), note: false };
  }`,
  ],
  [
    'ai/prompts.ts',
    `export function answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {`,
    `export function answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {
  const __G = globalThis as any;
  const __top = !!__G.__boTopNext;
  __G.__boTopNext = false;
  const __was = __G.__boTop;
  __G.__boTop = __top;
  try {
    return __answerPrompt(state, side, memory, synergy);
  } finally {
    __G.__boTop = __was;
  }
}

function __answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {`,
  ],
  [
    'ai/prompts.ts',
    `  const priced = outs.map((o, k) => runPrice(state, prompt, o.action, o.after, memory, synergy) - (verdicts[k] === 'in' ? loss : 0));`,
    `  const priced = outs.map((o, k) => runPrice(state, prompt, o.action, o.after, memory, synergy) - (verdicts[k] === 'in' ? loss : 0));
  if ((globalThis as any).__boTop) (globalThis as any).__boRun = { loss, opts: outs.map((o, k) => ({ a: o.action, price: priced[k], v: verdicts[k] })) };`,
  ],
  [
    'ai/prompts.ts',
    `  for (const action of options) {
    const after = simulated?.get(JSON.stringify(action)) ?? simulate(state, action);
    if (!after) continue;
    let score = scoreOutcome(state, followChain(prompt, after, side, memory, synergy), side, memory, synergy);
    if (side === 'corp') score += freeRezSaving(state, after);
    if (skip && after.activeRun?.encounter?.iceId === skip.iceId) score -= skip.cost;`,
    `  const __rec: { a: GameAction; score: number }[] | null = (globalThis as any).__boTop && side === 'corp' ? [] : null;
  for (const action of options) {
    const after = simulated?.get(JSON.stringify(action)) ?? simulate(state, action);
    if (!after) continue;
    let score = scoreOutcome(state, followChain(prompt, after, side, memory, synergy), side, memory, synergy);
    if (side === 'corp') score += freeRezSaving(state, after);
    if (skip && after.activeRun?.encounter?.iceId === skip.iceId) score -= skip.cost;
    if (__rec) __rec.push({ a: action, score });`,
  ],
  [
    'ai/prompts.ts',
    `    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

/**
 * A "bypass this ice?" prompt`,
    `    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  if (__rec) (globalThis as any).__boFb = __rec;
  return best;
}

/**
 * A "bypass this ice?" prompt`,
  ],
];

/** The branch's correction: counted when it moves a price; topOnly: off outside the top-level prompt answer. */
function correction(top: boolean): Patch[] {
  return [
    [
      'ai/prompts.ts',
      `  if (gone.length === 0) return 0;
  const back: GameState = `,
      `  if (gone.length === 0) return 0;
  if (${top ? '!(globalThis as any).__boTop' : 'false'}) return 0;
  const back: GameState = `,
    ],
    [
      'ai/prompts.ts',
      `  return corpBoardValue(board, 'corp') - corpBoardValue(back, 'corp');
}`,
      `  const __move = corpBoardValue(board, 'corp') - corpBoardValue(back, 'corp');
  if (__move !== 0) (globalThis as any).__boFire = ((globalThis as any).__boFire ?? 0) + 1;
  return __move;
}`,
    ],
  ];
}

function patches(tree: TreeName): Patch[] {
  if (tree === 'branch') return [...RECORD, ...correction(false)];
  if (tree === 'topOnly') return [...RECORD, ...correction(true)];
  return RECORD;
}

/** The merge base's src, extracted once into `dir` (git archive; on a shallow Actions checkout the commit is fetched first). */
function baseSrc(dir: string): string {
  const out = join(dir, 'base');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  try {
    execSync(`git cat-file -e ${BASE}^{commit}`, { stdio: 'ignore' });
  } catch {
    execSync(`git fetch -q --depth=1 origin ${BASE}`, { stdio: 'inherit' });
  }
  execSync(`git archive ${BASE} src | tar -x -C ${out}`, { stdio: 'inherit' });
  return join(out, 'src');
}

/** Copies the tree's src into root/<tree>/src with its patches; each patch must match exactly once. */
export function makeTrees(root: string, trees: readonly TreeName[] = TREES): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const base = trees.some(t => t === 'source' || t === 'beta' || t === 'control') ? baseSrc(root) : '';
  const dirs: Record<string, string> = {};
  for (const tree of trees) {
    const dir = join(root, tree);
    mkdirSync(dir, { recursive: true });
    cpSync(tree === 'branch' || tree === 'topOnly' ? 'src' : base, join(dir, 'src'), { recursive: true });
    for (const [f, at, to] of patches(tree)) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length !== 2) throw new Error(`tree ${tree}: a patch does not match once in ${f}: ${at.slice(0, 80)}`);
      writeFileSync(path, text.replace(at, () => to));
    }
    dirs[tree] = dir;
  }
  return dirs;
}

export interface Tree {
  name: string;
  createAgent: (side: string, level: string) => any;
  GameRunner: any;
  core: any;
  decks: any;
  prompts: any;
  evaluate: any;
  clear: () => void;
}

export async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts', 'ai/prompts.ts', 'ai/evaluate.ts']) mods.push(await m(p));
  const [ai, po, core, decks, hv, ev, vm, iv, prompts, evaluate] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    core,
    decks,
    prompts,
    evaluate,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
