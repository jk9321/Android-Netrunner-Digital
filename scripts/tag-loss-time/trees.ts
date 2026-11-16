/* eslint-disable @typescript-eslint/no-explicit-any -- measurement trees around a globalThis probe */
/**
 * ai-tag-loss-time (brief-tag-loss-time.md rev 2, phase 1: measure, merge nothing). Each arm is a copy of this tree's
 * src/ with text patches (as scripts/hold-reentry/trees.ts): every patch must match exactly once, so a tree that drifted
 * from what the patch expects throws instead of measuring something else. Nothing here is in src/.
 *
 *   base  this tree as it is (instrumentation only)
 *   F     the ceiling, reference only: tagsWorth is the flat 3 a tag everywhere (the clock never runs)
 *   0     the exact skips: tagLoss prices no rig when the answer can't use it (no resource; no resource past `skip`; the
 *         Corp under 2 credits) and no copy for a resource HQ can't pay to trash (hqTrashCardsLoss Infinity)
 *   A     the copies' Runner deck average held: each copy is put in a WeakMap (copy -> the full board) and drawWorth
 *         reads it first, before its key is built (ruling 5: by object identity, Runner side only, no pricing context)
 *   0A    0 and A together
 *   H     attribution of (b): the clock's boards are priced with countingHold up (the hang fix's flag set around tagLoss
 *         too), so the rez budget does not ask the hold count for its order in there
 *   S     attribution: the Runner stack's average once per (Corp decision, rig), the tier-2 shape (rootDeckAverage) for
 *         the Runner's deck: each stack card's played worth once per decision and rig, then held by the asking board's
 *         credits (heldFromPlayed)
 *   B     attribution only (ruling 7: another quantity): a resource's own term in runnerRigValue's loop, no copy priced
 *
 * Every tree has the same probe (globalThis.__tl, a TlProbe): tag-clock prices and their kind, rig values, drawWorth
 * calls and misses, countRezBudget runs and hold counts started inside the clock, size-capped cache clears, and the
 * clock's own wall time. With `shadow` on (the values pass), each tagClock also works out today's per-turn loss and
 * worth on the same board (the arm's patches are off while `baseMode` is up) and the probe records the differences.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ARMS = ['base', 'F', '0', 'A', '0A', 'H', 'S', 'B'] as const;
/** Arms built on request only (the AI Coordinator's 19:44Z re-opening of ruling 7): 0 and B together. */
export const EXTRA_ARMS = ['0B'] as const;
export type Arm = (typeof ARMS)[number] | (typeof EXTRA_ARMS)[number];

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
const TRASH_LINE = '  const trash = Math.max(0, nets[skip] ?? 0) - (corp.credits >= 2 ? CLICK + 2 : Infinity);';

/**
 * An arm's tagLoss: the rig part worked out the arm's way; the punisher part copied from today's text (the lines after
 * `trash`). `skips`: arm 0's exact skips; `hold`: arm A's held deck average; `own`: arm B's own term.
 */
