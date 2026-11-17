import { CardInstance, GameState, cardDef, getCardScript, isLegalAction, rezCostOf, availableCredits } from '../../core';
import { rezCost, stealthCredits, threatLevel } from '../../core/engine/cardEffects';
import { canBreakSubroutinesWith, iceScript, iceSubroutines, iceSubtypes, isBioroid } from '../../core/engine/ice';
import { AUDREY, BOTULUS, SubEffect, SubFacts, bioroidBreakClicks, breakPlans, bypassesAhead, plannedSubroutines, runBypasses, runStealthCredits, subroutineFacts } from '../runs';
import { CARDS, clickMoneyOf, turnIncomeOf } from '../cards';
import type { HoldFacts } from '../cards/types';
import { counters } from '../../core/engine/cardEffects';
import { plan, pricing, withPricing } from '../pricing';

/**
 * Owner: does a server hold (Step 4 Stage A, spec-step4-corp-core.md 1.4; registry row "what holds a server").
 *
 * One function, serverHold, answers for both horizons the Corp counts today:
 *  - 'runnerTurn': can the Runner get in on its next turn, against the cheapest set of ice the Corp can afford to rez
 *    (holdCost's count, moved here from countedScore.ts);
 *  - 'thisRun': can the Runner get through the rest of the run under way with its credits now (stopCost's count, moved
 *    here from rezModel.ts).
 * The Corp rezzes ice as it is approached (rules 3.4.3a, 6.4.3, 6.9.2b); unrezzed ice is passed (6.9.2c); a bypassed
 * ice's subroutines never resolve (6.5.8a-b). Capability from public facts, not our Runner AI's choice; no Runner grip
 * and no deck order is read (10.2.2a).
 *
 * Stage A reproduces today's two counts exactly, their differences included (the two horizons use different Runner
 * budgets and different bypass readers; bioroid clicks are still counted both as clicks that earn credits and as the
 * break; encounter tolls such as Funhouse's are still left out). Those are the Stage D fixes D1 and D2 and are not
 * built here. `margin` and `entries` are new outputs: no decision reads them in Stage A.
 */

export interface HoldOptions {
  /** 'runnerTurn' (the Runner's next turn, runnerBudget) or 'thisRun' (the run under way, the Runner's credits now). */
  when: 'runnerTurn' | 'thisRun';
  /** The credits the Corp may spend on rezzes ('thisRun' defaults to its credits now). */
  corpCredits?: number;
  /** 'thisRun': the approached ice's position (default the run's icePosition); the ice from it inward is counted. */
  from?: number;
  /** 'thisRun': ice that must be rezzed (the approached ice, priced at its rez cost; stopCost's `ice`). */
  mustRez?: string[];
  /** 'thisRun': whether the unrezzed ice further in may be rezzed too (stopCost's `further`; default true). */
  further?: boolean;
}

export interface Hold {
  /** Some affordable rez set keeps the Runner out. */
  holds: boolean;
  /** The cheapest holding rez set (instance ids of the ice to rez), or null when none holds. */
  rez: string[] | null;
  /** Its rez spend; Infinity when none holds. */
  rezCost: number;
  /** The Runner's credit need against the holding set, or against the affordable set that asks the most when none holds. */
  need: number;
  /** The most the Runner can bring: runnerBudget ('runnerTurn') or its credits now ('thisRun'). */
  budget: number;
  /** need - budget: above 0 when it holds. */
  margin: number;
  /**
   * How many times the Runner can pay `need` ('runnerTurn': its turn's clicks, each run after the first costing the
   * credit that click would have earned; 'thisRun': 1 or 0). 0 when it holds.
   */
  entries: number;
}

/** Sensitivity knob for the stage 0 report: extra credits granted to the Runner's run (an economy event from the grip it may hold). */
export const CHECK = { runnerExtra: 0 };

/**
 * The Runner's budget for one run on its next turn, from public facts: its credits, and what its installed cards and
 * every click but the run's make (runnerMoney: card entries, never the grip; 5.2.7a). Count inputs F2: before it, 1
 * credit a click, so a loaded Telework Contract was missed (paired +0.0 ± 0.4 at games=3, run 42918973725).
 */
export const runnerBudget = (s: GameState) => s.runner.credits + runnerMoney(s) + CHECK.runnerExtra;

const hosted = (c: CardInstance) => counters(c, 'credit');

/**
 * The credits the Runner's installed cards and its clicks but the run's make on its next turn: each installed card's
 * turn-start payment (no more than it holds), then the best set of its paying click abilities (one use each: Telework
 * Contract is once per turn, Fermenter and Rent Rioters are trashed, Pennyshaver pays 1 after its first use), the
 * other clicks 1 credit each (5.2.7a).
 */
export function runnerMoney(s: GameState): number {
  return runnerEarnings(s)[Math.max(0, s.runner.maxClicks - 1)];
}

/**
 * What k earning clicks make on the Runner's next turn, for k = 0 .. maxClicks (runnerMoney is k = maxClicks - 1): each
 * installed card's turn-start payment (no more than it holds), then the best set of its paying click abilities within
 * the k clicks (one use each), the other clicks 1 credit each (5.2.7a). The hold walk splits the turn's clicks between
 * earning and the rest (brief 5.3) and reads this for both.
 */
export function runnerEarnings(s: GameState): number[] {
  const rig = [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources];
  let drip = 0;
  const uses: { clicks: number; credits: number }[] = [];
  for (const c of rig) {
    const pay = turnIncomeOf(c.cardCode);
    if (pay) drip += pay.hosted ? Math.min(pay.credits, hosted(c)) : pay.credits;
    const m = clickMoneyOf(c.cardCode);
    if (!m) continue;
    let credits = m.credits;
    if (m.hosted === 'cap') credits = Math.min(credits, hosted(c));
    if (m.hosted === 'add') credits += hosted(c);
    if (m.perVirus) credits += m.perVirus.credits * (counters(c, 'virus') + m.perVirus.turnStart);
    if (credits > m.clicks) uses.push({ clicks: m.clicks, credits });
  }
  const max = Math.max(0, s.runner.maxClicks);
  const n = Math.min(uses.length, 10);
  const out: number[] = [];
  for (let clicks = 0; clicks <= max; clicks++) {
    let best = clicks;
    for (let mask = 1; mask < 1 << n; mask++) {
      let k = 0;
      let got = 0;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) {
        k += uses[i].clicks;
        got += uses[i].credits;
      }
      if (k <= clicks) best = Math.max(best, got + clicks - k);
    }
    out.push(drip + best);
  }
  return out;
}

/** Does the server hold, and by how much (see the file comment)? */
export function serverHold(state: GameState, server: string, opts: HoldOptions): Hold {
  return opts.when === 'thisRun' ? walkThisRun(state, server, opts) : counted(() => walkRunnerTurn(state, server, opts.corpCredits ?? state.corp.credits));
}

/** Counted with countingHold up: the rez budget its prices reach does not ask this count again (deal 2138's hang). */
const counted = <T>(f: () => T): T => (pricing().countingHold ? f() : withPricing({ countingHold: true }, f));

/** A copy-free view with this one ice standing in for its unrezzed self (iceCreditNeed reads the board for strength). */
function withIce(state: GameState, ice: CardInstance): GameState {
  const server = Object.values(state.corp.servers).find(v => v.ice.some(c => c.instanceId === ice.instanceId));
  if (!server) return state;
  return { ...state, corp: { ...state.corp, servers: { ...state.corp.servers, [server.id]: { ...server, ice: server.ice.map(c => (c.instanceId === ice.instanceId ? ice : c)) } } } };
}

const withServerIce = (state: GameState, id: string, ice: CardInstance[]): GameState => ({ ...state, corp: { ...state.corp, servers: { ...state.corp.servers, [id]: { ...state.corp.servers[id], ice } } } });

// =====================================================================================================================
// The walk (Stage D item 1 branch 2, brief rev 2 section 5): the count as a model of the Runner's turn
// =====================================================================================================================
//
// With a rez set S, the Runner's turn is walked from public facts (10.2.2): for 'runnerTurn' from the board at its turn
// start (5.7.1: Botulus and Tranquilizer counters placed, Tranquilizer's and Lycian's derez), its clicks split between
// earning (runnerEarnings), the run and the clicks the run spends; for 'thisRun' from the run under way. The run meets
// the ice outermost first (6.9.2): unrezzed ice outside S is passed (6.9.2c), ice of S is rezzed as it is approached
// (6.4.3) and its rez-time facts apply (Flyswatter's purge), bypassed ice is skipped (6.5.8a, runBypasses as before).
// At each rezzed ice the Runner chooses which subroutines to break and how (a break plan from breakPlans, Botulus's
// counters, the ice's own click or credit ability), and the rest resolve in printed order against the state the walk
// carries (9.8.7b). Clicks, counters, grip cards and once-a-run uses are shared along the run (1.16.1: a cost is paid in
// full). The walk carries facts, never worths (ruling 5): it reads subroutineFacts, the card entries' holdFacts and
// breakPlans' credits and spends, and calls no price.
//
// The pool is not carried: each node works out the least credits in the Runner's pool that get it through from there
// (every effect on the pool is monotone: a payment adds, a condition sets a floor, a loss of n adds n above 0). So one
// pass answers the least the Runner must bring, for every click split, with no search over the credits.

/** No way through. */
const FAIL = Infinity;

