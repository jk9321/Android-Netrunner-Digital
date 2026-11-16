import { GameAction, GameState, SideCode, activePrompt, cardDef, executeAction, findCardAnywhere, maxHandSize } from '../core';
import { profileOf } from './cardProfiles';
import { ScoredAction } from './agent';
import { evaluate } from './evaluate';
import { RunnerMemory, runClick } from './runs';
import { turnSeed } from './threatModel';
import { plan, pricing, withPricing } from './pricing';
import { note, tally } from './diagnostics';
import { REPLY, guessHidden, guessRunnerView, runnerReply, sampledReply } from './runnerReply';
import { plannerCandidates, replySamples } from './oracle';
import { fingerprint } from './valueModel';

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

/**
 * How a playout continues after its first action. 'rule': the rule-based ranking's best each step. 'hold'
 * (spec-search S1, measurement only): the same, but no agenda is installed from HQ this turn. 'finish' (spec-search S1): an agenda
 * score (rule 7.1.1, 1.17.3a) and then an advance on an installed agenda (rules 1.18.1, 5.2.6a) are taken before
 * anything else the ranking allows, the rule ranking for the rest.
 */
export type LineMode = 'rule' | 'hold' | 'finish';

/** One continuation of a candidate: its value (null: the first action failed) and whether its line differs from the rule line. */
export interface SearchLine { mode: LineMode; value: number | null; distinct: boolean }

/** Spec-search S1: one Corp planner decision, the candidate the planner picked and every candidate's continuations. */
export interface SearchRow {
  /** 'installed': an agenda installed and unscored; 'hq': agenda(s) in HQ only; 'neither' */
  kind: 'installed' | 'hq' | 'neither';
  /** state.turnNumber (one a round: the Corp turn number) */
  turn: number;
  clicks: number;
  credits: number;
  /** The pick's value as the planner scored it, and the pick's index in `candidates` */
  chosen: number;
  pick: number;
  candidates: { type: string; agenda: boolean; lines: SearchLine[]; resample: number | null }[];
  /** Time of the decision as played (playouts and their replies), and the replies' share of it */
  ms: number;
  replyMs: number;
  /** Time of the measurement's extra lines (not part of play) */
  extraMs: number;
}

/** Time spent in the Runner reply (ms, process total): S1's time split. */
export const searchClock = { replyMs: 0 };

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
  /** The cards the deciding Runner has accessed (runnerDecisionView keeps them as seen; ai-honest-runner-view). */
  known?: RunnerMemory;
  /**
   * The Corp's candidates the planner plays out (Step 4 Stage C3), from the order (corp/candidates.ts plannerIntake,
   * passed in by corpAI.ts so that this file reads no Corp owner). Without it (the Runner): its ranking's first few.
   */
  intake?(open: ScoredAction[], k: number): { picked: ScoredAction[]; slots: Map<ScoredAction, 'agenda' | 'build'> };
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
export const searchPiece = (piece: 'plannerSeed' | 'plannerDiscard'): boolean => !!plan().plannerSearch && plan()[piece] !== false;

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
function dominated(state: GameState, action: GameAction, ranked: ScoredAction[]): boolean {
  if (action.type !== 'GAIN_CREDIT') return false;
  return ranked.some(r => {
    if (r.score === -Infinity || r.action.type !== 'USE_ABILITY' || r.action.abilityIndex !== 0) return false;
    const card = findCardAnywhere(state, r.action.cardInstanceId);
    const profile = card && profileOf(card.cardCode);
    return !!profile && profile.every === 'click' && profile.pay > 1 && (card.tokens.credit ?? 0) > 1;
  });
}

/** Where a playout ended (the reply is sampled from it) and what it added on the way; installedAgenda: its continuation installed an agenda. */
type Ends = { state?: GameState; bonus?: number; installedAgenda?: boolean };

