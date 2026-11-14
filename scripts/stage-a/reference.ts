/**
 * Frozen reference copies, for the Stage A identity tables only (scripts/stage-a/*): the hold, floor and stake counts as
 * they were on beta 92f5c96, before Step 4 Stage A moved them into src/ai/corp/ (holdCost, runnerMoney, afterLineFloor
 * and centralStake from countedScore.ts; stopCost, reachablePoints and the R&D pool from rezModel.ts; runLoss from
 * corpAI.ts). Copied verbatim (afterLineFloor without its diagnostics tally). Not AI code: nothing in src/ imports this
 * file, and it is deleted with Stage B, when the owners are the only counts left to compare.
 */
import { CardInstance, GameState, cardDef, rezCostOf } from '../../src/core';
import { counters, rezCost } from '../../src/core/engine/cardEffects';
import { bypassesAhead, iceCreditNeed, runBypasses } from '../../src/ai/runs';
import { clickMoneyOf, turnIncomeOf } from '../../src/ai/cards';
import { pointGain, sideCards } from '../../src/ai/valueModel';

const isAgenda = (c: CardInstance | undefined) => (c ? cardDef(c).type_code === 'agenda' : false);
const remotes = (s: GameState) => Object.values(s.corp.servers).filter(v => v.isRemote);

export const runnerBudget = (s: GameState) => s.runner.credits + runnerMoney(s);

const hosted = (c: CardInstance) => counters(c, 'credit');

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

export function holdCost(state: GameState, ice: CardInstance[], corpCredits: number): number | null {
  const budget = runnerBudget(state);
  // The Runner's turn: its clicks back (a bioroid broken by clicks, runs.ts plainCreditNeed), one kept for the run
  const view: GameState = { ...state, runner: { ...state.runner, clicks: Math.max(0, state.runner.maxClicks - 1) } };
  const n = Math.min(ice.length, 10);
  const serverId = Object.values(state.corp.servers).find(v => v.ice.some(c => c.instanceId === ice[0]?.instanceId))?.id;
  let best: number | null = null;
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
    if (rez <= corpCredits && need > budget && (best === null || rez < best)) best = rez;
  }
  return best;
}

function rezzedSet(state: GameState, serverId: string, ice: CardInstance[], mask: number, n: number): GameState {
  const on = new Set(ice.slice(0, n).filter((c, i) => !c.isRezzed && mask & (1 << i)).map(c => c.instanceId));
  const server = state.corp.servers[serverId];
  return { ...state, corp: { ...state.corp, servers: { ...state.corp.servers, [serverId]: { ...server, ice: server.ice.map(c => (on.has(c.instanceId) ? { ...c, isRezzed: true } : c)) } } } };
}

function withIce(state: GameState, ice: CardInstance): GameState {
  const server = Object.values(state.corp.servers).find(v => v.ice.some(c => c.instanceId === ice.instanceId));
  if (!server) return state;
  return { ...state, corp: { ...state.corp, servers: { ...state.corp.servers, [server.id]: { ...server, ice: server.ice.map(c => (c.instanceId === ice.instanceId ? ice : c)) } } } };
}

export function afterLineFloor(state: GameState, agendaId: string): number {
  const ice: CardInstance[][] = [state.corp.servers.rd.ice];
  if (state.corp.hq.some(c => isAgenda(c) && c.instanceId !== agendaId)) ice.push(state.corp.servers.hq.ice);
  for (const v of remotes(state)) if (v.root.some(c => isAgenda(c) && c.instanceId !== agendaId)) ice.push(v.ice);
  let floor = 0;
  for (const set of ice) {
    const cost = holdCost(state, set, Infinity);
    if (cost !== null) floor += cost;
  }
  return floor;
}

export function centralStake(state: GameState, leaving: string): { hq: number; rd: number } {
  const score = state.runner.score;
  const hand = state.corp.hq.filter(c => c.instanceId !== leaving);
  const rd = rdAgendaOdds(state);
  return {
    hq: hand.length ? hand.filter(isAgenda).reduce((n, c) => n + pointGain(score, cardDef(c).agenda_points ?? 0), 0) / hand.length : 0,
    rd: rd.odds * pointGain(score, rd.points),
  };
}

