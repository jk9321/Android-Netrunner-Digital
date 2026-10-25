import { GameAction, GameActionType } from '../types/actions';
import { GameState } from '../types/state';
import { IllegalActionError } from './errors';
import { drawCard, gainCredit, purgeVirus, removeTag, trashResource } from './actions/basic';
import { installCard } from './actions/install';
import { advanceCard, rezCard, scoreAgenda } from './actions/corp';
import { continueRun, initiateRun, jackOut } from './actions/run';
import { concede, endTurn } from './actions/turn';
import { resolvePrompt } from './actions/prompt';
import { playOperationOrEvent } from './actions/play';
import { bioroidBreak, boostBreaker, breakSubroutine } from './actions/breaking';
import { useAbility } from './actions/ability';
import { bumpTurnFlag, syncDerivedStats, TurnFlag } from './cardEffects';
import { findCardAnywhere } from './helpers';
import { getCardScript } from '../scripts';

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
 * Applies an action and returns the next state. The input state is never
 * mutated; on an illegal action an IllegalActionError is thrown.
 */
export function executeAction(prevState: GameState, action: GameAction): GameState {
  if (prevState.winner) {
    throw new IllegalActionError('Game is already over.');
  }
  // While a decision is pending, answering it (or conceding) is the only legal action.
  if (prevState.pendingPrompts.length > 0 && action.type !== 'RESOLVE_PROMPT' && action.type !== 'CONCEDE') {
    const p = prevState.pendingPrompts[0];
    throw new IllegalActionError(`Waiting on a decision: ${p.message}`);
  }
  // Everything is copied except the log entries: the log only ever grows and
  // its entries are never changed (addLog freezes them), so the new state gets
  // a new array holding the same entries instead of a deep copy of a log that
  // is most of the state late in a game.
  const { log, ...rest } = prevState;
  const state: GameState = { ...structuredClone(rest), log: log.slice() };
  const handler = handlers[action.type] as (state: GameState, action: GameAction) => void;
  if (!handler) {
    throw new IllegalActionError(`Unknown action type: ${(action as { type: string }).type}`);
  }
  handler(state, action);
  // Petty Cash: "Play only if you have not finished an action yet this turn"
  if (isClickAction(prevState, action) && state.activePlayer === prevState.activePlayer) bumpTurnFlag(state, TurnFlag.actionsFinished);
  syncDerivedStats(state);
  return state;
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
