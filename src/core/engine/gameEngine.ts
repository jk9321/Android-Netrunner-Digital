import { GameAction, GameActionType } from '../types/actions';
import { GameState } from '../types/state';
import { IllegalActionError } from './errors';
import { drawCard, gainCredit, purgeVirus, removeTag, trashResource } from './actions/basic';
import { installCard } from './actions/install';
import { advanceCard, rezCard, scoreAgenda } from './actions/corp';
import { continueRun, initiateRun, jackOut } from './actions/run';
import { concede, endTurn, startTurn } from './actions/turn';
import { resolvePrompt } from './actions/prompt';
import { playOperationOrEvent } from './actions/play';
import { bioroidBreak, boostBreaker, breakSubroutine } from './actions/breaking';
import { useAbility } from './actions/ability';
import { bumpTurnFlag, fireSettled, syncDerivedStats, TurnFlag, whenSettled } from './cardEffects';
import { findCardAnywhere, forgetHiddenCards, updateHandKnowledge } from './helpers';
import { updateRdKnowledge } from './rdKnowledge';
import { getCardScript } from '../scripts';
import { canRezIn, canScoreIn, currentStep, declareIntent, isActionStep, isRunStep, normalizePriority, onWindowClose, passPriority, priorityHolder, usedOption } from './priority';
import { sideName } from './prompts';
import { removeEmptyRemotes, trashOverMemoryLimit } from './checkpoint';

export { addLog } from './log';

type ActionOf<T extends GameActionType> = Extract<GameAction, { type: T }>;

/**
 * One handler per action type. A handler mutates the (already cloned) state
 * it is given, and throws IllegalActionError if the action is not legal.
 * Add new actions here; the mapped type makes a missing entry a type error.
 */
type ActionHandlers = { [T in GameActionType]: (state: GameState, action: ActionOf<T>) => void };

const handlers: ActionHandlers = {
  GAIN_CREDIT: gainCredit,
  DRAW_CARD: drawCard,
  INSTALL_CARD: installCard,
  ADVANCE_CARD: advanceCard,
  SCORE_AGENDA: scoreAgenda,
  REZ_CARD: rezCard,
  INITIATE_RUN: initiateRun,
  CONTINUE_RUN: continueRun,
  JACK_OUT: jackOut,
  END_TURN: endTurn,
  START_TURN: startTurn,
  PASS: (state, action) => passPriority(state, action.player, action.restOfRun),
  SET_STOPS: (state, action) => {
    state.stops = { ...state.stops, [action.player]: action.level };
  },
  CONCEDE: concede,
  RESOLVE_PROMPT: resolvePrompt,
  PLAY_OPERATION_OR_EVENT: playOperationOrEvent,
  PURGE_VIRUS: purgeVirus,
  BREAK_SUBROUTINE: breakSubroutine,
  BOOST_BREAKER: boostBreaker,
  BIOROID_BREAK: bioroidBreak,
  USE_ABILITY: useAbility,
  REMOVE_TAG: removeTag,
  TRASH_RESOURCE: trashResource,
};

/**
 * A deep copy of plain game data (objects, arrays, primitives), about twice as fast as structuredClone, which was a
 * quarter of AI self-play time. Expects plain data only: no Maps, Sets, Dates or cycles, and shared sub-objects come out
 * as separate copies (the log, whose entries are shared, is copied separately).
 */
function copyPlain(v: unknown): unknown {
  if (typeof v !== 'object' || v === null) return v;
  if (Array.isArray(v)) { const n = v.length; const out = new Array(n); for (let i = 0; i < n; i++) out[i] = copyPlain(v[i]); return out; }
  const out: Record<string, unknown> = {};
  for (const k in v as Record<string, unknown>) out[k] = copyPlain((v as Record<string, unknown>)[k]);
  return out;
}

/**
 * Applies an action and returns the next state. The input state is never
 * mutated; on an illegal action an IllegalActionError is thrown.
 */
