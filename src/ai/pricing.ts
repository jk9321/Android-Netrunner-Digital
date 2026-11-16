import type { SideCode } from '../core';
import type { Diagnostics } from './diagnostics';
import { planWith, sideOff, tuning } from './synergy';
import { setSynergyAblation } from './synergyTags';

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
  /**
   * plan.iceStopAnchor: the Runner's credits when the decision started (iceValues.ts stopCredits). stops: plan.ownIceKnown's
   * rez-budget stops, noted once per decision (iceValues.ts rezBudget). root, side: the decision's own board and side;
   * deckValues: the deck cards priced on that board, by pricing context and side (handValues.ts rootDeckAverage).
   */
  anchor: { id: string; credits: number; stops?: Map<string, number>; root?: import('../core').GameState; side?: SideCode; deckValues?: Map<string, Map<string, number>> } | null;
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
  /** A card's plan is being priced (cardPlans.ts handPlanWorth): no plan inside a plan. */
  planning: boolean;
  /** Depth of threat-model work (threatModel.ts): the threat is off inside its own computation. */
  computingThreat: number;
  /** The planner's per-decision seed for its playouts (turnPlanner.ts, plan.plannerSeed), or null. */
  decisionSeed: number | null;
  /**
   * Assets whose rez-to-use look-ahead is running (corpAI.ts rezToUse): no nested rez-to-use inside.
   */
  rezzingToUse: Set<string>;
  /** Breakers being priced by the rig they join (handValues.ts playedWorth): no breaker prices itself again. */
  pricingBreakers: Set<string>;
  /** plan.oracle.safestRemote (oracle.ts): the Runner's next turn is being played out for the oracle: no oracle inside. */
  oracleRunning: boolean;
  /**
   * plan.runRecord (threatModel.ts recordRun): the servers the Runner ran on each of its last turns, most recent first, as
   * the deciding Corp saw them (public: rules 6.1.2a, 6.9.1a, the Runner announces the server it runs). Null: none noted.
   */
  runRecord: string[][] | null;
  /**
   * The diagnostics sink a measurement script or test installed (diagnostics.ts), or null in play. Written only through
   * diagnostics.ts; no decision reads it, and it is not part of pricingKey.
   */
  diagnostics: Diagnostics | null;
  /**
   * Step S (measurement only, branch ai-search-first): the side whose decision this is at the root (the outermost
   * asSide). An ablated family is off in everything that decision evaluates, its look-ahead and the Runner reply inside
   * it included. Null outside a decision. Part of pricingKey only while some family is ablated.
   */
  root: SideCode | null;
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
  planning: false,
  computingThreat: 0,
  decisionSeed: null,
  rezzingToUse: new Set(),
  pricingBreakers: new Set(),
  oracleRunning: false,
  runRecord: null,
  diagnostics: null,
  root: null,
};

/** The current context (read only: change it with withPricing). */
export const pricing = (): Readonly<Pricing> => context;

/** The plan in force: the deciding side's, or tuning.plan outside a decision. Every switch read goes through here. */
export const plan = (): Plan => context.plan ?? tuning.plan;

/** Bumped on every context change, so pricingKey is only rebuilt when something changed. */
let version = 0;
/** Step S ablations by root side (see ABLATE_FAMILIES at the end of this file). */
const ablation: Record<SideCode, Set<AblateFamily>> = { corp: new Set(), runner: new Set() };
const ablating = { any: false };

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
    return withPricing({ side, plan: sideOff[side].length ? planWith(base, sideOff[side]) : base, root: context.root ?? side }, fn);
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
    c.pricingRootDeck ? 'd' : '',
    c.pricingTagLoss ? 't' : '',
    c.pricingIce ? 'i' : '',
    c.planning ? 'c' : '',
    c.computingThreat ? 'h' : '',
    c.oracleRunning ? 'o' : '',
    c.runRecord ? c.runRecord.map(turn => turn.join('+')).join('/') : '',
    ...(ablating.any ? [`ab-${c.root ?? ''}`] : []),
  ].join(':');
  keyVersion = version;
  return key;
}

