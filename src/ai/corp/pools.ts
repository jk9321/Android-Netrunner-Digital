import { CardInstance, GameState, cardDef } from '../../core';
import { pointGain, sideCards } from '../valueModel';

/**
 * Owner: the Corp's view of the agenda pools, and what one access to a server stakes (Step 4 Stage A,
 * spec-step4-corp-core.md 1.6; registry row "agenda odds", the Corp pool). The Runner's view of the Corp's cards
 * (effectValues agendaOdds and the others the registry lists) is the Runner audit's, not this file's.
 *
 * Viewpoint: the Corp knows its own HQ exactly; R&D is its deck list less every card it knows is elsewhere (HQ,
 * installed, either score area, Archives). Never R&D's order and never the Runner's grip (rule 10.2.2a).
 *
 * Stage A moves today's three stake computations here unchanged (runLoss from corpAI.ts, reachablePoints and the R&D
 * pool from rezModel.ts, centralStake from countedScore.ts) and adds `corpPools` and `stake` as the one reader of them.
 * Where the three disagree (Archives: runLoss counts facedown agendas only, reachablePoints every agenda there; HQ: a
 * share of the hand against the best agendas) `stake` returns each as today, in its own field; the disagreement log is
 * scripts/stage-a/pools.ts. The game-ending steal (rule 1.7.2a) is priced as ordinary points, as today (Stage D5).
 */

const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';
const pts = (c: CardInstance) => cardDef(c).agenda_points ?? 0;

export interface CorpPools {
  /** Agendas in HQ, and their points (the Corp's own hand). */
  hq: number;
  hqPoints: number;
  /** The chance a card of R&D is an agenda by the Corp's list, and those agendas' mean points (rdAgendaOdds). */
  rdOdds: number;
  rdPoints: number;
  /** Agendas the list still has in R&D (agendasUnseen). */
  unseen: number;
}

/** The Corp's agenda pools (see the file comment). */
export function corpPools(state: GameState): CorpPools {
  const hand = state.corp.hq.filter(isAgenda);
  const rd = rdAgendaOdds(state);
  return { hq: hand.length, hqPoints: hand.reduce((n, c) => n + pts(c), 0), rdOdds: rd.odds, rdPoints: rd.points, unseen: agendasUnseen(state) };
}

export interface StakeOptions {
  /** Accesses the run gives (default the run under way's 1 + extraAccesses, else 1). */
  accesses?: number;
  /** A card leaving HQ before the access (centralStake's `leaving`: the ice being installed from HQ). */
  leaving?: string;
}

export interface Stake {
  /** The most agenda points one successful run can take (reachablePoints' count). */
  points: number;
  /** What it costs the Corp on the points clock (runLoss's count: pointGain, by the odds on HQ and R&D). */
  loss: number;
}

/** What one successful run on `server` stakes, by the Corp's own knowledge (see the file comment). */
export function stake(state: GameState, server: string, opts: StakeOptions = {}): Stake {
  const run = state.activeRun;
  const accesses = opts.accesses ?? (run && run.server === server ? 1 + run.extraAccesses : 1);
  const view = opts.leaving ? { ...state, corp: { ...state.corp, hq: state.corp.hq.filter(c => c.instanceId !== opts.leaving) } } : state;
  return { points: points(view, server, accesses), loss: loss(view, server, accesses) };
}

/**
 * The most agenda points the Runner can take on this run by what the Corp knows: the root's agendas; on HQ the best
 * agendas in it, one an access; on R&D the best agendas its deck list still has there (agendasUnseen's pool, never the
 * order: 10.2.2a), one an access; on Archives every agenda in it (every card there is a candidate, facedown ones turned faceup: 7.3.2, 7.3.3).
 */
export function reachablePoints(state: GameState): number {
  const run = state.activeRun;
  if (!run || !state.corp.servers[run.server]) return 0;
  return points(state, run.server, 1 + run.extraAccesses);
}

function points(state: GameState, id: string, accesses: number): number {
  const server = state.corp.servers[id];
  if (!server) return 0;
  const best = (cards: CardInstance[], n: number) => cards.map(pts).sort((a, b) => b - a).slice(0, n).reduce((a, b) => a + b, 0);
  let points = server.root.filter(isAgenda).reduce((n, c) => n + pts(c), 0);
  if (server.id === 'hq') points += best(state.corp.hq.filter(isAgenda), accesses);
  else if (server.id === 'rd') points += best(rdAgendas(state), Math.min(accesses, state.corp.rd.length));
  else if (server.id === 'archives') points += [...state.corp.archives.faceUp, ...state.corp.archives.faceDown].filter(isAgenda).reduce((n, c) => n + pts(c), 0);
  return points;
}