/** The pool needed before losing n credits from it, `after` needed after (a loss takes no more than the pool holds). */
const lose = (after: number, n: number): number => (after > 0 ? after + n : 0);

/** A piece of ice as the walk meets it. */
export interface WalkIce {
  /** The ice, rezzed: the subroutines and subtypes it is met with (gathered; the search reads only `id`). */
  card: CardInstance;
  id: string;
  /** Rezzed when the walk starts (the Runner's turn start applied). */
  rezzed: boolean;
  rezCost: number;
  /** In the rez set: the Corp rezzes it as it is approached (6.4.3). */
  inS: boolean;
  /** Skipped by the Runner's bypasses (runBypasses, bypassesAhead; 6.5.8a). */
  bypassed: boolean;
  subs: SubFacts[];
  types: string[];
  /** Rig indexes of the Botulus programs it hosts ("Hosted virus counter: Break 1 subroutine on host ice"). */
  botulus: number[];
  /** Hosted cards that bypass it for credits (Physarum Entangler): rig index, credits a subroutine, the subtype it can't bypass. */
  bypassers: { idx: number; per: number; unless: string }[];
  /** Its own break ability for credits ("3 credits: Break 1 subroutine on this ice", N-Pot). */
  selfCredits?: number;
  /** A bioroid: the Runner may break its subroutines with clicks (bioroidBreakClicks, by the number broken). */
  bioroid: boolean;
  breakClicks: number[];
  /** Botulus may break its subroutines (not Semak-samun's fracters-only). */
  anyBreaker: boolean;
  rezFacts?: HoldFacts['rezDuringRun'];
  /** What the Runner meets as the encounter begins (6.9.3a: Funhouse, Seraph, Jaguarundi; Paywall). */
  encounterFacts?: HoldFacts['encounter'];
  /** Rig indexes of the hosted cards that give it subtypes (Chromatophores): a Corp trash of one changes them. */
  granters: number[];
  /** 'thisRun': the encounter with it is under way; the subroutines already broken. */
  broken?: boolean[];
  /** The subroutine it gains after its others when the Corp rezzes it during a run (Thunderbolt Armaments, 9.8.3e; its +1 strength is not carried). */
  rezGains?: SubFacts;
  /** Unrezzed at the walk's start, and the Corp chooses its subtypes when it rezzes it (holdFacts.rezChoosesSubtypes, Lycian): the sets it may choose. `types` is then without a choice. */
  choices?: string[][];
}

/** One run of the walk's turn: its server and its ice, innermost first (as the server lists them). */
export interface WalkTarget {
  server: string;
  ice: WalkIce[];
}

/** The ice as the search reads it: no card, so nothing of the board but what was gathered. */
export type SearchIce = Omit<WalkIce, 'card'>;
export interface SearchTarget {
  server: string;
  ice: SearchIce[];
}
export const searchTarget = (t: WalkTarget): SearchTarget => ({ server: t.server, ice: t.ice.map(searchIce) });
function searchIce(w: WalkIce): SearchIce {
  const out: Partial<WalkIce> = { ...w };
  delete out.card;
  return out as SearchIce;
}

/** What the rig's cards are to the search. */
export interface RigFacts {
  /** Audrey v2: its plans spend grip cards. */
  audrey: boolean;
  /** A trojan (Bumi 1.0 may trash it). */
  trojan: boolean;
  /** Trashed by a purge (Physarum Entangler). */
  purgeTrash: boolean;
  /** A breaker or Botulus: its counters are read (memo key). */
  counted: boolean;
}

/**
 * Everything the search reads besides its targets and its state, gathered from the board once per question (Stage D
 * item 1, the time stop's ruling 4.3: a pure search, so the gathered question is its own cache key). Break plans and
 * subtypes are gathered for every number of subroutines and every set of the hosted cards that give subtypes gone.
 */
export interface WalkBoard {
  badPublicity: number;
  threat: number;
  hq: number;
  tags: number;
  grip: number;
  rig: RigFacts[];
  lenders: Lender[];
  /** `${ice id}|${subroutines to break}|${granters gone}|${the Corp's choice of subtypes at rez, by index, or ''}`. */
  plans: Record<string, WalkPlan[]>;
  /** `${ice id}|${granters gone}|${choice}` (some gone, or a choice made). */
  types: Record<string, string[]>;
  /** plan.bypass: the Runner's own bypasses (Physarum Entangler) are tried. */
  bypass: boolean;
  /** The cards the turn's first basic draw gives (Verbal Plasticity: "The first time each turn you take the basic action to draw 1 card, instead draw 2 cards"; the engine's firstBasicDraw); 1 without one. */
  firstDraw: number;
}

/** The state the walk carries (brief 5.1), but the Runner's pool: the walk works out the least pool a way needs. */
export interface WalkState {
  clicks: number;
  tags: number;
  grip: number;
  stack: number;
  /** The turn's first basic draw is taken (WalkBoard.firstDraw). */
  drew: boolean;
  /** The Corp's subtype choices for ice rezzed during the walk (`${ice id}:${index into choices}`, sorted; Lycian). */
  chose: string[];
  corp: number;
  /** Credits the Runner can spend only during this run (the bad publicity fund, filled at each run's start, 10.6.3a-b; Overclock's). */
  fund: number;
  /** Credits on cards that pay during runs (Methuselah, Touchstone): shared through the turn. */
  hosted: number;
  stealth: number;
  /** Counters on each rig card (by rig index). */
  virus: number[];
  power: number[];
  /** Rig indexes trashed during the walk. */
  gone: number[];
  /** Ice rezzed during the walk. */
  up: string[];
  /** Pressure Spike's once-a-run boost used this run. */
  spike: boolean;
  /** Rig indexes trashed when the run ends (Mayfly). */
  mayfly: number[];
}

/** A break plan as the walk spends it: breakPlans' credits and its spends, by rig index. */
export interface WalkPlan {
  breaker: number;
  credits: number;
  stealth: number;
  counter?: { idx: number; kind: 'virus' | 'power'; n: number };
  grip: number;
  mayfly: boolean;
  spike: boolean;
}

/** A subroutine whose resolution ends the run whatever the state ("End the run.", "X or end the run": ruling 6). */
/** What the walk does not carry (trashing or bouncing a Runner card, the Corp's own side, a jack out it may take). */
const INERT = new Set<SubEffect['kind']>(['trashInstalled', 'toGrip', 'iceStrengthThisRun', 'trashThisIce', 'corpSide', 'mayJackOut', 'unknown']);
/** A subroutine that changes nothing the walk carries: breaking it never helps, so the walk leaves it to resolve. */
const inert = (f: SubFacts) => !f.orEndRun && f.does.every(e => INERT.has(e.kind));

const alwaysEnds = (f: SubFacts) => !f.when && !f.unless && (f.orEndRun || f.does.some(e => e.kind === 'endRun' && !e.if));

/** The board the walk starts from: the rig, its counters, and the ice derezzed by then (brief 5.2). */
export interface WalkStart {
  rig: CardInstance[];
  index: Map<string, number>;
  virus: number[];
  power: number[];
  derezzed: Set<string>;
}

export function walkStart(state: GameState, runnerTurn: boolean): WalkStart {
  const rig = [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources];
  const index = new Map(rig.map((c, i) => [c.instanceId, i]));
  const virus = rig.map(c => counters(c, 'virus'));
  const power = rig.map(c => counters(c, 'power'));
  const derezzed = new Set<string>();
  if (runnerTurn) {
    // When a turn ends, Lycian Multi-Munition derezzes itself: by the Runner's next turn it is unrezzed
    for (const sv of Object.values(state.corp.servers)) for (const c of sv.ice) if (c.isRezzed && CARDS[c.cardCode]?.holdFacts?.turnEndDerezSelf) derezzed.add(c.instanceId);
    // 5.7.1d: the Runner's turn begins: Botulus and Tranquilizer place a counter, then Tranquilizer derezzes its host at 3
    rig.forEach((c, i) => {
      const t = CARDS[c.cardCode]?.holdFacts?.runnerTurnStart;
      if (!t) return;
      if (t.counters.kind === 'virus') virus[i] += t.counters.n;
      if (t.counters.kind === 'power') power[i] += t.counters.n;
      if (t.derezHostAt !== undefined && c.hostedOnId && virus[i] >= t.derezHostAt) derezzed.add(c.hostedOnId);
    });
  }
  return { rig, index, virus, power, derezzed };
}

