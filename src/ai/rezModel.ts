import { CardInstance, GameState, activePrompt, cardDef } from '../core';
import { evaluate } from './evaluate';
import { answerPrompt, simulate } from './prompts';
import { BLOCK, iceCost, iceCreditNeed } from './runs';
import { rezCost } from '../core/engine/cardEffects';
import { iceStop } from './iceValues';
import { runLoss } from './corpAI';
import { deckCount } from './effectValues';
import { sideCards } from './valueModel';
import { archivesPayoffOf } from './cards';

/**
 * plan.modelRez (structural review item 2, Jeff approved 2026-11-06): what rezzing the approached ice in a run is
 * worth to the Corp, in the value model's credits. The Corp may rez the approached ice only in the approach-ice paid
 * ability window (rules 6.4.3, 6.9.2b); ice left unrezzed is not encountered and the Runner moves past it (6.9.2c).
 *
 * The run is played out both ways and the boards compared with evaluate, Corp view, with the run over:
 *   pass: the Runner goes on to the ice further in (restOfRun: rezzed ice stops it or takes its toll, and the Corp
 *         rezzes the unrezzed ice there when that plays out better) and, if nothing stops it, gets in.
 *   rez:  the rez cost on the Corp's credit slide (a broke Corp pays more per credit, and the slide's need counts the
 *         unrezzed ice on centrals and agenda remotes, which is what agendaMoney charged), the ice's worth rezzed
 *         rather than unrezzed (iceWorth), any on-rez effect (Ping's tag); then the ice stops the run if the Runner
 *         can't pay to get past it (iceCreditNeed), or the Runner pays its toll (iceCost) and goes on in as above, poorer.
 * Getting in takes the agendas in the root (stolen), the root cards the Runner has the credits left to trash (rules
 * 7.1.5), and on HQ, R&D and Archives the agendas by the odds (runLoss).
 *
 * Comparing after the run matters: evaluate on a board mid-run counts affordable unrezzed ice as protecting an agenda
 * the Runner is about to walk past, so "before" would look safer than the run really leaves it.
 * rezToll and the old importance table fall out: breakable ice off an agenda server only earns its toll.
 *
 * Not priced (review, 2026-11-06): inner ice rezzed in the playout is flipped by hand, so its on-rez effects (Ping's
 * tag) count only for the approached ice, which goes through the engine; and both branches leave the Runner's
 * remaining clicks as they are (a stopped Runner may run again this turn).
 */
export function modelRezGain(state: GameState, ice: CardInstance, synergy: boolean): number {
  const parts = modelRezParts(state, ice, synergy);
  return parts ? parts.rez - parts.pass : -Infinity;
}

/** Both outcomes of modelRezGain, and whether the rez stops the run (undefined: the rez can't be played out). */
export function modelRezParts(state: GameState, ice: CardInstance, synergy: boolean): { pass: number; rez: number; stops: boolean } | undefined {
  const run = state.activeRun;
  if (!run || run.icePosition === null) return undefined;
  let after = simulate(state, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice.instanceId });
  for (let i = 0; after && i < 3 && activePrompt(after)?.side === 'corp'; i++) after = simulate(after, answerPrompt(after, 'corp', undefined, synergy));
  if (!after?.activeRun) return undefined;
  const rezzed = after.corp.servers[run.server]?.ice.find(c => c.instanceId === ice.instanceId);
  if (!rezzed?.isRezzed) return undefined;
  const pass = restOfRun(state, run.icePosition - 1, synergy);
  const need = iceCreditNeed(after, rezzed);
  const stops = need === BLOCK || need > after.runner.credits;
  return { pass, rez: stops ? evaluate(ended(after), 'corp') : throughIce(after, rezzed, run.icePosition, synergy), stops };
}

/**
 * The rest of the run from the ice at `position` inward (-1: the server), Corp view: rezzed ice stops a Runner that
 * can't pay to get past it (iceCreditNeed) or takes its toll; at unrezzed ice the Corp can afford, the better of
 * rezzing it and not (it will get that window too: rules 6.4.3, 6.9.2b), so a toll here can set up a stop further in.
 */