export function stopCost(state: GameState, ice: CardInstance | null, further: boolean): number {
  const run = state.activeRun;
  const server = run ? state.corp.servers[run.server] : undefined;
  if (!run || !server || run.icePosition === null) return Infinity;
  const pos = run.icePosition;
  const base = ice ? rezCost(state, ice) : 0;
  if (base > state.corp.credits) return Infinity;
  const open = further ? server.ice.slice(0, pos).filter(c => !c.isRezzed).slice(0, 10) : [];
  let best = Infinity;
  for (let mask = 0; mask < 1 << open.length; mask++) {
    const extra = open.filter((_, i) => mask & (1 << i));
    const cost = base + extra.reduce((n, c) => n + rezCost(state, c), 0);
    if (cost > state.corp.credits || cost >= best) continue;
    const up = new Set([...(ice ? [ice.instanceId] : []), ...extra.map(c => c.instanceId)]);
    const board = withServerIce(state, server.id, server.ice.map(c => (up.has(c.instanceId) ? { ...c, isRezzed: true } : c)));
    const reach = board.corp.servers[server.id].ice.slice(0, pos + 1);
    const skipped = bypassesAhead(board, reach, true);
    const met = reach.filter(c => c.isRezzed && !skipped.has(c.instanceId));
    if (met.reduce((n, c) => n + iceCreditNeed(board, c), 0) > state.runner.credits) best = cost;
  }
  return best;
}

const withServerIce = (state: GameState, id: string, ice: CardInstance[]): GameState => ({ ...state, corp: { ...state.corp, servers: { ...state.corp.servers, [id]: { ...state.corp.servers[id], ice } } } });

export function reachablePoints(state: GameState): number {
  const run = state.activeRun;
  const server = run ? state.corp.servers[run.server] : undefined;
  if (!run || !server) return 0;
  const pts = (c: CardInstance) => cardDef(c).agenda_points ?? 0;
  const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';
  const best = (cards: CardInstance[], n: number) => cards.map(pts).sort((a, b) => b - a).slice(0, n).reduce((a, b) => a + b, 0);
  const accesses = 1 + run.extraAccesses;
  let points = server.root.filter(isAgenda).reduce((n, c) => n + pts(c), 0);
  if (server.id === 'hq') points += best(state.corp.hq.filter(isAgenda), accesses);
  else if (server.id === 'rd') points += best(rdAgendas(state), Math.min(accesses, state.corp.rd.length));
  else if (server.id === 'archives') points += [...state.corp.archives.faceUp, ...state.corp.archives.faceDown].filter(isAgenda).reduce((n, c) => n + pts(c), 0);
  return points;
}

function rdAgendas(state: GameState): CardInstance[] {
  const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';
  const known = new Set(knownElsewhere(state).filter(isAgenda).map(c => c.instanceId));
  return sideCards(state, 'corp').filter(c => isAgenda(c) && !known.has(c.instanceId));
}

const knownElsewhere = (state: GameState): CardInstance[] => [...state.corp.hq, ...Object.values(state.corp.servers).flatMap(v => v.root), ...state.corp.scoreArea, ...state.runner.scoreArea, ...state.corp.archives.faceUp, ...state.corp.archives.faceDown];

export function rdAgendaOdds(state: GameState): { odds: number; points: number } {
  const left = rdAgendas(state);
  const n = state.corp.rd.length;
  const points = left.length ? left.reduce((a, c) => a + (cardDef(c).agenda_points ?? 0), 0) / left.length : 0;
  return { odds: n > 0 ? Math.min(1, left.length / n) : 0, points };
}

export function runLoss(state: GameState): number {
  const run = state.activeRun;
  const server = run ? state.corp.servers[run.server] : undefined;
  if (!run || !server) return 0;
  const steal = (c: CardInstance) => pointGain(state.runner.score, cardDef(c).agenda_points ?? 0);
  const accesses = 1 + run.extraAccesses;
  let loss = server.root.filter(c => cardDef(c).type_code === 'agenda').reduce((n, c) => n + steal(c), 0);
  if (server.id === 'hq' && state.corp.hq.length > 0) {
    const agendas = state.corp.hq.filter(c => cardDef(c).type_code === 'agenda');
    loss += (Math.min(accesses, state.corp.hq.length) / state.corp.hq.length) * agendas.reduce((n, c) => n + steal(c), 0);
  } else if (server.id === 'rd') {
    // R&D's odds by the Corp's own list (rezModel rdAgendaOdds, R4's pool; spec-match-point-rez.md E2), not the deck-wide
    // pool the Runner prices from (agendaOdds: it can't see HQ)
    const { odds, points } = rdAgendaOdds(state);
    loss += Math.min(accesses, state.corp.rd.length) * odds * pointGain(state.runner.score, points);
  } else if (server.id === 'archives') {
    loss += state.corp.archives.faceDown.filter(c => cardDef(c).type_code === 'agenda').reduce((n, c) => n + steal(c), 0);
  }
  return loss;
}
