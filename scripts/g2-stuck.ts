/**
 * Step 4 G2 follow-up (AI Coordinator 2026-11-12 00:14Z). Plays the game-0 deals with this branch's switches (PLAN_OFF
 * as in a batch, e.g. placementAdvance for G2 alone) and records:
 *  (a) on each Corp turn where an agenda install into a remote was the Corp's first pick and was stopped (G2), what its
 *      clicks went to (draw, credit, ice install, other install, operation, advance, other);
 *  (b) for each stop into a remote that has ice: how far short the server is by the count (the Runner's spare credits
 *      after paying the most the Corp can make it pay: runnerBudget less the highest iceCreditNeed sum over the rez
 *      sets it can afford, with the credits installCounted uses), and whether one or two ice from HQ would close it;
 *  (b2) pooled: whether all the ice on the other remotes, moved onto it, would make it hold (ice spread thin);
 *  (c) whether the Corp could not afford a set that holds but would with unlimited credits (the money case).
 * Per game: decked (the Corp lost on an empty R&D, 4.2.7b), turns, optional draw clicks, agendas in HQ at the end.
 * One JSON line per deal.
 *
 *   SEEDS=1001,1011 PLAN_OFF=placementAdvance npx vite-node scripts/g2-stuck.ts
 */
import { CardInstance, GameState, cardDef, createInitialGameState, rezCostOf } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { afterLineFloor, holdCost, placementStats, runnerBudget } from '../src/ai/countedScore';
import { iceCreditNeed } from '../src/ai/runs';
import { withIceInstalled } from '../src/ai/iceValues';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

applyPlanOff(process.env.PLAN_OFF ?? '');
const typeOf = (c: CardInstance) => cardDef(c).type_code;

/** The most the Corp can make the Runner pay on these ice with this many credits for rezzes (holdCost's sets). */
function bestNeed(state: GameState, ice: CardInstance[], credits: number): number {
  const view: GameState = { ...state, runner: { ...state.runner, clicks: Math.max(0, state.runner.maxClicks - 1) } };
  const n = Math.min(ice.length, 10);
  let best = 0;
  for (let mask = 0; mask < 1 << n; mask++) {
    let rez = 0;
    let need = 0;
    let ok = true;
    for (let i = 0; i < n; i++) {
      const c = ice[i];
      const on = !!(mask & (1 << i));
      if (c.isRezzed && on) ok = false;
      if (!ok) break;
      if (!c.isRezzed && !on) continue;
      if (!c.isRezzed) rez += rezCostOf(view, c);
      need += iceCreditNeed(view, c.isRezzed ? c : { ...c, isRezzed: true });
    }
    if (ok && rez <= credits) best = Math.max(best, need);
  }
  return best;
}

function look(s: GameState, agendaId: string, serverId: string) {
  return asSide('corp', () => {
    decisionContext(s, 'corp');
    const server = s.corp.servers[serverId];
    const end = s.corp.credits + Math.max(0, s.corp.clicks - 1) - afterLineFloor(s, agendaId);
    const budget = runnerBudget(s);
    const need = bestNeed(s, server.ice, end);
    const spare = need === Infinity ? null : budget - need;
    const money = holdCost(s, server.ice, Infinity) !== null;
    const hqIce = [...new Map(s.corp.hq.filter(c => typeOf(c) === 'ice').map(c => [c.cardCode, c])).values()];
    // One ice from HQ: a click and its install cost (8.5.11a), then the rez from what is left
    let one = false;
    for (const ice of hqIce) {
      const view = withIceInstalled(s, ice, server);
      if (holdCost(view, view.corp.servers[serverId].ice, end - 1 - server.ice.length) !== null) one = true;
    }
    let two = one;
    if (!two && s.corp.clicks >= 3)
      for (const a of hqIce)
        for (const b of s.corp.hq.filter(c => typeOf(c) === 'ice' && c.instanceId !== a.instanceId)) {
          if (two) break;
          const v1 = withIceInstalled(s, a, server);
          const v2 = withIceInstalled(v1, b, v1.corp.servers[serverId]);
          if (holdCost(v2, v2.corp.servers[serverId].ice, end - 2 - server.ice.length * 2 - 1) !== null) two = true;
        }
    // All the ice on the other remotes moved onto this one: does it hold (ice spread thin)
    const others = Object.values(s.corp.servers).filter(v => v.isRemote && v.id !== serverId).flatMap(v => v.ice);
    let pool = s;
    for (const ice of others) pool = withIceInstalled(pool, ice, pool.corp.servers[serverId]);
    const pooled = others.length > 0 && holdCost(pool, pool.corp.servers[serverId].ice, end) !== null;
    return { turn: s.turnNumber, ice: server.ice.length, spare, pooled, money, hqIce: hqIce.length, one, two, credits: s.corp.credits };
  });
}

