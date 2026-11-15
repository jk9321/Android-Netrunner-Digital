import { CardInstance, GameState, activePrompt, cardDef } from '../core';
import { evaluate } from './evaluate';
import { answerPrompt, simulate } from './prompts';
import { BLOCK, bypassesAhead, iceCost, iceCreditNeed } from './runs';
import { rezCost } from '../core/engine/cardEffects';
import { iceStop } from './iceValues';
import { runLoss } from './corp/pools';

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
  if (runBypassed(after, rezzed)) return { pass, rez: restOfRun(after, run.icePosition - 1, synergy), stops: false };
  const need = iceCreditNeed(after, rezzed);
  const stops = need === BLOCK || need > after.runner.credits;
  return { pass, rez: stops ? evaluate(ended(after), 'corp') : throughIce(after, rezzed, run.icePosition, synergy), stops };
}

/**
 * The approached ice, rezzed in this state, is one the declared run bypasses (S-Dobrado's event, Alarm
 * Clock, the rig's bypass cards and their counters: all public, runs.ts bypassesAhead; 6.5.8a). Part A of spec
 * jeff-games-48-50, folded 2026-11-13 (plan.bypassHold).
 */
export function runBypassed(state: GameState, ice: CardInstance): boolean {
  const run = state.activeRun;
  if (!run || run.icePosition === null) return false;
  return bypassesAhead(state, state.corp.servers[run.server].ice.slice(0, run.icePosition + 1), true).has(ice.instanceId);
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