function armTagLoss(today: string, o: { skips: boolean; hold: boolean; own: boolean }): string {
  const tail = today.slice(today.indexOf(TRASH_LINE) + TRASH_LINE.length);
  const copy = o.hold
    ? `(() => { const c = { ...state, runner: { ...state.runner, rig: { ...state.runner.rig, resources: all.filter(x => x !== r) } } }; __heldRunnerDeck.set(c, state); return c; })()`
    : `{ ...state, runner: { ...state.runner, rig: { ...state.runner.rig, resources: all.filter(x => x !== r) } } }`;
  const term = o.own ? '__rigCardTerm(state, r)' : `rig - runnerRigValue(${copy})`;
  const rigLine = o.own ? '' : '    const rig = runnerRigValue(state);\n';
  return `function tagLoss(state: GameState, viewer: SideCode, skip: number): number {
  if (${G}?.baseMode) return tagLossToday(state, viewer, skip);
  const corp = state.corp;
  const all = state.runner.rig.resources;
  const extra = (r: CardInstance) => { const v = plan().hqTrashCost ? hqTrashCardsLoss(state, r) : 0; if (v === Infinity && ${G}) ${G}.untrash++; return v; };
  let trash = 0;
  ${o.skips ? `if (all.length > skip && corp.credits >= 2) {
    const extras = all.map(extra);
    const live = all.filter((_, i) => extras[i] !== Infinity);
    if (live.length > skip) {
${rigLine}      const terms = live.map(r => ${term});
      if (${G}?.shadow) ${G}.lastTerms = live.map((r, i) => [r.cardCode, terms[i]]);
${o.own ? `      if (${G}?.byCard && ${G}.shadowDepth > 0) live.forEach((r, i) => ${G}.cross(cardDef(r).title, __crossTerms(state, r), terms[i]));\n` : ''}      const nets = terms.map((v, i) => v - extras[all.indexOf(live[i])]).sort((a, b) => b - a);
      trash = Math.max(0, nets[skip] ?? 0) - (CLICK + 2);
    }
  }` : `{
${rigLine}    const terms = all.map(r => ${term});
    if (${G}?.shadow) ${G}.lastTerms = all.map((r, i) => [r.cardCode, terms[i]]);
${o.own ? `    if (${G}?.byCard && ${G}.shadowDepth > 0) all.forEach((r, i) => ${G}.cross(cardDef(r).title, __crossTerms(state, r), terms[i]));\n` : ''}    const nets = terms.map((v, i) => v - extra(all[i])).sort((a, b) => b - a);
    trash = Math.max(0, nets[skip] ?? 0) - (corp.credits >= 2 ? CLICK + 2 : Infinity);
  }`}${tail}
`;
}

