import { GameAction, GameState, SideCode, activePrompt, cardDef, executeAction, findCardAnywhere, maxHandSize } from '../core';
import { profileOf } from './cardProfiles';
import { ScoredAction } from './agent';
import { evaluate } from './evaluate';
import { runClick } from './runs';
import { threat, turnSeed } from './threatModel';
import { plan, pricing, withPricing } from './pricing';
import { REPLY, runnerReply, sampledReply } from './runnerReply';

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
  /** plan.plannerSearch plannerBuild: the candidate set with the two-step builds added, at most (Hard's time). */
  withBuild: 6,
};

/** Diagnostics (scripts): plannerBuild's added candidates, how often one was played out and how often it won. */
export const plannerStats: { decisions: number; withAdded: number; added: number; addedWins: number; onAddedWin?: (state: GameState, action: GameAction) => void; onCandidates?: (side: SideCode, values: number[], actions: GameAction[]) => void } = { decisions: 0, withAdded: 0, added: 0, addedWins: 0 };

export interface PlannerAI {
  /** Main-phase actions, best first (the rule-based ranking). */
  rank(state: GameState): ScoredAction[];
  /** Any other decision in a playout (a prompt an operation raises). */
  answer(state: GameState): GameAction;
  /** A run's expected worth before it starts (runScore), or undefined for the Corp. */
  runWorth?(state: GameState, serverId: string, sourceCode?: string): number;
  /** Credits that run is expected to spend getting in (plan.plannerRunCredits). */
  runCredits?(state: GameState, serverId: string, sourceCode?: string): number;
  /** The opponent's next turn played out from the end of this one, scored by `leaf` (plan.runnerReply, Corp). */
  reply?(state: GameState, leaf: (state: GameState) => number): number;
  /** The rest of this AI's last plan (one per agent, so a new game or a reloaded one starts without it). */
  memory?: PlanMemory;
}

/** The rest of the last plan: followed while the game goes as the plan expected. */
export interface PlanMemory {
  line: Line;
}

export const plannerOn = (side: SideCode): boolean => !!plan().turnPlanner?.[side];

/**
 * plannerSeed: the seed of the decision being planned (game, turn and clicks left: threatModel.ts turnSeed mixed with
 * the clicks), or null outside one. Every candidate of one decision is dealt from it, so they see the same deals; the
 * next decision of the turn gets a fresh one (Fable review, 2026-11-07: a seed per turn made one bad deal steer every
 * decision of the turn, stuck in HQ +3.5 per 100).
 */
export const currentDecisionSeed = (): number | null => pricing().decisionSeed;

/** A piece of the widened search (structural review item 4), on only with plan.plannerSearch. */
export const searchPiece = (piece: 'plannerSeed' | 'plannerBuild' | 'plannerDiscard' | 'plannerPatchesOff'): boolean => !!plan().plannerSearch && plan()[piece] !== false;

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

/** Plans of AIs that keep none of their own (tests). */
const sharedPlan: Record<SideCode, PlanMemory> = { corp: { line: [] }, runner: { line: [] } };

/**
 * A click for 1 credit while a click takes more from a money card (Regolith Mining License, Telework Contract):
 * the same click for fewer credits. The planner tries each first action and plays the rest out with the
 * rule-based ranking, so it could pick the basic click just to steer the rest of the turn (Jeff, 2026-10-30).
 */
function dominated(state: GameState, action: GameAction, ranked: ScoredAction[], side: SideCode): boolean {
  if (action.type !== 'GAIN_CREDIT') return false;
  // plan.plannerSearch plannerPatchesOff (item 4): the search decides between the click and the money card
  if (searchPiece('plannerPatchesOff')) return false;
  // plan.oneCurrency: the Corp's ranking and the planner's leaf price the click the same way, so no override (item 1)
  if (side === 'corp' && plan().oneCurrency) return false;
  return ranked.some(r => {
    if (r.score === -Infinity || r.action.type !== 'USE_ABILITY' || r.action.abilityIndex !== 0) return false;
    const card = findCardAnywhere(state, r.action.cardInstanceId);
    const profile = card && profileOf(card.cardCode);
    return !!profile && profile.every === 'click' && profile.pay > 1 && (card.tokens.credit ?? 0) > 1;
  });
}

