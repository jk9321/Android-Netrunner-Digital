import type { GameState, SideCode } from '../core';
import type { Diagnostics } from './diagnostics';
import { planWith, sideOff, tuning } from './synergy';

/**
 * The pricing context (structural review item 6, Fable 2026-11-07): what a
 * position is worth depends on who is deciding, with which plan, and which
 * guards are up. All of that lives here, in one object, instead of in
 * module-level flags flipped around calls in seven files. Read it with
 * pricing() (or plan() for the switches); change it only with withPricing.
 *
 * R-B B1b (brief runner-rework/briefs/b1b-pricing-context.md rev 1a): the context is a chain of FRAMES. A frame is
 * never written: withPricing (and asSide, and handValues.ts inDecision for a decision's anchor and known hands) makes a
 * new frame from the current one and a patch, makes it current for its callback, and puts the old one back. The current
 * frame is the one module-level variable here. What a frame holds is values: its Sets are never changed in place (a
 * frame with another set is a new frame), the anchor object is never copied (its identity is a cache home, hold.ts).
 * What is not frozen and not part of any key: tuning.plan (tests and scripts flip its switches in place), the root
 * GameState, the diagnostics sink, and the anchor's deckValues (a cache the anchor holds, as the sink is one).
 */
export type Plan = typeof tuning.plan;

/** A decision's root (handValues.ts inDecision makes it; its identity is the hold caches' key, so it is never copied). */
export interface Anchor {
  /** The decision's board id and the Runner's credits as it started (plan.iceStopAnchor: iceValues.ts stopCredits). */
  readonly id: string;
  readonly credits: number;
  /** The decision's own board and side. */
  readonly root?: GameState;
  readonly side?: SideCode;
  /** valueModel positionSerial(root), read when the anchor is made: the root's number in the context key. */
  readonly serial?: number;
  /**
   * The deck cards priced on that board, by pricing context and side (handValues.ts rootDeckAverage): a cache the anchor
   * holds, outside every key, written in place (as the diagnostics sink is); made with the anchor.
   */
  readonly deckValues?: Map<string, Map<string, number>>;
}

export interface Pricing {
  /** The side whose decision is being made (asSide), or null outside one. */
  readonly side: SideCode | null;
  /**
   * The deciding side's plan: tuning.plan with sideOff[side] off. Null
   * outside a decision: tuning.plan itself, as batch scripts and tests set
   * it (they reassign it and flip its switches in place).
   */
  readonly plan: Plan | null;
  /** The outermost decision's base plan, which a nested asSide builds on (the Corp's Runner reply plays the Runner with the Runner's own plan); null outside one. */
  readonly basePlan: Plan | null;
  /** The planner is playing a turn out: the hands stay as they were seen when the decision started. */
  readonly frozen: boolean;
  /** The cards in each side's hand the deciding AI has seen (noted as its decision starts, handValues.ts inDecision). */
  readonly known: Readonly<Record<SideCode, ReadonlySet<string> | null>>;
  /** The decision's root (see Anchor), or null outside a decision. */
  readonly anchor: Anchor | null;
  /**
   * The planner leaves being priced (plan.plannerHand): each prices its side's hand card by card, whatever
   * plan.handByCard says (leafHandByCard). A list, not one side: a leaf can open a decision that has its own
   * planner (the Corp's leaf prices the Runner reply), and an outer leaf still holds inside it.
   */
  readonly leaves: readonly { side: SideCode; plan: Plan }[];
  /** The deck's average card is being worked out (handValues.ts drawWorth): no card plans, no rig pricing inside. */
  readonly averaging: boolean;
  /**
   * A deck card's played worth is being priced on the decision's root (handValues.ts priceAtRoot): what it asks for
   * is priced per board, not from the root's prices.
   */
  readonly pricingRootDeck: boolean;
  /** The tag clock is pricing the rig: tags at the flat rate inside (evaluate.ts tagLossPerTurn). */
  readonly pricingTagLoss: boolean;
  /** Ice is being priced against the rig: run odds are the flat guesses inside (effectValues.ts). */
  readonly pricingIce: boolean;
  /** A hold count is open (corp/hold.ts holdRunnerTurn): the rez budget inside keeps its stop order (iceValues.ts). */
  readonly countingHold: boolean;
  /** A card's plan is being priced (cardPlans.ts handPlanWorth): no plan inside a plan. */
  readonly planning: boolean;
  /** The planner's per-decision seed for its playouts (turnPlanner.ts, plan.plannerSeed), or null. */
  readonly decisionSeed: number | null;
  /** Assets whose rez-to-use look-ahead is running (corp/rez.ts rezToUse): no nested rez-to-use inside. */
  readonly rezzingToUse: ReadonlySet<string>;
  /** A breaker is priced by the rig it joins (handValues.ts playedWorth): breakers inside take the rule-based worth. */
  readonly pricingBreaker: boolean;
  /** plan.oracle.safestRemote (oracle.ts): the Runner's next turn is being played out for the oracle: no oracle inside. */
  readonly oracleRunning: boolean;
  /**
   * The diagnostics sink a measurement script or test installed (diagnostics.ts), or null in play. Written only through
   * diagnostics.ts; no decision reads it, and it is in no key.
   */
  readonly diagnostics: Diagnostics | null;
  /** How many withPricing scopes this frame is inside (0: a top-level frame, installTop's): read by installTop only. */
  readonly depth: number;
}