/** An agenda from HQ installed (rule 8.5.6: into a remote root). */
const agendaInstall = (state: GameState, action: GameAction): boolean =>
  action.type === 'INSTALL_CARD' && state.corp.hq.some(c => c.instanceId === action.cardInstanceId && cardDef(c).type_code === 'agenda');

/** An installed agenda's id, when `action` advances one (rules 1.18.1, 5.2.6a). */
const advancesAgenda = (state: GameState, action: GameAction): boolean => {
  if (action.type !== 'ADVANCE_CARD') return false;
  const card = findCardAnywhere(state, action.cardInstanceId);
  return !!card && cardDef(card).type_code === 'agenda';
};

/** The first action the 'finish' line takes, if any: a score, else an advance on an installed agenda, best-ranked first. */
function finishStep(state: GameState, ranked: ScoredAction[]): ScoredAction | undefined {
  const open = ranked.filter(r => r.score > -Infinity);
  return open.find(r => r.action.type === 'SCORE_AGENDA') ?? open.find(r => advancesAgenda(state, r.action));
}

/**
 * Plays `side`'s turn on from `state` after `first`, and returns how good the end of the turn is. `mode` (LineMode):
 * how the continuation picks its actions ('hold': it installs no agenda from HQ this turn).
 */
function playout(start: GameState, side: SideCode, first: GameAction, ai: PlannerAI, line: Line = [], ends?: Ends, mode: LineMode = 'rule'): number {
  const hold = mode === 'hold';
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
    const ruled = ranked.find(r => r.score > -Infinity && r.action.type !== 'END_TURN' && (!outOfClicks || r.action.type === 'SCORE_AGENDA') && !(ran && r.action.type === 'INITIATE_RUN') && !dominated(now, r.action, ranked) && !(hold && agendaInstall(now, r.action)));
    const finish = mode === 'finish' && side === 'corp' ? finishStep(now, ranked) : undefined;
    const best = finish && (!outOfClicks || finish.action.type === 'SCORE_AGENDA') ? finish : ruled;
    if (!best) break;
    if (ends && agendaInstall(now, best.action)) ends.installedAgenda = true;
    if (!ran) line.push({ key: positionKey(state, side), action: best.action }); // after a run the position can't be foreseen
    const next = step(state, best.action);
    if (!next) break;
    state = next;
  }
  if (searchPiece('plannerDiscard') && !state.winner) state = discardStep(state, side, ai);
  const leaf = (s: GameState) => leafValue(s, side);
  if (ends) {
    ends.state = state;
    ends.bonus = bonus;
  }
  if (ai.reply && !state.winner) {
    const t = performance.now();
    const replied = ai.reply(state, leaf);
    searchClock.replyMs += performance.now() - t;
    return replied + bonus;
  }
  return leaf(state) + bonus;
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


/** The end of the turn: hand by what each card will do later (plan.plannerHand), clicks as the model prices them. */
function leafValue(state: GameState, side: SideCode): number {
  return withPricing({ leaves: [...pricing().leaves, { side, plan: plan() }] }, () => evaluate(state, side));
}

/**
 * The planner's pick among the rule-based AI's best candidates (`ranked`,
 * best first): the one whose turn ends best. Falls back to the favourite.
 */
/** Whether a playout from `start` ended with a card in `side`'s hand that was in its deck (R&D, the stack) at the start (S6 measurement). */
function drewFromDeck(side: SideCode, start: GameState, end: GameState | undefined): boolean {
  if (!end) return false;
  const deck = new Set((side === 'corp' ? start.corp.rd : start.runner.stack).map(c => c.instanceId));
  return (side === 'corp' ? end.corp.hq : end.runner.grip).some(c => deck.has(c.instanceId));
}

/** plan.hiddenDraws: the guessHidden (Corp) or guessRunnerView (Runner) deal the planner's own playouts start from (the replies use deals 0 ..). */
export const HIDDEN_DRAW_SAMPLE = 4096;

