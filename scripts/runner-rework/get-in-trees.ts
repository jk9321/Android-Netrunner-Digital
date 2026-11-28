/**
 * Runner rework R0, count 3 (getting in, looking ahead through runs, the missed lines): the trees. Brief:
 * /mnt/project-files/netrunner-ai/runner-rework/r0/count3-get-in/brief.md. A tree is a copy of this checkout's src/
 * with text patches, loaded as its own module graph (as scripts/stage-vc/breaker-once-trees.ts). Nothing under src/ is
 * edited: the branch changes no file there. An arm adds no number.
 *
 * RECORD (every tree; play identical with the globals unset):
 *  - turnPlanner.ts decisionSeedFor: the Runner's seed XOR `__giSalt` (0 unless the flip measure sets it), so only the
 *    deal of the deciding Runner's view and playouts changes;
 *  - playout: every main-phase action of a playout (the first and the ones played, a run included) kept on its Ends,
 *    and planTurn leaves the picked candidate's whole line in `__giPlan` (and `__giPlanned` true when it planned, false
 *    when it followed the last plan's line), with the number of runs each playout priced or played in `__giRuns`;
 *  - runnerAI.ts chooseAction / chooseOffTurn: `__giDeciding` is raised while a Runner with its planner on decides (the
 *    deciding Runner and its playouts; never the Corp's reply, whose Runner has its planner off). The arms below read
 *    it, so the reply's Runner is the same in every arm.
 *
 * ARMS (each a patched copy; the arms change the deciding Runner only):
 *  - control: RECORD only (identical to beta; the time base and the flip base).
 *  - repeatRepaired (b): the four repeat rules (runs.ts serverValue: a server where a run this turn failed is 0;
 *    serverWorth: a remote on a repeat 0, Archives on a repeat 0, HQ halved per repeat) are not applied while
 *    `__giDeciding`. What stands in for each, all owners that exist and already read the state:
 *      failed run   -> the board as it is now: the ice it rezzed is rezzed (runScore prices it), the credits are the
 *                      credits now (runBudget), the clicks are the clicks left;
 *      remote       -> the deciding Runner's memory of the root (runnerAI.ts remember: a successful run marks the root
 *                      seen; serverWorth then prices a seen card at its trash worth, a seen trap at 0) and the cards
 *                      gone from the root (stolen, trashed);
 *      Archives     -> the state: an accessed Archives card is turned faceup (rule 7.4.4 region "archives"), a stolen
 *                      agenda is gone, so a second breach prices what is left;
 *      HQ           -> hqAgendaOdds' known cards (knownInHand: cards the Runner accessed in HQ and that are still there);
 *      R&D          -> unchanged (already rdWorth's knownInRd, no repeat factor today).
 *  - runsPriced (d): (b) and the one-run cap lifted in the playouts of the deciding Runner: a playout may price one run
 *    on each server (a second run on a server it already priced in this playout is not taken). The three open points
 *    (plan section 5): effects carried after a priced run are the click and runCreditSpend's credits, as beta already
 *    carries them (no new effect written beside the engine; Side Hustle's credits, Knickknack's, counters spent at the
 *    breach and cards trashed are NOT carried: listed in the note); the record: a priced run is written nowhere
 *    (runsThisTurn unchanged: "neither successful nor failed", so Chain Reaction and Side Hustle read no run); the
 *    second run is priced on the board the first left (its click and credits gone), its outcome not known.
 *  - runsPlayed (c): a run in a playout of the deciding Runner is played in the engine on the playout's board (the
 *    Runner's dealt view: runnerDecisionView), the Runner's in-run choices by the playout's planner-off Runner, the
 *    Corp's rez windows and prompts by a planner-off Normal Corp, both through GameRunner (playout.ts), until the run is
 *    over; the playout then goes on from the board the run left (no cap: the engine's record of the run stands).
 *  - runsPlayed8 (c, 8 deals): as (c), each candidate's playout played on 8 deals of the view (the decision's seed
 *    XOR 0..7) and its value the mean; the line kept is deal 0's.
 *  - icePlayed (c2): as (c), but the run is played only until it approaches the server (phase 'approach_server'); the breach
 *    is priced by serverValue on that board (from the first board of the approach to the server, 6.9.4, before the
 *    Corp's root rez window: an upgrade rezzed there is not met; the run's own entry left out) and the run is then
 *    ended as successful on the playout's board. A run that ends before is the engine's.
 * (a) is not built (the brief): get-in.ts times one serverHold ask on the Runner's dealt view per server instead.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ARMS = ['beta', 'control', 'source', 'repeatRepaired', 'runsPriced', 'runsPlayed', 'runsPlayed8', 'icePlayed'] as const;
export type Arm = (typeof ARMS)[number];
export const GETIN_ARMS: Arm[] = ['repeatRepaired', 'runsPriced', 'runsPlayed', 'runsPlayed8', 'icePlayed'];

type Patch = [file: string, at: string, to: string];

const G = '(globalThis as any)';

function record(): Patch[] {
  return [
    [
      'ai/turnPlanner.ts',
      `return searchPiece('plannerSeed') ? (turnSeed(state) ^ Math.imul(clicksOf(state, side) + 1, 0x85ebca6b)) >>> 0 : pricing().decisionSeed;`,
      `return searchPiece('plannerSeed') ? (turnSeed(state) ^ Math.imul(clicksOf(state, side) + 1, 0x85ebca6b) ^ (side === 'runner' ? (${G}.__giSalt ?? 0) : 0)) >>> 0 : pricing().decisionSeed;`,
    ],
    [
      'ai/turnPlanner.ts',
      `type Ends = { state?: GameState; bonus?: number; installedAgenda?: boolean; seen?: string[] };`,
      `type Ends = { state?: GameState; bonus?: number; installedAgenda?: boolean; seen?: string[]; acts?: GameAction[]; runs?: number };`,
    ],
    // every main-phase action of the playout, kept on ends
    [
      'ai/turnPlanner.ts',
      `  corpLine?.first(start, first);
  let state = advance(start, first);`,
      `  corpLine?.first(start, first);
  const __acts: GameAction[] = [first];
  let __runs = first.type === 'INITIATE_RUN' ? 1 : 0;
  if (ends) { ends.acts = __acts; ends.runs = 0; }
  let state = advance(start, first);
  if (state && side === 'runner' && first.type !== 'INITIATE_RUN' && state.runsThisTurn.length > start.runsThisTurn.length) __runs++;`,
    ],
    [
      'ai/turnPlanner.ts',
      `    if (ends && agendaInstall(now, played)) ends.installedAgenda = true;`,
      `    if (ends && agendaInstall(now, played)) ends.installedAgenda = true;
    __acts.push(played);
    if (played.type === 'INITIATE_RUN') __runs++;`,
    ],
    [
      'ai/turnPlanner.ts',
      `  if (ends) {
    ends.state = state;
    ends.bonus = bonus;
    ends.seen = seen;
  }`,
      `  if (ends) {
    ends.state = state;
    ends.bonus = bonus;
    ends.seen = seen;
    ends.runs = __runs;
  }`,
    ],
    [
      'ai/turnPlanner.ts',
      `    memory.line.shift();
    return next.action;`,
      `    memory.line.shift();
    if (side === 'runner') { ${G}.__giPlanned = false; ${G}.__giPlan = [next.action, ...memory.line.map(l => l.action)]; }
    return next.action;`,
    ],
    [
      'ai/turnPlanner.ts',
      `    if (!best || best.value === -Infinity) return null;
    const slot = intake`,
      `    if (side === 'runner') {
      const __b = scored.find(x => x.action === best?.action);
      ${G}.__giPlanned = true;
      ${G}.__giPlan = __b?.ends.acts ?? null;
      ${G}.__giRuns = scored.map(x => x.ends.runs ?? 0);
    }
    if (!best || best.value === -Infinity) return null;
    const slot = intake`,
    ],
    [
      'ai/runnerAI.ts',
      `  chooseAction(state: GameState): GameAction {
    return asSide('runner', () => this.decide(state));
  }`,
      `  chooseAction(state: GameState): GameAction {
    const __was = ${G}.__giDeciding;
    if (this.planner) ${G}.__giDeciding = true;
    try {
      return asSide('runner', () => this.decide(state));
    } finally {
      ${G}.__giDeciding = __was;
    }
  }`,
    ],
    [
      'ai/runnerAI.ts',
      `  chooseOffTurn(state: GameState): GameAction | null {
    return asSide('runner', () => runnerOffTurn(state, this.runnerContext()));
  }`,
      `  chooseOffTurn(state: GameState): GameAction | null {
    const __was = ${G}.__giDeciding;
    if (this.planner) ${G}.__giDeciding = true;
    try {
      return asSide('runner', () => runnerOffTurn(state, this.runnerContext()));
    } finally {
      ${G}.__giDeciding = __was;
    }
  }`,
    ],
  ];
}

function repaired(): Patch[] {
  return [
    [
      'ai/runs.ts',
      `  if (priorRuns.some(r => !r.successful)) return 0; // it stopped us once already this turn
  const repeat = priorRuns.length;`,
      `  if (!${G}.__giDeciding && priorRuns.some(r => !r.successful)) return 0; // it stopped us once already this turn
  const repeat = ${G}.__giDeciding ? 0 : priorRuns.length;`,
    ],
  ];
}

function priced(): Patch[] {
  return [
    ['ai/turnPlanner.ts', `  let ran = false;`, `  let ran = false;\n  const __priced = new Set<string>();\n  const __multi = side === 'runner' && !!${G}.__giDeciding;`],
    [
      'ai/turnPlanner.ts',
      `    if (ran || !ai.runWorth || !after.activeRun) return null;
    ran = true;`,
      `    if (!ai.runWorth || !after.activeRun) return null;
    if (__multi ? __priced.has(after.activeRun.server) : ran) return null;
    ran = true;
    __priced.add(after.activeRun.server);`,
    ],
    [
      'ai/turnPlanner.ts',
      `      if (ran || !ai.runWorth) return null;
      ran = true;`,
      `      if (!ai.runWorth) return null;
      if (__multi ? __priced.has(action.targetServerId) : ran) return null;
      ran = true;
      __priced.add(action.targetServerId);`,
    ],
    [
      'ai/turnPlanner.ts',
      `!(ran && r.action.type === 'INITIATE_RUN')`,
      `!(r.action.type === 'INITIATE_RUN' && (__multi ? __priced.has(r.action.targetServerId) : ran))`,
    ],
  ];
}

/** (c), (c2): a run in a playout of the deciding Runner played in the engine (PlannerAI.playRun from runnerAI.ts plan). */
function played(mode: 'full' | 'ice', eight: boolean): Patch[] {
  const p: Patch[] = [
    [
      'ai/turnPlanner.ts',
      `  line?(): { rank(state: GameState): ScoredAction[]; first(state: GameState, action: GameAction): void; step(state: GameState, pick: GameAction | null): GameAction | null };`,
      `  line?(): { rank(state: GameState): ScoredAction[]; first(state: GameState, action: GameAction): void; step(state: GameState, pick: GameAction | null): GameAction | null };
  /** count 3 arm (c)/(c2): the run under way played (to its end or its breach); value: the breach's price when not played. */
  playRun?(state: GameState): { state: GameState; value: number } | null;`,
    ],
    [
      'ai/turnPlanner.ts',
      `    if (ran || !ai.runWorth || !after.activeRun) return null;`,
      `    if (ai.playRun && after.activeRun) {
      ran = true;
      const r = ai.playRun(after);
      if (!r) return null;
      bonus += r.value;
      return r.state;
    }
    if (ran || !ai.runWorth || !after.activeRun) return null;`,
    ],
    [
      'ai/turnPlanner.ts',
      `    if (action.type === 'INITIATE_RUN') {
      // Not played out`,
      `    if (action.type === 'INITIATE_RUN' && ai.playRun) {
      ran = true;
      try {
        const r = ai.playRun(executeAction(state, action));
        if (!r) return null;
        bonus += r.value;
        return r.state;
      } catch {
        return null;
      }
    }
    if (action.type === 'INITIATE_RUN') {
      // Not played out`,
    ],
    // no cap: the engine's record of the run stands
    ['ai/turnPlanner.ts', `!(ran && r.action.type === 'INITIATE_RUN')`, `!(ran && !ai.playRun && r.action.type === 'INITIATE_RUN')`],
    [
      'ai/runnerAI.ts',
      `import { RATES } from './valueModel';`,
      `import { RATES } from './valueModel';
import { GameRunner } from './playout';
import { activePrompt as __activePrompt } from '../core';`,
    ],
    [
      'ai/runnerAI.ts',
      `      { rank: s => rollout.rankMainActions(s), answer: s => rollout.chooseAction(s), runWorth:`,
      `      { playRun: (${G}.__giDeciding ? (s: GameState) => playRunIn(s, rollout, options, '${mode}') : undefined), rank: s => rollout.rankMainActions(s), answer: s => rollout.chooseAction(s), runWorth:`,
    ],
    [
      'ai/runnerAI.ts',
      `const READ_WRITE_SHARE = '36022';`,
      `const READ_WRITE_SHARE = '36022';

/** count 3 arm (c)/(c2): plays the run under way on the playout's board; the Corp by a planner-off Normal Corp. */
function playRunIn(start: GameState, rollout: HeuristicRunnerAI, options: { memory: RunnerMemory; wary: boolean }, mode: 'full' | 'ice'): { state: GameState; value: number } | null {
  const make = (HeuristicRunnerAI as any).__makeCorp as (() => any) | undefined;
  if (!make || !start.activeRun) return null;
  const server = start.activeRun.server;
  const g = new GameRunner(start, { corp: make(), runner: rollout });
  ${G}.__giPlayed = (${G}.__giPlayed ?? 0) + 1;
  for (let i = 0; i < 300; i++) {
    const s = g.state;
    if (s.winner) break;
    if (!s.activeRun && !__activePrompt(s)) break;
    if (s.activeRun && s.activePlayer !== 'runner') break;
    if (${mode === 'ice' ? 'true' : 'false'} && s.activeRun && s.activeRun.phase === 'approach_server' && s.activeRun.server === server) {
      const earlier = s.runsThisTurn.slice(0, -1);
      const off = { ...s, activeRun: null, pendingPrompts: [], runsThisTurn: earlier };
      const value = serverValue(off, server, 0, options.memory, options.wary);
      return { state: { ...off, runsThisTurn: [...earlier, { server, successful: true }] }, value };
    }
    try {
      if (!g.step()) break;
    } catch {
      return null;
    }
  }
  const end = g.state;
  // back to the playout's own settings (GameRunner set both stops to 'ai')
  return { state: { ...end, stops: start.stops }, value: 0 };
}`,
    ],
    ['ai/index.ts', `export function createAgent(`, `(HeuristicRunnerAI as any).__makeCorp = () => new HeuristicCorpAI({ planner: false });\n\nexport function createAgent(`],
  ];
  if (eight)
    p.push([
      'ai/turnPlanner.ts',
      `      const value = playout(root, side, c.action, ai, line, ends);`,
      `      let value = playout(root, side, c.action, ai, line, ends);
      if (side === 'runner' && ${G}.__giDeciding && Number.isFinite(value)) {
        const __salt = ${G}.__giSalt ?? 0;
        let __sum = value;
        let __n = 1;
        for (let k = 1; k < 8; k++) {
          ${G}.__giSalt = (__salt ^ Math.imul(k, 0x9e3779b1)) >>> 0;
          const __seed = decisionSeedFor(state, side);
          const __root = runnerDecisionView(state, ai.known);
          ${G}.__giSalt = __salt;
          const v = withPricing({ frozen: true, decisionSeed: __seed }, () => playout(__root, side, c.action, ai, [], {}));
          if (Number.isFinite(v)) { __sum += v; __n++; }
        }
        value = __sum / __n;
      }`,
    ]);
  return p;
}

export function patches(arm: Arm): Patch[] {
  const base = record();
  switch (arm) {
    case 'beta':
    case 'control':
    case 'source':
      return base;
    case 'repeatRepaired':
      return [...base, ...repaired()];
    case 'runsPriced':
      return [...base, ...repaired(), ...priced()];
    case 'runsPlayed':
      return [...base, ...played('full', false)];
    case 'runsPlayed8':
      return [...base, ...played('full', true)];
    case 'icePlayed':
      return [...base, ...played('ice', false)];
  }
}

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
  runs: any;
  hold: any;
  turnPlanner: any;
  pricing: any;
  handValues: any;
  synergy: any;
  clear: () => void;
}

export async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts', 'ai/runs.ts', 'ai/corp/hold.ts', 'ai/turnPlanner.ts', 'ai/pricing.ts', 'ai/synergy.ts'])
    mods.push(await m(p));
  const [ai, po, core, decks, hv, ev, vm, iv, runs, hold, turnPlanner, pricing, synergy] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    core,
    decks,
    runs,
    hold,
    turnPlanner,
    pricing,
    handValues: hv,
    synergy,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