export function executeAction(prevState: GameState, action: GameAction): GameState {
  if (prevState.winner) {
    throw new IllegalActionError('Game is already over.');
  }
  // While a decision is pending, answering it (or conceding) is the only legal action.
  if (prevState.pendingPrompts.length > 0 && action.type !== 'RESOLVE_PROMPT' && action.type !== 'CONCEDE' && action.type !== 'SET_STOPS') {
    const p = prevState.pendingPrompts[0];
    throw new IllegalActionError(`Waiting on a decision: ${p.message}`);
  }
  // Everything is copied except the log entries: the log only ever grows and
  // its entries are never changed (addLog freezes them), so the new state gets
  // a new array holding the same entries instead of a deep copy of a log that
  // is most of the state late in a game.
  const { log, ...rest } = prevState;
  const state: GameState = { ...(copyPlain(rest) as typeof rest), log: log.slice() };
  const handler = handlers[action.type] as (state: GameState, action: GameAction) => void;
  if (!handler) {
    throw new IllegalActionError(`Unknown action type: ${(action as { type: string }).type}`);
  }
  // The action carried out as the player's action this turn (for "actions taken" counts):
  // a declared action waits for the opponent's priority, and runs when the window closes.
  let taken: GameAction | null = action;
  switch (windowRole(state, action)) {
    case 'pass':
      closedIntent = null;
      try {
        passPriority(state, action.player, action.type === 'PASS' && action.restOfRun);
        taken = closedIntent;
      } finally {
        closedIntent = null;
      }
      break;
    case 'intent':
      if (declareIntent(state, action, () => handler(structuredClone(state), action))) handler(state, action);
      else taken = null;
      break;
    case 'option':
      handler(state, action);
      usedOption(state, action.player);
      break;
    default:
      handler(state, action);
  }
  normalizePriority(state);
  if (state.winner) endGame(state);
  removeEmptyRemotes(state);
  trashOverMemoryLimit(state);
  forgetHiddenCards(state);
  updateRdKnowledge(prevState, state);
  updateHandKnowledge(prevState, state);
  // Petty Cash: "Play only if you have not finished an action yet this turn"
  if (taken && isClickAction(prevState, taken) && state.activePlayer === prevState.activePlayer) {
    bumpTurnFlag(state, TurnFlag.actionsFinished);
    // Wage Workers: "if you have taken that action exactly 3 times this turn"
    const count = bumpTurnFlag(state, `action:${actionKey(taken)}`);
    whenSettled(state, { type: 'action_finished', side: taken.player, count });
  }
  fireSettled(state);
  refreshActivePrompt(state);
  syncDerivedStats(state);
  return state;
}

/** An effect_cards prompt now at the front lists only the cards its card can still choose (rules 9.2.8d). */
function refreshActivePrompt(state: GameState): void {
  const prompt = state.pendingPrompts[0];
  if (prompt?.kind !== 'effect_cards') return;
  const live = getCardScript(prompt.source.cardCode)?.liveCandidates?.(state, prompt.source);
  if (!live) return;
  prompt.candidateIds = prompt.candidateIds.filter(id => live.includes(id));
  // Nothing left to choose: the answer is no card
  prompt.min = Math.min(prompt.min, prompt.candidateIds.length);
  prompt.max = Math.min(prompt.max, prompt.candidateIds.length);
}

/** The declared action carried out when the window it waited on closed during this executeAction. */
let closedIntent: GameAction | null = null;

/** Carries out an action the active player declared, once its window closed (see priority.ts). */
function runIntent(state: GameState, action: GameAction): void {
  (handlers[action.type] as (state: GameState, action: GameAction) => void)(state, action);
  closedIntent = action;
}

// The window before an action closed: the action declared is carried out (5.6.2b, 5.7.1f)
for (const step of ['corp_action', 'runner_action'] as const) {
  onWindowClose(step, (state, pw) => {
    if (pw.intent) runIntent(state, pw.intent);
  });
}

/**
 * How an action relates to the paid ability window in progress (rules 9.2.7):
 * passing priority, an action declared by the active player (carried out once
 * the window closes), an option used with priority, or none of these
 * (answering a prompt, conceding, choosing stops). Throws if the player may
 * not act now.
 */