/** Plays `side`'s turn on from `state` after `first`, and returns how good the end of the turn is. */
function playout(start: GameState, side: SideCode, first: GameAction, ai: PlannerAI, synergy: boolean, line: Line = [], ends?: { state?: GameState; bonus?: number }): number {
  let bonus = 0;
  let ran = false;
  /** The position before the last main-phase action, and the card it used: where a run event's run is priced from. */
  let mainBefore = start;
  let mainCard: string | undefined;
  const cardOf = (state: GameState, action: GameAction) => ('cardInstanceId' in action && action.cardInstanceId ? findCardAnywhere(state, action.cardInstanceId)?.cardCode : undefined);
  /**
   * plan.plannerRunEvents (Jeff, 2026-11-05, thread "Find why AI card valuation misses cards"): a run a card starts
   * (Tailgate, Kompromat, Clean Getaway, Red Team) is priced like a plain run, with the card's riders, instead of
   * ending the playout at the run's start with the card's cost paid and nothing for the run. The planner picked the
   * plain run over every run event for that reason: in self-play run events were held on most turns.
   */
  const runStarted = (after: GameState): GameState | null => {
    if (ran || !ai.runWorth || !after.activeRun) return null;
    ran = true;
    const worth = ai.runWorth(mainBefore, after.activeRun.server, mainCard);
    if (!Number.isFinite(worth)) return null;
    // runScore charges the run's clicks (one, and any the card's own options count); here they are the plan's
    const clicks = Math.max(1, clicksOf(mainBefore, 'runner') - clicksOf(after, 'runner'));
    bonus += worth + clicks * runClick(mainBefore);
    // plan.plannerRunCredits (Gemini's second audit): the rest of the turn can't spend what the run will
    const spent = ai.runCredits ? ai.runCredits(after, after.activeRun.server, mainCard) : 0;
    return { ...after, activeRun: null, pendingPrompts: [], runner: { ...after.runner, credits: Math.max(0, after.runner.credits - spent) } };
  };
  const step = (state: GameState, action: GameAction): GameState | null => {
    if (action.type === 'INITIATE_RUN') {
      // Not played out: the run's click spent, its expected worth (net of its credits) added
      if (ran || !ai.runWorth) return null;
      ran = true;
      const worth = ai.runWorth(state, action.targetServerId);
      if (!Number.isFinite(worth)) return null;
      bonus += worth + runClick(state); // runScore charges the click; here the click is the plan's
      // plan.plannerRunCredits (Gemini's second audit, 2026-11-05): the run's credits are gone for the rest of the turn
      // (runScore already charged them; the playout kept them, so a run then a 5-credit install looked affordable on 6)
      const spent = ai.runCredits ? ai.runCredits(state, action.targetServerId) : 0;
      return { ...state, runner: { ...state.runner, clicks: state.runner.clicks - 1, credits: Math.max(0, state.runner.credits - spent) } };
    }
    if (!activePrompt(state)) {
      mainBefore = state;
      mainCard = cardOf(state, action);
    }
    try {
      const after = executeAction(state, action);
      if (side === 'runner' && !state.activeRun && after.activeRun) return runStarted(after);
      return after;
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
    // Out of clicks, the turn can still score an agenda the last click finished: scoring costs no click (rule 7.1.1;
    // Jeff's bug report, 2026-10-31: Petty Cash first, then two advances, looked like leaving the agenda for the Runner)
    const outOfClicks = clicksOf(state, side) <= 0;
    if (outOfClicks && !(side === 'corp')) break;
    const now = state;
    const ranked = ai.rank(now);
    const best = ranked.find(r => r.score > -Infinity && r.action.type !== 'END_TURN' && (!outOfClicks || r.action.type === 'SCORE_AGENDA') && !(ran && r.action.type === 'INITIATE_RUN') && !dominated(now, r.action, ranked, side));
    if (!best) break;
    if (!ran) line.push({ key: positionKey(state, side), action: best.action }); // after a run the position can't be foreseen
    const next = step(state, best.action);
    if (!next) break;
    state = next;
  }
  if (searchPiece('plannerDiscard') && !state.winner) state = discardStep(state, side, ai);
  const leaf = (s: GameState) => leafValue(s, side, synergy);
  if (ends) {
    ends.state = state;
    ends.bonus = bonus;
  }
  return (ai.reply && !state.winner ? ai.reply(state, leaf) : leaf(state)) + bonus;
}

/**
 * plan.plannerSearch plannerDiscard (structural review item 4): a playout that has spent its clicks over its maximum
 * hand size plays the discard step before it is scored, so a line that draws past the limit is not scored with the
 * extra cards still in hand. The engine plays it (END_TURN, then the discard prompt answered by the AI's own discard
 * choice: rules 5.6.3a for the Corp, 5.7.2a for the Runner); the leaf takes the hand and the discard pile from it and
 * keeps the rest of the end-of-action-phase position, because the engine hands the turn over once the window after
 * discarding (5.6.3b, 5.7.2b) closes, and every candidate must be scored at the same point of the turn.
 * Under the limit, or with clicks left, the end state is left as it is.
 */
export function discardStep(state: GameState, side: SideCode, ai: PlannerAI): GameState {
  if (state.activePlayer !== side || state.activeRun || activePrompt(state) || state.turnStep || clicksOf(state, side) > 0) return state;
  const hand = side === 'corp' ? state.corp.hq.length : state.runner.grip.length;
  if (hand <= Math.max(0, maxHandSize(state, side))) return state;
  try {
    let next = executeAction(state, { type: 'END_TURN', player: side } as GameAction);
    for (let i = 0; i < 8 && !next.winner; i++) {
      const prompt = activePrompt(next);
      if (!prompt || prompt.kind !== 'discard' || prompt.side !== side) break;
      next = executeAction(next, ai.answer(next));
    }
    if (next.winner) return next;
    return side === 'corp'
      ? { ...state, corp: { ...state.corp, hq: next.corp.hq, archives: next.corp.archives } }
      : { ...state, runner: { ...state.runner, grip: next.runner.grip, heap: next.runner.heap } };
  } catch {
    return state;
  }
}

/**
 * plan.plannerAgenda (install-worth side check, probe P3, AI Coordinator 2026-11-08): the agenda moves the rule ranking
 * puts outside the planner's top few, added as candidates (not scored higher; the playout and the leaf decide). The
 * one-step score charges an installed agenda its whole steal and advancement cost at once (Jeff's agenda installs: median
 * -2.37, p25 -13.4), so at report-17 turn 2 Offworld Office into remote-1 was never played out though its line beat the
 * AI's pick. Added: the best-ranked agenda install into an existing empty remote with ice, and the best-ranked advance on an
 * installed agenda. Rules: installed agendas can always be advanced (1.18.1, 1.18.3; basic action 5.2.6a) and are
 * scored once their counters reach the advancement requirement (1.17.3a).
 */
export function agendaCandidates(state: GameState, ranked: ScoredAction[], chosen: ScoredAction[]): ScoredAction[] {
  const taken = new Set(chosen.map(r => JSON.stringify(r.action)));
  const agenda = (r: ScoredAction) => {
    const id = 'cardInstanceId' in r.action ? r.action.cardInstanceId : undefined;
    const card = id ? findCardAnywhere(state, id) : undefined;
    return !!card && cardDef(card).type_code === 'agenda';
  };
  const added: ScoredAction[] = [];
  const pick = (test: (r: ScoredAction) => boolean) => {
    const found = ranked.find(r => r.score > -Infinity && !taken.has(JSON.stringify(r.action)) && agenda(r) && test(r));
    if (found) {
      added.push(found);
      taken.add(JSON.stringify(found.action));
    }
  };
  pick(r => {
    if (r.action.type !== 'INSTALL_CARD' || r.action.asNewRemote || !r.action.targetServerId) return false;
    const server = state.corp.servers[r.action.targetServerId];
    // Into an empty remote only: an agenda installed over an asset or agenda trashes it (rule 8.5.6a), as buildCandidates
    return !!server?.isRemote && server.ice.length > 0 && server.root.length === 0;
  });
  pick(r => r.action.type === 'ADVANCE_CARD');
  return added;
}

/**
 * plan.plannerSearch plannerBuild (structural review item 4): the Corp's two-step builds the rule ranking can't see,
 * added as candidates (not scored higher; the playout and the leaf decide): the best-ranked ice install into a new
 * remote, or a remote with nothing in it yet, while HQ holds an agenda or an asset that would go behind it; and the
 * best-ranked ice install on a central the threat expects the Runner to run. Only the Corp's own legal actions, as the
 * engine listed them (ranked); nothing of the Runner's is read but the threat, which reads the Runner's view.
 */
export function buildCandidates(state: GameState, ranked: ScoredAction[], chosen: ScoredAction[]): ScoredAction[] {
  const hq = state.corp.hq;
  const iceInstall = (r: ScoredAction) => {
    if (r.score === -Infinity || r.action.type !== 'INSTALL_CARD') return null;
    const id = r.action.cardInstanceId;
    const card = hq.find(c => c.instanceId === id);
    return card && cardDef(card).type_code === 'ice' ? card : null;
  };
  const rootCard = (exclude: string) => hq.some(c => c.instanceId !== exclude && ['agenda', 'asset'].includes(cardDef(c).type_code ?? ''));
  const taken = new Set(chosen.map(r => JSON.stringify(r.action)));
  const added: ScoredAction[] = [];
  const pick = (test: (r: ScoredAction & { action: { type: 'INSTALL_CARD' } }) => boolean) => {
    const found = ranked.find(r => {
      const ice = iceInstall(r);
      return !!ice && r.action.type === 'INSTALL_CARD' && !taken.has(JSON.stringify(r.action)) && test(r as ScoredAction & { action: { type: 'INSTALL_CARD' } });
    });
    if (found) {
      added.push(found);
      taken.add(JSON.stringify(found.action));
    }
  };
  pick(r => {
    const a = r.action;
    if (!rootCard(a.cardInstanceId)) return false;
    if (a.asNewRemote) return true;
    const server = a.targetServerId ? state.corp.servers[a.targetServerId] : undefined;
    return !!server?.isRemote && server.root.length === 0;
  });
  let runs: Record<string, { run: number }> | null = null;
  pick(r => {
    const id = r.action.targetServerId;
    if (r.action.asNewRemote || (id !== 'hq' && id !== 'rd' && id !== 'archives')) return false;
    runs ??= threat(state).servers;
    return (runs[id]?.run ?? 0) >= 0.5;
  });
  return added;
}

/** The end of the turn: hand by what each card will do later (plan.plannerHand), clicks as the model prices them. */
function leafValue(state: GameState, side: SideCode, synergy: boolean): number {
  // plan.oneCurrency: the Corp's line ends on the same evaluate its actions are ranked by (HQ by count, its seen agendas
  // at heldAgendasWorth): a hand priced card by card here made the leaf a second currency (Petty Cash first ranked +2.8
  // and lost the line to an install, its card worth in HQ counted against playing it)
  if ((side === 'corp' && synergy && plan().oneCurrency)) return evaluate(state, side);
  return withPricing({ leaves: [...pricing().leaves, { side, plan: plan() }] }, () => evaluate(state, side));
}

/**
 * The planner's pick among the rule-based AI's best candidates (`ranked`,
 * best first): the one whose turn ends best. Falls back to the favourite.
 */
export function planTurn(state: GameState, side: SideCode, ranked: ScoredAction[], ai: PlannerAI, synergy: boolean): GameAction | null {
  // Still on the last plan: its next step, if the rule-based AI still rates it
  const key = positionKey(state, side);
  const memory = ai.memory ?? sharedPlan[side];
  const next = memory.line[0];
  if (next && next.key === key && ranked.some(r => r.score > -Infinity && sameAction(r.action, next.action))) {
    memory.line.shift();
    return next.action;
  }
  memory.line = [];
  const candidates = ranked.filter(r => r.score > -Infinity && r.action.type !== 'END_TURN' && r.action.type !== 'START_TURN' && !dominated(state, r.action, ranked, side)).slice(0, PLANNER.candidates);
  const added = side === 'corp' && searchPiece('plannerBuild') ? buildCandidates(state, ranked, candidates).slice(0, Math.max(0, PLANNER.withBuild - candidates.length)) : [];
  candidates.push(...added);
  if (side === 'corp' && plan().plannerAgenda) candidates.push(...agendaCandidates(state, ranked, candidates).slice(0, Math.max(0, PLANNER.withBuild + 2 - candidates.length)));
  if (candidates.length <= 1 || clicksOf(state, side) <= 0) return null;
  plannerStats.decisions++;
  if (added.length) {
    plannerStats.withAdded++;
    plannerStats.added += added.length;
  }
  // The hands stay as seen when the decision started (frozen); plan.plannerSeed: one seed for every playout of this decision
  const decisionSeed = searchPiece('plannerSeed') ? (turnSeed(state) ^ Math.imul(clicksOf(state, side) + 1, 0x85ebca6b)) >>> 0 : pricing().decisionSeed;
  return withPricing({ frozen: true, decisionSeed }, () => {
    let best: { action: GameAction; value: number; line: Line } | null = null;
    const values: number[] = [];
    const scored: { action: GameAction; value: number; line: Line; ends: { state?: GameState; bonus?: number } }[] = [];
    for (const c of candidates) {
      const line: Line = [];
      const ends: { state?: GameState; bonus?: number } = {};
      const value = playout(state, side, c.action, ai, synergy, line, ends);
      values.push(value);
      scored.push({ action: c.action, value, line, ends });
      if (!best || value > best.value) best = { action: c.action, value, line };
    }
    if (side === 'corp' && plan().replyContenders && ai.reply && sampledReply()) best = contenders(scored, side, synergy) ?? best;
    plannerStats.onCandidates?.(side, values, candidates.map(c => c.action));
    if (!best || best.value === -Infinity) return null;
    if (added.some(a => a.action === best!.action)) {
      plannerStats.addedWins++;
      plannerStats.onAddedWin?.(state, best.action);
    }
    memory.line = best.line;
    return best.action;
  });
}

/**
 * plan.replyContenders (install-worth side check, probe P2, AI Coordinator addendum 2026-11-08): the two-sample Runner
 * reply decided 3-4 of 10 of Jeff's positions, one losing sample (-1000) throwing a line out on its own. So the best two
 * candidates, after every candidate is scored on REPLY.samples, get REPLY.extra more samples each (the same new deals for
 * both: samples REPLY.samples .. REPLY.samples + REPLY.extra - 1) and the better mean over all of them is the pick, when the two are closer than
 * REPLY.contendGap (a wider gap is left to the first samples).
 */
function contenders<T extends { action: GameAction; value: number; line: Line; ends: { state?: GameState; bonus?: number } }>(scored: T[], side: SideCode, synergy: boolean): T | null {
  const live = scored.filter(r => Number.isFinite(r.value) && r.ends.state && !r.ends.state.winner).sort((a, b) => b.value - a.value);
  if (live.length < 2 || live[0].value - live[1].value >= REPLY.contendGap) return null;
  const leaf = (s: GameState) => leafValue(s, side, synergy);
  const top = live.slice(0, 2).map(r => {
    const bonus = r.ends.bonus ?? 0;
    const extra = runnerReply(r.ends.state!, synergy, leaf, { from: REPLY.samples, count: REPLY.extra });
    return { ...r, value: (REPLY.samples * (r.value - bonus) + REPLY.extra * extra) / (REPLY.samples + REPLY.extra) + bonus };
  });
  // A candidate outside the two (a won game, or one the extra samples can't change) keeps its value
  const rest = scored.filter(r => !top.some(t => t.action === r.action));
  return [...top, ...rest].reduce((a, b) => (b.value > a.value ? b : a));
}

const sameAction = (a: GameAction, b: GameAction): boolean => JSON.stringify(a) === JSON.stringify(b);
