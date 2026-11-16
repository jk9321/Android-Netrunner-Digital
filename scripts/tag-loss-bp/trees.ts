/* eslint-disable @typescript-eslint/no-explicit-any -- measurement trees around a globalThis probe */
/**
 * ai-tag-loss-bp (brief-tag-loss-bp.md rev 2): beta and the branch side by side, as scripts/tag-loss-bp/trees.ts on
 * branch ai-tag-loss-time measured arm BP. Each arm is a copy of a src/ tree with text patches; every patch must match
 * exactly once, so a tree that drifted from what the patch expects throws instead of measuring something else. Nothing
 * here is in src/.
 *
 *   base   beta's src/ (BASE, a git ref, default origin/beta: `git archive` of it), instrumentation only
 *   F      the ceiling, reference only: beta's src/ with tagsWorth the flat 3 a tag everywhere (the clock never runs)
 *   built  this checkout's src/ (the branch): tagLoss prices a resource by its own term plus its share of the plans;
 *          beta's tagLoss is kept beside it as tagLossToday for the values pass (shadow: the same board both ways)
 *
 * Every tree has the same probe (globalThis.__tl, a TlProbe): tag-clock prices and their viewer, rig values, drawWorth
 * calls and misses, countRezBudget runs and hold counts started inside the clock, size-capped cache clears, plan copies,
 * and the clock's own wall time. With `shadow` on, each tagClock also works out beta's per-turn loss and worth on the
 * same board and the probe records the differences (higher, lower, past one tag clear, and lower clocks with no positive
 * cross term named: the brief's stop).
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ARMS = ['base', 'F', 'built'] as const;
export type Arm = (typeof ARMS)[number];

const once = (text: string, from: string, to: string, file: string): string => {
  if (text.split(from).length !== 2) throw new Error(`${file}: patch does not match once: ${from.slice(0, 100)}`);
  return text.replace(from, () => to);
};
function edit(dir: string, file: string, f: (text: string) => string) {
  const path = join(dir, 'src', file);
  writeFileSync(path, f(readFileSync(path, 'utf8')));
}
const G = '(globalThis as any).__tl';

/** The text of a top-level function, from its header to the first line that is just `}`. */
function fnText(text: string, header: string, file: string): string {
  const at = text.indexOf(header);
  if (at < 0 || text.indexOf(header, at + 1) >= 0) throw new Error(`${file}: no single ${header}`);
  const end = text.indexOf('\n}\n', at);
  return text.slice(at, end + 2);
}

// --- tagLoss, as today -------------------------------------------------------------------------------------------
const TAGLOSS_HEAD = 'function tagLoss(state: GameState, viewer: SideCode, skip: number): number {';
const RESOURCES_LINE = '  const resources = state.runner.rig.resources.map(r => rig - runnerRigValue({ ...state, runner: { ...state.runner, rig: { ...state.runner.rig, resources: state.runner.rig.resources.filter(c => c !== r) } } }));';
const EXTRA_LINE = '  const extra = (r: CardInstance) => (plan().hqTrashCost ? hqTrashCardsLoss(state, r) : 0);';

/**
 * Beta's tagLoss (arm 0 in, beta fddc803) and the same with arm 0 put back to the text the instrumentation patches (beta
 * 8e28403's; arm 0 is exact, so the same numbers). The built tree keeps TAGLOSS_ARM0 as tagLossToday for the values pass.
 */