/** The server's ice as the walk meets it, innermost first; inS and bypassed are set per rez set. */
export function walkIce(state: GameState, start: WalkStart, ice: CardInstance[]): WalkIce[] {
  const encounter = state.activeRun?.encounter;
  // The Corp's identity: what ice of some subtypes gains when it is rezzed during a run (Thunderbolt Armaments)
  const anyIce = CARDS[state.corp.identity?.cardCode]?.holdFacts?.rezDuringRun?.anyIce;
  return ice.map(c => {
    const rezzed = c.isRezzed && !start.derezzed.has(c.instanceId);
    const choices = rezzed ? undefined : CARDS[c.cardCode]?.holdFacts?.rezChoosesSubtypes;
    // An ice whose subtypes the Corp chooses at its rez is met without an earlier choice (the derez clears it)
    const up = choices ? { ...c, isRezzed: true, chosenSubtypes: undefined } : c.isRezzed ? c : { ...c, isRezzed: true };
    const view = withIce(state, up);
    const hostedHere = (f: (x: CardInstance) => boolean) => start.rig.flatMap((r, i) => (r.hostedOnId === c.instanceId && f(r) ? [i] : []));
    const bypassers = hostedHere(r => !!CARDS[r.cardCode]?.holdFacts?.hostBypass).map(i => {
      const b = CARDS[start.rig[i].cardCode].holdFacts!.hostBypass!;
      return { idx: i, per: b.creditsPerSubroutine, unless: b.unlessSubtype };
    });
    const subs = plannedSubroutines(view, up).map(sub => subroutineFacts(sub.label));
    const bioroid = isBioroid(c);
    return {
      card: up,
      id: c.instanceId,
      rezzed,
      rezCost: rezCostOf(state, c),
      inS: false,
      bypassed: false,
      subs,
      types: iceSubtypes(up, state),
      botulus: hostedHere(r => r.cardCode === BOTULUS),
      bypassers,
      selfCredits: iceScript(c)?.runnerBreakCost,
      bioroid,
      breakClicks: bioroid ? Array.from({ length: subs.length + 2 }, (_, y) => bioroidBreakClicks(up, y)) : [],
      anyBreaker: canBreakSubroutinesWith(c, null),
      rezFacts: CARDS[c.cardCode]?.holdFacts?.rezDuringRun,
      encounterFacts: CARDS[c.cardCode]?.holdFacts?.encounter,
      granters: hostedHere(r => !!getCardScript(r.cardCode)?.grantsIceSubtypes?.length),
      broken: encounter?.iceId === c.instanceId ? [...encounter.broken] : undefined,
      rezGains: anyIce && (cardDef(c).keywords ?? '').toLowerCase().split(/\s*-\s*/).some(k => anyIce.subtypes.includes(k)) ? subroutineFacts(anyIce.gains) : undefined,
      choices,
    };
  });
}

/**
 * A server's ice as met on the Runner's turn (walkIce from walkStart(state, true)), once per board and server: serverHold's
 * question and the run sequence's ask it of the same boards (the 14:39Z ruling: gathered once).
 */
const turnIceCache = new WeakMap<GameState, Map<string, WalkIce[]>>();
function turnIce(state: GameState, start: WalkStart, server: string): WalkIce[] {
  let cache = turnIceCache.get(state);
  if (!cache) turnIceCache.set(state, (cache = new Map()));
  let ice = cache.get(server);
  if (!ice) cache.set(server, (ice = walkIce(state, start, state.corp.servers[server]?.ice ?? [])));
  return ice;
}

/** Each ice's break plans, by the number of subroutines, worked out once per board (time condition: not once per rez set). */
const planCache = new WeakMap<GameState, Map<string, WalkPlan[]>>();

/** The board with the hosted subtype-giving cards at rig indexes `off` taken off (for the ice's subtypes and plans). */
function without(state: GameState, start: WalkStart, off: number[]): GameState {
  if (!off.length) return state;
  const ids = new Set(off.map(i => start.rig[i].instanceId));
  return { ...state, runner: { ...state.runner, rig: { ...state.runner.rig, programs: state.runner.rig.programs.filter(c => !ids.has(c.instanceId)) } } };
}

/** The walk's board for `targets` (WalkBoard): everything the search reads, from the board. */
export function walkBoard(state: GameState, start: WalkStart, targets: WalkTarget[]): WalkBoard {
  let cache = planCache.get(state);
  if (!cache) planCache.set(state, (cache = new Map()));
  const plans: Record<string, WalkPlan[]> = {};
  const types: Record<string, string[]> = {};
  const ices = new Map(targets.flatMap(t => t.ice.map(i => [i.id, i] as const)));
  for (const ice of ices.values()) {
    const n = ice.subs.length + (ice.rezGains ? 1 : 0);
    for (let mask = 0; mask < 1 << ice.granters.length; mask++) {
      const off = ice.granters.filter((_, k) => mask & (1 << k));
      const board = without(state, start, off);
      for (const k of ['', ...(ice.choices ?? []).map((_, i) => String(i))]) {
        const card = k === '' ? ice.card : { ...ice.card, chosenSubtypes: ice.choices![Number(k)] };
        if (off.length || k !== '') types[`${ice.id}|${off}|${k}`] = iceSubtypes(card, board);
        for (let z = 1; z <= n; z++) {
          const key = `${ice.id}|${z}|${off}|${k}`;
          let list = cache.get(key);
          if (!list) cache.set(key, (list = planFor(board, start, card, z)));
          plans[key] = list;
        }
      }
    }
  }
  const borrows = [...ices.values()].some(i => i.subs.some(f => f.does.some(e => e.kind === 'borrow')));
  return {
    badPublicity: state.corp.badPublicity,
    threat: threatLevel(state),
    hq: state.corp.hq.length,
    tags: state.runner.tags,
    grip: state.runner.grip.length,
    rig: start.rig.map(c => {
      const keywords = cardDef(c).keywords ?? '';
      return { audrey: c.cardCode === AUDREY, trojan: /\btrojan\b/i.test(keywords), purgeTrash: !!CARDS[c.cardCode]?.holdFacts?.trashedOnPurge, counted: c.cardCode === BOTULUS || /icebreaker/i.test(keywords) };
    }),
    lenders: borrows ? lenders(state, targets) : [],
    plans,
    types,
    bypass: !!plan().bypass,
    firstDraw: [...start.rig, state.runner.identity].reduce((n, c) => Math.max(n, (c && getCardScript(c.cardCode)?.modifiers?.firstBasicDraw) || 1), 1),
  };
}

/** breakPlans for `z` of the ice's subroutines, as the walk spends them (rig indexes). */
function planFor(board: GameState, start: WalkStart, card: CardInstance, z: number): WalkPlan[] {
  return breakPlans(withIce(board, card), card, z).flatMap(({ plan: p, spends }) => {
    const breaker = start.index.get(p.breaker.instanceId);
    if (breaker === undefined) return [];
    const c = spends.counters;
    const idx = c ? start.index.get(c.cardId) : undefined;
    return [{
      breaker,
      credits: p.credits,
      stealth: spends.stealthCredits ?? 0,
      counter: c && idx !== undefined ? { idx, kind: c.kind, n: c.n } : undefined,
      grip: spends.gripCards ?? 0,
      mayfly: !!spends.trashesBreaker,
      spike: !!spends.oncePerRun,
    }];
  });
}

/** The walk (exported with its parts for tests/holdWalkReference.test.ts, the brute-force reference; brief section 6). */
export class Walk {
  /** Per target and ice position: the rez-set and bypass flags of that ice and every ice inward of it, the part of the
   * set an approach there reads (a memo shared across the rez sets of one question keys on it). */
  private readonly inner: string[][];
  /** Per target: the flags of the targets after it (a later run reads all of its ice). */
  private readonly later: string[];
  /** The rig cards whose counters the walk reads (breakers, Botulus): the others' counters stay out of the memo key. */
  private readonly counted: number[];
  /** By run: whether its approaches read the Runner's clicks (key them by clicks). The last run's breach ends the walk, so
   * its clicks are read only by a bioroid's click breaks and a toll paid in clicks; on any other run, by the runs after. */
  private readonly clicksRead: boolean[];
  /** The ice a borrowed subroutine may come from, with its subroutines' facts (borrow). */
  private readonly lenders: Lender[];
  /** A draw can matter (some damage, a grip condition or a grip-spending plan on the way). */
  private readonly drawUseful: boolean;
  /** Removing a tag can matter (some condition or effect reads the Runner's tags). */
  private readonly tagUseful: boolean;