/**
 * Test-only checks on frames (on in the test runs, tests/setup.ts; off in play): with `on`, every frame made is frozen
 * (shallow: the frame, its known record, its leaves list and its anchor), and every Set it holds throws on a write
 * (Object.freeze does not stop Set.add). A frame is never written either way; this makes a write fail loudly.
 */
export const frameChecks = { on: false };

/** A Set that throws on every write once made (frameChecks), so a frame's set can't be changed in place. */
export function valueSet(ids: Iterable<string>): ReadonlySet<string> {
  const set = new Set(ids);
  return frameChecks.on ? sealed(set) : set;
}
const refuse = () => {
  throw new TypeError('a pricing frame is never written: make a new frame (withPricing)');
};
/** `set`, throwing on every write from now on (the top-level frame's empty set always: it is made before the checks go on). */
function sealed<S extends ReadonlySet<string> | null>(set: S): S {
  if (!set || Object.isFrozen(set)) return set;
  for (const name of ['add', 'delete', 'clear']) Object.defineProperty(set, name, { value: refuse });
  return Object.freeze(set);
}
function checked(f: Pricing): Pricing {
  sealed(f.rezzingToUse);
  sealed(f.known.corp);
  sealed(f.known.runner);
  Object.freeze(f.known);
  Object.freeze(f.leaves);
  if (f.anchor) Object.freeze(f.anchor);
  return Object.freeze(f);
}

/** The current frame: the one module-level variable of the context (B1b bar 3). */
let current: Pricing = {
  side: null,
  plan: null,
  basePlan: null,
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
  rezzingToUse: sealed(new Set()),
  pricingBreaker: false,
  oracleRunning: false,
  diagnostics: null,
  depth: 0,
};

/** The current frame (read only: a frame is never written). */
export const pricing = (): Pricing => current;

/** The plan in force: the deciding side's, or tuning.plan outside a decision. Every switch read goes through here. */
export const plan = (): Plan => current.plan ?? tuning.plan;

/** `was` with `patch` laid over it, as a new frame at `depth`; `was` itself when the patch changes nothing. */
function framed(was: Pricing, patch: Partial<Pricing>, depth: number): Pricing {
  let same = true;
  for (const key in patch) {
    if (!Object.is((was as unknown as Record<string, unknown>)[key], (patch as Record<string, unknown>)[key])) {
      same = false;
      break;
    }
  }
  if (same) return was;
  const f: Pricing = { ...was, ...patch, depth };
  return frameChecks.on ? checked(f) : f;
}

/** Runs `fn` in a new frame: the current one with the fields in `patch` set. The old frame is current again afterwards (thrown or not). */
export function withPricing<T>(patch: Partial<Pricing>, fn: () => T): T {
  const was = current;
  const next = framed(was, patch, was.depth + 1);
  // A patch that changes nothing makes no frame (diagnostics.ts unsunk outside a sink, an asSide of the side deciding)
  if (next === was) return fn();
  current = next;
  try {
    return fn();
  } finally {
    current = was;
  }
}

