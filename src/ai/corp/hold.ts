import { CardInstance, GameState, cardDef, getCardScript, isLegalAction, rezCostOf, availableCredits } from '../../core';
import { rezCost, stealthCredits, threatLevel } from '../../core/engine/cardEffects';
import { canBreakSubroutinesWith, iceScript, iceSubroutines, iceSubtypes, isBioroid } from '../../core/engine/ice';
import { AUDREY, BOTULUS, SubEffect, SubFacts, bioroidBreakClicks, breakPlans, bypassesAhead, iceCreditNeed, plannedSubroutines, runBypasses, runStealthCredits, subroutineFacts } from '../runs';
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
  if (plan().holdWalk) return opts.when === 'thisRun' ? walkThisRun(state, server, opts) : counted(() => walkRunnerTurn(state, server, opts.corpCredits ?? state.corp.credits));
  return opts.when === 'thisRun' ? holdThisRun(state, server, opts) : holdRunnerTurn(state, server, opts.corpCredits ?? state.corp.credits);
}

/** Counted with countingHold up: the rez budget its prices reach does not ask this count again (deal 2138's hang). */
const counted = <T>(f: () => T): T => (pricing().countingHold ? f() : withPricing({ countingHold: true }, f));

/**
 * The Runner's next turn (holdCost's count): with a set S of the server's ice rezzed, the Runner needs the sum of
 * iceCreditNeed (runs.ts: the credits to break the ice's run-ending subroutines with its installed breakers; BLOCK when
 * none can) over S, plus what its bypasses cost, against runnerBudget. Each set once: a rezzed ice's bit stays clear.
 * Counted with countingHold up: the rez budget its prices reach does not ask this count again (deal 2138's hang).
 */
function holdRunnerTurn(state: GameState, server: string, corpCredits: number): Hold {
  if (pricing().countingHold) return countRunnerTurn(state, server, corpCredits);
  return withPricing({ countingHold: true }, () => countRunnerTurn(state, server, corpCredits));
}

function countRunnerTurn(state: GameState, server: string, corpCredits: number): Hold {
  const ice = state.corp.servers[server]?.ice ?? [];
  const budget = runnerBudget(state);
  // The Runner's turn: its clicks back (a bioroid broken by clicks, runs.ts plainCreditNeed), one kept for the run
  const view: GameState = { ...state, runner: { ...state.runner, clicks: Math.max(0, state.runner.maxClicks - 1) } };
  const n = Math.min(ice.length, 10);
  // holdCost's bypass reader ran only for a server with ice (it found the server by its first ice)
  const serverId = ice.length ? server : undefined;
  let best: number | null = null;
  let bestMask = 0;
  let bestNeed = 0;
  let mostNeed = -Infinity;
  // Each ice's rez cost and need are the same in every set (the board with only that ice rezzed): worked out once
  const rezOf: number[] = [];
  const needOf: number[] = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    // A set with a rezzed ice's bit, or one the Corp can't pay for, is never the answer and never the most asked: its
    // bits cleared give the same board, a need at least as large and a rez it can pay, and come first. Skipped before
    // its bypasses are priced (each set once)
    let rez = 0;
    for (let i = 0; i < n && rez <= corpCredits; i++) {
      if (!(mask & (1 << i))) continue;
      rez = ice[i].isRezzed ? Infinity : rez + (rezOf[i] ??= rezCostOf(view, ice[i]));
    }
    if (rez > corpCredits || rez === Infinity) continue;
    let need = 0;
    // The ice the Runner's installed bypasses pass with this set rezzed (runs.ts runBypasses: rig cards, their counters
    // and the threat level, all public; 6.5.8a: a bypassed ice's subroutines never resolve), and what those bypasses
    // cost it in credits' worth (spec jeff-games-48-50 Part A, folded 2026-11-13: g3 +0.3 ± 0.2, run 43382962736)
    const bypassed = serverId ? runBypasses(rezzedSet(view, serverId, ice, mask, n), serverId) : undefined;
    if (bypassed) need += bypassed.price;
    for (let i = 0; i < n; i++) {
      const c = ice[i];
      if (!c.isRezzed && !(mask & (1 << i))) continue;
      if (bypassed?.ids.has(c.instanceId)) continue;
      need += (needOf[i] ??= iceNeed(view, c));
    }
    if (need > mostNeed) mostNeed = need;
    if (need > budget && (best === null || rez < best)) {
      best = rez;
      bestMask = mask;
      bestNeed = need;
    }
  }
  if (best !== null) {
    const rezIds = ice.slice(0, n).filter((c, i) => !c.isRezzed && bestMask & (1 << i)).map(c => c.instanceId);
    return { holds: true, rez: rezIds, rezCost: best, need: bestNeed, budget, margin: bestNeed - budget, entries: 0 };
  }
  const need = mostNeed === -Infinity ? 0 : mostNeed;
  return { holds: false, rez: null, rezCost: Infinity, need, budget, margin: need - budget, entries: turnEntries(state, need, budget) };
}