const TAGLOSS_ARM0 = "function tagLoss(state: GameState, viewer: SideCode, skip: number): number {\n  const corp = state.corp;\n  const owned = state.runner.rig.resources;\n  // The best resource the Corp would trash, net of what trashing costs it (the basic action \"[click], 2[credit]: Trash 1\n  // resource\", rule 5.2.6g). No rig is priced when no resource could be the answer (ai-tag-loss-time arm 0, exact: the\n  // loss is the same number): the Runner has none; none is left past `skip` (the one tagTrashNow takes this turn); or\n  // the Corp has under the 2 credits the action costs. The trash part is then 0, as max(trash, 0) below made it\n  let trash = 0;\n  if (owned.length > skip && corp.credits >= 2) {\n    const rig = runnerRigValue(state);\n    const resources = owned.map(r => rig - runnerRigValue({ ...state, runner: { ...state.runner, rig: { ...state.runner.rig, resources: owned.filter(c => c !== r) } } }));\n    // plan.hqTrashCost: a resource that also costs cards from HQ to trash is worth that much less to trash\n    const extra = (r: CardInstance) => (plan().hqTrashCost ? hqTrashCardsLoss(state, r) : 0);\n    const nets = resources.map((v, i) => v - extra(owned[i])).sort((a, b) => b - a);\n    // plan.tagTrashNow: a Corp that can trash now takes the best one this turn; the turns after lose the next best\n    trash = Math.max(0, nets[skip] ?? 0) - (CLICK + 2);\n  }\n";
const TAGLOSS_BEFORE = "function tagLoss(state: GameState, viewer: SideCode, skip: number): number {\n  const corp = state.corp;\n  // The best resource the Corp would trash, net of what trashing costs it\n  const rig = runnerRigValue(state);\n  const resources = state.runner.rig.resources.map(r => rig - runnerRigValue({ ...state, runner: { ...state.runner, rig: { ...state.runner.rig, resources: state.runner.rig.resources.filter(c => c !== r) } } }));\n  // plan.hqTrashCost: a resource that also costs cards from HQ to trash is worth that much less to trash\n  const extra = (r: CardInstance) => (plan().hqTrashCost ? hqTrashCardsLoss(state, r) : 0);\n  const nets = resources.map((v, i) => v - extra(state.runner.rig.resources[i])).sort((a, b) => b - a);\n  // plan.tagTrashNow: a Corp that can trash now takes the best one this turn; the turns after lose the next best\n  const trash = Math.max(0, nets[skip] ?? 0) - (corp.credits >= 2 ? CLICK + 2 : Infinity);\n";

/** The branch's tagLoss lines the built tree's instrumentation hooks (src/ai/evaluate.ts on ai-tag-loss-bp). */
const BUILT_RESOURCES_LINE = '    const resources = owned.map(r => addRigCard(state, r, 0) + share(r));';
const BUILT_SHARE = '(plans === undefined ? 0 : plans - boardPlansWorth(';