  constructor(
    /** What it reads of the board, gathered (walkBoard): the search has no `state` in scope. */
    private readonly board: WalkBoard,
    private readonly targets: SearchTarget[],
    /** The memo, shared by the walks of one question over its rez sets (keys carry the flags they read). */
    private readonly memo = new Map<string, number>(),
  ) {
    // Keys name the server and the runs still to make, not the run's index: the last run of a sequence and a single run
    // on the same server share their nodes (sequenceEntries, turnReach)
    const flags = (i: SearchIce) => `${i.inS ? 1 : 0}${i.bypassed ? 1 : 0}`;
    this.inner = targets.map(t => t.ice.map((_, pos) => `${t.server}:${t.ice.slice(0, pos + 1).map(flags).join('')}`));
    this.later = targets.map((_, j) => targets.slice(j + 1).map(t => `${t.server}:${t.ice.map(flags).join('')}`).join('/'));
    this.clicksRead = targets.map((t, j) => j < targets.length - 1 || t.ice.some(i => i.bioroid || i.encounterFacts?.unless?.clicks !== undefined));
    this.counted = board.rig.flatMap((r, i) => (r.counted ? [i] : []));
    const facts = targets.flatMap(t => t.ice.flatMap(i => (i.rezGains ? [...i.subs, i.rezGains] : i.subs)));
    const effects = facts.flatMap(f => f.does);
    const borrows = effects.filter(e => e.kind === 'borrow').length;
    // What a borrow can resolve: the subroutines of every ice it may lend from (borrow, below), gathered
    this.lenders = borrows ? board.lenders : [];
    const lent = this.lenders.flatMap(l => l.facts);
    const all = [...facts, ...lent];
    const allEffects = all.flatMap(f => f.does);
    const encounters = targets.flatMap(t => t.ice.flatMap(i => (i.encounterFacts ? [i.encounterFacts] : [])));
    // A draw helps only when the grip can run short (10.4.4): the most the targets can take from it (damage, net damage
    // paid instead, X counted at the most tags the walk can carry; each borrow at the most one lent subroutine takes) is
    // more than it holds; a grip condition or a plan that spends grip cards (Audrey v2) always counts
    const most = (list: number[]) => list.reduce((a, b) => Math.max(a, b), 0);
    const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
    const tagsOf = (f: SubFacts) => sum(f.does.map(e => (e.kind === 'tags' && typeof e.n === 'number' ? e.n : 0)));
    const tagGains = targets.flatMap(t => t.ice.map(i => (i.rezFacts?.tags ?? 0) + (i.encounterFacts?.toll?.tags ?? 0) + (i.encounterFacts?.unless?.tags ?? 0)));
    const tagsMost = board.tags + sum(tagGains) + sum(facts.map(tagsOf)) + borrows * most(lent.map(tagsOf));
    const gripOf = (f: SubFacts) => sum(f.does.map(e => (e.kind === 'damage' ? (e.n === 'runnerTags' ? tagsMost : e.n) : 0))) + (f.unless?.netDamage ?? 0);
    const gripMost = sum(facts.map(gripOf)) + sum(encounters.map(e => e.unless?.netDamage ?? 0)) + borrows * most(lent.map(gripOf));
    const doubling = allEffects.some(e => e.kind === 'tags' && e.n === 'runnerTags');
    this.drawUseful = doubling || allEffects.some(e => e.kind === 'endRun' && e.if?.kind === 'hqMoreThanGrip') || board.rig.some(r => r.audrey) || gripMost > board.grip;
    this.tagUseful = all.some(f => f.when?.kind === 'runnerTagsAtLeast') || allEffects.some(e => (e.kind === 'endRun' && e.if?.kind === 'runnerTagsAtLeast') || ((e.kind === 'damage' || e.kind === 'tags') && e.n === 'runnerTags') || (e.kind === 'corpGainsCredits' && e.n === 'perRunnerTag'));
  }

  /** The walk state in a memo key (run j: the clicks only where they are read, the stack before the last run). */
  private wsKey(ws: WalkState, j: number): string {
    return `${this.clicksRead[j] ? ws.clicks : '-'}|${ws.tags}|${ws.grip}|${j < this.targets.length - 1 ? ws.stack : '-'}|${ws.corp}|${ws.fund}|${ws.hosted}|${ws.stealth}|${this.counters(ws)}|${ws.gone}|${ws.up}|${ws.spike ? 1 : 0}|${ws.mayfly}|${ws.drew ? 1 : 0}|${ws.chose}`;
  }

  /** The counters the walk reads, for a memo key. */
  private counters(ws: WalkState): string {
    let s = '';
    for (const i of this.counted) s += `${ws.virus[i]},${ws.power[i]};`;
    return s;
  }

  /** The least pool that gets the Runner through every target in order, its turn's clicks in `ws` (runnerTurn). */
  turn(ws: WalkState): number {
    return this.beforeRun(ws, 0);
  }

  /** The least pool from the approach of the ice at `pos` of the first target (thisRun: the run under way). */
  fromIce(ws: WalkState, pos: number): number {
    return this.approach(ws, 0, pos);
  }

  /**
   * Before run j: the Runner may draw (5.2.7c) or remove a tag (5.2.7g: a click and 2 credits) with a click it keeps
   * clear of the runs still to make, then runs (5.2.7d). Earning comes first (runnerEarnings at the turn's start): a
   * credit in the pool earlier is never worse.
   */
  private beforeRun(ws: WalkState, j: number): number {
    const runs = this.targets.length - j;
    if (ws.clicks < runs) return FAIL;
    const key = `b|${this.inner[j][this.targets[j].ice.length - 1] ?? this.targets[j].server}|${this.later[j]}|${ws.clicks}|${ws.tags}|${ws.grip}|${ws.stack}|${ws.corp}|${ws.hosted}|${ws.stealth}|${this.counters(ws)}|${ws.gone}|${ws.up}|${ws.drew ? 1 : 0}|${ws.chose}`;
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;
    // 6.9.1b, 10.6.3a: the bad publicity fund is filled as each run begins
    const fund = this.board.badPublicity;
    let best = this.approach({ ...ws, clicks: ws.clicks - 1, spike: false, fund }, j, this.targets[j].ice.length - 1);
    if (ws.clicks > runs) {
      if (this.drawUseful && ws.stack > 0) {
        // 5.2.7c; the turn's first draw may give more (WalkBoard.firstDraw), at most the stack
        const n = Math.min(ws.stack, ws.drew ? 1 : this.board.firstDraw);
        best = Math.min(best, this.beforeRun({ ...ws, clicks: ws.clicks - 1, grip: ws.grip + n, stack: ws.stack - n, drew: true }, j));
      }
      if (this.tagUseful && ws.tags > 0) best = Math.min(best, this.beforeRun({ ...ws, clicks: ws.clicks - 1, tags: ws.tags - 1 }, j) + 2);
    }
    this.memo.set(key, best);
    return best;
  }

  /** The breach of run j (6.9.5): the turn goes on to the next target, Mayfly trashed as the run ends. */
  private breach(ws: WalkState, j: number): number {
    if (j + 1 >= this.targets.length) return 0;
    // 6.9.6b, 10.6.3b: what is left in the bad publicity fund goes back to the bank
    return this.beforeRun({ ...ws, fund: 0, gone: [...ws.gone, ...ws.mayfly].sort((a, b) => a - b), mayfly: [] }, j + 1);
  }

  private approach(ws: WalkState, j: number, pos: number): number {
    if (pos < 0) return this.breach(ws, j);
    const at = `${pos}|${this.inner[j][pos]}|${this.later[j]}`;
    const key = `${at}|${this.wsKey(ws, j)}`;
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;
    const ice = this.targets[j].ice[pos];
    const next = (w: WalkState) => this.approach(w, j, pos - 1);
    let v: number;
    if (!ice.rezzed && !ws.up.includes(ice.id)) {
      // 6.9.2c: unrezzed ice the Corp does not rez is passed; 6.4.3: ice of S is rezzed as it is approached
      const paid = ws.corp - ice.rezCost;
      v = ice.inS && paid >= 0 ? this.rezzed({ ...ws, corp: paid, up: [...ws.up, ice.id].sort() }, ice, next, { key: at, j }) : next(ws);
    } else v = ice.bypassed ? next(ws) : this.encounter(ws, ice, next, { key: at, j });
    this.memo.set(key, v);
    return v;
  }

  /** The ice was rezzed during this run against its server: its rez-time facts (Flyswatter: purge virus counters). */
  private rezzed(ws: WalkState, ice: SearchIce, next: (w: WalkState) => number, at: Step): number {
    if (ice.choices && this.choiceOf(ice, ws) === '') {
      // Lycian: the Corp chooses the ice's subtypes as it rezzes it, the choice worst for the Runner (ruling 6)
      let worst = -Infinity;
      ice.choices.forEach((_, k) => (worst = Math.max(worst, this.rezzed({ ...ws, chose: [...ws.chose, `${ice.id}:${k}`].sort() }, ice, next, at))));
      return worst;
    }
    let w = ws;
    if (ice.rezFacts?.purgeVirus) {
      // Purging removes every virus counter (10.3.5); Physarum Entangler is trashed by it (its text)
      const purged = this.board.rig.flatMap((r, i) => (r.purgeTrash ? [i] : []));
      w = { ...w, virus: w.virus.map(() => 0), gone: [...new Set([...w.gone, ...purged])].sort((a, b) => a - b) };
    }
    if (ice.rezFacts?.tags) w = { ...w, tags: w.tags + ice.rezFacts.tags };
    // Thunderbolt Armaments: the ice gains its subroutine after its others for the rest of the run (9.8.3e)
    const met = ice.rezGains ? { ...ice, subs: [...ice.subs, ice.rezGains] } : ice;
    const go = (x: WalkState) => (ice.bypassed ? next(x) : this.encounter(x, met, next, at));
    if (ice.rezFacts?.corpMayTrashInstalled === 'trojan') {
      // Bumi 1.0: the Corp may trash 1 installed trojan, the choice worst for the Runner (ruling 6)
      let worst = go(w);
      this.board.rig.forEach((r, i) => {
        if (!w.gone.includes(i) && r.trojan) worst = Math.max(worst, go({ ...w, gone: [...w.gone, i].sort((a, b) => a - b) }));
      });
      return worst;
    }
    return go(w);
  }

  /**
   * An encounter: the Runner's own bypass first (Physarum, its trigger as the active player's), then what the ice does as
   * the encounter begins (6.9.3a), then its choice of the subroutines to break and how; the rest resolve in order.
   */
  private encounter(ws: WalkState, ice: SearchIce, next: (w: WalkState) => number, at: Step): number {
    const subs = ice.subs;
    const types = this.typesOf(ice, ws);
    let best = FAIL;
    if (this.board.bypass) {
      for (const b of ice.bypassers) if (!ws.gone.includes(b.idx) && !types.includes(b.unless)) best = Math.min(best, this.pay(ws, b.per * subs.length, next));
    }
    return Math.min(best, this.tolls(ws, ice, w => this.breaks(w, ice, types, next, at)));
  }