function restOfRun(state: GameState, position: number, synergy: boolean): number {
  const server = state.activeRun ? state.corp.servers[state.activeRun.server] : undefined;
  if (!server || position < 0) return gotIn(state, state.runner.credits);
  const ice = server.ice[position];
  if (!ice) return gotIn(state, state.runner.credits);
  if (!ice.isRezzed) {
    const pass = restOfRun(state, position - 1, synergy);
    const cost = rezCost(state, ice);
    if (cost > state.corp.credits) return pass;
    const rezzed = { ...ice, isRezzed: true };
    const after: GameState = {
      ...state,
      corp: { ...state.corp, credits: state.corp.credits - cost, servers: { ...state.corp.servers, [server.id]: { ...server, ice: server.ice.map((c, i) => (i === position ? rezzed : c)) } } },
    };
    return Math.max(pass, atRezzed(after, rezzed, position, synergy));
  }
  return atRezzed(state, ice, position, synergy);
}

function atRezzed(state: GameState, ice: CardInstance, position: number, synergy: boolean): number {
  const need = iceCreditNeed(state, ice);
  if (need === BLOCK || need > state.runner.credits) return evaluate(ended(state), 'corp');
  return throughIce(state, ice, position, synergy);
}

/** The Runner pays to get past this rezzed ice (in credits where it can, the rest at a credit each) and goes on in. */
function throughIce(state: GameState, ice: CardInstance, position: number, synergy: boolean): number {
  const need = iceCreditNeed(state, ice);
  const toll = Math.min(iceCost(state, ice), iceStop(state));
  const paid = Math.min(Math.max(toll, need), Math.max(0, state.runner.credits));
  const poorer: GameState = { ...state, runner: { ...state.runner, credits: state.runner.credits - paid } };
  return restOfRun(poorer, position - 1, synergy) + Math.max(0, toll - paid);
}

const ended = (state: GameState): GameState => ({ ...state, activeRun: null });

/**
 * The board after the Runner gets into the attacked server with `spare` credits for trash costs, Corp view: agendas in
 * the root stolen, the root cards it can afford trashed (cheapest first), and the central's agendas by the odds.
 */
function gotIn(state: GameState, spare: number): number {
  const server = state.activeRun ? state.corp.servers[state.activeRun.server] : undefined;
  if (!server) return evaluate(ended(state), 'corp');
  const agendas = server.root.filter(c => cardDef(c).type_code === 'agenda');
  const trashable = server.root
    .filter(c => cardDef(c).type_code !== 'agenda' && typeof cardDef(c).trash_cost === 'number')
    .sort((a, b) => (cardDef(a).trash_cost ?? 0) - (cardDef(b).trash_cost ?? 0));
  const trashed: CardInstance[] = [];
  let money = Math.max(0, spare);
  for (const card of trashable) {
    const cost = cardDef(card).trash_cost ?? 0;
    if (cost > money) break;
    money -= cost;
    trashed.push(card);
  }
  const gone = new Set([...agendas, ...trashed].map(c => c.instanceId));
  const points = agendas.reduce((n, c) => n + (cardDef(c).agenda_points ?? 0), 0);
  const after: GameState = {
    ...state,
    corp: {
      ...state.corp,
      servers: { ...state.corp.servers, [server.id]: { ...server, root: server.root.filter(c => !gone.has(c.instanceId)) } },
      archives: { ...state.corp.archives, faceUp: [...state.corp.archives.faceUp, ...trashed.map(c => ({ ...c, isRezzed: false }))] },
    },
    runner: {
      ...state.runner,
      credits: state.runner.credits - (Math.max(0, spare) - money),
      score: state.runner.score + points,
      scoreArea: [...state.runner.scoreArea, ...agendas],
    },
  };
  // runLoss on the board with the root agendas already taken: what HQ, R&D or Archives would still give up
  return evaluate(ended(after), 'corp') - runLoss(after);
}