function windowRole(state: GameState, action: GameAction): 'pass' | 'intent' | 'option' | 'free' {
  if (action.type === 'CONCEDE' || action.type === 'RESOLVE_PROMPT' || action.type === 'SET_STOPS') return 'free';
  const holder = priorityHolder(state);
  if (action.player !== holder) throw new IllegalActionError(`Waiting for the ${sideName(holder)}`);
  const step = currentStep(state);
  switch (action.type) {
    case 'PASS':
      // In the action phase the active player acts; in a run the Runner continues; before the Corp's turn the Corp starts it
      if (!step || (holder === state.activePlayer && isActionStep(step)) || (holder === 'runner' && state.activeRun) || (holder === 'corp' && step === 'corp_draw')) {
        throw new IllegalActionError('There is nothing to pass');
      }
      return 'pass';
    case 'START_TURN':
      if (step !== 'corp_draw' || action.player !== 'corp') throw new IllegalActionError('Not waiting to start a turn');
      return 'pass';
    case 'CONTINUE_RUN':
      if (action.player !== 'runner') throw new IllegalActionError('Only the Runner can continue a run');
      // The Runner passes in the run's windows; elsewhere Continue moves the run on (after approaching the server)
      return step && isRunStep(step) ? 'pass' : 'free';
    case 'JACK_OUT':
      if (step === 'movement') return 'intent';
      throw new IllegalActionError('You can only jack out after passing a piece of ice, or before approaching a server with no ice');
    case 'REZ_CARD':
      if (!canRezIn(step)) throw new IllegalActionError('Cards cannot be rezzed now');
      return 'option';
    case 'SCORE_AGENDA':
      if (!canScoreIn(step)) throw new IllegalActionError('Agendas can only be scored during your turn');
      return 'option';
    case 'BREAK_SUBROUTINE':
    case 'BOOST_BREAKER':
    case 'BIOROID_BREAK':
      if (step !== 'encounter') throw new IllegalActionError('Not encountering ice');
      return 'option';
    case 'USE_ABILITY': {
      const card = findCardAnywhere(state, action.cardInstanceId);
      const clicks = card ? (getCardScript(card.cardCode)?.abilities?.[action.abilityIndex]?.clicks ?? 0) : 0;
      if (clicks > 0) return actionWindowRole(state, step);
      if (!step) throw new IllegalActionError('Paid abilities can only be used in a paid ability window');
      return 'option';
    }
    default:
      return actionWindowRole(state, step);
  }
}

/** An action the active player takes in their action phase (5.6.2b, 5.7.1f): declared, then carried out. */
function actionWindowRole(state: GameState, step: ReturnType<typeof currentStep>): 'intent' | 'free' {
  // Out of the action phase, the handler gives the reason (not your turn, during a run, start your turn first)
  return isActionStep(step) && step === `${state.activePlayer}_action` && !state.activeRun ? 'intent' : 'free';
}

/**
 * The game ends the moment a player wins (rules 1.7.1, 10.3.1c), so nothing
 * still waiting is carried out: decisions queued before the win (Ryō's HQ
 * trash, the rest of a breach) are dropped and the run is over.
 */
function endGame(state: GameState): void {
  state.pendingPrompts = [];
  state.activeRun = null;
}

const CLICK_ACTIONS: GameActionType[] = [
  'GAIN_CREDIT',
  'DRAW_CARD',
  'INSTALL_CARD',
  'PLAY_OPERATION_OR_EVENT',
  'ADVANCE_CARD',
  'PURGE_VIRUS',
  'INITIATE_RUN',
  'REMOVE_TAG',
  'TRASH_RESOURCE',
];

/**
 * Which action this is, for "that action ... this turn" (Wage Workers): each
 * basic action is one action whatever card it is used on (install, play,
 * advance); each [click] ability is its own action.
 */
function actionKey(action: GameAction): string {
  return action.type === 'USE_ABILITY' ? `ability:${action.cardInstanceId}:${action.abilityIndex}` : action.type;
}

/** Is this one of the active player's actions (a basic action or a [click] ability)? */
function isClickAction(state: GameState, action: GameAction): boolean {
  if (action.player !== state.activePlayer || state.activeRun) return false;
  if (CLICK_ACTIONS.includes(action.type)) return true;
  if (action.type !== 'USE_ABILITY') return false;
  const card = findCardAnywhere(state, action.cardInstanceId);
  return !!card && (getCardScript(card.cardCode)?.abilities?.[action.abilityIndex]?.clicks ?? 0) > 0;
}

/**
 * Answers already worked out for each state, by action. Checking legality
 * runs the whole action on a copy of the state, and the UI asks about the
 * same state many times (every render, every button), so each answer is
 * kept for as long as the state object lives. Game states are never changed
 * after they are made (executeAction returns a new one), which is what
 * makes this safe.
 */
const legalityCache = new WeakMap<GameState, Map<string, boolean>>();

/** True if the action can be applied to the state without error. */
export function isLegalAction(state: GameState, action: GameAction): boolean {
  let known = legalityCache.get(state);
  if (!known) {
    known = new Map();
    legalityCache.set(state, known);
  }
  const key = JSON.stringify(action);
  const cached = known.get(key);
  if (cached !== undefined) return cached;
  let legal: boolean;
  try {
    executeAction(state, action);
    legal = true;
  } catch (err) {
    if (!(err instanceof IllegalActionError)) throw err;
    legal = false;
  }
  known.set(key, legal);
  return legal;
}
