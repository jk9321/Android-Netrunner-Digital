import { CardInstance, GameState, cardDef } from '../../core';
import { tally } from '../diagnostics';
import { TurnFrom, afterRun, nextTurn, nextTurnBoard, reachQuestion, reachSets, restOfTurn, serverHold } from './hold';
import { memo } from '../valueModel';
import { agendasUnseen } from './pools';

/**
 * Owner: rez money, the credits the Corp keeps to rez the ice that holds what it stakes through the Runner's next turn
 * (Step 4 Stage A, spec-step4-corp-core.md 1.5; registry row "rez money the Corp must keep").
 *
 * A server stakes something next Runner turn when the Runner's access there can take an agenda the Corp knows of:
 * R&D while the deck list has an agenda left there (agendasUnseen, the pools' owner; rule 10.2.2a: the set, never its
 * order); HQ while it holds an agenda; a remote with an agenda in its root. A card the caller is about to score or install leaves the pools (`without`).
 *
 *  - byServer: for each staked server, the cheapest rez that keeps the Runner out next turn (serverHold, 'runnerTurn',
 *    the Corp's money unbounded: what it should keep, not what it has). Rezzed ice that holds costs 0. This is
 *    afterLineFloor's definition, server by server (count inputs F1, moved here from countedScore.ts).
 *  - unholdable: staked servers no rez set holds (money can't fix them, so they add nothing).
 *  - keep: the most the Runner can make the Corp spend in one turn (keepFor): the largest byServer total over the sets
 *    of staked servers one Runner turn reaches in some order past the ice rezzed now, the Corp rezzing nothing more
 *    (the run sequence, owned by hold.ts: reachQuestion and reachSets). A set is reached only if every set inside it
 *    is (one run fewer frees its click). With one or two staked servers, or a rich Runner, it is the sum.
 *
 * restOfTurn (Stage D item 3, F1; item3-rez-money/design-answer.md): the same keep through the rest of the Runner's
 * current turn instead of its next one: the board with the run over, the Runner's clicks left and the credits it will
 * have once this run is paid (hold.ts's 'restOfTurn' start, the same walk). `except` leaves the run's own server out (the
 * rez in question pays for it). countedRez's toll rezzes (R3t, R4t) read it: a toll rez that spends this money passes.
 * `except` on the next turn (the external review of 2026-11-19, bundle P fix 1, AI-SCORING-SHORT-DOUBLE-COUNT): lineKeep
 * given a line's own server leaves it out the same way (the line pays that server's rez as its own question).
 *
 * Since Stage C6 lineFloor returns `keep`; the placement rules (scoringShort, reservedForAgenda, centralIce's rez gate)
 * read it, and the valuation reaches it through corpPorts (boardNeed reads keep, rezBudget the holding rezzes; registry
 * row "rez money the Corp must keep").
 */

export interface RezMoney {
  keep: number;
  byServer: Record<string, number>;
  /** The ice of each byServer rez (serverHold's rez ids), servers in stakedServers order. */
  rezIds: Record<string, string[]>;
  unholdable: string[];
}

const isAgenda = (c: CardInstance | undefined) => (c ? cardDef(c).type_code === 'agenda' : false);

/** The servers that stake an agenda through the Runner's next turn: R&D (while agendasUnseen is above 0), then HQ, then remotes in id order. */
export function stakedServers(state: GameState, without: string[] = []): string[] {
  const out = agendasUnseen(state) > 0 ? ['rd'] : [];
  if (state.corp.hq.some(c => isAgenda(c) && !without.includes(c.instanceId))) out.push('hq');
  for (const v of Object.values(state.corp.servers)) if (v.isRemote && v.root.some(c => isAgenda(c) && !without.includes(c.instanceId))) out.push(v.id);
  return out;
}

/**
 * Rez money (see the file comment). Every form reads the board with the run under way over: the next turn and the rest of
 * this one have no run of this turn in them (6.8.5, 6.9.6d), and keepFor's reach (reachQuestion, which does not go through
 * serverHold) reads the same board as byServer (the review's AI-HOLD-RUNNER-TURN-ACTIVERUN, red team S3). The next turn's
 * board is nextTurnBoard's (the Runner's once-per-turn uses unused too); the rest of this turn keeps this turn's flags.
 */