  /** The ice's subtypes now: a Corp trash of a hosted card that gives subtypes (Chromatophores) takes them away. */
  private typesOf(ice: SearchIce, ws: WalkState): string[] {
    const off = ice.granters.filter(i => ws.gone.includes(i));
    const k = this.choiceOf(ice, ws);
    return off.length || k !== '' ? this.board.types[`${ice.id}|${off}|${k}`] : ice.types;
  }

  /** The Corp's choice of the ice's subtypes at its rez during the walk (its index in `choices`), or '' (none made). */
  private choiceOf(ice: SearchIce, ws: WalkState): string {
    if (!ice.choices) return '';
    const c = ws.chose.find(x => x.startsWith(`${ice.id}:`));
    return c ? c.slice(ice.id.length + 1) : '';
  }

  /**
   * What the ice does as the encounter begins (6.9.3a): a toll unless the Runner pays one of the alternatives, its
   * choice (Funhouse: end the run unless it takes 1 tag; Seraph: lose 3 unless it suffers 2 net damage or takes 1 tag;
   * Jaguarundi at threat 4: a tag unless it spends a click).
   */
  private tolls(ws: WalkState, ice: SearchIce, then: (w: WalkState) => number): number {
    const e = ice.encounterFacts;
    if (!e || ice.broken || (e.threatAtLeast !== undefined && this.board.threat < e.threatAtLeast)) return then(ws);
    // Paywall: the Runner loses credits as the encounter begins (6.9.3a), from its pool (10.6.2: not the fund)
    if (e.loses) return lose(this.toll(ws, e, then), e.loses);
    return this.toll(ws, e, then);
  }

  /** The encounter toll and the alternatives the Runner may pay instead, its choice. */
  private toll(ws: WalkState, e: NonNullable<SearchIce['encounterFacts']>, then: (w: WalkState) => number): number {
    if (!e.toll) return then(ws);
    const t = e.toll;
    let best = t.endRun ? FAIL : t.loses ? lose(then(ws), t.loses) : then({ ...ws, tags: ws.tags + (t.tags ?? 0) });
    const u = e.unless ?? {};
    if (u.tags) best = Math.min(best, then({ ...ws, tags: ws.tags + u.tags }));
    if (u.netDamage !== undefined && u.netDamage <= ws.grip) best = Math.min(best, then({ ...ws, grip: ws.grip - u.netDamage }));
    if (u.clicks !== undefined && u.clicks <= ws.clicks) best = Math.min(best, then({ ...ws, clicks: ws.clicks - u.clicks }));
    return best;
  }

  /** The Runner's choice of the subroutines to break and how (a plan, Botulus's counters, the ice's own ability). */
  private breaks(ws: WalkState, ice: SearchIce, types: string[], next: (w: WalkState) => number, at: Step): number {
    const subs = ice.subs;
    let best = FAIL;
    // An inert subroutine resolves to nothing (breaking it never helps): left out of the choice and of the resolution
    const open = subs.map((_, i) => i).filter(i => !ice.broken?.[i] && !inert(subs[i]));
    for (let set = 0; set < 1 << open.length; set++) {
      const unbroken = open.filter((_, k) => !(set & (1 << k)));
      if (unbroken.some(i => alwaysEnds(subs[i]))) continue;
      const b = open.length - unbroken.length;
      const resolve = (w: WalkState) => this.resolve(w, ice, types, unbroken, 0, next, at);
      if (b === 0) {
        best = Math.min(best, resolve(ws));
        continue;
      }
      const hosted = ice.anyBreaker ? ice.botulus.filter(i => !ws.gone.includes(i)) : [];
      const counters = hosted.reduce((n, i) => n + ws.virus[i], 0);
      for (let x = 0; x <= Math.min(b, counters); x++) {
        const w1 = x ? this.spendBotulus(ws, hosted, x) : ws;
        for (let y = 0; y <= b - x; y++) {
          if (y > 0 && !ice.bioroid && ice.selfCredits === undefined) break;
          const clicks = ice.bioroid && y > 0 ? ice.breakClicks[y] : 0;
          if (clicks > w1.clicks) break;
          const w2 = clicks ? { ...w1, clicks: w1.clicks - clicks } : w1;
          const self = (w: WalkState, then: (w: WalkState) => number) => (ice.selfCredits !== undefined && y > 0 ? this.pay(w, y * ice.selfCredits, then) : then(w));
          const z = b - x - y;
          if (z === 0) {
            best = Math.min(best, self(w2, resolve));
            continue;
          }
          for (const p of this.planList(ice, z, w2)) if (this.usable(w2, p)) best = Math.min(best, self(w2, w => this.payPlan(w, p, resolve)));
        }
      }
    }
    return best;
  }

  private spendBotulus(ws: WalkState, hosted: number[], x: number): WalkState {
    const virus = [...ws.virus];
    let left = x;
    for (const i of hosted) {
      const n = Math.min(left, virus[i]);
      virus[i] -= n;
      left -= n;
    }
    return { ...ws, virus };
  }

  private planList(ice: SearchIce, z: number, ws: WalkState): WalkPlan[] {
    return this.board.plans[`${ice.id}|${z}|${ice.granters.filter(i => ws.gone.includes(i))}|${this.choiceOf(ice, ws)}`] ?? [];
  }

  private usable(ws: WalkState, p: WalkPlan): boolean {
    if (ws.gone.includes(p.breaker) || (p.spike && ws.spike) || p.stealth > ws.stealth || p.grip > ws.grip) return false;
    return !p.counter || (p.counter.kind === 'virus' ? ws.virus : ws.power)[p.counter.idx] >= p.counter.n;
  }

  private payPlan(ws: WalkState, p: WalkPlan, then: (w: WalkState) => number): number {
    const w: WalkState = { ...ws, stealth: ws.stealth - p.stealth, spike: ws.spike || p.spike, grip: ws.grip - p.grip };
    if (p.counter) {
      const list = [...(p.counter.kind === 'virus' ? w.virus : w.power)];
      list[p.counter.idx] -= p.counter.n;
      if (p.counter.kind === 'virus') w.virus = list;
      else w.power = list;
    }
    if (p.mayfly && !w.mayfly.includes(p.breaker)) w.mayfly = [...w.mayfly, p.breaker].sort((a, b) => a - b);
    return this.pay(w, p.credits - p.stealth, then);
  }

  /**
   * Pays `n` credits during the run: the run-only credits first (the fund, which goes back at the run's end, then the
   * credits on cards that pay during runs), the pool last (spendCredits' order): a pool credit can do all they can and
   * more (conditions read the pool; 10.6.2: the fund is not part of it). The pool part is added to what the rest needs.
   */
  private pay(ws: WalkState, n: number, then: (w: WalkState) => number): number {
    const fund = Math.min(n, ws.fund);
    const hosted = Math.min(n - fund, ws.hosted);
    const w = fund || hosted ? { ...ws, fund: ws.fund - fund, hosted: ws.hosted - hosted } : ws;
    return then(w) + (n - fund - hosted);
  }

  /** The unbroken subroutines `list` (indexes into ice.subs) resolve one at a time in printed order (9.8.7b). */
  private resolve(ws: WalkState, ice: SearchIce, types: string[], list: number[], k: number, next: (w: WalkState) => number, at: Step): number {
    if (k >= list.length) return next(ws);
    const go = () => this.subroutine(ws, ice.id, types, ice.subs[list[k]], w => this.resolve(w, ice, types, list, k + 1, next, at));
    // A borrowing ice (Mycoweb) branches on every subroutine it may lend, each with the rest of its own to resolve: the
    // steps after the first are keyed (`at`: the approach and run; the subroutines as met, those left, the state)
    if (k === 0 || !ice.subs.some(f => f.does.some(e => e.kind === 'borrow'))) return go();
    const key = `s|${at.key}|${ice.subs.length}|${list}|${k}|${this.wsKey(ws, at.j)}`;
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;
    const v = go();
    this.memo.set(key, v);
    return v;
  }

  /** One subroutine resolves (or the Runner pays its nested cost instead, 1.16.11b). */
  private subroutine(ws: WalkState, card: string, types: string[], f: SubFacts, then: (w: WalkState) => number): number {
    if (f.when && !(f.when.kind === 'iceIs' ? types.includes(f.when.subtype) : f.when.kind === 'runnerTagsAtLeast' && ws.tags >= f.when.n)) return then(ws);
    // "X or end the run": the Corp chooses, and the walk takes the end (ruling 6)
    if (f.orEndRun) return FAIL;
    let best = this.effects(ws, card, f.does, 0, then);
    // "unless the Runner pays N" (1.16.11b): paid as it resolves, run-only credits first (10.6.3a: the fund pays any cost
    // during the run)
    if (f.unless?.credits !== undefined) best = Math.min(best, this.pay(ws, f.unless.credits, then));
    // "unless the Runner trashes 1 of their installed cards" (Thunderbolt Armaments): the card it can best spare
    if (f.unless?.trashInstalled) {
      this.board.rig.forEach((_, i) => {
        if (!ws.gone.includes(i)) best = Math.min(best, then({ ...ws, gone: [...ws.gone, i].sort((a, b) => a - b) }));
      });
    }
    if (f.unless?.netDamage !== undefined && f.unless.netDamage <= ws.grip) best = Math.min(best, then({ ...ws, grip: ws.grip - f.unless.netDamage }));
    return best;
  }