/** The seed a decision of `side` at `state` deals its guesses from (plannerSeed: the game, turn and clicks left). */
export function decisionSeedFor(state: GameState, side: SideCode): number | null {
  return searchPiece('plannerSeed') ? (turnSeed(state) ^ Math.imul(clicksOf(state, side) + 1, 0x85ebca6b)) >>> 0 : pricing().decisionSeed;
}

/**
 * The Runner's own view of `state` for this decision (plan.hiddenDraws; rule 10.2.2a): the same deal its planner's
 * playouts start from, so the rule ranking that picks the planner's candidates scores a draw on the same guessed stack
 * and reads the same guess of the Corp's hidden cards (runnerReply.ts guessRunnerView; ai-honest-runner-view). Kept per
 * real state while what it deals from is the same (red team 8, as corpDecisionView), so the ranking, the prompt
 * answers and the planner's root are one object. `memory`: the cards the deciding Runner has accessed (they keep their
 * identity). Honest only with plan.plannerSeed on (the default). Off (hiddenDraws): the state itself.
 */
export function runnerDecisionView(state: GameState, memory?: RunnerMemory): GameState {
  if (!plan().hiddenDraws) return state;
  const seed = decisionSeedFor(state, 'runner');
  // Kept while nothing it deals from has changed (tests edit a state in place): the seed, the plan, the board, the cards
  const cards = (list: { instanceId: string; cardCode: string }[]) => list.map(c => `${c.instanceId}:${c.cardCode}`).join(',');
  const installed = Object.values(state.corp.servers).map(v => `${cards(v.ice)}/${cards(v.root)}`).join(';');
  const known = memory ? [...memory].map(([id, code]) => `${id}:${code}`).join(',') : '';
  const sig = `${seed}|${fingerprint(state)}|${cards(state.corp.hq)}|${cards(state.corp.rd)}|${cards(state.corp.archives.faceDown)}|${installed}|${cards(state.runner.stack)}|${known}|${JSON.stringify(plan())}`;
  const kept = runnerViews.get(state);
  if (kept?.sig === sig) return kept.view;
  const view = withPricing({ decisionSeed: seed }, () => guessRunnerView(state, HIDDEN_DRAW_SAMPLE, memory));
  runnerViews.set(state, { sig, view });
  return view;
}
const runnerViews = new WeakMap<GameState, { sig: string; view: GameState }>();

/**
 * The deciding Corp's own view of `state` for this decision (plan.hiddenDraws; rule 10.2.2a; Jeff: the Normal Corp does
 * not see its own draws): the guessHidden deal with the decision's seed, so R&D's order (outside the slots both sides
 * know, knownRdSlots), the Runner's unseen grip (with the stack) and the rng are a guess. The same object is the root
 * its planner's playouts start from (planTurn), so the order and the playouts read one deal by construction: kept per
 * real state while what it deals from is the same. Honest only with plan.plannerSeed on (the default): off, the
 * deal is seeded from the real rng and shuffles R&D from its real order. Off (hiddenDraws): the state itself.
 */
