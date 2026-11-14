import { CardInstance, GameState, rezCostOf } from '../../core';
import { rezCost } from '../../core/engine/cardEffects';
import { bypassesAhead, iceCreditNeed, runBypasses } from '../runs';
import { clickMoneyOf, turnIncomeOf } from '../cards';
import { counters } from '../../core/engine/cardEffects';

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
  const clicks = Math.max(0, s.runner.maxClicks - 1);
  let best = clicks;
  const n = Math.min(uses.length, 10);
  for (let mask = 1; mask < 1 << n; mask++) {
    let k = 0;
    let got = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) {
      k += uses[i].clicks;
      got += uses[i].credits;
    }
    if (k <= clicks) best = Math.max(best, got + clicks - k);
  }
  return drip + best;
}

/** Does the server hold, and by how much (see the file comment)? */
export function serverHold(state: GameState, server: string, opts: HoldOptions): Hold {
  return opts.when === 'thisRun' ? holdThisRun(state, server, opts) : holdRunnerTurn(state, server, opts.corpCredits ?? state.corp.credits);
}

/**
 * The Runner's next turn (holdCost's count): with a set S of the server's ice rezzed, the Runner needs the sum of
 * iceCreditNeed (runs.ts: the credits to break the ice's run-ending subroutines with its installed breakers; BLOCK when
 * none can) over S, plus what its bypasses cost, against runnerBudget. Each set once: a rezzed ice's bit stays clear.
 */
function holdRunnerTurn(state: GameState, server: string, corpCredits: number): Hold {
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
  for (let mask = 0; mask < 1 << n; mask++) {
    let rez = 0;
    let need = 0;
    // The ice the Runner's installed bypasses pass with this set rezzed (runs.ts runBypasses: rig cards, their counters
    // and the threat level, all public; 6.5.8a: a bypassed ice's subroutines never resolve), and what those bypasses
    // cost it in credits' worth (spec jeff-games-48-50 Part A, folded 2026-11-13: g3 +0.3 ± 0.2, run 43382962736)
    const bypassed = serverId ? runBypasses(rezzedSet(view, serverId, ice, mask, n), serverId) : undefined;
    if (bypassed) need += bypassed.price;
    for (let i = 0; i < n; i++) {
      const c = ice[i];
      const on = !!(mask & (1 << i));
      if (c.isRezzed && on) {
        rez = Infinity; // each set once: a rezzed ice's bit stays clear
        break;
      }
      if (!c.isRezzed && !on) continue;
      if (!c.isRezzed) rez += rezCostOf(view, c);
      if (bypassed?.ids.has(c.instanceId)) continue;
      const up = c.isRezzed ? c : { ...c, isRezzed: true };
      need += iceCreditNeed(withIce(view, up), up);
    }
    if (rez > corpCredits) continue;
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
  if (base > credits) return none;
  const open = (opts.further ?? true) ? sv.ice.slice(0, pos).filter(c => !c.isRezzed).slice(0, 10) : [];
  let best = Infinity;
  let bestSet: string[] | null = null;
  let bestNeed = 0;
  let mostNeed = -Infinity;
  for (let mask = 0; mask < 1 << open.length; mask++) {
    const extra = open.filter((_, i) => mask & (1 << i));
    const cost = base + extra.reduce((n, c) => n + rezCost(state, c), 0);
    if (cost > credits || cost >= best) continue;
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

/**
 * Reader for an ice list (the counted lines' view boards and the measurement scripts): the cheapest rez spend that
 * keeps the Runner out next turn, or null. The ice must be one server's ice on `state` (the server is found by its
 * first ice; an empty list holds nothing).
 */
export function holdCost(state: GameState, ice: CardInstance[], corpCredits: number): number | null {
  const server = Object.values(state.corp.servers).find(v => v.ice.some(c => c.instanceId === ice[0]?.instanceId));
  if (!server) return null;
  const h = serverHold(state, server.id, { when: 'runnerTurn', corpCredits });
  return h.holds ? h.rezCost : null;
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
