/**
 * Stage D item 3 step 1 (brief /mnt/project-files/netrunner-ai/stage-d/item3-rez-money/brief.md): the questions the counts
 * ask, read from the owners on this tree, with no source change. Everything here is a measurement; nothing is a second
 * owner in play (the design note says which part would become an owner input in step 2).
 *
 *  - restOfTurn(state, runnerCredits): the Runner's rest of THIS turn as a board serverHold's 'runnerTurn' walk can read:
 *    no run under way, its clicks left as the turn's clicks (maxClicks), its credits after paying through the run under
 *    way less the turn-start money runnerEarnings would add again (earn[0], paid already this turn). Known gaps, each
 *    erring toward a richer or stronger Runner (more kept): a once-per-turn click ability used already this turn is
 *    counted again; walkStart's turn-start counters (Botulus, Tranquilizer) are placed again; Lycian derezzes itself.
 *  - keepRest(view, except): rezMoney's keep on that board without the run's own server: the staked servers (the owner's
 *    stakedServers), each one's cheapest holding rez (serverHold 'runnerTurn', the Corp's money unbounded), the largest
 *    total over the sets one turn reaches (reachSets, as keepFor). keepFor is not exported; its 25 lines are mirrored
 *    here for the measurement only.
 *  - classify(state, ice): which rule of decideRez takes this rez window (match point, R2, R3, R4 with stop or toll, the
 *    priced rez) and whether the rez is part of a set that stops the run (serverHold 'thisRun' with it rezzed and the
 *    affordable ice further in).
 */
import { CardInstance, GameState, cardDef } from '../../src/core';
import { rezCost } from '../../src/core/engine/cardEffects';
import { reachQuestion, reachSets, serverHold } from '../../src/ai/corp/hold';
import { runnerEarnings } from '../../src/ai/nextTurnMoney';
import { stakedServers } from '../../src/ai/corp/rezMoney';
import { countedRez, matchPointRez, rezStops } from '../../src/ai/corp/rez';
import { agendasUnseen } from '../../src/ai/corp/pools';

export const isAgenda = (c: CardInstance | undefined) => (c ? cardDef(c).type_code === 'agenda' : false);

/** The Runner's rest of this turn (see the file comment). */
export function restOfTurn(state: GameState, runnerCredits: number, corpCredits = state.corp.credits): GameState {
  const clicks = Math.max(0, state.runner.clicks);
  const base: GameState = { ...state, activeRun: null, corp: { ...state.corp, credits: corpCredits }, runner: { ...state.runner, maxClicks: clicks, clicks } };
  const drip = runnerEarnings(base)[0] ?? 0;
  return { ...base, runner: { ...base.runner, credits: runnerCredits - drip } };
}

const bits = (mask: number): number => (mask ? (mask & 1) + bits(mask >>> 1) : 0);

/** keepFor's sum (rezMoney.ts) over the servers in byServer, on `state`. */
export function keepOver(state: GameState, byServer: Record<string, number>): number {
  const ids = Object.keys(byServer).filter(id => byServer[id] > 0);
  if (!ids.length || state.runner.maxClicks <= 0) return 0;
  const sets: number[] = [];
  for (let mask = 1; mask < 1 << ids.length; mask++) if (bits(mask) <= state.runner.maxClicks) sets.push(mask);
  const total = (mask: number) => ids.reduce((n, id, i) => (mask & (1 << i) ? n + byServer[id] : n), 0);
  sets.sort((a, b) => total(b) - total(a) || bits(a) - bits(b) || a - b);
  let asked: ((set: string[]) => boolean) | undefined;
  const some = (set: string[]) => (asked ??= reachSets(reachQuestion(state, ids)))(set);
  const reached = new Map<number, boolean>();
  const reach = (mask: number): boolean => {
    const hit = reached.get(mask);
    if (hit !== undefined) return hit;
    const set = ids.filter((_, i) => mask & (1 << i));
    let ok = set.every((_, i) => bits(mask) === 1 || reach(mask & ~(1 << ids.indexOf(set[i]))));
    ok &&= some(set);
    reached.set(mask, ok);
    return ok;
  };
  for (const mask of sets) if (reach(mask)) return total(mask);
  return 0;
}