/** The instrumentation, the same in every tree (applied before the arm's own patches, which keep its lines). */
function instrument(dir: string, built: boolean) {
  edit(dir, 'ai/evaluate.ts', t => {
    if (!built) t = once(t, TAGLOSS_ARM0, TAGLOSS_BEFORE, 'evaluate.ts');
    // the clock's per-turn loss: entered/left (depth and the outermost wall time), each computation counted
    t = once(t, 'function tagLossPerTurn(state: GameState, viewer: SideCode, skip = 0): number {', 'function tagLossPerTurnP(state: GameState, viewer: SideCode, skip = 0): number {', 'evaluate.ts');
    t += `
// tag-loss-time probe (scripts/tag-loss-bp/trees.ts)
function tagLossPerTurn(state: GameState, viewer: SideCode, skip = 0): number {
  const g = ${G};
  if (!g || g.baseMode) return tagLossPerTurnP(state, viewer, skip);
  g.enter(viewer);
  try { return tagLossPerTurnP(state, viewer, skip); } finally { g.exit(); }
}
`;
    // the price's kind, counted on today's tagLoss (every arm reaches it unless baseMode, see armTagLoss)
    t = once(t, `${TAGLOSS_HEAD}\n  const corp = state.corp;`, `${TAGLOSS_HEAD}\n  const corp = state.corp;\n  if (${G} && !${G}.baseMode) ${G}.price(state, skip, viewer);`, 'evaluate.ts');
    t = once(t, EXTRA_LINE, `  const extra = (r: CardInstance) => { const v = plan().hqTrashCost ? hqTrashCardsLoss(state, r) : 0; if (v === Infinity && ${G} && !${G}.baseMode) ${G}.untrash++; return v; };`, 'evaluate.ts');
    if (!built) t = once(t, RESOURCES_LINE, `${RESOURCES_LINE}\n  if (${G}?.shadow) ${G}.lastTerms = state.runner.rig.resources.map((r, i) => [r.cardCode, resources[i]]);`, 'evaluate.ts');
    else {
      t = once(t, BUILT_RESOURCES_LINE, `${BUILT_RESOURCES_LINE}
    if (${G}?.shadow) ${G}.lastTerms = owned.map((r, i) => [r.cardCode, resources[i]]);
    if (${G}?.byCard && ${G}.shadowDepth > 0) owned.forEach((r, i) => ${G}.cross(cardDef(r).title, __crossTerms(state, r), resources[i]));`, 'evaluate.ts');
      t = once(t, BUILT_SHARE, `(plans === undefined ? 0 : (${G}?.planCopy(), plans) - boardPlansWorth(`, 'evaluate.ts');
    }
    t = once(t, 'export function runnerRigValue(state: GameState): number {', `export function runnerRigValue(state: GameState): number {\n  if (${G}) ${G}.rigValue();`, 'evaluate.ts');
    // the values pass: tagClock worked out again with today's per-turn loss on the same board
    t = once(t, 'function tagClock(state: GameState, viewer: SideCode, tags: number, actual: boolean, memoHome?: GameState): number {', 'function tagClockP(state: GameState, viewer: SideCode, tags: number, actual: boolean, memoHome?: GameState, override?: (skip: number) => number): number {', 'evaluate.ts');
    t = once(t, '  const perTurn = memoHome\n', '  const perTurn = override ? override(skip) : memoHome\n', 'evaluate.ts');
    t += `
function tagClock(state: GameState, viewer: SideCode, tags: number, actual: boolean, memoHome?: GameState): number {
  const v = tagClockP(state, viewer, tags, actual, memoHome);
  const g = ${G};
  if (!g?.shadow || g.baseMode) return v;
  let armTurn = 0, todayTurn = 0, armTerms: unknown = null, todayTerms: unknown = null;
  if (g.shadowDepth === 0) g.posCross = false;
  g.shadowDepth++;
  try {
    const armWorth = tagClockP(state, viewer, tags, actual, memoHome, skip => { g.lastTerms = null; armTurn = tagLossPerTurnP(state, viewer, skip); armTerms = g.lastTerms; return armTurn; });
    g.baseMode = true;
    let todayWorth: number;
    try {
      todayWorth = tagClockP(state, viewer, tags, actual, memoHome, skip => { g.lastTerms = null; todayTurn = tagLossPerTurnP(state, viewer, skip); todayTerms = g.lastTerms; return todayTurn; });
    } finally { g.baseMode = false; }
    if (g.shadowDepth === 1) g.compare({ armTurn, todayTurn, armWorth, todayWorth, armTerms, todayTerms, viewer, tags, ident: state.runner.identity.cardCode }, CLICK + 2, state);
  } finally { g.shadowDepth--; }
  return v;
}
`;
    return t;
  });
  edit(dir, 'ai/handValues.ts', t => {
    t = once(t, 'function drawWorth(state: GameState, side: SideCode): number {', `function drawWorth(state: GameState, side: SideCode): number {\n  if (${G}) ${G}.draw(side);`, 'handValues.ts');
    t = once(t, '  if (deckAverage.size > 500) deckAverage.clear();\n  deckAverage.set(key, value);', `  if (${G}) ${G}.drawMiss(side);\n  if (deckAverage.size > 500) (${G} && ${G}.clear('deckAverage'), deckAverage.clear());\n  deckAverage.set(key, value);`, 'handValues.ts');
    t = once(t, '  if (clickCache.size > 2000) clickCache.clear();', `  if (clickCache.size > 2000) (${G} && ${G}.clear('clickCache'), clickCache.clear());`, 'handValues.ts');
    return t;
  });
  edit(dir, 'ai/iceValues.ts', t => once(t, 'function countRezBudget(state: GameState, stops: Map<string, number> | null = null): Map<string, number> {', `function countRezBudget(state: GameState, stops: Map<string, number> | null = null): Map<string, number> {\n  if (${G}) ${G}.rezBudget();`, 'iceValues.ts'));
  edit(dir, 'ai/corp/hold.ts', t => once(t, 'function holdRunnerTurn(state: GameState, server: string, corpCredits: number): Hold {', `function holdRunnerTurn(state: GameState, server: string, corpCredits: number): Hold {\n  if (${G}) ${G}.hold();`, 'hold.ts'));
  edit(dir, 'ai/effectValues.ts', t => once(t, '  if (threats.size > 200) threats.clear();', `  if (threats.size > 200) (${G} && ${G}.clear('threats'), threats.clear());`, 'effectValues.ts'));
  // threatModel's cache went with the threat deletion (beta fddc803)
  edit(dir, 'ai/oracle.ts', t => once(t, '  if (playedOut.size > 2000) playedOut.clear();', `  if (playedOut.size > 2000) (${G} && ${G}.clear('oracle'), playedOut.clear());`, 'oracle.ts'));
}

