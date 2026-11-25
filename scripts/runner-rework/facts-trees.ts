/**
 * R-A A-log (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/a-log.md rev 2): the two trees the log reads.
 *
 * `source` is this checkout's src copied unchanged: it plays the source games (plain GameRunner) and is never asked or
 * cleared mid-game. `eval` is a second copy whose only changes are exports (no line of logic changes): the log reads
 * private functions of runs.ts (SUB_RULES, subroutineDamage, runPrices, selfBreakPrice, borrowedSubroutines) and the
 * walk's own rez set when it does not hold (hold.ts walkPick: the set that asks the most, the set policy (b) of L9 needs).
 * Each patch must match exactly once (a stop otherwise, as count 2's trees).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Patch = [file: string, at: string, to: string];

const EVAL_PATCHES: Patch[] = [
  // Exports only: the log reads these private readers by name
  [
    'ai/runs.ts',
    `const CHAIN_REACTION = '36001';`,
    `export { SUB_RULES as __SUB_RULES, subroutineDamage as __subroutineDamage, runPrices as __runPrices, selfBreakPrice as __selfBreakPrice, borrowedSubroutines as __borrowedSubroutines, plainIcePrice as __plainIcePrice };\nconst CHAIN_REACTION = '36001';`,
  ],
  // The walk's set that asks the most when nothing holds (the answer's own set; a field added to the returned object only)
  ['ai/corp/hold.ts', `    rez: null,\n    rezCost: Infinity,\n    need,`, `    rez: null,\n    rezCost: Infinity,\n    rezMost: ids(a.set),\n    need,`],
];

/**
 * The L9 count's arms (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/l9-residual.md): one fact difference set
 * equal at a time. Each patch reads `L9ARM` (an object exported from runs.ts, empty unless the measuring script sets a
 * key) and changes nothing while its key is unset: every patch is "if the arm's key is set, read the other side's fact;
 * else the line as it was". Hooks are functions the script sets (it holds the other side's reading); flags are booleans.
 * Applied to the eval tree only when makeTrees is asked for them (facts-l9.ts); facts-log and facts-golden are unchanged.
 */
