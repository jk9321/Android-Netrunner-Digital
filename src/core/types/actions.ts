import { SideCode } from './card';
import { PromptChoice } from './prompts';

export type GameActionType =
  // Basic clicks
  | 'GAIN_CREDIT'
  | 'DRAW_CARD'
  | 'INSTALL_CARD'
  | 'PLAY_OPERATION_OR_EVENT'
  | 'ADVANCE_CARD'
  | 'SCORE_AGENDA'
  | 'PURGE_VIRUS'
  | 'INITIATE_RUN'
  // Reactive / Run actions
  | 'REZ_CARD'
  | 'CONTINUE_RUN'
  | 'JACK_OUT'
  | 'BREAK_SUBROUTINE'
  | 'BOOST_BREAKER'
  | 'BIOROID_BREAK'
  | 'RESOLVE_PROMPT'
  | 'USE_ABILITY'
  | 'REMOVE_TAG'
  | 'TRASH_RESOURCE'
  | 'END_TURN'
  | 'START_TURN'
  // Either player, at any time
  | 'CONCEDE';

export interface BaseAction {
  type: GameActionType;
  player: SideCode;
}

export interface GainCreditAction extends BaseAction {
  type: 'GAIN_CREDIT';
}

export interface DrawCardAction extends BaseAction {
  type: 'DRAW_CARD';
}

export interface InstallCardAction extends BaseAction {
  type: 'INSTALL_CARD';
  cardInstanceId: string;
  targetServerId?: string; // required for Corp installs
  asNewRemote?: boolean;
  /** Runner programs that install onto a card (Botulus, Tranquilizer): the host ice. */
  hostInstanceId?: string;
  /** Corp: install an agenda faceup (BANGUN). */
  faceUp?: boolean;
}

export interface PlayOperationOrEventAction extends BaseAction {
  type: 'PLAY_OPERATION_OR_EVENT';
  cardInstanceId: string;
}

export interface AdvanceCardAction extends BaseAction {
  type: 'ADVANCE_CARD';
  cardInstanceId: string;
  serverId: string;
}

export interface ScoreAgendaAction extends BaseAction {
  type: 'SCORE_AGENDA';
  cardInstanceId: string;
}

export interface PurgeVirusAction extends BaseAction {
  type: 'PURGE_VIRUS';
}

export interface InitiateRunAction extends BaseAction {
  type: 'INITIATE_RUN';
  targetServerId: string;
}

export interface RezCardAction extends BaseAction {
  type: 'REZ_CARD';
  cardInstanceId: string;
}

export interface ContinueRunAction extends BaseAction {
  type: 'CONTINUE_RUN';
}

export interface JackOutAction extends BaseAction {
  type: 'JACK_OUT';
}

/** Use an icebreaker's interface ability to break subroutines on the encountered ice. */
export interface BreakSubroutineAction extends BaseAction {
  type: 'BREAK_SUBROUTINE';
  breakerInstanceId: string;
  subroutineIndices: number[];
}

/** Use an icebreaker's strength ability once (lasts for the current encounter). */
export interface BoostBreakerAction extends BaseAction {
  type: 'BOOST_BREAKER';
  breakerInstanceId: string;
}

/** Spend a click to break 1 subroutine on encountered bioroid ice (Ansel 1.0, Brân 1.0). */
export interface BioroidBreakAction extends BaseAction {
  type: 'BIOROID_BREAK';
  subroutineIndex: number;
}

export interface ResolvePromptAction extends BaseAction {
  type: 'RESOLVE_PROMPT';
  promptId: string;
  choice: PromptChoice;
}

/** Use an ability printed on an active card (see CardScript.abilities). */
export interface UseAbilityAction extends BaseAction {
  type: 'USE_ABILITY';
  cardInstanceId: string;
  abilityIndex: number;
}

/** Runner basic action: [click] + 2 credits to remove 1 tag. */
export interface RemoveTagAction extends BaseAction {
  type: 'REMOVE_TAG';
}

/** Corp basic action: [click] + 2 credits to trash 1 installed resource while the Runner is tagged. */
export interface TrashResourceAction extends BaseAction {
  type: 'TRASH_RESOURCE';
  cardInstanceId: string;
}

export interface EndTurnAction extends BaseAction {
  type: 'END_TURN';
}

/** Corp: closes the paid ability window before the turn formally begins, then takes the mandatory draw. */
export interface StartTurnAction extends BaseAction {
  type: 'START_TURN';
}

/** A player concedes: the game ends at once and the other side wins. */
export interface ConcedeAction extends BaseAction {
  type: 'CONCEDE';
}

export type GameAction =
  | StartTurnAction
  | GainCreditAction
  | DrawCardAction
  | InstallCardAction
  | PlayOperationOrEventAction
  | AdvanceCardAction
  | ScoreAgendaAction
  | PurgeVirusAction
  | InitiateRunAction
  | RezCardAction
  | ContinueRunAction
  | JackOutAction
  | BreakSubroutineAction
  | BoostBreakerAction
  | BioroidBreakAction
  | ResolvePromptAction
  | UseAbilityAction
  | RemoveTagAction
  | TrashResourceAction
  | EndTurnAction
  | ConcedeAction;