/**
 * What the Runner's run takes if it gets in, on the value model's scale: the agendas it would
 * steal (the Corp knows its own cards), each worth the points it brings the Runner closer to 7.
 */
export function runLoss(state: GameState): number {
  const run = state.activeRun;
  if (!run || !state.corp.servers[run.server]) return 0;
  return loss(state, run.server, 1 + run.extraAccesses);
}

function loss(state: GameState, id: string, accesses: number): number {
  const server = state.corp.servers[id];
  if (!server) return 0;
  const steal = (c: CardInstance) => pointGain(state.runner.score, cardDef(c).agenda_points ?? 0);
  let loss = server.root.filter(isAgenda).reduce((n, c) => n + steal(c), 0);
  if (server.id === 'hq' && state.corp.hq.length > 0) {
    const agendas = state.corp.hq.filter(isAgenda);
    loss += (Math.min(accesses, state.corp.hq.length) / state.corp.hq.length) * agendas.reduce((n, c) => n + steal(c), 0);
  } else if (server.id === 'rd') {
    // R&D's odds by the Corp's own list (rdAgendaOdds, R4's pool; spec-match-point-rez.md E2), not the deck-wide
    // pool the Runner prices from (agendaOdds: it can't see HQ)
    const { odds, points } = rdAgendaOdds(state);
    loss += Math.min(accesses, state.corp.rd.length) * odds * pointGain(state.runner.score, points);
  } else if (server.id === 'archives') {
    loss += state.corp.archives.faceDown.filter(isAgenda).reduce((n, c) => n + steal(c), 0);
  }
  return loss;
}

/**
 * The points at stake for one access to each central (centralIce's order): HQ, its agendas' pointGain over the cards left
 * in HQ once `leaving` goes (the Corp's own hand, 10.2.2a); R&D, the deck list's agendas not yet seen over R&D's cards,
 * times their average pointGain (rdAgendaOdds: the Corp's one R&D pool), never R&D's order.
 */
export function centralStake(state: GameState, leaving: string): { hq: number; rd: number } {
  const score = state.runner.score;
  const hand = state.corp.hq.filter(c => c.instanceId !== leaving);
  const rd = rdAgendaOdds(state);
  return {
    hq: hand.length ? hand.filter(isAgenda).reduce((n, c) => n + pointGain(score, cardDef(c).agenda_points ?? 0), 0) / hand.length : 0,
    rd: rd.odds * pointGain(score, rd.points),
  };
}

/** The agendas the Corp's deck list still has in R&D: the list's agendas less the ones it knows are elsewhere (as agendasUnseen). */
function rdAgendas(state: GameState): CardInstance[] {
  const known = new Set(knownElsewhere(state).filter(isAgenda).map(c => c.instanceId));
  return sideCards(state, 'corp').filter(c => isAgenda(c) && !known.has(c.instanceId));
}

const knownElsewhere = (state: GameState): CardInstance[] => [...state.corp.hq, ...Object.values(state.corp.servers).flatMap(v => v.root), ...state.corp.scoreArea, ...state.runner.scoreArea, ...state.corp.archives.faceUp, ...state.corp.archives.faceDown];

/**
 * The chance a card of R&D is an agenda, and those agendas' mean points, by the Corp's own list (spec E2): the agendas
 * it still has in R&D (rdAgendas, R4's pool) over R&D's size. Never R&D's order (10.2.2a). The Runner can't see HQ, so its
 * view stays the deck-wide pool (effectValues.ts agendaOdds).
 */
export function rdAgendaOdds(state: GameState): { odds: number; points: number } {
  const left = rdAgendas(state);
  const n = state.corp.rd.length;
  const points = left.length ? left.reduce((a, c) => a + (cardDef(c).agenda_points ?? 0), 0) / left.length : 0;
  return { odds: n > 0 ? Math.min(1, left.length / n) : 0, points };
}

/** Agendas the Corp's deck list still has in R&D: the list's agendas less the ones it knows are elsewhere (HQ, installed, either score area, Archives). */
export function agendasUnseen(state: GameState): number {
  return rdAgendas(state).length;
}
