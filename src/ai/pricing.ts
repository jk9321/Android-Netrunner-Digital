import type { SideCode } from '../core';
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
 * again, as they always did. The guard sets (rezzingToUse,
 * pricingBreakers) are added to and removed from by their owners.
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
  /** plan.iceStopAnchor: the Runner's credits when the decision started (iceValues.ts stopCredits). */
  anchor: { id: string; credits: number } | null;
  /**
   * The planner leaves being priced (plan.plannerHand): each prices its side's hand card by card, whatever
   * plan.handByCard says (leafHandByCard). A list, not one side: a leaf can open a decision that has its own
   * planner (the Corp's leaf prices the Runner reply), and an outer leaf still holds inside it.
   */
  leaves: { side: SideCode; plan: Plan }[];
  /** The deck's average card is being worked out (handValues.ts drawWorth): no card plans, no rig pricing inside. */
  averaging: boolean;
  /** The tag clock is pricing the rig: tags at the flat rate inside (evaluate.ts tagLossPerTurn). */
  pricingTagLoss: boolean;
  /** Ice is being priced against the rig: run odds are the flat guesses inside (effectValues.ts). */
  pricingIce: boolean;
  /** plan.oneCurrency: a projection (finish or score effect) is running: no finish projection inside. */
  projecting: boolean;
  /** plan.oneCurrency: an agenda's on-score effect is being measured: no effect measure inside. */
  pricingEffect: boolean;
  /** A card's plan is being priced (cardPlans.ts handPlanWorth): no plan inside a plan. */
  planning: boolean;
  /** Depth of threat-model work (threatModel.ts): the threat is off inside its own computation. */
  computingThreat: number;
  /** The race clock is being worked out (clock.ts): turnsLeft and the clock itself fall back to the score guess inside. */
  buildingClock: boolean;
  /** The planner's per-decision seed for its playouts (turnPlanner.ts, plan.plannerSeed), or null. */
  decisionSeed: number | null;
  /**
   * Assets whose rez-to-use look-ahead is running (corpAI.ts rezToUse): no nested rez-to-use inside (plan.oneCurrency:
   * per card, so a second Humanoid Resources is still priced inside the first's).
   */
  rezzingToUse: Set<string>;
  /** Breakers being priced by the rig they join (handValues.ts playedWorth): no breaker prices itself again. */
  pricingBreakers: Set<string>;
}

const context: Pricing = {
  side: null,
  plan: null,
  frozen: false,
  known: { corp: null, runner: null },
  anchor: null,
  leaves: [],
  averaging: false,
  pricingTagLoss: false,
  pricingIce: false,
  projecting: false,
  pricingEffect: false,
  planning: false,
  computingThreat: 0,
  buildingClock: false,
  decisionSeed: null,
  rezzingToUse: new Set(),
  pricingBreakers: new Set(),
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
export function noteDecision(known: Partial<Record<SideCode, Set<string>>>, anchor: { id: string; credits: number }) {
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

/** The plan as its switches read here, leaves included, for caches keyed by the whole plan (threatModel.ts planKey). */
export function effectivePlan(): Plan {
  const current = plan();
  if (context.leaves.length === 0) return current;
  const sides = (['corp', 'runner'] as SideCode[]).filter(leafHandByCard);
  if (sides.length === 0) return current;
  const handByCard = { ...current.handByCard };
  for (const side of context.leaves.map(l => l.side)) if (sides.includes(side)) handByCard[side] = true;
  return { ...current, handByCard };
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
    c.pricingTagLoss ? 't' : '',
    c.pricingIce ? 'i' : '',
    c.projecting ? 'p' : '',
    c.pricingEffect ? 'e' : '',
    c.planning ? 'c' : '',
    c.computingThreat ? 'h' : '',
    c.buildingClock ? 'k' : '',
  ].join(':');
  keyVersion = version;
  return key;
}