/**
 * A top-level frame for the rest of the run (a measurement script's setup: diagnostics.ts installDiagnostics). Throws
 * inside a withPricing scope: a frame set there would outlive its scope.
 */
export function installTop(patch: Partial<Pricing>): void {
  if (current.depth !== 0) throw new Error('installTop inside a pricing scope: use withPricing');
  current = framed(current, patch, 0);
}

/**
 * Runs `fn` as `side`'s decision: side set and its plan (tuning.plan with
 * sideOff[side] off). Nested calls build on the outermost decision's base
 * plan (the frame's basePlan), so the Corp's Runner reply plays the Runner with the Runner's own plan.
 */
export function asSide<T>(side: SideCode, fn: () => T): T {
  if (current.side === side) return fn();
  const base = current.basePlan ?? plan();
  return withPricing({ side, plan: sideOff[side].length ? planWith(base, sideOff[side]) : base, basePlan: base }, fn);
}

/**
 * A planner leaf prices `side`'s hand card by card here (handValues.ts handByCard). This is exactly where the
 * in-place flip of tuning.plan.handByCard it replaces was seen: on the plan the leaf was priced with and, when
 * that was the base plan (no sideOff for the side: the Corp on beta), on every plan built from the base inside it.
 */
export function leafHandByCard(side: SideCode): boolean {
  const c = current;
  if (c.leaves.length === 0) return false;
  const now = plan();
  return c.leaves.some(l => l.side === side && (l.plan === now || l.plan === c.basePlan));
}

/** The side whose decision is being made (asSide), or null outside one. */
export const actingSide = (): SideCode | null => current.side;

/**
 * The frame's value-relevant fields as strings, for caches: the one owner of "the part of the context a value reads"
 * (B1b, the Corp side's condition 3). Worked out once per frame (a frame is never written) and kept in a WeakMap, not on
 * the frame.
 *   pricing  the side, its plan (named by its side: the switches themselves are the same for every position in a run),
 *            the leaves and the guards: valueModel memo and clickWorth's map
 *   deck     pricing less the breaker guard, for the deck averages (handValues.ts): worked out under averaging, it is
 *            never read
 *   context  the fields a value can read that `pricing` leaves out, for the value maps keyed by the position itself (F3:
 *            handValues.ts drawWorth and clickWorth): frozen, both sides' known hands, the anchor (its root by
 *            valueModel positionSerial, the anchor's serial), the decision seed and rezzingToUse
 * tests/valueB1Keys.test.ts pins that a frame differing in any field has other keys, or the field is on its not-read list.
 */
export interface FrameKeys {
  readonly pricing: string;
  readonly deck: string;
  readonly context: string;
}
const keysOf = new WeakMap<Pricing, FrameKeys>();
export function frameKeys(): FrameKeys {
  const c = current;
  let k = keysOf.get(c);
  if (!k) keysOf.set(c, (k = buildKeys(c)));
  return k;
}
function buildKeys(c: Pricing): FrameKeys {
  // c is the current frame (frameKeys): leafHandByCard reads it
  const planSide = c.side && sideOff[c.side].length ? c.side : '';
  const head = [
    planSide,
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
  ].join(':');
  const pricingKey = `${head}:${c.pricingBreaker && !c.averaging ? 'b' : ''}`;
  const hand = (s: ReadonlySet<string> | null) => (s ? [...s].join(',') : '-');
  const a = c.anchor;
  if (a?.root && a.serial === undefined) throw new Error('an anchor with a root is made by handValues.ts anchorAt (its serial)');
  const root = a?.root ? `o${a.serial}` : '';
  const context = `${c.frozen ? 'f' : ''}|${hand(c.known.corp)}|${hand(c.known.runner)}|${a ? `${a.id}:${a.credits}:${a.side ?? ''}:${root}` : ''}|${c.decisionSeed ?? ''}|${[...c.rezzingToUse].join(',')}`;
  return { pricing: pricingKey, deck: `${head}:`, context };
}