const kindOf = (s: GameState, a: { type: string; cardInstanceId?: string }): string => {
  if (a.type === 'DRAW_CARD') return 'draw';
  if (a.type === 'GAIN_CREDIT') return 'credit';
  if (a.type === 'ADVANCE_CARD') return 'advance';
  if (a.type === 'PLAY_OPERATION_OR_EVENT') return 'operation';
  if (a.type === 'INSTALL_CARD') {
    const c = s.corp.hq.find(x => x.instanceId === a.cardInstanceId);
    return c && typeOf(c) === 'ice' ? 'ice install' : c && typeOf(c) === 'agenda' ? 'agenda install' : 'other install';
  }
  return a.type === 'END_TURN' || a.type === 'START_TURN' ? '' : 'other';
};

function playDeal(seed: number) {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  const c = corpDecks[Math.floor(p / runnerDecks.length)];
  const r = runnerDecks[p % runnerDecks.length];
  valueLoops.clear();
  placementStats.stopped.length = 0;
  const start = createInitialGameState(deckGameSetup(seed, c, r));
  const corp = createAgent('corp', 'normal');
  const turns = new Map<number, { stopped: boolean; clicks: Record<string, number> }>();
  const short: ReturnType<typeof look>[] = [];
  const seen = new Set<string>();
  const choose = corp.chooseAction.bind(corp);
  let draws = 0;
  corp.chooseAction = (s: GameState) => {
    const before = placementStats.stopped.length;
    const a = choose(s);
    if (s.activePlayer !== 'corp' || s.activeRun) return a;
    if (a.type === 'DRAW_CARD') draws++;
    const t = turns.get(s.turnNumber) ?? { stopped: false, clicks: {} };
    turns.set(s.turnNumber, t);
    for (const x of placementStats.stopped.slice(before)) {
      if (x.kind !== 'install') continue;
      t.stopped = true;
      const key = `${s.turnNumber}:${x.id}`;
      if (x.server && s.corp.servers[x.server]?.ice.length && !seen.has(key)) {
        seen.add(key);
        short.push(look(s, x.id, x.server));
      }
    }
    const k = kindOf(s, a as { type: string; cardInstanceId?: string });
    if (k) t.clicks[k] = (t.clicks[k] ?? 0) + 1;
    return a;
  };
  const game = new GameRunner(start, { corp, runner: createAgent('runner', 'normal') });
  for (let i = 0; i < 6000 && game.step(); i++);
  const stuckTurns = [...turns.values()].filter(t => t.stopped);
  const clicks: Record<string, number> = {};
  for (const t of stuckTurns) for (const [k, n] of Object.entries(t.clicks)) clicks[k] = (clicks[k] ?? 0) + n;
  return { seed, winner: game.state.winner ?? null, decked: game.state.winner === 'runner' && game.state.corp.rd.length === 0, turns: game.state.turnNumber, draws, hqAgendasEnd: game.state.corp.hq.filter(c => typeOf(c) === 'agenda').length, stuckTurns: stuckTurns.length, clicks, short };
}

const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
for (const seed of seeds) console.log(JSON.stringify(playDeal(seed)));
