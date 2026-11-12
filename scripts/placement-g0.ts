/**
 * Step 4 G0 (spec-step4-placement.md): measure before building. Plays the game-0 deals Normal v Normal (PLAN_OFF as in a batch) and, at every Corp decision that installs an agenda into a remote with no
 * counted line for it (B/C install) or advances an agenda with no counted line (B advance), records by the count:
 *  - target: does the target remote hold for the Runner's coming turn (holdCost non-null against runnerBudget, with the
 *    credits the Corp ends on: this action's cost out, spare clicks to credits, scoreInTwo's assumption);
 *  - anyRemote: does some other open remote (no agenda or asset in its root) hold;
 *  - line: could the Corp have started a counted line instead (scoreNow or scoreInTwo at that decision);
 *  - hq: does HQ hold by the same test, HQ's size and agendas in it (a payable HQ gives one random card of n, 7.4.1);
 *  - g3: would one ice install from HQ (install cost and its rez paid) have made a remote hold, a new one included;
 *  - g3Money: no such build with its credits, but one with more; hqIce: ice in HQ at all;
 *  - fate: what happened to the agenda (stolen from a remote, scored, other).
 * At each Corp turn start with agendas in HQ: each one, and whether it was stolen from HQ within the next 2 Runner turns.
 * Per game: ice per server at the turn 6 and 12 starts, turns, optional draw clicks, agendas in HQ at the end, decked (the Corp lost on an empty R&D, 4.2.7b).
 * One JSON line per deal; scripts/placement-g0-sum.mjs sums them.
 *
 *   SEEDS=1001,1011 PLAN_OFF=placementAdvance,placementInstall,placementBuild npx vite-node scripts/placement-g0.ts
 */
import { CardInstance, GameState, cardDef, createInitialGameState, rezCostOf } from '../src/core';
import { isIcebreaker } from '../src/core/engine/ice';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { HeldLine, holdCost, runnerBudget, scoreInTwo } from '../src/ai/countedScore';
import { iceCreditNeed } from '../src/ai/runs';
import { scoreNowPlan } from '../src/ai/winNow';
import { withIceInstalled } from '../src/ai/iceValues';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { applyPlanOff } from '../src/ai/synergy';

applyPlanOff(process.env.PLAN_OFF ?? '');

const typeOf = (c: CardInstance) => cardDef(c).type_code;
const isAgenda = (c: CardInstance) => typeOf(c) === 'agenda';

interface Event {
  kind: 'install' | 'advance';
  turn: number;
  agenda: string;
  id: string;
  server: string;
  target: boolean;
  anyRemote: boolean;
  line: 'scoreNow' | 'scoreInTwo' | 'none';
  hq: boolean;
  hqSize: number;
  hqAgendas: number;
  g3: 'none' | 'existing' | 'new';
  /** No build holds with the Corp's credits, one would with more (the money step's case). */
  g3Money: boolean;
  hqIce: number;
  credits: number;
  /** Ice on the target and the Runner's credits left after paying the most the Corp can make it pay there (runnerBudget less the best affordable rez set's need). */
  targetIce: number;
  margin: number;
  /** An iced target that does not hold: would all the ice on the other remotes, there too, make it hold (ice spread thin). */
  pooled?: boolean;
  fate?: 'stolen' | 'scored' | 'other';
  stolenFrom?: string;
}

/** The most the Corp can make the Runner pay on these ice with this many credits for rezzes (holdCost's sets and view). */
function bestNeed(state: GameState, ice: CardInstance[], credits: number): number {
  const view: GameState = { ...state, runner: { ...state.runner, clicks: Math.max(0, state.runner.maxClicks - 1) } };
  const n = Math.min(ice.length, 10);
  let best = 0;
  for (let mask = 0; mask < 1 << n; mask++) {
    let rez = 0;
    let need = 0;
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const c = ice[i];
      const on = !!(mask & (1 << i));
      if (c.isRezzed && on) ok = false;
      else if (c.isRezzed || on) {
        if (!c.isRezzed) rez += rezCostOf(view, c);
        need += iceCreditNeed(view, c.isRezzed ? c : { ...c, isRezzed: true });
      }
    }
    if (ok && rez <= credits) best = Math.max(best, need);
  }
  return best;
}