  private effects(ws: WalkState, card: string, does: SubEffect[], i: number, then: (w: WalkState) => number): number {
    if (i >= does.length) return then(ws);
    const e = does[i];
    const next = (w: WalkState) => this.effects(w, card, does, i + 1, then);
    switch (e.kind) {
      case 'endRun': {
        const c = e.if;
        if (!c) return FAIL;
        if (c.kind === 'runnerCreditsAtMost') return Math.max(next(ws), c.n + 1);
        if (c.kind === 'corpCreditsMoreThanRunner') return Math.max(next(ws), ws.corp);
        if (c.kind === 'runnerTagsAtLeast') return ws.tags >= c.n ? FAIL : next(ws);
        if (c.kind === 'threatAtLeast') return this.board.threat >= c.n ? FAIL : next(ws);
        if (c.kind === 'hqMoreThanGrip') return this.board.hq > ws.grip ? FAIL : next(ws);
        // Diviner's odd cost: a fact of the grip the walk can't read; left out (the safe side, "does not hold")
        return next(ws);
      }
      case 'runnerLosesClicks':
        return next({ ...ws, clicks: Math.max(0, ws.clicks - e.n) });
      case 'runnerLosesCredits':
        return lose(next(ws), e.n);
      case 'corpGainsCredits':
        return next({ ...ws, corp: ws.corp + (e.n === 'perRunnerTag' ? ws.tags : e.n) });
      case 'damage': {
        // 10.4.4: more damage than the cards in the grip is a flatline; each point takes a card (10.4.2)
        const n = e.n === 'runnerTags' ? ws.tags : e.n;
        return n > ws.grip ? FAIL : next({ ...ws, grip: ws.grip - n });
      }
      case 'tags':
        return next({ ...ws, tags: ws.tags + (e.n === 'runnerTags' ? ws.tags : e.n) });
      case 'cannotStealOrTrash':
        return FAIL;
      case 'corpMayTrashHqToEndRun':
        return this.board.hq > 0 ? FAIL : next(ws);
      case 'borrow':
        return this.borrow(ws, card, e.subtype, next);
      default:
        // What the walk doesn't carry: trashing or bouncing a Runner card (registry debt: errs toward "does not hold"),
        // the Corp's own side, a jack out the Runner may take
        return next(ws);
    }
  }

  /** Mycoweb: the Corp resolves 1 subroutine of another rezzed ice of the subtype, the one worst for the Runner (ruling 6). */
  private borrow(ws: WalkState, card: string, subtype: string, next: (w: WalkState) => number): number {
    let worst = -1;
    for (const l of this.lenders) {
      if (l.id === card || !(l.rezzed || ws.up.includes(l.id)) || !l.types.includes(subtype)) continue;
      for (const f of l.facts) worst = Math.max(worst, this.subroutine(ws, l.id, l.types, f, next));
    }
    return worst < 0 ? next(ws) : worst;
  }
}

/** Where an encounter is: its approach's memo key and its run. */
interface Step {
  key: string;
  j: number;
}

/** A borrow's lender: rezzed now, or walked (rezzed when the walk rezzes it), its subroutines but the borrowing ones. */
interface Lender {
  id: string;
  rezzed: boolean;
  types: string[];
  facts: SubFacts[];
}

/** Every ice a borrow may lend from, in board order: the walked ice as met, the rest as the board has it. */
function lenders(state: GameState, targets: WalkTarget[]): Lender[] {
  const walked = new Map(targets.flatMap(t => t.ice.map(x => [x.id, x] as const)));
  return lenderViews(state, walked).flatMap(v => (walked.has(v.id) ? [v.walked!] : v.unwalked ? [v.unwalked] : []));
}

/** Each ice of the board as a lender both ways, in board order: as met when `walked` holds it, and as the board has it (rezzed ice only). */
function lenderViews(state: GameState, walked: Map<string, WalkIce>): { id: string; walked?: Lender; unwalked?: Lender }[] {
  const facts = (c: CardInstance) => iceSubroutines(state, c).filter(sub => !/resolve 1 subroutine on/i.test(sub.label)).map(sub => subroutineFacts(sub.label));
  const out: { id: string; walked?: Lender; unwalked?: Lender }[] = [];
  for (const sv of Object.values(state.corp.servers)) {
    for (const c of sv.ice) {
      const w = walked.get(c.instanceId);
      out.push({
        id: c.instanceId,
        walked: w ? { id: c.instanceId, rezzed: w.rezzed, types: w.types, facts: facts(w.card) } : undefined,
        unwalked: c.isRezzed ? { id: c.instanceId, rezzed: true, types: iceSubtypes(c, state), facts: facts(c) } : undefined,
      });
    }
  }
  return out;
}

/** Credits on the rig's cards that pay during runs (Methuselah, Touchstone; cardEffects runPayers). */
function duringRuns(state: GameState): number {
  const rig = [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources];
  return rig.filter(c => getCardScript(c.cardCode)?.paysDuringRuns).reduce((n, c) => n + counters(c, 'credit'), 0);
}

/** The walk's first state on the Runner's turn: `clicks` for the turn, the rest from the board at its start. */
export function firstState(state: GameState, start: WalkStart, clicks: number, corp: number): WalkState {
  return {
    clicks,
    tags: state.runner.tags,
    grip: state.runner.grip.length,
    stack: state.runner.stack.length,
    drew: false,
    chose: [],
    corp,
    fund: 0,
    hosted: duringRuns(state),
    stealth: runStealthCredits(state),
    virus: start.virus,
    power: start.power,
    gone: [],
    up: [],
    spike: false,
    mayfly: [],
  };
}

/** What one turn's search reads besides its targets: the gathered board, the clicks and what they earn, the first state. */
interface TurnInput {
  board: WalkBoard;
  /** runnerEarnings: what the Runner earns with k clicks. */
  earn: number[];
  maxClicks: number;
  /** The first state, its clicks set per split. */
  first: WalkState;
}

/** The turn's input from the board (gathering: the only part of a question that reads `state`). */
function turnInput(state: GameState, start: WalkStart, targets: WalkTarget[], corp: number): TurnInput {
  return { board: walkBoard(state, start, targets), earn: runnerEarnings(state), maxClicks: state.runner.maxClicks, first: firstState(state, start, Math.max(0, state.runner.maxClicks), corp) };
}

/**
 * The least the Runner must bring for one turn through `targets`, in the budget's units (brief 5.5): over every split of
 * its clicks, the pool the walk needs plus what the clicks it doesn't earn with would have earned (runnerEarnings).
 */
function turnNeed(input: TurnInput, targets: SearchTarget[], memo?: Map<string, number>): number {
  return walkNeed(input, new Walk(input.board, targets, memo), targets.length);
}

/** turnNeed with its walk made (reachOrders shares a walk's memo with the walks that read the same). */
function walkNeed(input: TurnInput, walk: Walk, runs: number): number {
  const { earn, first } = input;
  const c = Math.max(0, input.maxClicks);
  let need = FAIL;
  for (let e = 0; e + runs <= c; e++) need = Math.min(need, walk.turn({ ...first, clicks: c - e }) + earn[c - 1] - earn[e]);
  return need;
}

/** The Corp's credits through the walk: the rez budget asked, or its credits and every rez it could make (as the oracle). */
export function corpStart(state: GameState, ice: WalkIce[], corpCredits: number): number {
  return Number.isFinite(corpCredits) ? corpCredits : state.corp.credits + ice.filter(c => !c.rezzed).reduce((n, c) => n + c.rezCost, 0);
}

/** The board runBypasses reads for a rez set: the ice rezzed at the walk's start and the set's (as rezzedSet before). */
function bypassBoard(state: GameState, serverId: string, ice: WalkIce[], set: Set<string>): GameState {
  const server = state.corp.servers[serverId];
  return withServerIce(state, serverId, server.ice.map((c, i) => ({ ...c, isRezzed: ice[i].rezzed || set.has(c.instanceId) })));
}

/** A run of the walk's turn on `server` with `set` to rez: its ice as met, and what its bypasses cost (runBypasses; 6.5.8a). */
export function runTarget(state: GameState, base: WalkIce[], server: string, set: Set<string>): { target: WalkTarget; price: number } {
  const all = state.corp.servers[server]?.ice ?? [];
  // The view runBypasses read before (the Runner's clicks but the run's)
  const view: GameState = { ...state, runner: { ...state.runner, clicks: Math.max(0, state.runner.maxClicks - 1) } };
  const bypassed = all.length ? runBypasses(bypassBoard(view, server, base, set), server) : undefined;
  const ice = base.map(c => ({ ...c, inS: set.has(c.card.instanceId), bypassed: !!bypassed?.ids.has(c.card.instanceId) }));
  return { target: { server, ice }, price: bypassed?.price ?? 0 };
}

/**
 * One 'runnerTurn' question, gathered (Stage D item 1, the time stop's ruling 4.3): the server's ice as met with no rez
 * set, the board the search reads, and each rez set the Corp can afford (its mask over the ice, its rez cost, the ice its
 * bypasses skip and their price; the empty set always, as `entries` may need it). The search reads this and nothing else,
 * so the question is its own cache key: equal questions are equal answers, whichever board asked.
 */
export interface TurnQuestion extends TurnInput {
  server: string;
  budget: number;
  ice: SearchIce[];
  sets: { mask: number; rez: number; affordable: boolean; bypassed: number; price: number }[];
}