const L9_PATCHES: Patch[] = [
  // The arm object, and the readers the script needs to build the overrides (exports only)
  ['ai/runs.ts', `export const BLOCK = Infinity;`, `export const BLOCK = Infinity;\n// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport const L9ARM: Record<string, any> = {};\nconst __grip = (state: GameState): number => (L9ARM.grip ? L9ARM.grip(state) : state.runner.grip.length);`],
  ['ai/runs.ts', `const CHAIN_REACTION = '36001';`, `export { SUB_RULES as __L9_SUB_RULES, rulesFor as __rulesFor, NEXT as __NEXT, ownRun as __ownRun };\nconst CHAIN_REACTION = '36001';`],
  // L1, L2, L4 (Runner side): the price of one subroutine, overridden by the arm's hook where it says so (undefined: as it was)
  ['ai/runs.ts', `export function knownSubroutineCost(state: GameState, label: string): number | undefined {`, `export function knownSubroutineCost(state: GameState, label: string): number | undefined {\n  if (L9ARM.cost) {\n    const o = L9ARM.cost(state, label);\n    if (o !== undefined) return o === null ? undefined : o;\n  }`],
  ['ai/runs.ts', `export function subroutineBlocks(state: GameState, label: string): boolean {`, `export function subroutineBlocks(state: GameState, label: string): boolean {\n  if (L9ARM.cost) {\n    const o = L9ARM.cost(state, label);\n    if (o !== undefined) return o === BLOCK;\n  }`],
  // L2 (Runner side): the damage a subroutine does in the tank
  ['ai/runs.ts', `function subroutineDamage(label: string, tags: number): number {`, `function subroutineDamage(label: string, tags: number): number {\n  if (L9ARM.damage) return L9ARM.damage(label, tags);`],
  // BLOCK as lethal damage (Runner side): the grip the lethal tests read (the arm: the grip the walk can come to hold)
  ['ai/runs.ts', `const lethal = (state: GameState, n: number) => n > state.runner.grip.length;`, `const lethal = (state: GameState, n: number) => n > __grip(state);`],
  ['ai/runs.ts', `(Number(unless[1]) > state.runner.grip.length ? BLOCK`, `(Number(unless[1]) > __grip(state) ? BLOCK`],
  ['ai/runs.ts', `(2 > state.runner.grip.length ? BLOCK`, `(2 > __grip(state) ? BLOCK`],
  ['ai/runs.ts', `return x > state.runner.grip.length ? BLOCK`, `return x > __grip(state) ? BLOCK`],
  ['ai/runs.ts', `return n > state.runner.grip.length ? BLOCK : n * coreDamageWorth`, `return n > __grip(state) ? BLOCK : n * coreDamageWorth`],
  ['ai/runs.ts', `return n > state.runner.grip.length ? BLOCK : damageWorth(state, n, ownRun(state));`, `return n > __grip(state) ? BLOCK : damageWorth(state, n, ownRun(state));`],
  ['ai/runs.ts', `if (lethal === undefined && damage > state.runner.grip.length) lethal = p.i;`, `if (lethal === undefined && damage > __grip(state)) lethal = p.i;`],
  ['ai/runs.ts', `damage > state.runner.grip.length; damage = damageOf()`, `damage > __grip(state); damage = damageOf()`],
  // L13 (Runner side): the run's prices worked out ice by ice outermost first, the bioroid clicks shared (the hook)
  ['ai/runs.ts', `const prices = new Map(ices.map(ice => [ice.instanceId, icePrice(state, ice)] as const));`, `const prices: Map<string, IcePrice> = L9ARM.seqPrices ? L9ARM.seqPrices(state, ices) : new Map(ices.map(ice => [ice.instanceId, icePrice(state, ice)] as const));`],
  ['ai/runs.ts', `  if (state.activePlayer === 'runner' && clicks > (state.activeRun ? state.runner.clicks : state.runner.clicks - 1)) return BLOCKED;\n  return { credits: 0, value: clicks * 1.5 };`, `  if (state.activePlayer === 'runner' && clicks > (L9ARM.clicksLeft !== undefined ? L9ARM.clicksLeft : state.activeRun ? state.runner.clicks : state.runner.clicks - 1)) return BLOCKED;\n  return L9ARM.clicksLeft !== undefined ? ({ credits: 0, value: clicks * 1.5, clicks } as IcePrice) : { credits: 0, value: clicks * 1.5 };`],
  // Approach toll (Runner side): Manegarm's toll as the walk reads it (the walk has none)
  ['ai/runs.ts', `export function approachCost(state: GameState, serverId: string, clicks: number, credits: number): { cost: number; credits: number } | null {`, `export function approachCost(state: GameState, serverId: string, clicks: number, credits: number): { cost: number; credits: number } | null {\n  if (L9ARM.noToll) return { cost: 0, credits: 0 };`],
  // The walk's side
  ['ai/corp/hold.ts', `import { SubEffect, SubFacts, bioroidBreakClicks`, `import { L9ARM, SubEffect, SubFacts, bioroidBreakClicks`],
  // L1, L2, L4 (walk side): the facts of one subroutine as met, overridden by the hook (the Runner's reading of the same board)
  ['ai/corp/hold.ts', `    const subs = plannedSubroutines(view, up).map(sub => subroutineFacts(sub.label));`, `    const subs = plannedSubroutines(view, up).map(sub => (L9ARM.facts ? L9ARM.facts(view, up, sub.label, subroutineFacts(sub.label)) : subroutineFacts(sub.label)));`],
  // L7 (walk side): no card acts as a run begins, no hosted counter pays
  ['ai/corp/hold.ts', `export const counterCredits = (c: CardInstance): number => {`, `export const counterCredits = (c: CardInstance): number => {\n  if (L9ARM.noRunBegin) return 0;`],
  ['ai/corp/hold.ts', `    runBegins: runBegins(state, start),`, `    runBegins: L9ARM.noRunBegin ? [] : runBegins(state, start),`],
  // L12 (walk side): the lenders the Runner reads (rezzed on the board now; none the walk rezzes)
  ['ai/corp/hold.ts', `    lenders: borrows ? lenders(state, targets, start.derezzed) : [],`, `    lenders: borrows ? (L9ARM.lendNow ? lenderViews(state, new Map(), new Set()).flatMap(v => (v.unwalked ? [v.unwalked] : [])) : lenders(state, targets, start.derezzed)) : [],`],
  // L8 (walk side): the Runner's bypasses on its own board (the hook), not on the rez set's board
  ['ai/corp/hold.ts', `  const bypassed = all.length ? runBypasses(bypassBoard(view, server, base, set), server) : undefined;`, `  const bypassed = all.length ? (L9ARM.bypass ? L9ARM.bypass(server) : runBypasses(bypassBoard(view, server, base, set), server)) : undefined;`],
  // Retry (walk side, an arm the brief did not name): one run, no run after a failed one (the Runner's feasibility is one run)
  ['ai/corp/hold.ts', `if (need > q.budget && turnNeed(q, target, memos.turn, true) + q.sets[k].price > q.budget) return`, `if (need > q.budget && (L9ARM.noRetry || turnNeed(q, target, memos.turn, true) + q.sets[k].price > q.budget)) return`],
  // Losses (walk side, an arm the brief did not name): credits and clicks a subroutine or toll takes are not counted (the
  // Runner's feasibility prices them as worth, not as credits)
  ['ai/corp/hold.ts', `        return lose(next(ws), e.n);`, `        return L9ARM.noLoss ? next(ws) : lose(next(ws), e.n);`],
  ['ai/corp/hold.ts', `        return next({ ...ws, clicks: Math.max(0, ws.clicks - e.n) });`, `        return next(L9ARM.noLoss ? ws : { ...ws, clicks: Math.max(0, ws.clicks - e.n) });`],
  ['ai/corp/hold.ts', `    if (e.loses) return lose(this.toll(ws, e, then, at), e.loses);`, `    if (e.loses && !L9ARM.noLoss) return lose(this.toll(ws, e, then, at), e.loses);`],
  // Partial break (walk side, an arm the brief did not name): the Runner breaks every open subroutine or none, as the
  // Runner's run price does (plainIcePrice: tank all or break all)
  ['ai/corp/hold.ts', `    for (let set = 0; set < (ice.resolving ? 1 : 1 << open.length); set++) {`, `    for (let set = 0; set < (ice.resolving ? 1 : 1 << open.length); set++) {\n      if (L9ARM.allOrNone && set !== 0 && set !== (1 << open.length) - 1) continue;`],
  // A run begun with no click (walk side, an arm the brief did not name): the walk's rest of the turn is given the run's
  // click when the Runner has none (a card began the run)
  ['ai/corp/hold.ts', `export const restOfTurn = (s: GameState, credits = s.runner.credits): TurnFrom => ({ rest: true, clicks: Math.max(0, s.runner.clicks), credits });`, `export const restOfTurn = (s: GameState, credits = s.runner.credits): TurnFrom => ({ rest: true, clicks: Math.max(L9ARM.runClick ? 1 : 0, s.runner.clicks), credits });`],
  // BLOCK as lethal damage (walk side): no draw before a run (the Runner's grip is the grip now)
  ['ai/corp/hold.ts', `    this.drawUseful = doubling`, `    this.drawUseful = !L9ARM.noDraw && (doubling`],
  ['ai/corp/hold.ts', `gripMost > board.grip || (retries && gripMost > 0);`, `gripMost > board.grip || (retries && gripMost > 0));`],
];

