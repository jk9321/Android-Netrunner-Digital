import type { SideCode } from '../core';
import type { Diagnostics } from './diagnostics';
import { planWith, sideOff, tuning } from './synergy';

/**
 * The pricing context (structural review item 6, Fable 2026-11-07): what a
 * position is worth depends on who is deciding, with which plan, and which
 * guards are up. All of that lives here, in one object, instead of in
 * module-level flags flipped around calls in seven files. Read it with
 * pricing() (or plan() for the switches); change it only with withPricing,
 * which restores every field it set when the call returns or throws.
 *
 * Two fields are not scoped: `known` and `anchor` are noted as a decision
 * starts (decisionContext) and stay until the next decision notes them
 * again, as they always did. The guard set rezzingToUse is changed by its
 * owner (corp/rez.ts rezAllowed, its one reader, under no keyed value).
 */
export type Plan = typeof tuning.plan;

export interface Pricing {
  /** The side whose decision is being made (asSide), or null outside one. */
  side: SideCode | null;
  /**
   * The deciding side's plan: tuning.plan with sideOff[side] off. Null
   * outside a decision: tuning.plan itself, as batch scripts and tests set
   * it (they reassign it and flip its switches in place).
   */
  plan: Plan | null;
  /** The planner is playing a turn out: the hands stay as they were seen when the decision started. */
  frozen: boolean;
  /** The cards in each side's hand the deciding AI has seen (noted as a decision starts). */
  known: Record<SideCode, Set<string> | null>;
  /**
   * plan.iceStopAnchor: the Runner's credits when the decision started (iceValues.ts stopCredits). root, side: the
   * decision's own board and side;
   * deckValues: the deck cards priced on that board, by pricing context and side (handValues.ts rootDeckAverage).
   */
  anchor: { id: string; credits: number; root?: import('../core').GameState; side?: SideCode; deckValues?: Map<string, Map<string, number>> } | null;
  /**
   * The planner leaves being priced (plan.plannerHand): each prices its side's hand card by card, whatever
   * plan.handByCard says (leafHandByCard). A list, not one side: a leaf can open a decision that has its own
   * planner (the Corp's leaf prices the Runner reply), and an outer leaf still holds inside it.
   */
  leaves: { side: SideCode; plan: Plan }[];
  /** The deck's average card is being worked out (handValues.ts drawWorth): no card plans, no rig pricing inside. */
  averaging: boolean;
  /**
   * A deck card's played worth is being priced on the decision's root (handValues.ts priceAtRoot): what it asks for
   * is priced per board, not from the root's prices.
   */
  pricingRootDeck: boolean;
  /** The tag clock is pricing the rig: tags at the flat rate inside (evaluate.ts tagLossPerTurn). */
  pricingTagLoss: boolean;
  /** Ice is being priced against the rig: run odds are the flat guesses inside (effectValues.ts). */
  pricingIce: boolean;
  /** A hold count is open (corp/hold.ts holdRunnerTurn): the rez budget inside keeps its stop order (iceValues.ts). */
  countingHold: boolean;
  /** A card's plan is being priced (cardPlans.ts handPlanWorth): no plan inside a plan. */
  planning: boolean;
  /** The planner's per-decision seed for its playouts (turnPlanner.ts, plan.plannerSeed), or null. */
  decisionSeed: number | null;
  /**
   * Assets whose rez-to-use look-ahead is running (corp/rez.ts rezToUse): no nested rez-to-use inside.
   */
  rezzingToUse: Set<string>;
  /** A breaker is priced by the rig it joins (handValues.ts playedWorth): breakers inside take the rule-based worth. */
  pricingBreaker: boolean;
  /** plan.oracle.safestRemote (oracle.ts): the Runner's next turn is being played out for the oracle: no oracle inside. */
  oracleRunning: boolean;
  /**
   * The diagnostics sink a measurement script or test installed (diagnostics.ts), or null in play. Written only through
   * diagnostics.ts; no decision reads it, and it is not part of pricingKey.
   */
  diagnostics: Diagnostics | null;
}

const context: Pricing = {
  side: null,
  plan: null,
  frozen: false,
  known: { corp: null, runner: null },
  anchor: null,
  leaves: [],
  averaging: false,
  pricingRootDeck: false,
  pricingTagLoss: false,
  pricingIce: false,
  countingHold: false,
  planning: false,
  decisionSeed: null,
  rezzingToUse: new Set(),
  pricingBreaker: false,
  oracleRunning: false,
  diagnostics: null,
};

/** The current context (read only: change it with withPricing). */
export const pricing = (): Readonly<Pricing> => context;

/** The plan in force: the deciding side's, or tuning.plan outside a decision. Every switch read goes through here. */
export const plan = (): Plan => context.plan ?? tuning.plan;

/** Bumped on every context change, so pricingKey is only rebuilt when something changed. */
let version = 0;

/** Runs `fn` with the fields in `patch` set, and puts them back as they were afterwards (thrown or not). */
export function withPricing<T>(patch: Partial<Pricing>, fn: () => T): T {
  const undo = holdPricing(patch);
  try {
    return fn();
  } finally {
    undo();
  }
}