const open = (s: GameState) => Object.values(s.corp.servers).filter(v => v.isRemote && !v.root.some(c => isAgenda(c) || typeOf(c) === 'asset'));

/** All the ice on the other remotes moved onto this one (outermost after its own): does it hold by the count. */
function pooledHolds(s: GameState, server: string, end: number): boolean {
  const others = Object.values(s.corp.servers).filter(v => v.isRemote && v.id !== server).flatMap(v => v.ice);
  if (!others.length) return false;
  let view = s;
  for (const ice of others) view = withIceInstalled(view, ice, view.corp.servers[server]);
  return holdCost(view, view.corp.servers[server].ice, end) !== null;
}

/**
 * Corp supply at a Corp turn start (coordinator 02:02Z): cards seen (out of R&D), ice seen, installed and in HQ; of the
 * ice in HQ, how much the Corp could not pay to install and rez (cheapest server: 8.5.11a install cost, then the rez);
 * both sides' credits; the Runner's installed breakers; and whether the Runner can pay through every installed ice
 * piece alone (iceCreditNeed of each, rezzed, within runnerBudget).
 */
function supply(s: GameState, deck: { cards: number; ice: number }) {
  const isIce = (c: CardInstance) => typeOf(c) === 'ice';
  const installed = Object.values(s.corp.servers).flatMap(v => v.ice);
  const cheapest = 0; // a new remote takes ice for no install cost
  const hqIce = s.corp.hq.filter(isIce);
  const unpaid = hqIce.filter(c => cheapest + rezCostOf(s, c) > s.corp.credits).length;
  const view: GameState = { ...s, runner: { ...s.runner, clicks: Math.max(0, s.runner.maxClicks - 1) } };
  const budget = runnerBudget(s);
  const payAll = installed.length > 0 && asSide('corp', () => (decisionContext(s, 'corp'), installed.every(c => iceCreditNeed(view, { ...c, isRezzed: true }) <= budget)));
  return {
    turn: s.turnNumber, seen: deck.cards - s.corp.rd.length, iceSeen: deck.ice - s.corp.rd.filter(isIce).length, iceInstalled: installed.length,
    iceHq: hqIce.length, iceHqUnpaid: unpaid, corpCredits: s.corp.credits, runnerCredits: s.runner.credits, runnerBudget: budget,
    breakers: [...s.runner.rig.programs].filter(isIcebreaker).length, payAll,
  };
}

/** Ice per server at a Corp turn start: HQ, R&D, the most-iced remote, all other remotes, and how many remotes have ice. */
function iceBoard(s: GameState) {
  const remotes = Object.values(s.corp.servers).filter(v => v.isRemote).map(v => v.ice.length).sort((a, b) => b - a);
  return { turn: s.turnNumber, hq: s.corp.servers.hq.ice.length, rd: s.corp.servers.rd.ice.length, most: remotes[0] ?? 0, others: remotes.slice(1).reduce((a, b) => a + b, 0), iced: remotes.filter(n => n > 0).length };
}

