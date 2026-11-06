import { CardInstance, GameState, activePrompt, cardDef } from '../core';
import { evaluate } from './evaluate';
import { answerPrompt, simulate } from './prompts';
import { BLOCK, iceCost, iceCreditNeed, iceCreditsAhead } from './runs';
import { iceStop } from './iceValues';
import { runLoss } from './corpAI';

/**
 * plan.modelRez (structural review item 2, Jeff approved 2026-11-06): what rezzing the approached ice in a run is
 * worth to the Corp, in the value model's credits. The Corp may rez the approached ice only in the approach-ice paid
 * ability window (rules 6.4.3, 6.9.2b); ice left unrezzed is not encountered and the Runner moves past it (6.9.2c).
 *
 * The run is played out both ways and the boards compared with evaluate, Corp view, with the run over:
 *   pass: the Runner gets in unless the rezzed ice further in already stops it (iceCreditsAhead against its credits).
 *   rez:  the rez cost on the Corp's credit slide (a broke Corp pays more per credit, and the slide's need counts the
 *         unrezzed ice on centrals and agenda remotes, which is what agendaMoney charged), the ice's worth rezzed
 *         rather than unrezzed (iceWorth), any on-rez effect (Ping's tag); then the ice stops the run if the Runner
 *         can't pay to get past it and the inner ice (iceCreditNeed), or the Runner pays its toll (iceCost) and gets in.
 * Getting in takes the agendas in the root (stolen), the root cards the Runner has the credits left to trash (rules
 * 7.1.5), and on HQ, R&D and Archives the agendas by the odds (runLoss).
 *
 * Comparing after the run matters: evaluate on a board mid-run counts affordable unrezzed ice as protecting an agenda
 * the Runner is about to walk past, so "before" would look safer than the run really leaves it.
 * rezToll and the old importance table fall out: breakable ice off an agenda server only earns its toll.
 */
export function modelRezGain(state: GameState, ice: CardInstance, synergy: boolean): number {
  const parts = modelRezParts(state, ice, synergy);
  return parts ? parts.rez - parts.pass : -Infinity;
}

/** Both outcomes of modelRezGain, and whether the rez stops the run (undefined: the rez can't be played out). */
export function modelRezParts(state: GameState, ice: CardInstance, synergy: boolean): { pass: number; rez: number; stops: boolean } | undefined {
  const run = state.activeRun;
  if (!run) return undefined;
  let after = simulate(state, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice.instanceId });
  for (let i = 0; after && i < 3 && activePrompt(after)?.side === 'corp'; i++) after = simulate(after, answerPrompt(after, 'corp', undefined, synergy));
  if (!after?.activeRun) return undefined;
  const rezzed = after.corp.servers[run.server]?.ice.find(c => c.instanceId === ice.instanceId);
  if (!rezzed?.isRezzed) return undefined;
  const credits = state.runner.credits;
  const inner = iceCreditsAhead(state);
  if (inner === BLOCK || inner > credits) {
    // Stopped further in either way: the rez only changes the board
    return { pass: evaluate(ended(state), 'corp', synergy), rez: evaluate(ended(after), 'corp', synergy), stops: false };
  }
  const pass = gotIn(state, credits - inner, synergy);
  const need = iceCreditNeed(after, rezzed);
  if (need === BLOCK || need + inner > credits) return { pass, rez: evaluate(ended(after), 'corp', synergy), stops: true };
  // Through: the toll is paid in credits where it can be, the rest (damage, a lost card) at a credit each
  const toll = Math.min(iceCost(after, rezzed), iceStop(after));
  const paid = Math.min(Math.max(toll, need), Math.max(0, credits - inner));
  const poorer: GameState = { ...after, runner: { ...after.runner, credits: after.runner.credits - paid } };
  return { pass, rez: gotIn(poorer, credits - inner - paid, synergy) + Math.max(0, toll - paid), stops: false };
}

const ended = (state: GameState): GameState => ({ ...state, activeRun: null });

/**
 * The board after the Runner gets into the attacked server with `spare` credits for trash costs, Corp view: agendas in
 * the root stolen, the root cards it can afford trashed (cheapest first), and the central's agendas by the odds.
 */
function gotIn(state: GameState, spare: number, synergy: boolean): number {
  const server = state.activeRun ? state.corp.servers[state.activeRun.server] : undefined;
  if (!server) return evaluate(ended(state), 'corp', synergy);
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
  return evaluate(ended(after), 'corp', synergy) - runLoss(after);
}