export interface Held {
  keep: number;
  byServer: Record<string, number>;
  unholdable: string[];
}

/** The holding rez of each listed server (the Corp's money unbounded) and keepFor's sum over them. */
export function heldOver(state: GameState, servers: string[]): Held {
  const byServer: Record<string, number> = {};
  const unholdable: string[] = [];
  for (const id of servers) {
    const h = serverHold(state, id, { when: 'runnerTurn', corpCredits: Infinity });
    if (h.holds) byServer[id] = h.rezCost;
    else unholdable.push(id);
  }
  return { keep: keepOver(state, byServer), byServer, unholdable };
}

/** rezMoney's keep on the rest-of-turn board, without the run's own server. */
export function keepRest(view: GameState, except: string, extra: string[] = []): Held & { staked: string[] } {
  const staked = [...stakedServers(view).filter(id => id !== except), ...extra.filter(id => id !== except)];
  return { ...heldOver(view, staked), staked };
}

export type RezRule = 'match' | 'R2' | 'R3s' | 'R3t' | 'R4s' | 'R4t' | 'model' | 'other';

/** The rule of decideRez that answers this approached ice's window (the counted rez's order). */
export function ruleOf(state: GameState, ice: CardInstance): { rule: RezRule; counted: 'rez' | 'pass' | null } {
  if (matchPointRez(state, ice) === 'rez') return { rule: 'match', counted: 'rez' };
  const counted = countedRez(state, ice);
  if (counted !== 'rez') return { rule: counted === null ? 'model' : 'other', counted };
  const run = state.activeRun!;
  const stops = rezStops(state, ice, false);
  if (stops && state.corp.servers[run.server].root.some(isAgenda)) return { rule: 'R2', counted };
  const hq = state.corp.hq.filter(isAgenda).length;
  if (run.server === 'hq' && hq > 0) return { rule: stops ? 'R3s' : 'R3t', counted };
  if (run.server === 'rd' && hq === 0 && agendasUnseen(state) > 0) return { rule: stops ? 'R4s' : 'R4t', counted };
  return { rule: 'other', counted };
}

export interface Window {
  server: string;
  ice: string;
  title: string;
  rezCost: number;
  corp: number;
  runner: number;
  /** The rez is part of a set the Corp can afford that stops this run (it with the ice further in). */
  stopsWithFurther: boolean;
  /** This ice alone (with the rezzed ice further in) stops the run. */
  stopsAlone: boolean;
  /** The Runner's least credit need for the rest of the run with this ice rezzed and nothing more. */
  tollNeed: number;
  /** The Runner's credits once it has paid through (tollNeed taken off, no less than 0). */
  runnerAfter: number;
  clicksLeft: number;
}

/** The facts of an approach-ice rez window for `ice`. */
export function windowOf(state: GameState, ice: CardInstance): Window {
  const run = state.activeRun!;
  const cost = rezCost(state, ice);
  const further = serverHold(state, run.server, { when: 'thisRun', mustRez: [ice.instanceId], further: true });
  const alone = serverHold(state, run.server, { when: 'thisRun', mustRez: [ice.instanceId], further: false });
  const runnerAfter = alone.holds ? state.runner.credits : Math.max(0, state.runner.credits - alone.need);
  return {
    server: run.server,
    ice: ice.instanceId,
    title: cardDef(ice).title,
    rezCost: cost,
    corp: state.corp.credits,
    runner: state.runner.credits,
    stopsWithFurther: further.holds,
    stopsAlone: alone.holds,
    tollNeed: alone.holds ? Infinity : alone.need,
    runnerAfter,
    clicksLeft: state.runner.clicks,
  };
}