function look(s: GameState, kind: Event['kind'], card: CardInstance, server: string): Event {
  return asSide('corp', () => {
    decisionContext(s, 'corp');
    // Credits the Corp ends on: this action's cost out, the clicks left after it to credits
    const cost = kind === 'advance' ? 1 : 0;
    const end = s.corp.credits - cost + Math.max(0, s.corp.clicks - 1);
    const holds = (st: GameState, ice: CardInstance[], credits: number) => holdCost(st, ice, credits) !== null;
    const targetIce = server.startsWith('remote') ? s.corp.servers[server]?.ice ?? [] : [];
    const target = targetIce.length > 0 && holds(s, targetIce, end);
    const others = open(s).filter(v => v.id !== server && v.ice.length > 0);
    const anyRemote = others.some(v => holds(s, v.ice, end));
    const line = scoreNowPlan(s) ? 'scoreNow' : scoreInTwo(s) ? 'scoreInTwo' : 'none';
    const hqIceSet = s.corp.servers.hq.ice;
    const hq = hqIceSet.length > 0 && holds(s, hqIceSet, end);
    const hqIce = s.corp.hq.filter(c => typeOf(c) === 'ice');
    let g3: Event['g3'] = 'none';
    let g3Money = false;
    // One ice from HQ: install (1 credit per ice already there, 8.5.11a) with the clicks it takes, then the rez
    const g3End = s.corp.credits - cost + Math.max(0, s.corp.clicks - 2);
    for (const ice of [...new Map(hqIce.map(c => [c.cardCode, c])).values()]) {
      for (const v of [...open(s), null]) {
        const view = withIceInstalled(s, ice, v);
        const id = v?.id ?? 'remote-placed';
        const credits = g3End - (v?.ice.length ?? 0);
        if (credits < 0) continue;
        if (holdCost(view, view.corp.servers[id].ice, credits) !== null) {
          g3 = v ? 'existing' : 'new';
          break;
        }
      }
      if (g3 !== 'none') break;
    }
    // A build that holds only with more credits than the Corp has (the money case)
    if (g3 === 'none')
      g3Money = hqIce.some(ice => [...open(s), null].some(v => {
        const view = withIceInstalled(s, ice, v);
        return holdCost(view, view.corp.servers[v?.id ?? 'remote-placed'].ice, Infinity) !== null;
      }));
    return {
      kind, turn: s.turnNumber, agenda: cardDef(card).title, id: card.instanceId, server, target, anyRemote, line, hq,
      hqSize: s.corp.hq.length - (kind === 'install' ? 1 : 0), hqAgendas: s.corp.hq.filter(isAgenda).length - (kind === 'install' ? 1 : 0),
      g3, g3Money, hqIce: hqIce.length, credits: s.corp.credits,
      targetIce: targetIce.length, margin: runnerBudget(s) - bestNeed(s, targetIce, end),
      pooled: targetIce.length > 0 && !target ? pooledHolds(s, server, end) : undefined,
    };
  });
}

/** A Corp main-phase action by kind (clicks over turns 1-5). */
function clickKind(s: GameState, a: { type: string }): string {
  const id = (a as { cardInstanceId?: string }).cardInstanceId;
  if (a.type === 'DRAW_CARD') return 'draw';
  if (a.type === 'GAIN_CREDIT') return 'credit';
  if (a.type === 'ADVANCE_CARD') return 'advance';
  if (a.type === 'PLAY_OPERATION_OR_EVENT') return 'operation';
  if (a.type === 'INSTALL_CARD') {
    const c = s.corp.hq.find(x => x.instanceId === id);
    return c && typeOf(c) === 'ice' ? 'install ice' : 'install other';
  }
  return a.type === 'END_TURN' || a.type === 'START_TURN' || a.type === 'PASS' || a.type === 'RESOLVE_PROMPT' ? '' : 'other';
}