/**
 * Counted rez (roadmap step 3, spec-step3-rez.md): a rez decision on approached ice by counting, consulted before
 * modelRezGain. 'rez', 'pass', or null (no opinion: modelRezGain decides). The Corp may rez the approached ice in the
 * approach-ice window (rules 6.4.3, 6.9.2b); ice left unrezzed is passed (6.9.2c). Uses the run's real numbers:
 *  - stops: the Runner can't pay through this ice with its credits now (iceCreditNeed, 7.1 aside), counting the rezzed
 *    ice still ahead of it, while that ice alone would not stop it (the rez is what ends the run);
 *  - toll: it can, for credits; free: it passes for no credits (no opinion: the rez costs the Runner nothing).
 * R2 an agenda in the root and the rez stops the run: rez. R3 a run on HQ with an agenda in HQ (R3s stops, R3t toll):
 * rez. R4 a run on R&D with no agenda in HQ and agendas left in R&D by the Corp's own deck list minus what it has seen
 * (never the order; R4s, R4t): rez. R5 Archives ice with no agenda in Archives and no Runner card that pays off an
 * Archives run (installed or in its deck list, CardAI archivesPayoff): don't rez. Stacked with corpAI's R6 at 10 games
 * +0.4 ± 0.7 (run 42981640841 vs 42978477338), 130 fewer central points in Corp losses; went broke +3.8 ± 1.2 and stayed
 * broke +2.1 ± 0.9, never recovered flat (292 vs 293): shipped on recovery (AI Coordinator ruling, step3-report.md).
 */
export function countedRez(state: GameState, ice: CardInstance): 'rez' | 'pass' | null {
  const run = state.activeRun;
  if (!run || run.icePosition === null) return null;
  const server = state.corp.servers[run.server];
  if (!server) return null;
  // Match point (spec-match-point-rez.md E1): a rez that stops a game-winning run is made, ahead of every other rule
  if (matchPoint(state, ice)) return 'rez';
  // R5: Archives ice with no agenda there and no Runner Archives card is not rezzed
  if (run.server === 'archives' && !archivesWantsIce(state)) return 'pass';
  const up = { ...ice, isRezzed: true };
  const view: GameState = { ...state, corp: { ...state.corp, servers: { ...state.corp.servers, [server.id]: { ...server, ice: server.ice.map(c => (c.instanceId === ice.instanceId ? up : c)) } } } };
  const need = iceCreditNeed(view, up);
  if (need === 0) return null;
  const ahead = server.ice.slice(0, run.icePosition).filter(c => c.isRezzed).reduce((n, c) => n + iceCreditNeed(view, c), 0);
  // The ice ahead stops the Runner already: this rez adds nothing the run needs
  if (ahead === BLOCK || ahead > state.runner.credits) return null;
  // The one stop count (rezStops), here with no further rezzes: this ice and the rezzed ice further in
  const stops = rezStops(state, ice, false);
  const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';
  const isStopper = stops && server.root.some(isAgenda);
  // R2: the rez stops a steal from the root on this run
  if (isStopper) return 'rez';
  const hqAgendas = state.corp.hq.filter(isAgenda).length;
  // R3 (Jeff): a run on HQ with an agenda in it, stop or toll
  if (run.server === 'hq' && hqAgendas > 0) return 'rez';
  // R4 (Jeff): a run on R&D with no agenda in HQ and agendas left in R&D by the deck list, stop or toll
  if (run.server === 'rd' && hqAgendas === 0 && agendasUnseen(state) > 0) return 'rez';
  return null;
}

/** The Runner wins with 7 or more agenda points in its score area (rules 1.7.2a). */
const WIN = 7;

/**
 * Match point (spec-match-point-rez.md E1): the Runner needs p more agenda points to win (rules 1.7.2a), the run's
 * server can give it p this run (reachablePoints), and rezzing this ice stops the run by the count: with it rezzed,
 * the rezzed ice further in, and some set of the unrezzed ice further in that the Corp can still afford after this rez
 * (it gets each of their windows: 6.4.3, 6.9.2b), the Runner's credits now can't pay through (iceCreditNeed, as
 * countedRez's stop test). Then the rez is made: the other side of it is a chance the game ends now. A rez that only
 * tolls is no opinion here.
 */
export function matchPoint(state: GameState, ice: CardInstance): boolean {
  const run = state.activeRun;
  const server = run ? state.corp.servers[run.server] : undefined;
  if (!run || !server || run.icePosition === null) return false;
  const need = WIN - state.runner.score;
  return need > 0 && reachablePoints(state) >= need && rezStops(state, ice);
}