/** The arm's own patches (after the instrumentation). */
function patchArm(dir: string, arm: Arm) {
  if (arm === 'F') {
    edit(dir, 'ai/evaluate.ts', t => once(t, "  if (pricing().pricingTagLoss) return logValue('tag', 'tagsWorth flat (tag clock)'", "  if (true) return logValue('tag', 'tagsWorth flat (tag clock)'", 'evaluate.ts'));
    return;
  }
  if (arm !== 'built') return;
  // beta's tagLoss beside the branch's, for the values pass (baseMode); its counts stay off (the price line is guarded)
  edit(dir, 'ai/evaluate.ts', t => {
    // beta's text: its rig part (TAGLOSS_ARM0) and the punisher part, which the branch did not change
    const own = fnText(t, TAGLOSS_HEAD, 'evaluate.ts');
    const today = TAGLOSS_ARM0 + own.slice(own.indexOf('  // A tag punisher in HQ'));
    t = once(t, `${TAGLOSS_HEAD}\n`, `${TAGLOSS_HEAD}\n  if (${G}?.baseMode) return tagLossToday(state, viewer, skip);\n`, 'evaluate.ts');
    return `${t}
// ai-tag-loss-bp trees: beta fddc803's tagLoss, for the values pass
${today.replace(TAGLOSS_HEAD, 'function tagLossToday(state: GameState, viewer: SideCode, skip: number): number {')}
/**
 * The values pass's decomposition (G.byCard): what beta's copy difference for resource r is made of, beside the branch's
 * term (own term plus the plans' share): each other rig card's term on the full board less on the copy (keyed by the card
 * and its branch: payout = a profiled card, whose term reads the deck average; card = runnerCardValue + counters + hosted;
 * breaker = counters + hosted only), and the rest (breaker coverage). total = beta's term less the branch's.
 */
function __crossTerms(state: GameState, r: CardInstance): { total: number; parts: Record<string, number> } {
  const rig = state.runner.rig;
  const copy = { ...state, runner: { ...state.runner, rig: { ...rig, resources: rig.resources.filter(x => x !== r) } } };
  const plans = boardPlansWorth(state, 'runner') - boardPlansWorth(copy, 'runner');
  const total = runnerRigValue(state) - runnerRigValue(copy) - addRigCard(state, r, 0) - plans;
  const parts: Record<string, number> = {};
  let named = 0;
  for (const c of [...rig.programs, ...rig.hardware, ...rig.resources]) {
    if (c === r) continue;
    const d = addRigCard(state, c, 0) - addRigCard(copy, c, 0);
    if (Math.abs(d) <= 1e-9) continue;
    const kind = profileOf(c.cardCode) ? 'payout' : isIcebreaker(c) ? 'breaker' : 'card';
    parts[cardDef(c).title + ' (' + kind + ')'] = (parts[cardDef(c).title + ' (' + kind + ')'] ?? 0) + d;
    named += d;
  }
  const rest = total - named;
  if (Math.abs(rest) > 1e-9) parts['coverage (breakers, MU, ice odds)'] = rest;
  return { total, parts };
}
`;
  });
}

/** Builds the arms' trees under `root` and returns their directories. */
export function makeTrees(root: string, arms: readonly Arm[] = ARMS): Record<Arm, string> {
  rmSync(root, { recursive: true, force: true });
  const base = join(root, '_base');
  if (arms.some(a => a !== 'built')) {
    // beta's src/ (BASE: a git ref; a full SHA is fetched first when this clone does not have it)
    const ref = process.env.BASE ?? 'origin/beta';
    mkdirSync(base, { recursive: true });
    try {
      execSync(`git cat-file -e ${ref}^{commit}`, { stdio: 'ignore' });
    } catch {
      execSync(`git fetch -q --depth=1 origin ${ref}`, { stdio: 'inherit' });
    }
    execSync(`git archive ${ref} src | tar -x -C ${base}`);
  }
  const out = {} as Record<Arm, string>;
  for (const arm of arms) {
    const dir = join(root, arm);
    mkdirSync(dir, { recursive: true });
    cpSync(arm === 'built' ? 'src' : join(base, 'src'), join(dir, 'src'), { recursive: true });
    instrument(dir, arm === 'built');
    patchArm(dir, arm);
    out[arm] = dir;
  }
  return out;
}

export const treeRoot = (name: string) => resolve('.tl-trees', name);