/** How many runs of `need` credits the Runner's turn pays for: each run takes a click, and a click used to run earns no credit. */
function turnEntries(state: GameState, need: number, budget: number): number {
  const clicks = Math.max(0, state.runner.maxClicks);
  let k = 0;
  while (k < clicks && (k + 1) * need <= budget - k) k++;
  return k;
}

/**
 * The run under way (stopCost's count): the approached ice at `from` rezzed when mustRez names it, and the cheapest
 * affordable set of the unrezzed ice further in (only with `further`); the Runner's credits now against the need of
 * the rezzed ice it will meet, bypassed ice left out (bypassesAhead, the approached ice included; 6.5.8a).
 */
function holdThisRun(state: GameState, server: string, opts: HoldOptions): Hold {
  const run = state.activeRun;
  const sv = state.corp.servers[server];
  const budget = state.runner.credits;
  const none: Hold = { holds: false, rez: null, rezCost: Infinity, need: 0, budget, margin: -budget, entries: 1 };
  const pos = opts.from ?? run?.icePosition ?? null;
  if (!run || !sv || pos === null) return none;
  const credits = opts.corpCredits ?? state.corp.credits;
  const must = sv.ice.filter(c => opts.mustRez?.includes(c.instanceId));
  const base = must.reduce((n, c) => n + rezCost(state, c), 0);
  // Stage B2 owner fix (stage-b/logs, the rez-window kind "rez paid another way"): the approached ice may be rezzable
  // for less than its printed cost from the credit pool (Biawak forfeits an agenda for 10 of its 14 credits;
  // recurring credits; a rez discount). The engine's legality says so: then it is affordable, and it leaves
  // the Corp at most its pool less that cost for the ice further in.
  const paidAnotherWay = base > credits && must.length > 0 && !!run && must.every(c => c.instanceId === sv.ice[run.icePosition ?? -1]?.instanceId && isLegalAction(state, { type: 'REZ_CARD', player: 'corp', cardInstanceId: c.instanceId }));
  if (base > credits && !paidAnotherWay) return none;
  const spare = paidAnotherWay ? 0 : credits - base;
  const open = (opts.further ?? true) ? sv.ice.slice(0, pos).filter(c => !c.isRezzed).slice(0, 10) : [];
  let best = Infinity;
  let bestSet: string[] | null = null;
  let bestNeed = 0;
  let mostNeed = -Infinity;
  for (let mask = 0; mask < 1 << open.length; mask++) {
    const extra = open.filter((_, i) => mask & (1 << i));
    const cost = base + extra.reduce((n, c) => n + rezCost(state, c), 0);
    if (cost - base > spare || cost >= best) continue;
    const up = new Set([...must.map(c => c.instanceId), ...extra.map(c => c.instanceId)]);
    const board = withServerIce(state, sv.id, sv.ice.map(c => (up.has(c.instanceId) ? { ...c, isRezzed: true } : c)));
    const reach = board.corp.servers[sv.id].ice.slice(0, pos + 1);
    const skipped = bypassesAhead(board, reach, true);
    const met = reach.filter(c => c.isRezzed && !skipped.has(c.instanceId));
    const need = met.reduce((n, c) => n + iceCreditNeed(board, c), 0);
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

/** iceCreditNeed of this ice rezzed, on the board with only it changed. */
function iceNeed(view: GameState, c: CardInstance): number {
  const up = c.isRezzed ? c : { ...c, isRezzed: true };
  return iceCreditNeed(withIce(view, up), up);
}

/** The board with the ice of this rez set rezzed on its server (the mask over the first n ice). */
function rezzedSet(state: GameState, serverId: string, ice: CardInstance[], mask: number, n: number): GameState {
  const on = new Set(ice.slice(0, n).filter((c, i) => !c.isRezzed && mask & (1 << i)).map(c => c.instanceId));
  const server = state.corp.servers[serverId];
  return { ...state, corp: { ...state.corp, servers: { ...state.corp.servers, [serverId]: { ...server, ice: server.ice.map(c => (on.has(c.instanceId) ? { ...c, isRezzed: true } : c)) } } } };
}

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
interface WalkIce {
  /** The ice, rezzed: the subroutines and subtypes it is met with. */
  card: CardInstance;
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
  /** A bioroid: the Runner may break its subroutines with clicks (bioroidBreakClicks). */
  bioroid: boolean;
  /** Botulus may break its subroutines (not Semak-samun's fracters-only). */
  anyBreaker: boolean;
  rezFacts?: HoldFacts['rezDuringRun'];
  /** What the Runner meets as the encounter begins (6.9.3a: Funhouse, Seraph, Jaguarundi; Paywall). */
  encounterFacts?: HoldFacts['encounter'];
  /** Rig indexes of the hosted cards that give it subtypes (Chromatophores): a Corp trash of one changes them. */
  granters: number[];
  /** 'thisRun': the encounter with it is under way; the subroutines already broken. */
  broken?: boolean[];
}

/** One run of the walk's turn: its server and its ice, innermost first (as the server lists them). */
interface WalkTarget {
  server: string;
  ice: WalkIce[];
}

/** The state the walk carries (brief 5.1), but the Runner's pool: the walk works out the least pool a way needs. */
interface WalkState {
  clicks: number;
  tags: number;
  grip: number;
  stack: number;
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
interface WalkPlan {
  breaker: number;
  credits: number;
  stealth: number;
  counter?: { idx: number; kind: 'virus' | 'power'; n: number };
  grip: number;
  mayfly: boolean;
  spike: boolean;
}

/** A subroutine whose resolution ends the run whatever the state ("End the run.", "X or end the run": ruling 6). */
const alwaysEnds = (f: SubFacts) => !f.when && !f.unless && (f.orEndRun || f.does.some(e => e.kind === 'endRun' && !e.if));

/** The board the walk starts from: the rig, its counters, and the ice derezzed by then (brief 5.2). */
interface WalkStart {
  rig: CardInstance[];
  index: Map<string, number>;
  virus: number[];
  power: number[];
  derezzed: Set<string>;
}

function walkStart(state: GameState, runnerTurn: boolean): WalkStart {
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
function walkIce(state: GameState, start: WalkStart, ice: CardInstance[]): WalkIce[] {
  const encounter = state.activeRun?.encounter;
  return ice.map(c => {
    const up = c.isRezzed ? c : { ...c, isRezzed: true };
    const view = withIce(state, up);
    const hostedHere = (f: (x: CardInstance) => boolean) => start.rig.flatMap((r, i) => (r.hostedOnId === c.instanceId && f(r) ? [i] : []));
    const bypassers = hostedHere(r => !!CARDS[r.cardCode]?.holdFacts?.hostBypass).map(i => {
      const b = CARDS[start.rig[i].cardCode].holdFacts!.hostBypass!;
      return { idx: i, per: b.creditsPerSubroutine, unless: b.unlessSubtype };
    });
    return {
      card: up,
      rezzed: c.isRezzed && !start.derezzed.has(c.instanceId),
      rezCost: rezCostOf(state, c),
      inS: false,
      bypassed: false,
      subs: plannedSubroutines(view, up).map(sub => subroutineFacts(sub.label)),
      types: iceSubtypes(up, state),
      botulus: hostedHere(r => r.cardCode === BOTULUS),
      bypassers,
      selfCredits: iceScript(c)?.runnerBreakCost,
      bioroid: isBioroid(c),
      anyBreaker: canBreakSubroutinesWith(c, null),
      rezFacts: CARDS[c.cardCode]?.holdFacts?.rezDuringRun,
      encounterFacts: CARDS[c.cardCode]?.holdFacts?.encounter,
      granters: hostedHere(r => !!getCardScript(r.cardCode)?.grantsIceSubtypes?.length),
      broken: encounter?.iceId === c.instanceId ? [...encounter.broken] : undefined,
    };
  });
}

/** Each ice's break plans, by the number of subroutines, worked out once per board (time condition: not once per rez set). */
const planCache = new WeakMap<GameState, Map<string, WalkPlan[]>>();

class Walk {
  private readonly memo = new Map<string, number>();
  private readonly plans: Map<string, WalkPlan[]>;
  /** Commit 2's switch: tags and grip move through the turn (draws, tag removal, tags and damage on the way, Ping, Bumi). */
  private readonly tags: boolean;
  /** A draw can matter (some damage, a grip condition or a grip-spending plan on the way). */
  private readonly drawUseful: boolean;
  /** Removing a tag can matter (some condition or effect reads the Runner's tags). */
  private readonly tagUseful: boolean;
  /** Commit 3's switch: credits move on both sides through the run (losses, the Corp's gains and rezzes, run-only credits). */
  private readonly credits: boolean;

  constructor(
    private readonly state: GameState,
    private readonly start: WalkStart,
    private readonly targets: WalkTarget[],
  ) {
    let plans = planCache.get(state);
    if (!plans) planCache.set(state, (plans = new Map()));
    this.plans = plans;
    this.tags = plan().holdWalkTags;
    this.credits = plan().holdWalkCredits;
    const facts = targets.flatMap(t => t.ice.flatMap(i => i.subs));
    const effects = facts.flatMap(f => f.does);
    const borrows = effects.some(e => e.kind === 'borrow');
    const encounters = targets.flatMap(t => t.ice.flatMap(i => (i.encounterFacts ? [i.encounterFacts] : [])));
    this.drawUseful = this.tags && (borrows || effects.some(e => e.kind === 'damage' || (e.kind === 'endRun' && e.if?.kind === 'hqMoreThanGrip')) || facts.some(f => f.unless?.netDamage) || encounters.some(e => e.unless?.netDamage) || start.rig.some(c => c.cardCode === AUDREY));
    this.tagUseful = this.tags && (borrows || facts.some(f => f.when?.kind === 'runnerTagsAtLeast') || effects.some(e => (e.kind === 'endRun' && e.if?.kind === 'runnerTagsAtLeast') || ((e.kind === 'damage' || e.kind === 'tags') && e.n === 'runnerTags') || (e.kind === 'corpGainsCredits' && e.n === 'perRunnerTag')));
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
    const key = `b${j}|${ws.clicks}|${ws.tags}|${ws.grip}|${ws.stack}|${ws.corp}|${ws.hosted}|${ws.stealth}|${ws.virus}|${ws.power}|${ws.gone}|${ws.up}`;
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;
    // 6.9.1b, 10.6.3a: the bad publicity fund is filled as each run begins
    const fund = this.credits ? this.state.corp.badPublicity : 0;
    let best = this.approach({ ...ws, clicks: ws.clicks - 1, spike: false, fund }, j, this.targets[j].ice.length - 1);
    if (ws.clicks > runs) {
      if (this.drawUseful && ws.stack > 0) best = Math.min(best, this.beforeRun({ ...ws, clicks: ws.clicks - 1, grip: ws.grip + 1, stack: ws.stack - 1 }, j));
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
    const key = `${j}|${pos}|${ws.clicks}|${ws.tags}|${ws.grip}|${ws.stack}|${ws.corp}|${ws.fund}|${ws.hosted}|${ws.stealth}|${ws.virus}|${ws.power}|${ws.gone}|${ws.up}|${ws.spike ? 1 : 0}|${ws.mayfly}`;
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;
    const ice = this.targets[j].ice[pos];
    const next = (w: WalkState) => this.approach(w, j, pos - 1);
    let v: number;
    if (!ice.rezzed && !ws.up.includes(ice.card.instanceId)) {
      // 6.9.2c: unrezzed ice the Corp does not rez is passed; 6.4.3: ice of S is rezzed as it is approached
      const paid = this.credits ? ws.corp - ice.rezCost : ws.corp;
      v = ice.inS && paid >= 0 ? this.rezzed({ ...ws, corp: paid, up: [...ws.up, ice.card.instanceId].sort() }, ice, next) : next(ws);
    } else v = ice.bypassed ? next(ws) : this.encounter(ws, ice, next);
    this.memo.set(key, v);
    return v;
  }

  /** The ice was rezzed during this run against its server: its rez-time facts (Flyswatter: purge virus counters). */
  private rezzed(ws: WalkState, ice: WalkIce, next: (w: WalkState) => number): number {
    let w = ws;
    if (ice.rezFacts?.purgeVirus) {
      // Purging removes every virus counter (10.3.5); Physarum Entangler is trashed by it (its text)
      const purged = this.start.rig.flatMap((c, i) => (CARDS[c.cardCode]?.holdFacts?.trashedOnPurge ? [i] : []));
      w = { ...w, virus: w.virus.map(() => 0), gone: [...new Set([...w.gone, ...purged])].sort((a, b) => a - b) };
    }
    if (this.tags && ice.rezFacts?.tags) w = { ...w, tags: w.tags + ice.rezFacts.tags };
    const go = (x: WalkState) => (ice.bypassed ? next(x) : this.encounter(x, ice, next));
    if (this.tags && ice.rezFacts?.corpMayTrashInstalled === 'trojan') {
      // Bumi 1.0: the Corp may trash 1 installed trojan, the choice worst for the Runner (ruling 6)
      let worst = go(w);
      this.start.rig.forEach((c, i) => {
        if (!w.gone.includes(i) && /\btrojan\b/i.test(cardDef(c).keywords ?? '')) worst = Math.max(worst, go({ ...w, gone: [...w.gone, i].sort((a, b) => a - b) }));
      });
      return worst;
    }
    return go(w);
  }

  /**
   * An encounter: the Runner's own bypass first (Physarum, its trigger as the active player's), then what the ice does as
   * the encounter begins (6.9.3a), then its choice of the subroutines to break and how; the rest resolve in order.
   */
  private encounter(ws: WalkState, ice: WalkIce, next: (w: WalkState) => number): number {
    const subs = ice.subs;
    const types = this.typesOf(ice, ws);
    let best = FAIL;
    if (plan().bypass) {
      for (const b of ice.bypassers) if (!ws.gone.includes(b.idx) && !types.includes(b.unless)) best = Math.min(best, this.pay(ws, b.per * subs.length, next));
    }
    return Math.min(best, this.tolls(ws, ice, w => this.breaks(w, ice, types, next)));
  }

  /** The ice's subtypes now: a Corp trash of a hosted card that gives subtypes (Chromatophores) takes them away. */
  private typesOf(ice: WalkIce, ws: WalkState): string[] {
    if (!ice.granters.some(i => ws.gone.includes(i))) return ice.types;
    return iceSubtypes(ice.card, this.without(ice, ws));
  }

  /** The board with the hosted subtype-giving cards the walk has trashed taken off (for the ice's subtypes and plans). */
  private without(ice: WalkIce, ws: WalkState): GameState {
    const off = new Set(ice.granters.filter(i => ws.gone.includes(i)).map(i => this.start.rig[i].instanceId));
    if (!off.size) return this.state;
    return { ...this.state, runner: { ...this.state.runner, rig: { ...this.state.runner.rig, programs: this.state.runner.rig.programs.filter(c => !off.has(c.instanceId)) } } };
  }

  /**
   * What the ice does as the encounter begins (6.9.3a): a toll unless the Runner pays one of the alternatives, its
   * choice (Funhouse: end the run unless it takes 1 tag; Seraph: lose 3 unless it suffers 2 net damage or takes 1 tag;
   * Jaguarundi at threat 4: a tag unless it spends a click).
   */
  private tolls(ws: WalkState, ice: WalkIce, then: (w: WalkState) => number): number {
    const e = ice.encounterFacts;
    if (!e || ice.broken || (e.threatAtLeast !== undefined && threatLevel(this.state) < e.threatAtLeast)) return then(ws);
    if (!this.tags || !e.toll) return then(ws);
    const t = e.toll;
    let best = t.endRun ? FAIL : t.loses && this.credits ? lose(then(ws), t.loses) : then({ ...ws, tags: ws.tags + (t.tags ?? 0) });
    const u = e.unless ?? {};
    if (u.tags) best = Math.min(best, then({ ...ws, tags: ws.tags + u.tags }));
    if (u.netDamage !== undefined && u.netDamage <= ws.grip) best = Math.min(best, then({ ...ws, grip: ws.grip - u.netDamage }));
    if (u.clicks !== undefined && u.clicks <= ws.clicks) best = Math.min(best, then({ ...ws, clicks: ws.clicks - u.clicks }));
    return best;
  }

  /** The Runner's choice of the subroutines to break and how (a plan, Botulus's counters, the ice's own ability). */
  private breaks(ws: WalkState, ice: WalkIce, types: string[], next: (w: WalkState) => number): number {
    const subs = ice.subs;
    let best = FAIL;
    const open = subs.map((_, i) => i).filter(i => !ice.broken?.[i]);
    for (let set = 0; set < 1 << open.length; set++) {
      const unbroken = open.filter((_, k) => !(set & (1 << k)));
      if (unbroken.some(i => alwaysEnds(subs[i]))) continue;
      const b = open.length - unbroken.length;
      const resolve = (w: WalkState) => this.resolve(w, ice, types, unbroken, 0, next);
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
          const clicks = ice.bioroid && y > 0 ? bioroidBreakClicks(ice.card, y) : 0;
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

  private planList(ice: WalkIce, z: number, ws: WalkState): WalkPlan[] {
    const off = ice.granters.filter(i => ws.gone.includes(i));
    const key = `${ice.card.instanceId}|${z}|${off}`;
    let list = this.plans.get(key);
    if (!list) {
      const index = this.start.index;
      list = breakPlans(withIce(this.without(ice, ws), ice.card), ice.card, z).flatMap(({ plan: p, spends }) => {
        const breaker = index.get(p.breaker.instanceId);
        if (breaker === undefined) return [];
        const c = spends.counters;
        const idx = c ? index.get(c.cardId) : undefined;
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
      this.plans.set(key, list);
    }
    return list;
  }

  private usable(ws: WalkState, p: WalkPlan): boolean {
    if (ws.gone.includes(p.breaker) || (p.spike && ws.spike) || p.stealth > ws.stealth || p.grip > ws.grip) return false;
    return !p.counter || (p.counter.kind === 'virus' ? ws.virus : ws.power)[p.counter.idx] >= p.counter.n;
  }

  private payPlan(ws: WalkState, p: WalkPlan, then: (w: WalkState) => number): number {
    const w: WalkState = { ...ws, stealth: ws.stealth - p.stealth, spike: ws.spike || p.spike, grip: this.tags ? ws.grip - p.grip : ws.grip };
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
  private resolve(ws: WalkState, ice: WalkIce, types: string[], list: number[], k: number, next: (w: WalkState) => number): number {
    if (k >= list.length) return next(ws);
    return this.subroutine(ws, ice.card, types, ice.subs[list[k]], w => this.resolve(w, ice, types, list, k + 1, next));
  }

  /** One subroutine resolves (or the Runner pays its nested cost instead, 1.16.11b). */
  private subroutine(ws: WalkState, card: CardInstance, types: string[], f: SubFacts, then: (w: WalkState) => number): number {
    if (f.when && !(f.when.kind === 'iceIs' ? types.includes(f.when.subtype) : f.when.kind === 'runnerTagsAtLeast' && ws.tags >= f.when.n)) return then(ws);
    // "X or end the run": the Corp chooses, and the walk takes the end (ruling 6)
    if (f.orEndRun) return FAIL;
    let best = this.effects(ws, card, f.does, 0, then);
    // "unless the Runner pays N": as on beta, paid for nothing when the Runner holds N now
    if (f.unless?.credits !== undefined && this.state.runner.credits >= f.unless.credits) best = Math.min(best, then(ws));
    if (f.unless?.netDamage !== undefined && f.unless.netDamage <= ws.grip) best = Math.min(best, then(this.tags ? { ...ws, grip: ws.grip - f.unless.netDamage } : ws));
    return best;
  }

  private effects(ws: WalkState, card: CardInstance, does: SubEffect[], i: number, then: (w: WalkState) => number): number {
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
        if (c.kind === 'threatAtLeast') return threatLevel(this.state) >= c.n ? FAIL : next(ws);
        if (c.kind === 'hqMoreThanGrip') return this.state.corp.hq.length > ws.grip ? FAIL : next(ws);
        // Diviner's odd cost: a fact of the grip the walk can't read; left out (the safe side, "does not hold")
        return next(ws);
      }
      case 'runnerLosesClicks':
        return next({ ...ws, clicks: Math.max(0, ws.clicks - e.n) });
      case 'runnerLosesCredits':
        return this.credits ? lose(next(ws), e.n) : next(ws);
      case 'corpGainsCredits':
        return next(this.credits ? { ...ws, corp: ws.corp + (e.n === 'perRunnerTag' ? ws.tags : e.n) } : ws);
      case 'damage': {
        // 10.4.4: more damage than the cards in the grip is a flatline; each point takes a card (10.4.2)
        const n = e.n === 'runnerTags' ? ws.tags : e.n;
        return n > ws.grip ? FAIL : next(this.tags ? { ...ws, grip: ws.grip - n } : ws);
      }
      case 'tags':
        return next(this.tags ? { ...ws, tags: ws.tags + (e.n === 'runnerTags' ? ws.tags : e.n) } : ws);
      case 'cannotStealOrTrash':
        return FAIL;
      case 'corpMayTrashHqToEndRun':
        return this.state.corp.hq.length > 0 ? FAIL : next(ws);
      case 'borrow':
        return this.borrow(ws, card, e.subtype, next);
      default:
        // What the walk doesn't carry: trashing or bouncing a Runner card (registry debt: errs toward "does not hold"),
        // the Corp's own side, a jack out the Runner may take
        return next(ws);
    }
  }

  /** Mycoweb: the Corp resolves 1 subroutine of another rezzed ice of the subtype, the one worst for the Runner (ruling 6). */
  private borrow(ws: WalkState, card: CardInstance, subtype: string, next: (w: WalkState) => number): number {
    const walked = new Map(this.targets.flatMap(t => t.ice.map(x => [x.card.instanceId, x] as const)));
    let worst = -1;
    for (const sv of Object.values(this.state.corp.servers)) {
      for (const c of sv.ice) {
        if (c.instanceId === card.instanceId) continue;
        const w = walked.get(c.instanceId);
        const isUp = w ? w.rezzed || ws.up.includes(c.instanceId) : c.isRezzed;
        if (!isUp) continue;
        const up = w ? w.card : c;
        const types = w ? w.types : iceSubtypes(c, this.state);
        if (!types.includes(subtype)) continue;
        for (const sub of iceSubroutines(this.state, up)) {
          if (/resolve 1 subroutine on/i.test(sub.label)) continue;
          worst = Math.max(worst, this.subroutine(ws, up, types, subroutineFacts(sub.label), next));
        }
      }
    }
    return worst < 0 ? next(ws) : worst;
  }
}

/** Credits on the rig's cards that pay during runs (Methuselah, Touchstone; cardEffects runPayers). */
function duringRuns(state: GameState): number {
  const rig = [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources];
  return rig.filter(c => getCardScript(c.cardCode)?.paysDuringRuns).reduce((n, c) => n + counters(c, 'credit'), 0);
}

/** The walk's first state on the Runner's turn: `clicks` for the turn, the rest from the board at its start. */
function firstState(state: GameState, start: WalkStart, clicks: number, corp: number): WalkState {
  return {
    clicks,
    tags: state.runner.tags,
    grip: state.runner.grip.length,
    stack: state.runner.stack.length,
    corp,
    fund: 0,
    hosted: plan().holdWalkCredits ? duringRuns(state) : 0,
    stealth: runStealthCredits(state),
    virus: start.virus,
    power: start.power,
    gone: [],
    up: [],
    spike: false,
    mayfly: [],
  };
}

/**
 * The least the Runner must bring for one turn through `targets`, in the budget's units (brief 5.5): over every split of
 * its clicks, the pool the walk needs plus what the clicks it doesn't earn with would have earned (runnerEarnings).
 */
function turnNeed(state: GameState, start: WalkStart, targets: WalkTarget[], corp: number): number {
  const earn = runnerEarnings(state);
  const c = Math.max(0, state.runner.maxClicks);
  const walk = new Walk(state, start, targets);
  let need = FAIL;
  for (let e = 0; e + targets.length <= c; e++) need = Math.min(need, walk.turn(firstState(state, start, c - e, corp)) + earn[c - 1] - earn[e]);
  return need;
}

/** The Corp's credits through the walk: the rez budget asked, or its credits and every rez it could make (as the oracle). */
function corpStart(state: GameState, ice: WalkIce[], corpCredits: number): number {
  return Number.isFinite(corpCredits) ? corpCredits : state.corp.credits + ice.filter(c => !c.rezzed).reduce((n, c) => n + c.rezCost, 0);
}

/** The board runBypasses reads for a rez set: the ice rezzed at the walk's start and the set's (as rezzedSet before). */
function bypassBoard(state: GameState, serverId: string, ice: WalkIce[], set: Set<string>): GameState {
  const server = state.corp.servers[serverId];
  return withServerIce(state, serverId, server.ice.map((c, i) => ({ ...c, isRezzed: ice[i].rezzed || set.has(c.instanceId) })));
}

/** 'runnerTurn' by the walk: the cheapest affordable rez set that keeps the Runner out, or the one that asks the most. */
function walkRunnerTurn(state: GameState, server: string, corpCredits: number): Hold {
  const all = state.corp.servers[server]?.ice ?? [];
  const budget = runnerBudget(state);
  const start = walkStart(state, true);
  const base = walkIce(state, start, all);
  const n = Math.min(all.length, 10);
  // The view runBypasses read before (the Runner's clicks but the run's)
  const view: GameState = { ...state, runner: { ...state.runner, clicks: Math.max(0, state.runner.maxClicks - 1) } };
  const corp = corpStart(state, base, corpCredits);
  const sets: { mask: number; rez: number }[] = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    let rez = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) rez = base[i].rezzed ? Infinity : rez + base[i].rezCost;
    if (rez <= corpCredits) sets.push({ mask, rez });
  }
  // Cheapest first, ties in mask order (as before): the first that holds is the answer
  sets.sort((a, b) => a.rez - b.rez || a.mask - b.mask);
  let most = -Infinity;
  for (const { mask, rez } of sets) {
    const set = new Set(all.slice(0, n).filter((_, i) => mask & (1 << i)).map(c => c.instanceId));
    const bypassed = all.length ? runBypasses(bypassBoard(view, server, base, set), server) : undefined;
    const ice = base.map(c => ({ ...c, inS: set.has(c.card.instanceId), bypassed: !!bypassed?.ids.has(c.card.instanceId) }));
    const need = turnNeed(state, start, [{ server, ice }], corp) + (bypassed?.price ?? 0);
    if (need > budget) return { holds: true, rez: [...set], rezCost: rez, need, budget, margin: need - budget, entries: 0 };
    most = Math.max(most, need);
  }
  const need = most === -Infinity ? 0 : most;
  return { holds: false, rez: null, rezCost: Infinity, need, budget, margin: need - budget, entries: turnEntries(state, need, budget) };
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
  let best = Infinity;
  let bestSet: string[] | null = null;
  let bestNeed = 0;
  let mostNeed = -Infinity;
  for (let mask = 0; mask < 1 << open.length; mask++) {
    const extra = open.filter((_, i) => mask & (1 << i));
    const cost = base + extra.reduce((n, c) => n + rezCost(state, c), 0);
    if (cost - base > spare || cost >= best) continue;
    const up = new Set([...must.map(c => c.instanceId), ...extra.map(c => c.instanceId)]);
    const board = withServerIce(state, sv.id, sv.ice.map(c => (up.has(c.instanceId) ? { ...c, isRezzed: true } : c)));
    const skipped = bypassesAhead(board, board.corp.servers[sv.id].ice.slice(0, pos + 1), true);
    const ice = ice0.map(c => ({ ...c, inS: up.has(c.card.instanceId), bypassed: skipped.has(c.card.instanceId) }));
    // The Corp pays each rez as its ice is approached (6.4.3): it starts with the approached ice's cost still in hand
    const corp = spare + base;
    // The run's own credits: the fund and Overclock's, and the cards that pay during it (availableCredits less the pool)
    const fund = plan().holdWalkCredits ? run.bonusCredits + (run.badPublicityCredits ?? 0) : 0;
    const hosted = plan().holdWalkCredits ? Math.max(0, availableCredits(state, 'runner') - state.runner.credits - fund) : 0;
    const ws: WalkState = { ...firstState(state, start, state.runner.clicks, corp), fund, hosted, stealth: stealthCredits(state) };
    const need = new Walk(state, start, [{ server, ice }]).fromIce(ws, pos);
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