/**
 * Step S-1 ablation switches (brief-step-s.md; families in /mnt/project-files/netrunner-ai/audit-fixes/step-s/families.md).
 * MEASUREMENT ONLY, on branch ai-search-first: never merged to beta. Each family, when ablated for a side, takes the
 * plainest neutral value the code already has, in every evaluation of a decision rooted at that side. Off by default:
 * with no family ablated every read below returns false and play is unchanged. Set by the batch scripts' ABLATE
 * environment variable (`corp:handByCard,runner:runRiders`; a bare name means corp).
 */
export const ABLATE_FAMILIES = [
  'creditSlide', // A1
  'handByCard', // A2
  'clickByPlay', // A3
  'iceWorth', // A4
  'agendaStanding', // A5
  'threatValues', // A6
  'tagClock', // A7
  'damageClock', // A8
  'iceTypeOdds', // A9
  'digValue', // A10
  'archivesLoss', // A11
  'synergyTags', // B1
  'flatValues', // B2
  'corpFormulas', // B3 (with the Corp payout profiles, B5); the five parts below, all at once
  'corpProfiles', // B3a: Corp payout profiles (cardProfiles.ts profileOf, Corp cards)
  'corpKeep', // B3b: corpEffect keep, as corpKeepValue and rezzedWorth's fallback read it
  'corpEcon', // B3c: corpEffect econ (econValue, unprofiled econ assets)
  'corpUpgrade', // B3d: corpEffect upgrade (upgradeValue)
  'corpRezzed', // B3e: per-card rezzed rules (rezzedWorth's own entry)
  'runnerFormulas', // B4 (with the Runner payout profiles, B5)
  'counterWorths', // B6
  'runRiders', // B7
  'cardPlans', // B8
  'promptAnswers', // B9
  'cardRules', // corp/cardRules.ts (AI Coordinator 2026-11-15 21:59Z: one cheap arm)
] as const;
export type AblateFamily = (typeof ABLATE_FAMILIES)[number];


/** Whether `family` is ablated in the decision being made (by its root side). False outside a decision. */
export function ablated(family: AblateFamily): boolean {
  if (!ablating.any) {
    if (ablationProbe.seen && context.root) ablationProbe.seen.add(`${context.root}:${family}`);
    return false;
  }
  const root = context.root;
  return root !== null && ablation[root].has(family);
}

/** A part of B3 corpFormulas (AI Coordinator 2026-11-16 02:36Z trace): off with the part or with the whole family. */
export const corpPart = (part: 'corpProfiles' | 'corpKeep' | 'corpEcon' | 'corpUpgrade' | 'corpRezzed'): boolean => {
  const whole = ablated('corpFormulas');
  return ablated(part) || whole;
};

/** Fire-count probe (scripts/step-s/fire-count.ts): with nothing ablated, notes `side:family` for every family read. */
export const ablationProbe = { seen: null as Set<string> | null };

/** Sets the ablated families from a list (`corp:x,runner:y`, bare = corp); an unknown name throws. Empty clears. */
export function applyAblate(list: string): void {
  ablation.corp.clear();
  ablation.runner.clear();
  for (const key of list.split(',').map(k => k.trim()).filter(Boolean)) {
    const m = key.match(/^(?:(corp|runner):)?(.*)$/)!;
    const side = (m[1] ?? 'corp') as SideCode;
    const name = m[2] as AblateFamily;
    if (!ABLATE_FAMILIES.includes(name)) throw new Error(`no ablation family named ${name} (step S: ${ABLATE_FAMILIES.join(', ')})`);
    ablation[side].add(name);
  }
  ablating.any = ablation.corp.size + ablation.runner.size > 0;
  version++;
}

/** The ablated families, for logs. */
export const ablationList = (): string => (['corp', 'runner'] as SideCode[]).flatMap(s => [...ablation[s]].map(f => `${s}:${f}`)).join(',');

setSynergyAblation(() => ablated('synergyTags'));
