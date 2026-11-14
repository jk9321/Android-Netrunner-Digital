import { CardInstance, GameState, cardDef } from '../../core';
import { tally } from '../diagnostics';
import { runnerBudget, serverHold } from './hold';
import { memo, setRezKeep } from '../valueModel';

/**
 * Owner: rez money, the credits the Corp keeps to rez the ice that holds what it stakes through the Runner's next turn
 * (Step 4 Stage A, spec-step4-corp-core.md 1.5; registry row "rez money the Corp must keep").
 *
 * A server stakes something next Runner turn when the Runner's access there can take an agenda the Corp knows of:
 * R&D always (the deck list's agendas still there, rule 10.2.2a: never its order); HQ while it holds an agenda; a remote
 * with an agenda in its root. A card the caller is about to score or install leaves the pools (`without`).
 *
 *  - byServer: for each staked server, the cheapest rez that keeps the Runner out next turn (serverHold, 'runnerTurn',
 *    the Corp's money unbounded: what it should keep, not what it has). Rezzed ice that holds costs 0. This is
 *    afterLineFloor's definition, server by server (count inputs F1, moved here from countedScore.ts).
 *  - unholdable: staked servers no rez set holds (money can't fix them, so they add nothing).
 *  - keep: the most the Runner can make the Corp spend in one turn. The Runner has one budget and its clicks: each run
 *    takes a click and costs at least what getting past the server's rezzed ice costs it (serverHold's need with
 *    nothing more rezzed), and a click used to run earns no credit. keep is the largest byServer total over the staked
 *    servers one affordable run sequence reaches. With one or two staked servers, or a rich Runner, it is the sum.
 *
 * In Stage A no decision reads `keep`; the counted lines read the byServer sum (lineFloor), as they read afterLineFloor
 * before. The other reserves (rezReserve, reservePenalty, moneyTarget, the pacing gate, scoringShort, reservedForAgenda's
 * horizon, centralIce's rez gate, boardNeed, rezBudget) are untouched: scripts/stage-a/rez-money.ts measures how far
 * each is from `keep`.
 */

export interface RezMoney {
  keep: number;
  byServer: Record<string, number>;
  /** The ice of each byServer rez (serverHold's rez ids), servers in stakedServers order. */
  rezIds: Record<string, string[]>;
  unholdable: string[];
}

const isAgenda = (c: CardInstance | undefined) => (c ? cardDef(c).type_code === 'agenda' : false);

/** The servers that stake an agenda through the Runner's next turn, R&D first, then HQ, then remotes in id order. */
export function stakedServers(state: GameState, without: string[] = []): string[] {
  const out = ['rd'];
  if (state.corp.hq.some(c => isAgenda(c) && !without.includes(c.instanceId))) out.push('hq');
  for (const v of Object.values(state.corp.servers)) if (v.isRemote && v.root.some(c => isAgenda(c) && !without.includes(c.instanceId))) out.push(v.id);
  return out;
}

/** Rez money (see the file comment). */
export function rezMoney(state: GameState, opts: { without?: string[] } = {}): RezMoney {
  // Worked out once per position (valueModel memo: on the state object, the pricing context in its key): boardNeed and
  // rezBudget ask it of the same boards many times over in one decision (Stage B5 decision time)
  if (!opts.without?.length) return memo(state, 'rezMoney', () => countRezMoney(state, holding(state)));
  return countRezMoney(state, holdingRez(state, opts.without));
}

/** The ice of each staked server's holding rez (rezMoney's rezIds, without keep's count): rezBudget's order reads it. */
export const holdingRezIds = (state: GameState): Record<string, string[]> => holding(state).rezIds;

/** holdingRez with nothing left out, once per position (as rezMoney). */
const holding = (state: GameState) => memo(state, 'holdingRez', () => holdingRez(state));

function countRezMoney(state: GameState, { byServer, rezIds, unholdable }: ReturnType<typeof holdingRez>): RezMoney {
  // What getting in costs the Runner with nothing more rezzed (the rezzed ice only)
  const entry = Object.fromEntries(Object.keys(byServer).map(id => [id, serverHold(state, id, { when: 'runnerTurn', corpCredits: 0 }).need]));
  return { keep: keepFor(state, byServer, entry), byServer, rezIds, unholdable };
}

/** byServer and unholdable: the cheapest holding rez of each staked server, the Corp's money unbounded. */
function holdingRez(state: GameState, without: string[] = []): { byServer: Record<string, number>; rezIds: Record<string, string[]>; unholdable: string[] } {
  const byServer: Record<string, number> = {};
  const rezIds: Record<string, string[]> = {};
  const unholdable: string[] = [];
  for (const id of stakedServers(state, without)) {
    const h = serverHold(state, id, { when: 'runnerTurn', corpCredits: Infinity });
    if (h.holds) {
      byServer[id] = h.rezCost;
      rezIds[id] = h.rez ?? [];
    } else unholdable.push(id);
  }
  return { byServer, rezIds, unholdable };
}

/** The largest byServer total over the servers one affordable sequence of runs reaches (at most the Runner's clicks). */
function keepFor(state: GameState, byServer: Record<string, number>, entry: Record<string, number>): number {
  const ids = Object.keys(byServer).filter(id => byServer[id] > 0);
  const budget = runnerBudget(state);
  const clicks = Math.max(0, state.runner.maxClicks);
  let keep = 0;
  for (let mask = 1; mask < 1 << ids.length; mask++) {
    const set = ids.filter((_, i) => mask & (1 << i));
    if (set.length > clicks) continue;
    // Each run after the first spends a click that would have earned a credit (runnerBudget counts it as money)
    const cost = set.reduce((n, id) => n + entry[id], 0) + (set.length - 1);
    if (cost > budget) continue;
    keep = Math.max(keep, set.reduce((n, id) => n + byServer[id], 0));
  }
  return keep;
}

/**
 * The credits a counted two-turn line must leave once it has scored (count inputs F1; afterLineFloor before Stage A):
 * the byServer sum of rezMoney with the line's agenda out of the pools. A staked server no set holds adds 0 and is
 * counted in the diagnostics' scoreInTwo.unholdable. Measured alone -1.1 ± 0.7 (games=3, run 42918968349); with F2 at
 * 10 games +0.2 ± 0.4 (run 42940051464 vs 42940033908).
 */
export function lineFloor(state: GameState, agendaId: string): number {
  const money = holdingRez(state, [agendaId]);
  for (let i = 0; i < money.unholdable.length; i++) tally('scoreInTwo', 'unholdable');
  return Object.values(money.byServer).reduce((a, b) => a + b, 0);
}

// Stage B5 (plan.b5RezOwner): the valuation layer's Corp credit need reads keep (valueModel boardNeed; importing the
// owner there is an import cycle, so the owner registers it as it loads)
setRezKeep(state => rezMoney(state).keep);
