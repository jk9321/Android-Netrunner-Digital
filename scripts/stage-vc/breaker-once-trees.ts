/**
 * V-C item 1, count step (brief /mnt/project-files/netrunner-ai/stage-vc/item1-breaker-double-count/brief.md): the trees.
 *
 * A tree is a copy of this checkout's src/ (beta) with text patches, loaded as its own module graph (as
 * scripts/stage-d/prompt-chain-trees.ts). Every tree gets the RECORD patch, which only writes globals the script reads:
 *  - `__boTop` is true only inside the deciding Corp's own top-level prompt answer (corp/core.ts Q0 with the counted
 *    questions on sets `__boTopNext` just before calling answerPrompt). Look-ahead, playouts, the run term's settle and
 *    nested asks are never top level.
 *  - at the top level: the run term's priced answers (`__boRun`: runLoss and per answer its price and verdict) and the
 *    fallback's scores (`__boFb`), so a changed decision can be listed with both prices on each tree.
 *  - `__boFire`: how many times the arm's term changed a value (inside the look-ahead too).
 *
 * Arms (each patch is the whole rule; no number is added):
 *  - beta, control, source: RECORD only (source plays the source games and is never asked or cleared, found row 71b).
 *  - iceOwnsBoth / iceOwnsCorp. The ice on the board is priced by iceWorth alone; the rig's coverage term counts only the
 *    stops on ice it does not already price there. runnerRigValue's coverage of a type t was breakerTypeWorth(t) =
 *    3 x ICE_STOP x odds(t) x clock: 3 x odds(t) stops of type t still to meet. The rezzed installed ice of type t
 *    (iceSubtypes, gained subtypes included), and on the Corp's view also its unrezzed ice of type t that the rez budget
 *    gives a share (iceWorthOf prices exactly those against the rig; the Runner's view prices unrezzed ice by a guess
 *    with no type), is priced by iceWorth already, so the coverage
 *    of t becomes breakerTypeWorth(t) x max(0, 3 x odds(t) - n(t)) / (3 x odds(t)) = ICE_STOP x clock x
 *    max(0, 3 x odds(t) - n(t)). The AI breaker's share and the one-use share stay as they are. Both: every viewer, and
 *    the readers that pass none (handValues' played worth of a breaker, Knickknack's answer). Corp: only where
 *    sideStrength's viewer is 'corp' (runnerRigValue gets the viewer from sideStrength; the other readers are as beta).
 *  - rigOwnsBoth / rigOwnsCorp. The rig's coverage term is left whole; an installed ice's worth does not move with the
 *    Runner's breakers: iceWorth (iceWorthOf, protects, protectsIn: every break cost it reads) reads iceCost on the
 *    rig-free reference: the same board with every icebreaker taken out of the Runner's programs (other programs,
 *    hardware and resources stay, so a program-trash or a pay-through subroutine is priced as today). Both: both views.
 *    Corp: the Corp's view only (iceWorthOf's viewer 'corp'; protects and protectsIn are the Corp's view on beta
 *    already). rezBudget's stop order (which ice draws on the pool first) keeps beta's break cost in every arm.
 *  - readerOnce. Nothing in the two owners changes. Where the Corp prices a prompt answer (the run term's runPrice and the
 *    fallback's loop in todayAnswer, the two readers that score a program trash), a board on which a Runner program is
 *    gone is priced with the ice's movement taken back out: the price less (corpBoardValue of the board, Corp view) less
 *    corpBoardValue of the same board with the gone programs back in the rig). So the trash is priced by the rig's
 *    movement alone.
 *  - orEndCorp (mine, from A3: the pin's ice movement is not a breaker's coverage but Ballista's own price). iceCost's
 *    rule for "X or end the run" (runs.ts) prices 5 while the Runner has a program and a full stop when it has none, so
 *    trashing the last program raises the ice's worth from 5 to a stop on both views (found row 72a's second reading).
 *    The Corp chooses (rule 1.14.5), as the hold walk reads it (ruling 6: the walk takes the end). Arm: inside iceWorth on
 *    the Corp's view (iceWorthOf's direct break costs, protects, protectsIn; not rezBudget's stop order, not the hold
 *    count, not the Runner AI's run prices) the rule reads the end. A flag set around those iceCost calls only.
 *  - iceOrEndCorp: iceOwnsCorp and orEndCorp together (the two causes A3 finds, each at its owner, Corp view).
 * The Runner's prompts are never repriced by any arm.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ARMS = ['beta', 'control', 'source', 'iceOwnsBoth', 'iceOwnsCorp', 'rigOwnsBoth', 'rigOwnsCorp', 'readerOnce', 'orEndCorp', 'iceOrEndCorp'] as const;
export type Arm = (typeof ARMS)[number];
export const ONCE_ARMS: Arm[] = ['iceOwnsBoth', 'iceOwnsCorp', 'rigOwnsBoth', 'rigOwnsCorp', 'readerOnce', 'orEndCorp', 'iceOrEndCorp'];

type Patch = [file: string, at: string, to: string];

function patches(arm: Arm): Patch[] {
  const ICE = arm === 'iceOwnsBoth' ? 'true' : arm === 'iceOwnsCorp' || arm === 'iceOrEndCorp' ? "__v === 'corp'" : 'false';
  const OREND = arm === 'orEndCorp' || arm === 'iceOrEndCorp' ? "__v === 'corp'" : 'false';
  const RIG = arm === 'rigOwnsBoth' ? 'true' : arm === 'rigOwnsCorp' ? "__v === 'corp'" : 'false';
  const READ = arm === 'readerOnce' ? 'true' : 'false';
  return [
    // ---------------------------------------------------------------------------------------- RECORD: top level
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

/** readerOnce: the ice's movement on a board where Runner programs are gone (Corp view), 0 on every other tree. */
function __iceMove(before: GameState, board: GameState): number {
  if (!${READ}) return 0;
  const now = new Set(board.runner.rig.programs.map(p => p.instanceId));
  const gone = before.runner.rig.programs.filter(p => !now.has(p.instanceId));
  if (!gone.length) return 0;
  const back = { ...board, runner: { ...board.runner, rig: { ...board.runner.rig, programs: [...board.runner.rig.programs, ...gone] } } } as GameState;
  const move = corpBoardValue(board, 'corp') - corpBoardValue(back, 'corp');
  if (move !== 0) (globalThis as any).__boFire = ((globalThis as any).__boFire ?? 0) + 1;
  return move;
}