/** What one decision did, as the probe saw it. */
export interface Tally {
  /** tagLoss runs (the clock's per-turn prices actually worked out) and their kind. */
  prices: number;
  r0: number;
  rSkip: number;
  broke: number;
  priced: number;
  /** resources HQ can't pay to trash (hqTrashCardsLoss Infinity), counted where their copy's value is asked. */
  untrash: number;
  /** runnerRigValue calls: all, and inside the clock. */
  rig: number;
  rigIn: number;
  /** drawWorth calls and misses (worked out and stored), Runner side, all and inside the clock; Corp side all. */
  drawR: number;
  drawRIn: number;
  missR: number;
  missRIn: number;
  drawC: number;
  missC: number;
  /** countRezBudget runs and hold counts (holdRunnerTurn) started: all, and inside the clock. */
  rez: number;
  rezIn: number;
  hold: number;
  holdIn: number;
  /** Size-capped cache clears, by cache. */
  clears: Record<string, number>;
  /** ms inside the clock (outermost tagLossPerTurn). */
  msIn: number;
  /** by the viewer: tagLoss runs, and ms inside the outermost clock (nested clocks' time counts in the outer's viewer). */
  pricesCorpView: number;
  pricesRunnerView: number;
  msInCorpView: number;
  msInRunnerView: number;
  /** arm A: copies whose deck average was the full board's; arm S: averages served, stack cards priced. */
  heldServed: number;
  stackServed: number;
  stackPriced: number;
  /** arm BP: copies of the state made to price the combo plans without a resource. */
  planCopies: number;
}
const zero = (): Tally => ({ prices: 0, r0: 0, rSkip: 0, broke: 0, priced: 0, untrash: 0, rig: 0, rigIn: 0, drawR: 0, drawRIn: 0, missR: 0, missRIn: 0, drawC: 0, missC: 0, rez: 0, rezIn: 0, hold: 0, holdIn: 0, clears: {}, msIn: 0, pricesCorpView: 0, pricesRunnerView: 0, msInCorpView: 0, msInRunnerView: 0, heldServed: 0, stackServed: 0, stackPriced: 0, planCopies: 0 });

/** One resource's cross terms (today's copy difference less its own term), summed over a decision's clocks. */
export interface CardCross { n: number; moved: number; pos: number; neg: number; sum: number; abs: number; max: number; ownSum: number; parts: Record<string, { n: number; sum: number; abs: number }> }

export interface Diff { armTurn: number; todayTurn: number; armWorth: number; todayWorth: number; armTerms: unknown; todayTerms: unknown; viewer: string; tags: number; ident: string }
/** The values pass: per-turn loss and tag worth, the arm's against today's on the same board. */
export interface Values { n: number; turnHigher: number; turnLower: number; turnClear: number; lowerUntraced: number; turnBig: number; worthBig: number; turnDiff: number; turnSum: number; turnAbs: number; worthDiff: number; worthSum: number; worthAbs: number; nonFinite: number; largest: (Diff & { d: number }) | null }
const zeroValues = (): Values => ({ n: 0, turnHigher: 0, turnLower: 0, turnClear: 0, lowerUntraced: 0, turnBig: 0, worthBig: 0, turnDiff: 0, turnSum: 0, turnAbs: 0, worthDiff: 0, worthSum: 0, worthAbs: 0, nonFinite: 0, largest: null });