/** The instrumentation, the same in every tree (applied before the arm's own patches, which keep its lines). */
function instrument(dir: string) {
  edit(dir, 'ai/evaluate.ts', t => {
    // the clock's per-turn loss: entered/left (depth and the outermost wall time), each computation counted
    t = once(t, 'function tagLossPerTurn(state: GameState, viewer: SideCode, skip = 0): number {', 'function tagLossPerTurnP(state: GameState, viewer: SideCode, skip = 0): number {', 'evaluate.ts');
    t += `
// tag-loss-time probe (scripts/tag-loss-time/trees.ts)
function tagLossPerTurn(state: GameState, viewer: SideCode, skip = 0): number {
  const g = ${G};
  if (!g || g.baseMode) return tagLossPerTurnP(state, viewer, skip);
  g.enter();
  try { return tagLossPerTurnP(state, viewer, skip); } finally { g.exit(); }
}
`;
    // the price's kind, counted on today's tagLoss (every arm reaches it unless baseMode, see armTagLoss)
    t = once(t, `${TAGLOSS_HEAD}\n  const corp = state.corp;`, `${TAGLOSS_HEAD}\n  const corp = state.corp;\n  if (${G} && !${G}.baseMode) ${G}.price(state, skip);`, 'evaluate.ts');
    t = once(t, EXTRA_LINE, `  const extra = (r: CardInstance) => { const v = plan().hqTrashCost ? hqTrashCardsLoss(state, r) : 0; if (v === Infinity && ${G} && !${G}.baseMode) ${G}.untrash++; return v; };`, 'evaluate.ts');
    t = once(t, RESOURCES_LINE, `${RESOURCES_LINE}\n  if (${G}?.shadow) ${G}.lastTerms = state.runner.rig.resources.map((r, i) => [r.cardCode, resources[i]]);`, 'evaluate.ts');
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
  g.shadowDepth++;
  try {
    const armWorth = tagClockP(state, viewer, tags, actual, memoHome, skip => { g.lastTerms = null; armTurn = tagLossPerTurnP(state, viewer, skip); armTerms = g.lastTerms; return armTurn; });
    g.baseMode = true;
    let todayWorth: number;
    try {
      todayWorth = tagClockP(state, viewer, tags, actual, memoHome, skip => { g.lastTerms = null; todayTurn = tagLossPerTurnP(state, viewer, skip); todayTerms = g.lastTerms; return todayTurn; });
    } finally { g.baseMode = false; }
    if (g.shadowDepth === 1) g.compare({ armTurn, todayTurn, armWorth, todayWorth, armTerms, todayTerms, viewer, tags, ident: state.runner.identity.cardCode });
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
  edit(dir, 'ai/threatModel.ts', t => once(t, '  if (cache.size > 40000) cache.clear();', `  if (cache.size > 40000) (${G} && ${G}.clear('threatModel'), cache.clear());`, 'threatModel.ts'));
  edit(dir, 'ai/oracle.ts', t => once(t, '  if (playedOut.size > 2000) playedOut.clear();', `  if (playedOut.size > 2000) (${G} && ${G}.clear('oracle'), playedOut.clear());`, 'oracle.ts'));
}

/** The arm's own patches (after the instrumentation). */
function patchArm(dir: string, arm: Arm) {
  if (arm === 'base') return;
  if (arm === 'F') {
    edit(dir, 'ai/evaluate.ts', t => once(t, "  if (pricing().pricingTagLoss) return logValue('tag', 'tagsWorth flat (tag clock)'", "  if (true) return logValue('tag', 'tagsWorth flat (tag clock)'", 'evaluate.ts'));
    return;
  }
  if (arm === 'H') {
    edit(dir, 'ai/evaluate.ts', t => once(t, '  return withPricing({ pricingTagLoss: true }, () => tagLoss({ ...state }, viewer, skip));', `  return withPricing(${G}?.baseMode ? { pricingTagLoss: true } : { pricingTagLoss: true, countingHold: true }, () => tagLoss({ ...state }, viewer, skip));`, 'evaluate.ts'));
    return;
  }
  if (arm === 'S') {
    edit(dir, 'ai/handValues.ts', t => {
      t = once(t, '  const rootAvg = rootDeckAverage(state, side, deck);\n  if (rootAvg !== undefined) return rootAvg;', '  const rootAvg = rootDeckAverage(state, side, deck);\n  if (rootAvg !== undefined) return rootAvg;\n  const stackAvg = runnerStackOnce(state, side, deck);\n  if (stackAvg !== undefined) return stackAvg;', 'handValues.ts');
      return `${t}
// tag-loss-time arm S: the Runner stack's average once per (Corp decision, rig)
function runnerStackOnce(state: GameState, side: SideCode, deck: CardInstance[]): number | undefined {
  if (side !== 'runner' || ${G}?.baseMode) return undefined;
  const p = pricing();
  const anchor = p.anchor as any;
  if (p.pricingRootDeck || !p.frozen || !anchor?.root || anchor.side !== 'corp' || p.side === null) return undefined;
  if (!deck.length) return RATES.drawnCard;
  const rig = state.runner.rig;
  const rigKey = [...rig.programs, ...rig.hardware, ...rig.resources].map(c => c.instanceId + ':' + JSON.stringify(c.counters ?? {}) + (c.hostedCards ?? []).map(h => h.instanceId).join('+')).join(',');
  const all = (anchor.runnerStack ??= new Map<string, Map<string, number>>());
  const key = pricingKey() + '|' + rigKey;
  let values = all.get(key);
  if (!values) all.set(key, (values = new Map()));
  if (${G}) ${G}.stackServed++;
  let sum = 0;
  for (const c of deck) {
    let played = values.get(c.instanceId);
    if (played === undefined) {
      played = pricingApart(() => withPricing({ averaging: true, pricingRootDeck: true }, () => playedWorth(state, c)));
      values.set(c.instanceId, played);
      if (${G}) ${G}.stackPriced++;
    }
    sum += heldFromPlayed(state, c, side, played);
  }
  return sum / deck.length;
}
`;
    });
    return;
  }
  // 0, A, 0A, B: tagLoss rewritten; today's kept as tagLossToday for the values pass
  edit(dir, 'ai/evaluate.ts', t => {
    const today = fnText(t, TAGLOSS_HEAD, 'evaluate.ts');
    const renamed = today.replace(TAGLOSS_HEAD, 'function tagLossToday(state: GameState, viewer: SideCode, skip: number): number {');
    // the probe's price/untrash counts stay on the arm's own path (armTagLoss counts untrash itself)
    const todayQuiet = renamed;
    const arm2 = armTagLoss(today, { skips: arm === '0' || arm === '0A' || arm === '0B', hold: arm === 'A' || arm === '0A', own: arm === 'B' || arm === '0B' });
    // the arm's tagLoss counts its price kind like today's (the line instrument() put in today's text)
    const priced = arm2.replace(`  if (${G}?.baseMode) return tagLossToday(state, viewer, skip);\n  const corp = state.corp;`, `  if (${G}?.baseMode) return tagLossToday(state, viewer, skip);\n  const corp = state.corp;\n  if (${G}) ${G}.price(state, skip);`);
    t = once(t, today, `${priced}\n${todayQuiet}`, 'evaluate.ts');
    if (arm === 'A' || arm === '0A') t = `import { heldRunnerDeck as __heldRunnerDeck } from './handValues';\n${t}`;
    if (arm === 'B' || arm === '0B') {
      // runnerRigValue's loop body as a function of one card (the same terms, so runnerRigValue is unchanged)
      const LOOP_HEAD = '  for (const card of cards) {\n';
      const LOOP_END = '  }\n  // Combos in play';
      const a = t.indexOf(LOOP_HEAD, t.indexOf('export function runnerRigValue(state: GameState): number {'));
      const b = t.indexOf(LOOP_END, a);
      if (a < 0 || b < 0) throw new Error('evaluate.ts: runnerRigValue loop not found');
      const body = t.slice(a + LOOP_HEAD.length, b);
      t = t.slice(0, a) + '  for (const card of cards) value = __rigCardTerm(state, card, value);\n  // Combos in play' + t.slice(b + LOOP_END.length);
      t += `
// tag-loss-time arm B: one card's term in runnerRigValue's loop, added to \`from\` in the loop's own order (so
// runnerRigValue's sum is the same number); from 0, the card's own term
function __rigCardTerm(state: GameState, card: CardInstance, from = 0): number {
  let value = from;
${body.replace(/\n {6}continue;\n/, '\n      return value;\n')}  return value;
}

/**
 * The values pass's decomposition (G.byCard): what today's copy difference for resource r is made of, beside r's own
 * term: each other rig card's term on the full board less on the copy (keyed by the card and the branch its term takes:
 * payout = a profiled card, whose term reads the deck average; card = runnerCardValue + counters + hosted; breaker =
 * counters + hosted only), the combos (boardPlansWorth), and the rest (breaker coverage: MU, ice type odds, AI breaker
 * share). total = today's term (rig less the copy's rig) less r's own term.
 */
function __crossTerms(state: GameState, r: CardInstance): { total: number; parts: Record<string, number> } {
  const rig = state.runner.rig;
  const copy = { ...state, runner: { ...state.runner, rig: { ...rig, resources: rig.resources.filter(x => x !== r) } } };
  const total = runnerRigValue(state) - runnerRigValue(copy) - __rigCardTerm(state, r);
  const parts: Record<string, number> = {};
  let named = 0;
  for (const c of [...rig.programs, ...rig.hardware, ...rig.resources]) {
    if (c === r) continue;
    const d = __rigCardTerm(state, c) - __rigCardTerm(copy, c);
    if (Math.abs(d) <= 1e-9) continue;
    const kind = profileOf(c.cardCode) ? 'payout' : isIcebreaker(c) ? 'breaker' : 'card';
    parts[cardDef(c).title + ' (' + kind + ')'] = (parts[cardDef(c).title + ' (' + kind + ')'] ?? 0) + d;
    named += d;
  }
  const plans = boardPlansWorth(state, 'runner') - boardPlansWorth(copy, 'runner');
  if (Math.abs(plans) > 1e-9) parts['combos (boardPlansWorth)'] = plans;
  const rest = total - named - plans;
  if (Math.abs(rest) > 1e-9) parts['coverage (breakers, MU, ice odds)'] = rest;
  return { total, parts };
}
`;
    }
    return t;
  });
  if (arm === 'A' || arm === '0A') {
    edit(dir, 'ai/handValues.ts', t => {
      t = once(t, `function drawWorth(state: GameState, side: SideCode): number {\n  if (${G}) ${G}.draw(side);`, `function drawWorth(state: GameState, side: SideCode): number {\n  if (${G}) ${G}.draw(side);\n  const held = side === 'runner' && !${G}?.baseMode ? heldRunnerDeck.get(state) : undefined;\n  if (held) { if (${G}) ${G}.heldServed++; return drawWorth(held, side); }`, 'handValues.ts');
      return `${t}
/** tag-loss-time arm A: a tag-clock copy -> the full board whose Runner deck average it reads. */
export const heldRunnerDeck = new WeakMap<object, GameState>();
`;
    });
  }
}

/** Builds the arms' trees under `root` and returns their directories. */
export function makeTrees(root: string, arms: readonly Arm[] = ARMS): Record<Arm, string> {
  rmSync(root, { recursive: true, force: true });
  const out = {} as Record<Arm, string>;
  for (const arm of arms) {
    const dir = join(root, arm);
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    instrument(dir);
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
  /** arm A: copies whose deck average was the full board's; arm S: averages served, stack cards priced. */
  heldServed: number;
  stackServed: number;
  stackPriced: number;
}
const zero = (): Tally => ({ prices: 0, r0: 0, rSkip: 0, broke: 0, priced: 0, untrash: 0, rig: 0, rigIn: 0, drawR: 0, drawRIn: 0, missR: 0, missRIn: 0, drawC: 0, missC: 0, rez: 0, rezIn: 0, hold: 0, holdIn: 0, clears: {}, msIn: 0, heldServed: 0, stackServed: 0, stackPriced: 0 });

/** One resource's cross terms (today's copy difference less its own term), summed over a decision's clocks. */
export interface CardCross { n: number; moved: number; sum: number; abs: number; max: number; ownSum: number; parts: Record<string, { n: number; sum: number; abs: number }> }

export interface Diff { armTurn: number; todayTurn: number; armWorth: number; todayWorth: number; armTerms: unknown; todayTerms: unknown; viewer: string; tags: number; ident: string }
/** The values pass: per-turn loss and tag worth, the arm's against today's on the same board. */
export interface Values { n: number; turnBig: number; worthBig: number; turnDiff: number; turnSum: number; turnAbs: number; worthDiff: number; worthSum: number; worthAbs: number; nonFinite: number; largest: (Diff & { d: number }) | null }
const zeroValues = (): Values => ({ n: 0, turnBig: 0, worthBig: 0, turnDiff: 0, turnSum: 0, turnAbs: 0, worthDiff: 0, worthSum: 0, worthAbs: 0, nonFinite: 0, largest: null });

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
  enter() {
    if (this.depth++ === 0) this.t0 = performance.now();
  }
  exit() {
    if (--this.depth === 0) this.t.msIn += performance.now() - this.t0;
  }
  price(state: any, skip: number) {
    if (this.baseMode) return;
    const t = this.t;
    t.prices++;
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
  clear(name: string) {
    this.t.clears[name] = (this.t.clears[name] ?? 0) + 1;
  }
  cross(card: string, x: { total: number; parts: Record<string, number> }, own: number) {
    const c = (this.cards[card] ??= { n: 0, moved: 0, sum: 0, abs: 0, max: 0, ownSum: 0, parts: {} });
    c.n++;
    c.ownSum += own;
    if (Math.abs(x.total) <= 1e-9) return;
    c.moved++;
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
  compare(d: Diff) {
    const v = this.v;
    v.n++;
    if (![d.armTurn, d.todayTurn, d.armWorth, d.todayWorth].every(Number.isFinite)) v.nonFinite++;
    const dt = d.armTurn - d.todayTurn;
    const dw = d.armWorth - d.todayWorth;
    // differences past 1e-9 (a sum taken in another order differs in the last bits only)
    if (Math.abs(dt) > 1e-9) v.turnBig++;
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