/** A question's answer: the set that holds (its index in `sets`), or the one that asks the most, and its need. */
interface TurnAnswer {
  holds: boolean;
  set: number;
  need: number;
  /** The further runs (sequenceEntries), worked out when first read; the memo is kept for it until then. */
  entries?: number;
  memo?: Map<string, number>;
}

/** Answers per decision (ruling 4.3: never across decisions): keyed by the decision's anchor, so they die with it. */
const turnAnswers = new WeakMap<object, Map<string, TurnAnswer>>();
/** Questions asked and searched (the cache's hits are asked less searched), for the time report and its test. */
export const holdCacheStats = { asked: 0, searched: 0 };

/** The question as its key: every value it holds (a non-finite number by name; a Set, Map or function is refused). */
export function questionKey(q: unknown): string {
  return JSON.stringify(q, (_, v) => {
    if (typeof v === 'number' && !Number.isFinite(v)) return `#${v}`;
    if (v instanceof Set || v instanceof Map || typeof v === 'function') throw new Error('hold question: not plain data');
    return v;
  });
}

function turnQuestion(state: GameState, server: string, corpCredits: number): TurnQuestion {
  const all = state.corp.servers[server]?.ice ?? [];
  const start = walkStart(state, true);
  const base = turnIce(state, start, server);
  const n = Math.min(all.length, 10);
  const sets: TurnQuestion['sets'] = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    let rez = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) rez = base[i].rezzed ? Infinity : rez + base[i].rezCost;
    // A set with an ice rezzed already is the set without it (its rez cost is no rez's; with the rez budget asked
    // as unlimited, by holdingRez, it was walked again for nothing)
    const affordable = rez < Infinity && rez <= corpCredits;
    if (!affordable && mask) continue;
    const { target, price } = runTarget(state, base, server, new Set(all.slice(0, n).filter((_, i) => mask & (1 << i)).map(c => c.instanceId)));
    const bypassed = target.ice.reduce((m, c, i) => (c.bypassed ? m | (1 << i) : m), 0);
    sets.push({ mask, rez, affordable, bypassed, price });
  }
  // Cheapest first, ties in mask order (as before): the first that holds is the answer
  sets.sort((a, b) => a.rez - b.rez || a.mask - b.mask);
  return {
    ...turnInput(state, start, [{ server, ice: base }], corpStart(state, base, corpCredits)),
    server,
    budget: runnerBudget(state),
    ice: base.map(searchIce),
    sets,
  };
}

/** The run of a question's rez set: the ice as met, the set's ice rezzed as approached and its bypasses skipped. */
function setTarget(q: TurnQuestion, k: number): SearchTarget {
  const { mask, bypassed } = q.sets[k];
  return { server: q.server, ice: q.ice.map((c, i) => ({ ...c, inS: !!(mask & (1 << i)), bypassed: !!(bypassed & (1 << i)) })) };
}

/** The search of a question (pure: it reads `q` alone). */
function solveTurn(q: TurnQuestion): TurnAnswer {
  holdCacheStats.searched++;
  const memo = new Map<string, number>();
  let most = -Infinity;
  let mostSet = -1;
  for (let k = 0; k < q.sets.length; k++) {
    if (!q.sets[k].affordable) continue;
    const need = turnNeed(q, [setTarget(q, k)], memo) + q.sets[k].price;
    if (need > q.budget) return { holds: true, set: k, need };
    if (need > most) [most, mostSet] = [need, k];
  }
  return { holds: false, set: mostSet < 0 ? q.sets.findIndex(x => x.mask === 0) : mostSet, need: most === -Infinity ? 0 : most, memo };
}

/** `entries` from the run sequence (brief 5.6): the most runs on the server one turn reaches, against the set that asks the most. */
function sequenceEntries(q: TurnQuestion, a: TurnAnswer): number {
  const target = setTarget(q, a.set);
  const { price } = q.sets[a.set];
  // One run gets in (the set that asks the most does not hold); each further run is walked with the nodes shared
  let k = q.maxClicks > 0 ? 1 : 0;
  while (k < q.maxClicks && turnNeed(q, Array(k + 1).fill(target), a.memo) + (k + 1) * price <= q.budget) k++;
  return k;
}

/** 'runnerTurn' by the walk: the cheapest affordable rez set that keeps the Runner out, or the one that asks the most. */
function walkRunnerTurn(state: GameState, server: string, corpCredits: number): Hold {
  const q = turnQuestion(state, server, corpCredits);
  holdCacheStats.asked++;
  const anchor = pricing().anchor;
  let cache = anchor ? turnAnswers.get(anchor) : undefined;
  if (anchor && !cache) turnAnswers.set(anchor, (cache = new Map()));
  const key = cache ? questionKey(q) : '';
  let a = cache?.get(key);
  if (!a) {
    a = solveTurn(q);
    cache?.set(key, a);
  }
  const { budget } = q;
  const { need } = a;
  const ids = (k: number) => q.ice.slice(0, 10).filter((_, i) => q.sets[k].mask & (1 << i)).map(c => c.id);
  if (a.holds) return { holds: true, rez: ids(a.set), rezCost: q.sets[a.set].rez, need, budget, margin: need - budget, entries: 0 };
  // Worked out when read: two readers of the count's many (the ice move, iceCount) read `entries`, and the further runs
  // are most of a count's work (rez money asks every staked server of every board the planner looks at)
  const answer = a;
  return {
    holds: false,
    rez: null,
    rezCost: Infinity,
    need,
    budget,
    margin: need - budget,
    get entries() {
      if (answer.entries === undefined) {
        answer.entries = sequenceEntries(q, answer);
        answer.memo = undefined;
      }
      return answer.entries;
    },
  };
}

/**
 * The run sequence (brief 5.6): whether one Runner turn reaches the breach of each server in `servers` in that order,
 * the Corp rezzing the ice of `rezSets[i]` on run i as it is approached and nothing else: one split of the turn's clicks,
 * the fund filled at each run, the credits hosted on cards and the counters shared, the board carried from run to run
 * (an ice rezzed on one run is met rezzed on the next). `need` is in runnerBudget's units, as serverHold's. Each run's
 * bypasses are priced again (a known gap: a counter one bypass spends is not taken from the next).
 */
export function turnReach(state: GameState, servers: string[], rezSets: string[][], corpCredits = state.corp.credits): { reaches: boolean; need: number; budget: number } {
  return counted(() => {
    const budget = runnerBudget(state);
    if (!servers.length) return { reaches: true, need: 0, budget };
    const start = walkStart(state, true);
    const bases = new Map<string, WalkIce[]>();
    const baseOf = (id: string) => bases.get(id) ?? bases.set(id, turnIce(state, start, id)).get(id)!;
    const runs = servers.map((id, i) => runTarget(state, baseOf(id), id, new Set(rezSets[i] ?? [])));
    const corp = corpStart(state, [...bases.values()].flat(), corpCredits);
    const targets = runs.map(r => r.target);
    const need = turnNeed(turnInput(state, start, targets, corp), targets.map(searchTarget)) + runs.reduce((n, r) => n + r.price, 0);
    return { reaches: need <= budget, need, budget };
  });
}

/**
 * The run sequence over a list of servers, gathered once (the 14:39Z ruling on keepFor's time): the walk's start, each
 * server's ice as met with nothing more rezzed and its bypasses' price, the earnings, the first state, and the board for
 * all of them (break plans and subtypes are keyed by ice, so a server outside an order is never read), with each ice as a
 * lender both ways (a borrow lends from the walked ice as met and the rest as the board has it, so the lenders depend on
 * which servers an order runs). `reachOrder` answers turnReach(state, order, no rezzes) from it and nothing else.
 */
export interface ReachQuestion extends TurnInput {
  budget: number;
  targets: Record<string, SearchTarget>;
  prices: Record<string, number>;
  /** Whether a server's ice borrows (walkBoard's rule: then the lenders are gathered). */
  borrows: Record<string, boolean>;
  views: { id: string; server: string | null; walked?: Lender; unwalked?: Lender }[];
}

/** The question for `servers` (the Corp's credits as they are; corpStart with a finite budget is that budget). */
export function reachQuestion(state: GameState, servers: string[]): ReachQuestion {
  return counted(() => {
    const start = walkStart(state, true);
    const runs = servers.map(id => runTarget(state, turnIce(state, start, id), id, new Set()));
    const targets = runs.map(r => r.target);
    const input = turnInput(state, start, targets, state.corp.credits);
    const walked = new Map(targets.flatMap(t => t.ice.map(x => [x.id, x] as const)));
    const serverOf = new Map(targets.flatMap(t => t.ice.map(x => [x.id, t.server] as const)));
    const borrows = Object.fromEntries(targets.map(t => [t.server, t.ice.some(i => i.subs.some(f => f.does.some(e => e.kind === 'borrow')))]));
    // The lenders are read only by a borrow (setInput, walkBoard's rule)
    const views = Object.values(borrows).some(Boolean) ? lenderViews(state, walked) : [];
    // Nothing is rezzed on these runs (6.4.3: only a rez set's ice is rezzed as approached), so the Corp's credits are
    // read only by a subroutine's "more credits than the Runner", and HQ's size only by "more cards in HQ than in the
    // grip" and "trash 1 card from HQ to end the run": where no subroutine of these servers or of a lender says so, they
    // are left out of the question (0), so that boards differing in them alone ask the same
    const facts = [...targets.flatMap(t => t.ice.flatMap(i => (i.rezGains ? [...i.subs, i.rezGains] : i.subs))), ...views.flatMap(v => [...(v.walked?.facts ?? []), ...(v.unwalked?.facts ?? [])])];
    const ifs = facts.flatMap(f => f.does.map(e => (e.kind === 'endRun' ? e.if?.kind : e.kind)));
    const corpRead = ifs.includes('corpCreditsMoreThanRunner');
    const hqRead = ifs.includes('hqMoreThanGrip') || ifs.includes('corpMayTrashHqToEndRun');
    return {
      ...input,
      first: corpRead ? input.first : { ...input.first, corp: 0 },
      board: { ...input.board, lenders: [], hq: hqRead ? input.board.hq : 0 },
      budget: runnerBudget(state),
      targets: Object.fromEntries(targets.map(t => [t.server, searchTarget(t)])),
      prices: Object.fromEntries(runs.map(r => [r.target.server, r.price])),
      borrows,
      views: views.map(v => ({ ...v, server: serverOf.get(v.id) ?? null })),
    };
  });
}