/**
 * Rezzing this approached ice stops the run by the count: with it rezzed, the rezzed ice further in, and some set of the
 * unrezzed ice further in that the Corp can still afford after this rez, the Runner's credits now can't pay through.
 */
export function rezStops(state: GameState, ice: CardInstance, further = true): boolean {
  const run = state.activeRun;
  const server = run ? state.corp.servers[run.server] : undefined;
  if (!run || !server || run.icePosition === null) return false;
  const left = state.corp.credits - rezCost(state, ice);
  if (left < 0) return false;
  const inner = server.ice.slice(0, run.icePosition);
  const open = further ? inner.filter(c => !c.isRezzed).slice(0, 10) : [];
  for (let mask = 0; mask < 1 << open.length; mask++) {
    const extra = open.filter((_, i) => mask & (1 << i));
    if (extra.reduce((n, c) => n + rezCost(state, c), 0) > left) continue;
    const up = new Set([ice.instanceId, ...extra.map(c => c.instanceId)]);
    const board = withServerIce(state, server.id, server.ice.map(c => (up.has(c.instanceId) ? { ...c, isRezzed: true } : c)));
    const met = board.corp.servers[server.id].ice.slice(0, run.icePosition + 1).filter(c => c.isRezzed);
    if (met.reduce((n, c) => n + iceCreditNeed(board, c), 0) > state.runner.credits) return true;
  }
  return false;
}

/**
 * The most agenda points the Runner can take on this run by what the Corp knows: the root's agendas; on HQ the best
 * agendas in it, one an access; on R&D the best agendas its deck list still has there (agendasUnseen's pool, never the
 * order: 10.2.2a), one an access; on Archives every agenda in it (every card there is a candidate, facedown ones turned faceup: 7.3.2, 7.3.3).
 */
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

/** The agendas the Corp's deck list still has in R&D: the list's agendas less the ones it knows are elsewhere (as agendasUnseen). */
function rdAgendas(state: GameState): CardInstance[] {
  const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';
  const known = new Set(knownElsewhere(state).filter(isAgenda).map(c => c.instanceId));
  return sideCards(state, 'corp').filter(c => isAgenda(c) && !known.has(c.instanceId));
}

const knownElsewhere = (state: GameState): CardInstance[] => [...state.corp.hq, ...Object.values(state.corp.servers).flatMap(v => v.root), ...state.corp.scoreArea, ...state.runner.scoreArea, ...state.corp.archives.faceUp, ...state.corp.archives.faceDown];

const withServerIce = (state: GameState, id: string, ice: CardInstance[]): GameState => ({ ...state, corp: { ...state.corp, servers: { ...state.corp.servers, [id]: { ...state.corp.servers[id], ice } } } });

/**
 * The chance a card of R&D is an agenda, and those agendas' mean points, by the Corp's own list (spec E2): the agendas
 * it still has in R&D (rdAgendas, R4's pool) over R&D's size. Never R&D's order (10.2.2a). The Runner can't see HQ, so its
 * view stays the deck-wide pool (effectValues.ts agendaOdds).
 */
export function rdAgendaOdds(state: GameState): { odds: number; points: number } {
  const left = rdAgendas(state);
  const n = state.corp.rd.length;
  const points = left.length ? left.reduce((a, c) => a + (cardDef(c).agenda_points ?? 0), 0) / left.length : 2;
  return { odds: n > 0 ? Math.min(1, left.length / n) : 0, points };
}

/** Agendas the Corp's deck list still has in R&D: the list's agendas less the ones it knows are elsewhere (HQ, installed, either score area, Archives). */
export function agendasUnseen(state: GameState): number {
  return rdAgendas(state).length;
}

/** Archives is worth ice (Jeff, 2026-11-11): an agenda is in it, or the Runner's deck list has a card that pays off an Archives run (CardAI archivesPayoff). */
export function archivesWantsIce(state: GameState): boolean {
  const archives = [...state.corp.archives.faceUp, ...state.corp.archives.faceDown];
  return archives.some(c => cardDef(c).type_code === 'agenda') || deckCount(state, 'runner', c => archivesPayoffOf(c.cardCode)) > 0;
}