export function corpDecisionView(state: GameState): GameState {
  if (!plan().hiddenDraws) return state;
  const seed = decisionSeedFor(state, 'corp');
  // Kept while nothing it deals from has changed (tests edit a state in place): the seed, the plan, the board, the cards
  const ids = (cards: { instanceId: string }[]) => cards.map(c => c.instanceId).join(',');
  const sig = `${seed}|${fingerprint(state)}|${ids(state.corp.hq)}|${ids(state.corp.rd)}|${ids(state.runner.grip)}|${ids(state.runner.stack)}|${JSON.stringify(plan())}`;
  const kept = corpViews.get(state);
  if (kept?.sig === sig) return kept.view;
  const view = withPricing({ decisionSeed: seed }, () => guessHidden(state, HIDDEN_DRAW_SAMPLE));
  corpViews.set(state, { sig, view });
  return view;
}
const corpViews = new WeakMap<GameState, { sig: string; view: GameState }>();

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
  const open = ranked.filter(r => r.score > -Infinity && r.action.type !== 'END_TURN' && r.action.type !== 'START_TURN' && !dominated(state, r.action, ranked));
  // The Corp (Step 4 Stage C3, spec 1.3): the first K of the order under the two caps, with the two candidates always in
  // K (best agenda, best build pair) in its last places (corp/candidates.ts plannerIntake); the Runner: its first K
  const intake = side === 'corp' && ai.intake ? ai.intake(open, plannerCandidates(side, PLANNER.candidates)) : null;
  const candidates = intake ? intake.picked : open.slice(0, plannerCandidates(side, PLANNER.candidates));
  if (candidates.length <= 1 || clicksOf(state, side) <= 0) return null;
  tally('planner', 'decisions');
  for (const slot of intake?.slots.values() ?? []) tally('planner', slot === 'agenda' ? 'agendaSlot' : 'buildSlot');
  // The hands stay as seen when the decision started (frozen); plan.plannerSeed: one seed for every playout of this decision
  const decisionSeed = decisionSeedFor(state, side);
  const started = performance.now();
  const replyBefore = searchClock.replyMs;
  return withPricing({ frozen: true, decisionSeed }, () => {
    // plan.hiddenDraws (spec-search S6; the Runner's side Jeff 2026-11-14): each side's candidates are played from its own
    // guess of what it can't see, dealt once for the decision, so a line that draws draws a guess, not the real top of
    // R&D or the stack (rule 10.2.2a)
    const root = side === 'corp' ? corpDecisionView(state) : runnerDecisionView(state, ai.known);
    let best: { action: GameAction; value: number; line: Line } | null = null;
    const values: number[] = [];
    const scored: { action: GameAction; value: number; line: Line; ends: Ends }[] = [];
    for (const c of candidates) {
      const line: Line = [];
      const ends: Ends = {};
      const value = playout(root, side, c.action, ai, line, ends);
      values.push(value);
      scored.push({ action: c.action, value, line, ends });
      if (!best || value > best.value) best = { action: c.action, value, line };
    }
    if (side === 'corp' && plan().replyContenders && ai.reply && sampledReply()) best = contenders(scored, side, synergy) ?? best;
    note(d => {
      d.onCandidates?.(side, values, candidates.map(c => c.action));
      if (d.onDraws) d.onDraws(state, scored.filter(x => drewFromDeck(side, root, x.ends.state)).length, scored.length, best?.action ?? null);
    });
    note(d => {
      if (side === 'corp' && d.onSearch) auditSearch(d.onSearch, state, side, candidates, scored, best, ai, synergy, performance.now() - started, searchClock.replyMs - replyBefore);
    });
    if (!best || best.value === -Infinity) return null;
    const slot = intake ? [...intake.slots].find(([c]) => c.action === best!.action)?.[1] : undefined;
    if (slot) tally('planner', slot === 'agenda' ? 'agendaSlotWins' : 'buildSlotWins');
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
function contenders<T extends { action: GameAction; value: number; line: Line; ends: Ends }>(scored: T[], side: SideCode, synergy: boolean): T | null {
  const live = scored.filter(r => Number.isFinite(r.value) && r.ends.state && !r.ends.state.winner).sort((a, b) => b.value - a.value);
  if (live.length < 2 || live[0].value - live[1].value >= REPLY.contendGap) return null;
  const leaf = (s: GameState) => leafValue(s, side);
  const top = live.slice(0, 2).map(r => {
    const bonus = r.ends.bonus ?? 0;
    const first = replySamples(REPLY.samples); // (plan.oracle.think plays more first samples)
    const extra = runnerReply(r.ends.state!, synergy, leaf, { from: first, count: REPLY.extra });
    return { ...r, firstValue: r.value, samples: first + REPLY.extra, value: (first * (r.value - bonus) + REPLY.extra * extra) / (first + REPLY.extra) + bonus };
  });
  // A candidate outside the two (a won game, or one the extra samples can't change) keeps its value
  const rest = scored.filter(r => !top.some(t => t.action === r.action && t.line === r.line));
  const pick = [...top, ...rest].reduce((a, b) => (b.value > a.value ? b : a));
  note(d => d.onClose?.(top.map(t => ({ action: t.action, first: t.firstValue, value: t.value, samples: t.samples })), pick.action));
  return pick;
}

/** The Corp's agenda situation at a decision (spec-search S1 kinds). */
function agendaKind(state: GameState): SearchRow['kind'] {
  const installed = Object.values(state.corp.servers).some(s => s.root.some(c => cardDef(c).type_code === 'agenda'));
  if (installed) return 'installed';
  return state.corp.hq.some(c => cardDef(c).type_code === 'agenda') ? 'hq' : 'neither';
}

const lineKey = (first: GameAction, line: Line) => JSON.stringify([first, ...line.map(l => l.action)]);

/**
 * Spec-search S1 (measurement only, the diagnostics' onSearch): every candidate of a Corp decision also played on the hold
 * and the finish-first lines, after the pick is made, so play is unchanged (the pick, its line and the plan memory come
 * from the shipped search). The rule line is the one already played.
 */
function auditSearch(
  audit: (row: SearchRow) => void,
  state: GameState,
  side: SideCode,
  candidates: ScoredAction[],
  scored: { action: GameAction; value: number; line: Line; ends: Ends }[],
  best: { action: GameAction; value: number } | null,
  ai: PlannerAI,
  synergy: boolean,
  ms: number,
  replyMs: number
): void {
  const t = performance.now();
  const num = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  const rows = candidates.map((c, i) => {
    const agenda = (() => {
      const id = 'cardInstanceId' in c.action ? c.action.cardInstanceId : undefined;
      const card = id ? findCardAnywhere(state, id) : undefined;
      return !!card && cardDef(card).type_code === 'agenda';
    })();
    const ruleValue = scored[i]?.value ?? -Infinity;
    const ruleLine = scored[i]?.line ?? [];
    const ruleEnds: Ends = scored[i]?.ends ?? {};
    // The noise floor: the same rule line scored on two fresh reply deals (samples 2-3, as plan.replyContenders plays them).
    // An alternative line that "beats" the pick no more often than this re-sample does is the max of noise, not a better line.
    let resample: number | null = null;
    if (ai.reply && sampledReply() && Number.isFinite(ruleValue) && ruleEnds.state && !ruleEnds.state.winner) {
      const leaf = (s: GameState) => leafValue(s, side);
      resample = num(runnerReply(ruleEnds.state, synergy, leaf, { from: replySamples(REPLY.samples), count: REPLY.samples }) + (ruleEnds.bonus ?? 0));
    }
    const ruleKey = lineKey(c.action, ruleLine);
    const lines: SearchLine[] = [{ mode: 'rule', value: num(ruleValue), distinct: false }];
    for (const mode of ['hold', 'finish'] as const) {
      const l: Line = [];
      const v = playout(state, side, c.action, ai, l, {}, mode);
      lines.push({ mode, value: num(v), distinct: lineKey(c.action, l) !== ruleKey });
    }
    return { type: c.action.type, agenda, lines, resample };
  });
  const pick = best ? candidates.findIndex(c => c.action === best.action) : -1;
  audit({
    kind: agendaKind(state),
    turn: state.turnNumber,
    clicks: clicksOf(state, side),
    credits: state.corp.credits,
    chosen: num(best?.value ?? -Infinity) ?? -1e9,
    pick,
    candidates: rows,
    ms: Math.round(ms),
    replyMs: Math.round(replyMs),
    extraMs: Math.round(performance.now() - t),
  });
}

const sameAction = (a: GameAction, b: GameAction): boolean => JSON.stringify(a) === JSON.stringify(b);