function playDeal(seed: number) {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  const c = corpDecks[Math.floor(p / runnerDecks.length)];
  const r = runnerDecks[p % runnerDecks.length];
  valueLoops.clear();
  const start = createInitialGameState(deckGameSetup(seed, c, r));
  const corp = createAgent('corp', 'normal');
  const runner = createAgent('runner', 'normal');
  const heldOf = () => (corp as unknown as { heldLine: HeldLine | null }).heldLine;
  const events: Event[] = [];
  const hqWatch: { id: string; turn: number; stolen: boolean }[] = [];
  let lastCorpTurn = -1;
  let draws = 0;
  const boards: ReturnType<typeof iceBoard>[] = [];
  const supplies: ReturnType<typeof supply>[] = [];
  const turnStart: { turn: number; corp: number; runner: number }[] = [];
  const clicks15: Record<string, number> = {};
  const deck = { cards: start.corp.rd.length + start.corp.hq.length, ice: [...start.corp.rd, ...start.corp.hq].filter(c => typeOf(c) === 'ice').length };

  const choose = corp.chooseAction.bind(corp);
  corp.chooseAction = (s: GameState) => {
    const held = heldOf();
    const a = choose(s);
    if (s.activePlayer === 'corp' && !s.activeRun && a.type === 'DRAW_CARD') draws++;
    if (s.activePlayer === 'corp' && !s.activeRun && s.turnNumber <= 5 && s.turnStep?.kind !== 'corp_turn_start') {
      const k = clickKind(s, a);
      if (k) clicks15[k] = (clicks15[k] ?? 0) + 1;
    }
    const id = (a as { cardInstanceId?: string }).cardInstanceId;
    if (s.activePlayer === 'corp' && s.turnStep?.kind !== 'corp_turn_start' && s.turnNumber !== lastCorpTurn && !s.activeRun) {
      lastCorpTurn = s.turnNumber;
      if (s.turnNumber === 6 || s.turnNumber === 12) boards.push(iceBoard(s));
      if (s.turnNumber === 6 || s.turnNumber === 12) supplies.push(supply(s, deck));
      turnStart.push({ turn: s.turnNumber, corp: s.corp.credits, runner: s.runner.credits });
      for (const x of s.corp.hq.filter(isAgenda)) hqWatch.push({ id: x.instanceId, turn: s.turnNumber, stolen: false });
    }
    const after = heldOf();
    const onLine = (x: string) => (!!held && held.game === s.id && held.line.agendaId === x) || (!!after && after.game === s.id && after.line.agendaId === x);
    if (a.type === 'INSTALL_CARD' && id) {
      const card = s.corp.hq.find(x => x.instanceId === id);
      const target = (a as { targetServerId?: string }).targetServerId ?? 'new remote';
      if (card && isAgenda(card) && target !== 'hq' && target !== 'rd' && target !== 'archives' && !onLine(id)) {
        const line = asSide('corp', () => (decisionContext(s, 'corp'), scoreNowPlan(s)));
        if (!line) events.push(look(s, 'install', card, target));
      }
    }
    if (a.type === 'ADVANCE_CARD' && id && !onLine(id)) {
      const where = Object.values(s.corp.servers).find(v => v.root.some(x => x.instanceId === id));
      const card = where?.root.find(x => x.instanceId === id);
      if (card && isAgenda(card)) {
        const line = asSide('corp', () => (decisionContext(s, 'corp'), scoreNowPlan(s)));
        if (!line) events.push(look(s, 'advance', card, where!.id));
      }
    }
    return a;
  };

  let prev: GameState = start;
  const game = new GameRunner(start, { corp, runner });
  const step = (s: GameState) => {
    const had = new Set(prev.runner.scoreArea.map(x => x.instanceId));
    for (const x of s.runner.scoreArea) {
      if (had.has(x.instanceId) || !isAgenda(x)) continue;
      const fromRemote = Object.values(prev.corp.servers).find(v => v.isRemote && v.root.some(y => y.instanceId === x.instanceId));
      const fromHq = prev.corp.hq.some(y => y.instanceId === x.instanceId);
      for (const e of events) if (e.id === x.instanceId && !e.fate) {
        e.fate = 'stolen';
        e.stolenFrom = fromRemote ? 'remote' : fromHq ? 'hq' : 'other';
      }
      if (fromHq) for (const w of hqWatch) if (w.id === x.instanceId && s.turnNumber - w.turn <= 1) w.stolen = true; // turnNumber counts rounds: the Runner turns of rounds t and t+1
    }
    const scored = new Set(prev.corp.scoreArea.map(x => x.instanceId));
    for (const x of s.corp.scoreArea) if (!scored.has(x.instanceId)) for (const e of events) if (e.id === x.instanceId && !e.fate) e.fate = 'scored';
    prev = s;
  };
  for (let i = 0; i < 6000; i++) {
    step(game.state);
    if (!game.step()) break;
  }
  step(game.state);
  for (const e of events) e.fate ??= 'other';
  return {
    seed, corp: c.name, runner: r.name, winner: game.state.winner ?? null,
    events,
    hqTurns: hqWatch.length,
    hqStolen2: hqWatch.filter(w => w.stolen).length,
    turns: game.state.turnNumber, draws, boards, supplies, turnStart, clicks15, hqAgendasEnd: game.state.corp.hq.filter(isAgenda).length,
    decked: game.state.winner === 'runner' && game.state.corp.rd.length === 0,
  };
}

const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
for (const seed of seeds) console.log(JSON.stringify(playDeal(seed)));