/** The board of the orders of a set of servers: the lenders a borrow reads when those servers are walked. */
function setInput(q: ReachQuestion, set: string[]): TurnInput {
  const on = new Set(set);
  const lenders = set.some(id => q.borrows[id]) ? q.views.flatMap(v => (v.server !== null && on.has(v.server) ? [v.walked!] : v.unwalked ? [v.unwalked] : [])) : [];
  return { ...q, board: { ...q.board, lenders } };
}

/** Whether one Runner turn gets through `order`'s servers in that order, the walk made (its memo given or its own). */
const reaches = (q: ReachQuestion, order: string[], input: TurnInput, memo?: Map<string, number>): boolean =>
  walkNeed(input, new Walk(input.board, order.map(id => q.targets[id]), memo), order.length) + order.reduce((n, id) => n + q.prices[id], 0) <= q.budget;

/** turnReach(state, order, no rezzes) from the gathered question, its own memo (pure: it reads `q` alone). */
export function reachOrder(q: ReachQuestion, order: string[]): boolean {
  return !order.length || reaches(q, order, setInput(q, order));
}

/** Every order of `ids`. */
export const orders = (ids: string[]): string[][] => (ids.length <= 1 ? [ids] : ids.flatMap((id, i) => orders([...ids.slice(0, i), ...ids.slice(i + 1)]).map(rest => [id, ...rest])));

/**
 * The answers per decision (as turnAnswers: on the decision's anchor, never across decisions). An order's answer reads
 * the question's common part (the board but its break plans and lenders, the earnings, the clicks, the first state, the
 * budget, the lenders as the board has them) and the part of each server it runs (its ice as met, the price of its
 * bypasses, whether it borrows, its ice as walked lenders, its ice's plans and subtypes): each part is interned, and an
 * answer is keyed by the common part and the parts it runs, so the questions a decision asks (the staked servers of
 * each board it looks at, with or without a line's agenda) share what they have in common. A set's answer (some order
 * reaches it) is keyed by the common part and its parts. The walks' memos are shared by the orders of one question and
 * set (their node keys name servers, which a question fixes; the set fixes what a node reads besides its key).
 */
interface ReachCache {
  ids: Map<string, number>;
  orders: Map<string, boolean>;
  sets: Map<string, boolean>;
  memos: Map<string, Map<string, number>>;
}
const reachAnswers = new WeakMap<object, ReachCache>();

/** Whether some order of a set of the question's servers is reached (reachOrder), cached per decision (above). */
export function reachSets(q: ReachQuestion): (set: string[]) => boolean {
  const anchor = pricing().anchor;
  let c = anchor ? reachAnswers.get(anchor) : undefined;
  if (!c) {
    c = { ids: new Map(), orders: new Map(), sets: new Map(), memos: new Map() };
    if (anchor) reachAnswers.set(anchor, c);
  }
  const cache = c;
  const intern = (x: unknown) => {
    const k = questionKey(x);
    let id = cache.ids.get(k);
    if (id === undefined) cache.ids.set(k, (id = cache.ids.size));
    return id;
  };
  const common = intern({
    board: { ...q.board, plans: {}, types: {}, lenders: [] },
    earn: q.earn,
    maxClicks: q.maxClicks,
    first: q.first,
    budget: q.budget,
    unwalked: q.views.map(v => v.unwalked ?? null),
  });
  const part: Record<string, number> = {};
  for (const [id, t] of Object.entries(q.targets)) {
    const own = (k: string) => t.ice.some(i => k.startsWith(`${i.id}|`));
    part[id] = intern({
      target: t,
      price: q.prices[id],
      borrows: q.borrows[id],
      walked: q.views.filter(v => v.server === id).map(v => v.walked),
      plans: Object.entries(q.board.plans).filter(([k]) => own(k)),
      types: Object.entries(q.board.types).filter(([k]) => own(k)),
    });
  }
  const servers = `${common}|${Object.keys(q.targets).map(id => `${id}=${part[id]}`)}`;
  return set => {
    if (!set.length) return true;
    const sk = `${common}|${set.map(id => part[id]).sort((a, b) => a - b)}`;
    let a = cache.sets.get(sk);
    if (a !== undefined) return a;
    // One board and one memo for the set's orders: the lenders and the walk's options read the set, not its order
    const input = setInput(q, set);
    const mk = `${servers}|${[...set].sort()}`;
    let memo = cache.memos.get(mk);
    if (!memo) cache.memos.set(mk, (memo = new Map()));
    a = orders(set).some(order => {
      const k = `${common}|${order.map(id => part[id])}`;
      let r = cache.orders.get(k);
      if (r === undefined) cache.orders.set(k, (r = reaches(q, order, input, memo)));
      return r;
    });
    cache.sets.set(sk, a);
    return a;
  };
}

/** 'thisRun' by the walk: from the approached ice at `from`, the Runner's credits and clicks as they are. */
function walkThisRun(state: GameState, server: string, opts: HoldOptions): Hold {
  const run = state.activeRun;
  const sv = state.corp.servers[server];
  const budget = state.runner.credits;
  const none: Hold = { holds: false, rez: null, rezCost: Infinity, need: 0, budget, margin: -budget, entries: 1 };
  const pos = opts.from ?? run?.icePosition ?? null;
  if (!run || !sv || pos === null) return none;
  const credits = opts.corpCredits ?? state.corp.credits;
  const must = sv.ice.filter(c => opts.mustRez?.includes(c.instanceId));
  const base = must.reduce((n, c) => n + rezCost(state, c), 0);
  // As before (Stage B2): the approached ice may be rezzable for less than its printed cost (Biawak's forfeit)
  const paidAnotherWay = base > credits && must.length > 0 && must.every(c => c.instanceId === sv.ice[run.icePosition ?? -1]?.instanceId && isLegalAction(state, { type: 'REZ_CARD', player: 'corp', cardInstanceId: c.instanceId }));
  if (base > credits && !paidAnotherWay) return none;
  const spare = paidAnotherWay ? 0 : credits - base;
  const open = (opts.further ?? true) ? sv.ice.slice(0, pos).filter(c => !c.isRezzed).slice(0, 10) : [];
  const start = walkStart(state, false);
  const ice0 = walkIce(state, start, sv.ice);
  const board = walkBoard(state, start, [{ server, ice: ice0 }]);
  let best = Infinity;
  let bestSet: string[] | null = null;
  let bestNeed = 0;
  let mostNeed = -Infinity;
  for (let mask = 0; mask < 1 << open.length; mask++) {
    const extra = open.filter((_, i) => mask & (1 << i));
    const cost = base + extra.reduce((n, c) => n + rezCost(state, c), 0);
    if (cost - base > spare || cost >= best) continue;
    const up = new Set([...must.map(c => c.instanceId), ...extra.map(c => c.instanceId)]);
    const view = withServerIce(state, sv.id, sv.ice.map(c => (up.has(c.instanceId) ? { ...c, isRezzed: true } : c)));
    const skipped = bypassesAhead(view, view.corp.servers[sv.id].ice.slice(0, pos + 1), true);
    const ice = ice0.map(c => ({ ...searchIce(c), inS: up.has(c.id), bypassed: skipped.has(c.id) }));
    // The Corp pays each rez as its ice is approached (6.4.3): it starts with the approached ice's cost still in hand
    const corp = spare + base;
    // The run's own credits: the fund and Overclock's, and the cards that pay during it (availableCredits less the pool)
    const fund = run.bonusCredits + (run.badPublicityCredits ?? 0);
    const hosted = Math.max(0, availableCredits(state, 'runner') - state.runner.credits - fund);
    const ws: WalkState = { ...firstState(state, start, state.runner.clicks, corp), fund, hosted, stealth: stealthCredits(state) };
    const need = new Walk(board, [{ server, ice }]).fromIce(ws, pos);
    if (need > mostNeed) mostNeed = need;
    if (need > budget) {
      best = cost;
      bestSet = [...up];
      bestNeed = need;
    }
  }
  if (bestSet) return { holds: true, rez: bestSet, rezCost: best, need: bestNeed, budget, margin: bestNeed - budget, entries: 0 };
  const need = mostNeed === -Infinity ? 0 : mostNeed;
  return { ...none, need, margin: need - budget };
}
