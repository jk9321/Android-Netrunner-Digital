import { GameAction, GameState, SideCode, activePrompt, executeAction } from '../core';
import { ScoredAction } from './agent';
import { evaluate } from './evaluate';
import { freezeKnownHand } from './handValues';
import { runClick } from './runs';
import { tuning } from './synergy';

/**
 * The whole-turn planner for Normal (Jeff, 2026-10-28; plan.turnPlanner).
 * One action at a time can't price a hand or a click: the worth of a click
 * is what the rest of the turn does with it. So for each main-phase action,
 * the planner plays the AI's few best candidates through to the end of the
 * turn (the rest chosen by the rule-based AI, one step at a time) and picks
 * the candidate whose turn ends best. At the end of the turn the clicks are
 * gone and the hand is worth what each card will do on a later turn
 * (plan.plannerHand: the cards-in-hand values of handValues.ts).
 *
 * It never peeks: a card drawn in a playout stays unseen (worth the deck
 * average), and a run is not played out (that would reveal R&D, HQ and
 * facedown cards). A run in a playout spends its click and adds the run's
 * expected worth (runScore), once a playout.
 */

export const PLANNER = {
  /** Candidates played out to the end of the turn. */
  candidates: 4,
  /** Steps in one playout (a safety net: a turn has at most 4 clicks and a few free actions). */
  maxSteps: 12,
};

export interface PlannerAI {
  /** Main-phase actions, best first (the rule-based ranking). */
  rank(state: GameState): ScoredAction[];
  /** Any other decision in a playout (a prompt an operation raises). */
  answer(state: GameState): GameAction;
  /** A run's expected worth before it starts (runScore), or undefined for the Corp. */
  runWorth?(state: GameState, serverId: string): number;
  /** The opponent's next turn played out from the end of this one, scored by `leaf` (plan.runnerReply, Corp). */
  reply?(state: GameState, leaf: (state: GameState) => number): number;
}

export const plannerOn = (side: SideCode): boolean => !!tuning.plan.turnPlanner?.[side];

const clicksOf = (state: GameState, side: SideCode) => (side === 'corp' ? state.corp.clicks : state.runner.clicks);

/** A playout's main-phase actions after the first, each with the position it was chosen in. */
type Line = { key: string; action: GameAction }[];

/** A position as the planner tells them apart: the turn, clicks, credits and the cards in hand and play. */
function positionKey(state: GameState, side: SideCode): string {
  const p = side === 'corp' ? state.corp : state.runner;
  const hand = side === 'corp' ? state.corp.hq : state.runner.grip;
  const board =
    side === 'corp'
      ? Object.values(state.corp.servers).map(s => s.id + ':' + [...s.ice, ...s.root].map(c => c.instanceId + (c.isRezzed ? 'r' : '') + (c.advancementCounters ?? 0)).join(','))
      : [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources].map(c => c.instanceId);
  return `${state.id}|${state.turnNumber}|${p.clicks}|${p.credits}|${hand.map(c => c.instanceId).join(',')}|${board.join(';')}|${state.corp.score}|${state.runner.score}`;
}

/** The rest of the last plan, by side: followed while the game goes as the plan expected. */
const lastPlan: Record<SideCode, Line> = { corp: [], runner: [] };

/** Plays `side`'s turn on from `state` after `first`, and returns how good the end of the turn is. */
function playout(start: GameState, side: SideCode, first: GameAction, ai: PlannerAI, synergy: boolean, line: Line = []): number {
  let bonus = 0;
  let ran = false;
  const step = (state: GameState, action: GameAction): GameState | null => {
    if (action.type === 'INITIATE_RUN') {
      // Not played out: the run's click spent, its expected worth (net of its credits) added
      if (ran || !ai.runWorth) return null;
      ran = true;
      const worth = ai.runWorth(state, action.targetServerId);
      if (!Number.isFinite(worth)) return null;
      bonus += worth + runClick(state); // runScore charges the click; here the click is the plan's
      return { ...state, runner: { ...state.runner, clicks: state.runner.clicks - 1 } };
    }
    try {
      return executeAction(state, action);
    } catch {
      return null;
    }
  };
  let state = step(start, first);
  if (!state) return -Infinity;
  for (let i = 0; i < PLANNER.maxSteps && !state.winner; i++) {
    if (state.activePlayer !== side || state.activeRun) break;
    if (activePrompt(state)) {
      let answer: GameAction | undefined;
      try {
        answer = ai.answer(state);
      } catch {
        break;
      }
      if (!answer) break;
      const next = step(state, answer);
      if (!next) break;
      state = next;
      continue;
    }
    if (clicksOf(state, side) <= 0) break;
    const best = ai.rank(state).find(r => r.score > -Infinity && r.action.type !== 'END_TURN' && !(ran && r.action.type === 'INITIATE_RUN'));
    if (!best) break;
    if (!ran) line.push({ key: positionKey(state, side), action: best.action }); // after a run the position can't be foreseen
    const next = step(state, best.action);
    if (!next) break;
    state = next;
  }
  const leaf = (s: GameState) => leafValue(s, side, synergy);
  return (ai.reply && !state.winner ? ai.reply(state, leaf) : leaf(state)) + bonus;
}

/** The end of the turn: hand by what each card will do later (plan.plannerHand), clicks as the model prices them. */
function leafValue(state: GameState, side: SideCode, synergy: boolean): number {
  if (!tuning.plan.plannerHand) return evaluate(state, side, synergy);
  const saved = tuning.plan.handByCard;
  tuning.plan.handByCard = { ...saved, [side]: true };
  try {
    return evaluate(state, side, synergy);
  } finally {
    tuning.plan.handByCard = saved;
  }
}

/**
 * The planner's pick among the rule-based AI's best candidates (`ranked`,
 * best first): the one whose turn ends best. Falls back to the favourite.
 */
export function planTurn(state: GameState, side: SideCode, ranked: ScoredAction[], ai: PlannerAI, synergy: boolean): GameAction | null {
  // Still on the last plan: its next step, if the rule-based AI still rates it
  const key = positionKey(state, side);
  const next = lastPlan[side][0];
  if (next && next.key === key && ranked.some(r => r.score > -Infinity && sameAction(r.action, next.action))) {
    lastPlan[side].shift();
    return next.action;
  }
  lastPlan[side] = [];
  const candidates = ranked.filter(r => r.score > -Infinity && r.action.type !== 'END_TURN' && r.action.type !== 'START_TURN').slice(0, PLANNER.candidates);
  if (candidates.length <= 1 || clicksOf(state, side) <= 0) return null;
  const unfreeze = freezeKnownHand();
  try {
    let best: { action: GameAction; value: number; line: Line } | null = null;
    for (const c of candidates) {
      const line: Line = [];
      const value = playout(state, side, c.action, ai, synergy, line);
      if (!best || value > best.value) best = { action: c.action, value, line };
    }
    if (!best || best.value === -Infinity) return null;
    lastPlan[side] = best.line;
    return best.action;
  } finally {
    unfreeze();
  }
}

const sameAction = (a: GameAction, b: GameAction): boolean => JSON.stringify(a) === JSON.stringify(b);