export function rezMoney(state: GameState, opts: { without?: string[]; restOfTurn?: { runnerCredits: number }; except?: string } = {}): RezMoney {
  if (opts.restOfTurn) {
    state = afterRun(state);
    const from = restOfTurn(state, opts.restOfTurn.runnerCredits);
    return countRezMoney(state, holdingRez(state, opts.without, from, opts.except), from);
  }
  state = nextTurnBoard(state);
  const without = opts.without ?? [];
  // `except` (a line's own server: lineKeep) leaves the pools only where it stakes; elsewhere the answer is the plain one
  const except = opts.except !== undefined && stakedServers(state, without).includes(opts.except) ? opts.except : undefined;
  if (except !== undefined) return memo(state, `rezMoney:${without.join()}|except:${except}`, () => countRezMoney(state, holdingRez(state, without, undefined, except)));
  // Worked out once per position (valueModel memo: on the state object, the pricing context in its key): boardNeed and
  // rezBudget ask it of the same boards many times over in one decision (Stage B5 decision time)
  if (!without.length) {
    const money = memo(state, 'rezMoney', () => countRezMoney(state, holding(state)));
    if (rezMoneyAudit.on) audit(money, countRezMoney(state, holdingRez(state)));
    return money;
  }
  return countRezMoney(state, holdingRez(state, without));
}

/** On-hit audit of the per-position memo (as handValues clickAudit): every call worked out again and compared. */
export const rezMoneyAudit = { on: false, checked: 0, mismatches: 0 };
function audit<T>(memoised: T, fresh: T) {
  rezMoneyAudit.checked++;
  if (JSON.stringify(memoised) !== JSON.stringify(fresh)) rezMoneyAudit.mismatches++;
}

/** The ice of each staked server's holding rez (rezMoney's rezIds, without keep's count): rezBudget's order reads it. */
export function holdingRezIds(state: GameState): Record<string, string[]> {
  state = nextTurnBoard(state);
  const ids = holding(state).rezIds;
  if (rezMoneyAudit.on) audit(ids, holdingRez(state).rezIds);
  return ids;
}

/** holdingRez with nothing left out, once per position (as rezMoney). */
const holding = (state: GameState) => memo(state, 'holdingRez', () => holdingRez(state));

function countRezMoney(state: GameState, { byServer, rezIds, unholdable }: ReturnType<typeof holdingRez>, from: TurnFrom = nextTurn(state)): RezMoney {
  // What getting in costs the Runner with nothing more rezzed (the rezzed ice only)
  return { keep: keepFor(state, byServer, from), byServer, rezIds, unholdable };
}

/**
 * byServer and unholdable: the cheapest holding rez of each staked server, the Corp's money unbounded; from a rest-of-turn
 * start (`from.rest`), through the rest of the Runner's current turn, `except` left out.
 */
function holdingRez(
  state: GameState,
  without: string[] = [],
  from?: TurnFrom,
  except?: string,
): { byServer: Record<string, number>; rezIds: Record<string, string[]>; unholdable: string[] } {
  const byServer: Record<string, number> = {};
  const rezIds: Record<string, string[]> = {};
  const unholdable: string[] = [];
  for (const id of stakedServers(state, without)) {
    if (id === except) continue;
    const h = from?.rest ? serverHold(state, id, { when: 'restOfTurn', corpCredits: Infinity, runnerCredits: from.credits }) : serverHold(state, id, { when: 'runnerTurn', corpCredits: Infinity });
    if (h.holds) {
      byServer[id] = h.rezCost;
      rezIds[id] = h.rez ?? [];
    } else unholdable.push(id);
  }
  return { byServer, rezIds, unholdable };
}