/**
 * withPricing for callers that can't wrap a callback (a test's setup): sets
 * the fields and returns the undo, which must run in a finally.
 */
export function holdPricing(patch: Partial<Pricing>): () => void {
  const saved: Partial<Pricing> = {};
  const target = context as unknown as Record<string, unknown>;
  for (const key in patch) {
    (saved as Record<string, unknown>)[key] = target[key];
    target[key] = (patch as Record<string, unknown>)[key];
  }
  version++;
  return () => {
    for (const key in saved) target[key] = (saved as Record<string, unknown>)[key];
    version++;
  };
}

/** Notes, in the context, what the deciding AI knows as its decision starts: the hands it has seen and the Runner's credits. Not while frozen. */
export function noteDecision(known: Partial<Record<SideCode, Set<string>>>, anchor: NonNullable<Pricing['anchor']>) {
  context.anchor = anchor;
  for (const side in known) context.known[side as SideCode] = known[side as SideCode]!;
  version++;
}

/**
 * Runs `fn` as `side`'s decision: side set and its plan (tuning.plan with
 * sideOff[side] off). Nested calls build on the outermost decision's base
 * plan, so the Corp's Runner reply plays the Runner with the Runner's own plan.
 */
let basePlan: Plan | null = null;
export function asSide<T>(side: SideCode, fn: () => T): T {
  if (context.side === side) return fn();
  const outer = basePlan === null;
  const base = basePlan ?? plan();
  basePlan = base;
  try {
    return withPricing({ side, plan: sideOff[side].length ? planWith(base, sideOff[side]) : base }, fn);
  } finally {
    if (outer) basePlan = null;
  }
}

/**
 * A planner leaf prices `side`'s hand card by card here (handValues.ts handByCard). This is exactly where the
 * in-place flip of tuning.plan.handByCard it replaces was seen: on the plan the leaf was priced with and, when
 * that was the base plan (no sideOff for the side: the Corp on beta), on every plan built from the base inside it.
 */
export function leafHandByCard(side: SideCode): boolean {
  const c = context;
  if (c.leaves.length === 0) return false;
  const current = plan();
  return c.leaves.some(l => l.side === side && (l.plan === current || l.plan === basePlan));
}

/** The side whose decision is being made (asSide), or null outside one. */
export const actingSide = (): SideCode | null => context.side;

/** Which side's plan is in use, for caches whose values depend on it. */
export const planSide = (): string => (context.side && sideOff[context.side].length ? context.side : '');

let keyVersion = -1;
let key = '';
/**
 * The context's value-relevant fields as one string, for caches. Rebuilt
 * only when the context changed. The plan is named by its side (planSide):
 * the switches themselves are the same for every position in a run.
 */
export function pricingKey(): string {
  if (keyVersion === version) return key;
  const c = context;
  key = [
    planSide(),
    c.side ?? '',
    leafHandByCard('corp') ? 'lc' : '',
    leafHandByCard('runner') ? 'lr' : '',
    c.averaging ? 'a' : '',
    c.pricingRootDeck ? 'd' : '',
    c.pricingTagLoss ? 't' : '',
    c.pricingIce ? 'i' : '',
    c.countingHold ? 'k' : '',
    c.planning ? 'c' : '',
    c.oracleRunning ? 'o' : '',
    c.pricingBreaker && !c.averaging ? 'b' : '', // last: deckPricingKey drops it
  ].join(':');
  keyVersion = version;
  return key;
}

const rootIds = new WeakMap<object, number>();
let nextRootId = 0;
/**
 * The context fields a value can read that pricingKey leaves out, as one string, for the value maps keyed by the
 * position itself (F3: handValues.ts drawWorth and clickWorth; count netrunner-ai/cache-keys/count-note.md): frozen,
 * both sides' known hands, the anchor (its root by object), the decision seed and rezzingToUse. Built anew on every
 * call: rezzingToUse and the known sets change in place, so pricingKey's version can't stand for them.
 * tests/valueB1Keys.test.ts pins that every Pricing field is in pricingKey, here, or on its list of fields no value reads.
 */
export function contextKey(): string {
  const c = context;
  const hand = (s: Set<string> | null) => (s ? [...s].join(',') : '-');
  const a = c.anchor;
  let root = '';
  if (a?.root) {
    let id = rootIds.get(a.root);
    if (id === undefined) rootIds.set(a.root, (id = nextRootId++));
    root = `o${id}`;
  }
  return `${c.frozen ? 'f' : ''}|${hand(c.known.corp)}|${hand(c.known.runner)}|${a ? `${a.id}:${a.credits}:${a.side ?? ''}:${root}` : ''}|${c.decisionSeed ?? ''}|${[...c.rezzingToUse].join(',')}`;
}

/** pricingKey less the breaker guard, for the deck averages (handValues.ts): worked out under averaging, it is never read. */
export const deckPricingKey = (): string => pricingKey().replace(/:b$/, ':');