export class TlProbe {
  t: Tally = zero();
  v: Values = zeroValues();
  depth = 0;
  private t0 = 0;
  baseMode = false;
  shadow = false;
  /** values pass, B arms: decompose each resource's today term (cross, by card). */
  byCard = false;
  cards: Record<string, CardCross> = {};
  shadowDepth = 0;
  lastTerms: unknown = null;
  /** this clock (outermost shadow): some resource's cross term was positive past 1e-9 (beta's term above the branch's) */
  posCross = false;
  reset(): { t: Tally; v: Values; cards: Record<string, CardCross> } {
    const out = { t: this.t, v: this.v, cards: this.cards };
    this.cards = {};
    this.t = zero();
    this.v = zeroValues();
    this.depth = 0;
    this.baseMode = false;
    this.shadowDepth = 0;
    return out;
  }
  private viewer = '';
  enter(viewer: string) {
    if (this.depth++ === 0) {
      this.t0 = performance.now();
      this.viewer = viewer;
    }
  }
  exit() {
    if (--this.depth === 0) {
      const ms = performance.now() - this.t0;
      this.t.msIn += ms;
      if (this.viewer === 'corp') this.t.msInCorpView += ms;
      else this.t.msInRunnerView += ms;
    }
  }
  price(state: any, skip: number, viewer?: string) {
    if (this.baseMode) return;
    const t = this.t;
    t.prices++;
    if (viewer === 'corp') t.pricesCorpView++;
    else t.pricesRunnerView++;
    const r = state.runner.rig.resources.length;
    if (r === 0) t.r0++;
    else if (r <= skip) t.rSkip++;
    else if (state.corp.credits < 2) t.broke++;
    else t.priced++;
  }
  get untrash() { return this.t.untrash; }
  set untrash(n: number) { if (!this.baseMode) this.t.untrash = n; }
  get heldServed() { return this.t.heldServed; }
  set heldServed(n: number) { this.t.heldServed = n; }
  get stackServed() { return this.t.stackServed; }
  set stackServed(n: number) { this.t.stackServed = n; }
  get stackPriced() { return this.t.stackPriced; }
  set stackPriced(n: number) { this.t.stackPriced = n; }
  rigValue() {
    if (this.baseMode) return;
    this.t.rig++;
    if (this.depth > 0) this.t.rigIn++;
  }
  draw(side: string) {
    if (this.baseMode) return;
    if (side === 'runner') {
      this.t.drawR++;
      if (this.depth > 0) this.t.drawRIn++;
    } else this.t.drawC++;
  }
  drawMiss(side: string) {
    if (this.baseMode) return;
    if (side === 'runner') {
      this.t.missR++;
      if (this.depth > 0) this.t.missRIn++;
    } else this.t.missC++;
  }
  rezBudget() {
    if (this.baseMode) return;
    this.t.rez++;
    if (this.depth > 0) this.t.rezIn++;
  }
  hold() {
    if (this.baseMode) return;
    this.t.hold++;
    if (this.depth > 0) this.t.holdIn++;
  }
  planCopy() {
    if (!this.baseMode) this.t.planCopies++;
  }
  clear(name: string) {
    this.t.clears[name] = (this.t.clears[name] ?? 0) + 1;
  }
  cross(card: string, x: { total: number; parts: Record<string, number> }, own: number) {
    const c = (this.cards[card] ??= { n: 0, moved: 0, pos: 0, neg: 0, sum: 0, abs: 0, max: 0, ownSum: 0, parts: {} });
    c.n++;
    c.ownSum += own;
    if (Math.abs(x.total) <= 1e-9) return;
    c.moved++;
    if (x.total > 0) {
      c.pos++;
      this.posCross = true;
    } else c.neg++;
    c.sum += x.total;
    c.abs += Math.abs(x.total);
    if (Math.abs(x.total) > Math.abs(c.max)) c.max = x.total;
    for (const [k, d] of Object.entries(x.parts)) {
      const p = (c.parts[k] ??= { n: 0, sum: 0, abs: 0 });
      p.n++;
      p.sum += d;
      p.abs += Math.abs(d);
    }
  }
  /** TL_DUMP=<file>: the board of the largest per-turn difference so far is written there (to pin it in a test). */
  private dumped = 0;
  compare(d: Diff, clear: number, state?: unknown) {
    const v = this.v;
    v.n++;
    if (![d.armTurn, d.todayTurn, d.armWorth, d.todayWorth].every(Number.isFinite)) v.nonFinite++;
    const dt = d.armTurn - d.todayTurn;
    const dw = d.armWorth - d.todayWorth;
    // differences past 1e-9 (a sum taken in another order differs in the last bits only)
    if (Math.abs(dt) > 1e-9) v.turnBig++;
    if (dt > 1e-9) v.turnHigher++;
    if (dt < -1e-9) {
      v.turnLower++;
      // the brief's stop: a lower clock needs a positive cross term behind it (counted only when byCard names them)
      if (this.byCard && !this.posCross) v.lowerUntraced++;
    }
    if (Math.abs(dt) > clear) v.turnClear++;
    if (process.env.TL_DUMP && state && Math.abs(dt) > this.dumped) {
      this.dumped = Math.abs(dt);
      writeFileSync(process.env.TL_DUMP, JSON.stringify({ d, state }));
    }
    if (Math.abs(dw) > 1e-9) v.worthBig++;
    if (dt !== 0) {
      v.turnDiff++;
      v.turnSum += dt;
      v.turnAbs += Math.abs(dt);
    }
    if (dw !== 0) {
      v.worthDiff++;
      v.worthSum += dw;
      v.worthAbs += Math.abs(dw);
    }
    const big = Math.max(Math.abs(dt), Math.abs(dw));
    if (big > 0 && (!v.largest || big > v.largest.d)) v.largest = { ...d, d: big };
  }
}

export function installProbe(): TlProbe {
  const p = new TlProbe();
  (globalThis as unknown as { __tl: TlProbe }).__tl = p;
  return p;
}