/**
 * The largest byServer total over the sets of staked servers that one Runner turn reaches in some order past the ice
 * rezzed now, the Corp rezzing nothing more (the run sequence, brief 5.6; hold.ts owns it: reachQuestion and reachOrder,
 * turnReach's search on input gathered once), largest total first. A set is reached only if every set inside it is (one
 * run fewer frees its click), so a set with an unreached part is skipped unwalked.
 */
function keepFor(state: GameState, byServer: Record<string, number>, from: TurnFrom = nextTurn(state)): number {
  const ids = Object.keys(byServer).filter(id => byServer[id] > 0);
  const sets: number[] = [];
  for (let mask = 1; mask < 1 << ids.length; mask++) if (bits(mask) <= from.clicks) sets.push(mask);
  const totals = new Map(sets.map(mask => [mask, ids.reduce((n, id, i) => (mask & (1 << i) ? n + byServer[id] : n), 0)]));
  const total = (mask: number) => totals.get(mask)!;
  sets.sort((a, b) => total(b) - total(a) || bits(a) - bits(b) || a - b);
  // Gathered once for every set and order, when first asked (the 14:39Z ruling); its answers cached per decision
  let asked: ((set: string[]) => boolean) | undefined;
  const reachedInSomeOrder = (set: string[]) => (asked ??= reachSets(reachQuestion(state, ids, from)))(set);
  const reached = new Map<number, boolean>();
  const reach = (mask: number): boolean => {
    const hit = reached.get(mask);
    if (hit !== undefined) return hit;
    const set = ids.filter((_, i) => mask & (1 << i));
    let ok = set.every((_, i) => bits(mask) === 1 || reach(mask & ~(1 << ids.indexOf(set[i]))));
    ok &&= reachedInSomeOrder(set);
    reached.set(mask, ok);
    return ok;
  };
  for (const mask of sets) if (reach(mask)) return total(mask);
  return 0;
}

const bits = (mask: number): number => (mask ? (mask & 1) + bits(mask >>> 1) : 0);

/**
 * The credits a counted two-turn line must leave once it has scored (count inputs F1; afterLineFloor before Stage A):
 * rezMoney's keep with the line's agenda out of the pools (the byServer sum before Stage C6). A staked server no set holds adds 0 and is
 * counted in the diagnostics' scoreInTwo.unholdable. Measured alone -1.1 ± 0.7 (games=3, run 42918968349); with F2 at
 * 10 games +0.2 ± 0.4 (run 42940051464 vs 42940033908).
 */
export function lineFloor(state: GameState, agendaId: string): number {
  state = nextTurnBoard(state);
  const money = holdingRez(state, [agendaId]);
  for (let i = 0; i < money.unholdable.length; i++) tally('scoreInTwo', 'unholdable');
  const sum = Object.values(money.byServer).reduce((a, b) => a + b, 0);
  // Stage C6 (SB-TWO-FLOORS): one floor, the line reads keep as the placement rules do; floorLog counts the states where
  // keep and the byServer sum differ
  const keep = countRezMoney(state, money).keep;
  if (floorLog.on) {
    floorLog.checked++;
    if (keep !== sum) floorLog.differ.push({ keep, sum });
  }
  return keep;
}

/** Stage C6 log: lineFloor's keep against the byServer sum it read before (scripts/stage-c/floor-log.ts). */
export const floorLog = { on: false, checked: 0, differ: [] as { keep: number; sum: number }[] };

/**
 * The credits the Corp keeps under a counted line (keepFloor before Stage C6, moved here from corp/placement.ts): the
 * least keep over the HQ agendas a line could take, each left out of the pools (the line pays its own server's rez as
 * its own step); with no agenda in HQ, keep itself. `server`: the server the line is on, left out of the pools too
 * (scoringShort asks serverHold of it with the money less this keep: its own rez counted once, bundle P fix 1).
 */
export function lineKeep(state: GameState, agendas: CardInstance[], server?: string): number {
  const except = server === undefined ? {} : { except: server };
  return agendas.length ? Math.min(...agendas.map(x => rezMoney(state, { without: [x.instanceId], ...except }).keep)) : rezMoney(state, except).keep;
}

