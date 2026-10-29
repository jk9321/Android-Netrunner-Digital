import { GameState, cardDef, createRng, shuffleInPlace } from '../core';
import { HeuristicCorpAI } from './corpAI';
import { GameRunner } from './playout';
import { HeuristicRunnerAI } from './runnerAI';
import { pointValue } from './valueModel';
import { tuning } from './synergy';

/**
 * The Runner's reply (Jeff, 2026-10-28; plan.runnerReply): the Corp's
 * planner plays each candidate turn on through the Runner's next turn, with
 * the Runner AI standing in for the Runner, and scores the board it leaves.
 * Agenda safety and ice protection are then what the Runner's turn does to
 * them, not a guessed steal chance.
 *
 * No peeking: the Corp doesn't know the Runner's grip and stack, or the order
 * of its own R&D, so each sample redeals the Runner's grip from its unseen
 * cards (grip and stack shuffled together) and shuffles R&D, with a fresh
 * random seed for the rest of the turn.
 */
export const REPLY = {
  /** Runner turns played out per candidate. */
  samples: 2,
  /** Steps in one Runner turn (a safety net). */
  maxSteps: 300,
};

/** `state` with the cards the Corp can't see dealt at random (sample `k`). */
export function guessHidden(state: GameState, k: number): GameState {
  const rng = createRng(((state.rng?.state ?? 1) ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0);
  const unseen = shuffleInPlace(rng, [...state.runner.grip, ...state.runner.stack]);
  const grip = unseen.slice(0, state.runner.grip.length);
  const stack = unseen.slice(state.runner.grip.length);
  const rd = shuffleInPlace(rng, [...state.corp.rd]);
  return { ...state, rng: createRng(rng.state), runner: { ...state.runner, grip, stack }, corp: { ...state.corp, rd } };
}

/** Diagnostics (scripts): reply turns that began with an agenda in a remote with no ice, and how many ran it. */
export const replyStats = { nakedAgendaTurns: 0, nakedAgendaRuns: 0 };
const nakedAgendaRemotes = (s: GameState) =>
  Object.values(s.corp.servers)
    .filter(v => v.isRemote && v.ice.length === 0 && v.root.some(c => cardDef(c).type_code === 'agenda'))
    .map(v => v.id);

/**
 * Agendas left in an open remote that the sampled Runner happened not to
 * run (Jeff, 2026-10-29; plan.openSteal): counted as stolen anyway, a swing
 * of their points from the Corp's clock to the Runner's.
 */
function openAgendaLoss(state: GameState, ids: string[]): number {
  let loss = 0;
  for (const server of Object.values(state.corp.servers)) {
    for (const card of server.root) {
      if (!ids.includes(card.instanceId)) continue;
      const points = cardDef(card).agenda_points ?? 1;
      loss += pointValue(state.runner.score + points) - pointValue(state.runner.score) + pointValue(state.corp.score + points) - pointValue(state.corp.score);
    }
  }
  return loss;
}

/** Plays the Runner's next turn from the end of a Corp turn; the average of `leaf` over the samples. */
export function runnerReply(end: GameState, synergy: boolean, leaf: (state: GameState) => number): number {
  let total = 0;
  for (let k = 0; k < REPLY.samples; k++) {
    const gr = new GameRunner(guessHidden(end, k), {
      corp: new HeuristicCorpAI({ synergy, planner: false }),
      runner: new HeuristicRunnerAI({ synergy, planner: false }),
    });
    let runnerTurn = false;
    const naked = nakedAgendaRemotes(gr.state);
    const nakedAgendas = naked.flatMap(id => gr.state.corp.servers[id].root.filter(c => cardDef(c).type_code === 'agenda').map(c => c.instanceId));
    const ran = new Set<string>();
    try {
      for (let i = 0; i < REPLY.maxSteps && !gr.state.winner; i++) {
        if (!gr.step()) break;
        const s = gr.state;
        if (s.activeRun) ran.add(s.activeRun.server);
        if (s.activePlayer === 'runner') runnerTurn = true;
        else if (runnerTurn && !s.activeRun) break;
      }
    } catch {
      // A reply that breaks the engine is scored where it stopped
    }
    replyStats.nakedAgendaTurns += naked.length;
    replyStats.nakedAgendaRuns += naked.filter(id => ran.has(id)).length;
    total += leaf(gr.state) - (tuning.plan.openSteal ? openAgendaLoss(gr.state, nakedAgendas) : 0);
  }
  return total / REPLY.samples;
}