export interface Tree {
  name: string;
  createAgent: (side: string, level: string) => any;
  GameRunner: any;
  core: any;
  decks: any;
  runs: any;
  hold: any;
  rez: any;
  ice: any;
  effects: any;
  cards: any;
  pricing: any;
  handValues: any;
  synergy: any;
  iceValues: any;
  evaluate: any;
  payoutRisk: any;
  effectValues: any;
  clear: () => void;
}

export function makeTrees(root: string, opts: { l9?: boolean } = {}): { source: string; eval: string } {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs = { source: join(root, 'source'), eval: join(root, 'eval') };
  for (const [name, dir] of Object.entries(dirs)) {
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    if (name !== 'eval') continue;
    for (const [f, at, to] of [...EVAL_PATCHES, ...(opts.l9 ? L9_PATCHES : [])]) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length !== 2) throw new Error(`eval tree: a patch does not match once in ${f}: ${at.slice(0, 80)}`);
      writeFileSync(
        path,
        text.replace(at, () => to)
      );
    }
  }
  return dirs;
}

export async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const files = [
    'ai/index.ts',
    'ai/playout.ts',
    'core/index.ts',
    'data/decks.ts',
    'ai/handValues.ts',
    'ai/effectValues.ts',
    'ai/valueModel.ts',
    'ai/iceValues.ts',
    'ai/runs.ts',
    'ai/corp/hold.ts',
    'ai/corp/rez.ts',
    'core/engine/ice.ts',
    'core/engine/cardEffects.ts',
    'ai/cards/index.ts',
    'ai/pricing.ts',
    'ai/synergy.ts',
    'ai/evaluate.ts',
    'ai/payoutRisk.ts',
  ];
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of files) mods.push(await m(p));
  const [ai, po, core, decks, hv, ev, vm, iv, runs, hold, rez, ice, effects, cards, pricing, synergy, evaluate, payoutRisk] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    core,
    decks,
    runs,
    hold,
    rez,
    ice,
    effects,
    cards: cards.CARDS,
    pricing,
    handValues: hv,
    synergy,
    iceValues: iv,
    evaluate,
    payoutRisk,
    effectValues: ev,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
