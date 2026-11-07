import { GameState, cardDef, createRng, knownInHand, knownInRd, shuffleInPlace } from '../core';
import { HeuristicCorpAI } from './corpAI';
import { GameRunner } from './playout';
import { HeuristicRunnerAI } from './runnerAI';
import { pointValue } from './valueModel';
import { turnSeed } from './threatModel';
import { searchPiece } from './turnPlanner';
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

/**
 * R&D positions whose card the Runner knows exactly (plan.keepKnownRd; Gemini's second audit, 2026-11-05): both sides
 * saw it stay there (rules 7.4.7a), so a lookahead's re-deal leaves it in place. Without this a known agenda on top of
 * R&D became a random access in the Runner reply, and the Runner AI's memory pointed at a card no longer there.
 */
export function knownRdSlots(state: GameState): Set<number> {
  const slots = new Set<number>();
  if (!tuning.plan.keepKnownRd) return slots;
  for (const e of knownInRd(state)) if (e.lo === e.hi && state.corp.rd[e.lo]?.instanceId === e.id) slots.add(e.lo);
  return slots;
}

/** R&D shuffled except at `fixed` positions (`canonical`: the loose cards put in instance-id order first, plannerSeed). */
function shuffleRdKeeping<T extends { instanceId: string }>(rng: Parameters<typeof shuffleInPlace>[0], rd: T[], fixed: Set<number>, canonical = false): T[] {
  const rest = rd.filter((_, i) => !fixed.has(i));
  const loose = shuffleInPlace(rng, canonical ? byId(rest) : rest);
  return rd.map((c, i) => (fixed.has(i) ? c : loose.shift()!));
}

const byId = <T extends { instanceId: string }>(cards: T[]): T[] => [...cards].sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));

/**
 * `state` with the cards the Corp can't see dealt at random (sample `k`).
 *
 * plan.plannerSearch plannerSeed (structural review item 4): the seed is the game and turn's (threatModel.ts turnSeed,
 * the threat's dealer), not the end state's rng, and the cards are dealt from a fixed order (by instance id). The
 * planner's candidates end in different rng states whenever one of them drew or shuffled, so each was compared on its
 * own deal as well as its own line; now all candidates of a turn see the same guessed grip, stack and R&D order. Nothing
 * new is read: the same cards are hidden, only which guess is drawn changes.
 */
export function guessHidden(state: GameState, k: number): GameState {
  const common = searchPiece('plannerSeed');
  const rng = createRng(((common ? turnSeed(state) : state.rng?.state ?? 1) ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0);
  const order = common ? byId : <T,>(cards: T[]) => cards;
  // plan.keepKnownHand (Gemini audit, 2026-11-01): grip cards the Corp has seen (MuslihaT, Mutual Favor) stay where they are
  const known = new Set(tuning.plan.keepKnownHand ? knownInHand(state, 'runner').map(k => k.id) : []);
  const seen = state.runner.grip.filter(c => known.has(c.instanceId));
  const unseen = shuffleInPlace(rng, order([...state.runner.grip.filter(c => !known.has(c.instanceId)), ...state.runner.stack]));
  const grip = [...seen, ...unseen.slice(0, state.runner.grip.length - seen.length)];
  const stack = unseen.slice(state.runner.grip.length - seen.length);
  const rd = shuffleRdKeeping(rng, [...state.corp.rd], knownRdSlots(state), common);
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
    // (Jeff's bug report, 2026-10-31; plan.openStealUnrun) only agendas in remotes the Runner didn't run: one it ran and
    // was stopped from (The Red Room, LEO) survived the run it was counted stolen for
    const unrun = tuning.plan.openStealUnrun ? naked.filter(id => !ran.has(id)).flatMap(id => gr.state.corp.servers[id]?.root.map(c => c.instanceId) ?? []) : nakedAgendas;
    total += leaf(gr.state) - (tuning.plan.openSteal ? openAgendaLoss(gr.state, nakedAgendas.filter(id => unrun.includes(id))) : 0);
  }
  return total / REPLY.samples;
}