function __answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false): GameAction {`,
    ],
    [
      'ai/prompts.ts',
      `import { evaluate, keepValue, rigCoverage, runnerRigValue } from './evaluate';`,
      `import { corpBoardValue, evaluate, keepValue, rigCoverage, runnerRigValue } from './evaluate';`,
    ],
    // ---------------------------------------------------------------------------------------- RECORD + readerOnce: the run term
    [
      'ai/prompts.ts',
      `  const priced = outs.map((o, k) => runPrice(state, prompt, o.action, o.after, memory, synergy) - (verdicts[k] === 'in' ? loss : 0));`,
      `  const priced = outs.map((o, k) => runPrice(state, prompt, o.action, o.after, memory, synergy) - (verdicts[k] === 'in' ? loss : 0));
  if ((globalThis as any).__boTop) (globalThis as any).__boRun = { loss, opts: outs.map((o, k) => ({ a: o.action, price: priced[k], v: verdicts[k] })) };`,
    ],
    [
      'ai/prompts.ts',
      `  if (!shredTrash) return scoreOutcome(state, followChain(prompt, after, 'corp', memory, synergy), 'corp', memory, synergy) + freeRezSaving(state, after);`,
      `  if (!shredTrash) {
    const __b = followChain(prompt, after, 'corp', memory, synergy);
    return scoreOutcome(state, __b, 'corp', memory, synergy) + freeRezSaving(state, after) - __iceMove(state, __b);
  }`,
    ],
    // ---------------------------------------------------------------------------------------- RECORD + readerOnce: the fallback
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
    const __b = followChain(prompt, after, side, memory, synergy);
    let score = scoreOutcome(state, __b, side, memory, synergy);
    if (side === 'corp') score += freeRezSaving(state, after) - __iceMove(state, __b);
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
    // ---------------------------------------------------------------------------------------- iceOwns: the rig's coverage
    [
      'ai/evaluate.ts',
      `export function runnerRigValue(state: GameState): number {`,
      `/** iceOwns: the coverage of type t counts only the stops on ice the board does not already price (beta: breakerTypeWorth). */
function __toCome(state: GameState, t: string, odds: Record<string, number>, __v?: SideCode): number {
  const full = breakerTypeWorth(state, t, odds);
  if (!(__v === undefined ? ${ICE.replace("__v === 'corp'", 'false')} : ${ICE})) return full;
  const expected = 3 * odds[t];
  if (!(expected > 0)) return full;
  // The ice iceWorth prices against the rig on this view: rezzed ice; on the Corp's view also the unrezzed ice the rez
  // budget gives a share (iceWorthOf prices it at that share of its break cost, 0 without one)
  const shares = __v === 'corp' ? rezBudget(state) : undefined;
  const n = Object.values(state.corp.servers).reduce((k, s) => k + s.ice.filter(c => (c.isRezzed || (shares?.get(c.instanceId) ?? 0) > 0) && (iceSubtypes(c, state) as string[]).includes(t)).length, 0);
  if (n === 0) return full;
  (globalThis as any).__boFire = ((globalThis as any).__boFire ?? 0) + 1;
  return (full * Math.max(0, expected - n)) / expected;
}

export function runnerRigValue(state: GameState, __v?: SideCode): number {`,
    ],
    [
      'ai/evaluate.ts',
      `import { AI_BREAKER_SHARE, breakerTypeWorth, iceTypeOdds, iceWorth } from './iceValues';`,
      `import { AI_BREAKER_SHARE, breakerTypeWorth, iceTypeOdds, iceWorth, rezBudget } from './iceValues';`,
    ],
    [
      'ai/evaluate.ts',
      `  let value = ICE_TYPES.reduce((n, t) => n + (covered.has(t) ? 1 : aiShare) * breakerTypeWorth(state, t, odds), 0);`,
      `  let value = ICE_TYPES.reduce((n, t) => n + (covered.has(t) ? 1 : aiShare) * __toCome(state, t, odds, __v), 0);`,
    ],
    [
      'ai/evaluate.ts',
      `    runnerRigValue(state)
  );
}`,
      `    runnerRigValue(state, viewer)
  );
}`,
    ],
    // ---------------------------------------------------------------------------------------- rigOwns: the ice's worth
    [
      'ai/iceValues.ts',
      `function iceWorthOf(state: GameState, ice: CardInstance, viewer: SideCode): number {`,
      `const __free = new WeakMap<GameState, GameState>();
/** rigOwns: the rig-free reference (every icebreaker out of the Runner's programs), or the board itself on every other tree. */
function __ref(state: GameState, __v: SideCode): GameState {
  if (!(${RIG})) return state;
  let s = __free.get(state);
  if (!s) {
    const rig = state.runner.rig;
    const programs = rig.programs.filter(p => !isIcebreaker(p));
    s = programs.length === rig.programs.length ? state : ({ ...state, runner: { ...state.runner, rig: { ...rig, programs } } } as GameState);
    __free.set(state, s);
  }
  if (s !== state) (globalThis as any).__boFire = ((globalThis as any).__boFire ?? 0) + 1;
  return s;
}

/** iceWorth's break cost: on the rig-free reference (rigOwns), and with "X or end the run" read as the end (orEnd). */
function __cost(state: GameState, ice: CardInstance, __v: SideCode): number {
  const s = __ref(state, __v);
  if (!(${OREND})) return iceCost(s, ice);
  const G = globalThis as any;
  const was = G.__boOrEnd;
  G.__boOrEnd = true;
  if (s.runner.rig.programs.length > 0) G.__boFire = (G.__boFire ?? 0) + 1;
  try {
    return iceCost(s, ice);
  } finally {
    G.__boOrEnd = was;
  }
}

function iceWorthOf(state: GameState, ice: CardInstance, viewer: SideCode): number {`,
    ],
    [
      'ai/iceValues.ts',
      `  if (ice.isRezzed) return RATES.ice + Math.min(iceStop(state), iceCost(state, ice)) * protects(original, ice, viewer);
  // The Runner doesn't know what it is: iceCost's guess for unrezzed ice
  if (viewer === 'runner') return RATES.ice + iceCost(state, ice);`,
      `  if (ice.isRezzed) return RATES.ice + Math.min(iceStop(state), __cost(state, ice, viewer)) * protects(original, ice, viewer);
  // The Runner doesn't know what it is: iceCost's guess for unrezzed ice
  if (viewer === 'runner') return RATES.ice + __cost(state, ice, viewer);`,
    ],
    [
      'ai/iceValues.ts',
      `  const stop = Math.min(iceStop(state), iceCost(state, { ...ice, isRezzed: true }));
  return RATES.ice + (share > 0 ? share * stop * protects(original, ice, viewer) : 0);`,
      `  const stop = Math.min(iceStop(state), __cost(state, { ...ice, isRezzed: true }, viewer));
  return RATES.ice + (share > 0 ? share * stop * protects(original, ice, viewer) : 0);`,
    ],
    [
      'ai/iceValues.ts',
      `    const found = mainRemote(state) ? 0 : Math.min(1, plannedStake(state) / Math.max(1e-9, Math.min(iceStop(state), iceCost(state, { ...ice, isRezzed: true }))));`,
      `    const found = mainRemote(state) ? 0 : Math.min(1, plannedStake(state) / Math.max(1e-9, Math.min(iceStop(state), __cost(state, { ...ice, isRezzed: true }, 'corp'))));`,
    ],
    [
      'ai/iceValues.ts',
      `    const breaks = ice.reduce((n, c) => n + Math.min(iceStop(state), iceCost(state, { ...c, isRezzed: true })), 0);`,
      `    const breaks = ice.reduce((n, c) => n + Math.min(iceStop(state), __cost(state, { ...c, isRezzed: true }, 'corp')), 0);`,
    ],
    [
      'ai/iceValues.ts',
      `import { iceCost, isTrap } from './runs';`,
      `import { iceCost, isTrap } from './runs';
import { isIcebreaker } from '../core/engine/ice';`,
    ],
    // ---------------------------------------------------------------------------------------- orEnd: the Corp's choice
    [
      'ai/runs.ts',
      `  [/or end the run/i, state => (state.runner.rig.programs.length > 0 ? 5 : BLOCK), state => state.runner.rig.programs.length === 0],`,
      `  [/or end the run/i, state => (state.runner.rig.programs.length > 0 && !(globalThis as any).__boOrEnd ? 5 : BLOCK), state => state.runner.rig.programs.length === 0 || !!(globalThis as any).__boOrEnd],`,
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
  core: any;
  decks: any;
  prompts: any;
  evaluate: any;
  iceValues: any;
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
    iceValues: iv,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
