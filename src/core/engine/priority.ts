import { GameAction } from '../types/actions';
import { SideCode } from '../types/card';
import { GameState, PriorityWindow, StopLevel, WindowStep } from '../types/state';
import { cardDef } from '../cards';
import { getCardScript } from '../scripts';
import { illegal } from './helpers';
import { sideName } from './prompts';
import { abilitySources, abilityUsableFrom, abilityUsedKey } from './actions/ability';
import { availableCredits, counters, turnFlag } from './cardEffects';
import { getLegalActions } from './legalActions';

/**
 * Paid ability windows and priority (rules 9.2.4, 9.2.7).
 *
 * Every paid ability window of the turn and run structure (sections 5.6,
 * 5.7, 6.9) gives both players priority, the active player first. A player
 * with priority may use paid abilities, rez and score as that window allows,
 * any number of times, until they pass; the opponent then gets priority, and
 * the window closes once a player who received priority from their opponent
 * passes without using anything (9.2.7a).
 *
 * Most of the time the active player holds priority without anything being
 * recorded: during their action phase (5.6.2a, 5.7.1e) and at the Runner's
 * decisions during a run (approach, encounter, movement). Their action, or
 * Continue, passes priority; the opponent is offered priority, and the action
 * is carried out once the window closes. Windows that need a step to come
 * back to (before the turns begin, after discarding, before approaching ice)
 * are recorded in state.priority from the start.
 *
 * A player whose game would not stop at a window passes it automatically
 * (wantsStop). That choice uses only what both players can see, so stopping
 * or not tells the opponent nothing (rules 4.6.3).
 */

/** Windows during a run (they close with the run, rules 6.9.6a). */
const RUN_STEPS = new Set<WindowStep>(['run_initiation', 'approach_ice', 'encounter', 'movement', 'move_inward', 'approach_server']);
/** Windows where the active player holds priority without state.priority recording it. */
const IMPLICIT_STEPS = new Set<WindowStep>(['corp_action', 'runner_action', 'approach_ice', 'encounter', 'movement', 'approach_server']);
/** Windows where cards (other than ice) can be rezzed: (R) in the rules. */
const REZ_STEPS = new Set<WindowStep>([
  'corp_draw',
  'corp_action',
  'corp_discard',
  'runner_turn_start',
  'runner_action',
  'runner_discard',
  'run_initiation',
  'approach_ice',
  'move_inward',
  'approach_server',
]);
/** Windows where agendas can be scored: (S) in the rules. */
const SCORE_STEPS = new Set<WindowStep>(['corp_draw', 'corp_action']);

const other = (side: SideCode): SideCode => (side === 'corp' ? 'runner' : 'corp');

export const isRunStep = (step: WindowStep) => RUN_STEPS.has(step);
export const isActionStep = (step: WindowStep | null): step is 'corp_action' | 'runner_action' =>
  step === 'corp_action' || step === 'runner_action';
export const canRezIn = (step: WindowStep | null) => !!step && REZ_STEPS.has(step);
export const canScoreIn = (step: WindowStep | null) => !!step && SCORE_STEPS.has(step);

/**
 * The window the active player is in when nothing is recorded, or null when
 * the game is between windows (subroutines resolving, a breach, a turn
 * transition, the moment after the Runner approached the server).
 */
function implicitStep(state: GameState): WindowStep | null {
  const run = state.activeRun;
  if (run) {
    if (run.accessOnly) return null;
    switch (run.phase) {
      case 'approach_ice':
        return 'approach_ice';
      case 'encounter_ice':
        return run.encounter && run.encounter.resolvingIndex == null && !run.encounter.onEncounterPending ? 'encounter' : null;
      case 'movement':
        return 'movement';
      case 'approach_server':
        return run.serverApproached ? null : 'approach_server';
      default:
        return null;
    }
  }
  // The windows before the turns begin are recorded when they open; these stand in if a state was set up without it
  if (state.turnStep?.kind === 'corp_turn_start') return 'corp_draw';
  if (state.turnStep?.kind === 'runner_turn_start') return 'runner_turn_start';
  if (state.turnStep) return null;
  return state.activePlayer === 'corp' ? 'corp_action' : 'runner_action';
}

/** The paid ability window in progress, if any. */
export function currentStep(state: GameState): WindowStep | null {
  return state.priority?.step ?? implicitStep(state);
}

/** The side the game is waiting on: a prompt's side, else the player with priority; null once the game is over. */
export function actingSide(state: GameState): SideCode | null {
  if (state.winner) return null;
  return state.pendingPrompts[0]?.side ?? priorityHolder(state);
}

/** Who may act now (outside prompts): the player with priority, or the active player between windows. */
export function priorityHolder(state: GameState): SideCode {
  if (state.priority) return state.priority.holder;
  return state.activeRun ? 'runner' : state.activePlayer;
}

export function stopLevel(state: GameState, side: SideCode): StopLevel {
  return state.stops?.[side] ?? 'ai';
}

/**
 * Does `side`'s game stop to give them priority in this window, or do they
 * pass it automatically?
 */
export function wantsStop(state: GameState, side: SideCode, pw: PriorityWindow): boolean {
  const { step } = pw;
  const active = state.activePlayer;
  // The active player's own moves: their action phase and the Runner's decisions in a run
  if (side === active && IMPLICIT_STEPS.has(step)) return true;
  if (state.activeRun?.passing?.includes(side) && RUN_STEPS.has(step)) return false;
  const level = stopLevel(state, side);
  if (level === 'full') return true;
  if (level === 'none') return false;
  if (level === 'auto') return autoStop(state, side, pw);
  // The computer's stops ('ai'): where it has always been asked, judged from the table
  if (side === active) return step === 'corp_draw' && turnStartOptionsAI(state);
  const run = state.activeRun;
  switch (step) {
    case 'approach_ice': {
      // The Corp's rez decision for the approached ice
      const ice = run && run.icePosition !== null ? state.corp.servers[run.server]?.ice[run.icePosition] : undefined;
      return side === 'corp' && !!ice && !ice.isRezzed;
    }
    case 'approach_server': {
      // The Corp's last chance before the Runner approaches the server: cards in its root, or abilities
      const root = run ? (state.corp.servers[run.server]?.root ?? []) : [];
      return side === 'corp' && (root.some(c => !c.isRezzed) || hasUsableAbility(state, 'corp'));
    }
    case 'corp_action':
      // The Runner's chance at the end of the Corp's action phase (Madani)
      return side === 'runner' && pw.intent?.type === 'END_TURN' && hasUsableAbility(state, 'runner');
    default:
      return false;
  }
}

/**
 * A person's auto stops: the windows where players usually act, and only
 * when they have something they can actually do there now (a card they can
 * afford to rez, an agenda to score, a paid ability). Offline the person
 * deciding is the only one at the table who could learn from it; an online
 * game must not let the wait reveal hidden cards (rules 4.6.3).
 */
function autoStop(state: GameState, side: SideCode, pw: PriorityWindow): boolean {
  const { step } = pw;
  const run = state.activeRun;
  const usual =
    side === state.activePlayer
      ? step === 'corp_draw'
      : (side === 'corp' && (step === 'approach_ice' || step === 'approach_server' || step === 'runner_turn_start')) ||
        (side === 'runner' && step === 'corp_action' && pw.intent?.type === 'END_TURN');
  if (!usual) return false;
  const options = optionsIn(state, side, pw);
  if (step === 'approach_ice' || step === 'approach_server') {
    // During a run: rezzing the approached ice or the attacked server's root, or an ability
    const server = run ? state.corp.servers[run.server] : undefined;
    const here = new Set(
      step === 'approach_ice'
        ? [run && run.icePosition !== null ? server?.ice[run.icePosition]?.instanceId : undefined]
        : (server?.root ?? []).map(c => c.instanceId)
    );
    return options.some(a => a.type === 'USE_ABILITY' || (a.type === 'REZ_CARD' && here.has(a.cardInstanceId)));
  }
  return options.length > 0;
}

/** What `side` could do with priority in this window: rez, score or use a paid ability. */
function optionsIn(state: GameState, side: SideCode, pw: PriorityWindow): GameAction[] {
  // A copy with that priority: legal actions are cached per state object, so the
  // state itself must not be changed, even for a moment (a stale answer once
  // left the Corp's action phase offering only Start turn)
  const probe: GameState = { ...state, priority: { step: pw.step, holder: side, received: pw.received } };
  return getLegalActions(probe, side).filter(a => a.type === 'REZ_CARD' || a.type === 'SCORE_AGENDA' || a.type === 'USE_ABILITY');
}

/**
 * The Corp's options before their turn begins, as the computer Corp has always
 * been asked: a card to rez, an agenda ready to score, or a paid ability.
 */
function turnStartOptionsAI(state: GameState): boolean {
  for (const server of Object.values(state.corp.servers)) {
    for (const card of server.root) {
      const def = cardDef(card);
      if (def.type_code === 'agenda') {
        if (card.advancementCounters >= (def.advancement_cost ?? 0)) return true;
      } else if (!card.isRezzed) {
        return true;
      }
    }
  }
  return hasUsableAbility(state, 'corp');
}

/** Can `side` use a paid ability (one that costs no click) right now? A cheap check, without carrying it out. */
export function hasUsableAbility(state: GameState, side: SideCode): boolean {
  return abilitySources(state, side).some(({ card, where }) =>
    (getCardScript(card.cardCode)?.abilities ?? []).some((ability, index) => {
      if (ability.clicks || !abilityUsableFrom(ability, where, cardDef(card).side_code === side)) return false;
      if (ability.oncePerTurn && turnFlag(state, abilityUsedKey(card.instanceId, index)) > 0) return false;
      const purpose = ability.stealthOnly ? ({ kind: 'stealth' } as const) : undefined;
      if (availableCredits(state, side, purpose) < (ability.credits ?? 0)) return false;
      if (ability.counters && counters(card, ability.counters.type) < ability.counters.count) return false;
      try {
        return !ability.canUse?.({ state, card, side });
      } catch {
        return false;
      }
    })
  );
}

// --- Opening, passing and closing --------------------------------------------------

type Continuation = (state: GameState, pw: PriorityWindow) => void;

/** What happens when each window closes; registered by the turn and run code (no import cycle). */
const continuations: Partial<Record<WindowStep, Continuation>> = {};

export function onWindowClose(step: WindowStep, then: Continuation): void {
  continuations[step] = then;
}

/** Opens a recorded window (the active player gets priority first) and passes it for whoever doesn't stop. */
export function openWindow(state: GameState, step: WindowStep): void {
  state.priority = { step, holder: state.activePlayer, received: false };
  settle(state);
}

/** Passes priority for each player whose game doesn't stop here, until someone must act or the window closes. */
function settle(state: GameState): void {
  for (;;) {
    const pw = state.priority;
    if (!pw || state.pendingPrompts.length > 0 || state.winner) return;
    if (wantsStop(state, pw.holder, pw)) return;
    if (passFrom(state, pw) === 'closed') return;
  }
}

/** The holder passes: priority goes to the opponent, or the window closes. */
function passFrom(state: GameState, pw: PriorityWindow): 'closed' | 'passed' {
  if (pw.received) {
    closeWindow(state, pw);
    return 'closed';
  }
  state.priority = { step: pw.step, holder: other(pw.holder), received: true, ...(pw.intent && { intent: pw.intent }) };
  return 'passed';
}

function closeWindow(state: GameState, pw: PriorityWindow): void {
  state.priority = null;
  continuations[pw.step]?.(state, pw);
}

/** The window the player with priority is in, recorded so it can be passed on. */
function recorded(state: GameState): PriorityWindow {
  if (state.priority) return state.priority;
  const step = implicitStep(state);
  if (!step) illegal('There is no paid ability window to pass');
  return { step, holder: priorityHolder(state), received: false };
}

/** A player with priority passes (rules 9.2.4b). */
export function passPriority(state: GameState, side: SideCode, restOfRun = false): void {
  const pw = recorded(state);
  if (pw.holder !== side) illegal(`Waiting for the ${sideName(pw.holder)}`);
  if (restOfRun && state.activeRun && RUN_STEPS.has(pw.step)) {
    state.activeRun.passing = [...new Set([...(state.activeRun.passing ?? []), side])];
  }
  if (passFrom(state, pw) === 'passed') settle(state);
}

/**
 * The active player declares an action (or the Runner jacks out): they pass
 * priority, and the action is carried out once the window closes. Returns
 * true when it should be carried out now (nobody else stops here), false
 * when it waits for the opponent, whose priority has been recorded.
 */
export function declareIntent(state: GameState, action: GameAction, validate: () => void): boolean {
  const pw = recorded(state);
  if (pw.received) {
    // The opponent already passed after the active player got priority back: the window closes now
    state.priority = null;
    return true;
  }
  const offered: PriorityWindow = { step: pw.step, holder: other(pw.holder), received: true, intent: action };
  if (!wantsStop(state, offered.holder, offered)) {
    state.priority = null;
    return true;
  }
  validate(); // throws if the action could not be taken
  state.priority = offered;
  return false;
}

/**
 * After the player with priority used something (rezzed, scored, used an
 * ability, broke a subroutine), they keep priority and the window can no
 * longer close on their next pass; a declared action is dropped.
 */
export function usedOption(state: GameState, side: SideCode): void {
  const pw = state.priority;
  if (pw && pw.holder === side) {
    state.priority = { step: pw.step, holder: side, received: false, acted: true };
  }
  normalizePriority(state);
}

/**
 * Drops a recorded window that no longer applies: the run ended or moved on
 * (an ability ended the run, moved the Runner), or the active player holds
 * priority in their own move again (nothing to record).
 */
export function normalizePriority(state: GameState): void {
  const pw = state.priority;
  if (!pw) return;
  if (state.winner || (RUN_STEPS.has(pw.step) && (!state.activeRun || state.activeRun.accessOnly))) {
    state.priority = null;
    return;
  }
  if (IMPLICIT_STEPS.has(pw.step)) {
    if (implicitStep(state) !== pw.step) state.priority = null;
    else if (pw.holder === state.activePlayer && !pw.received && !pw.intent) state.priority = null;
  }
}

/** The run ended: its windows close with it (rules 6.9.6a). */
export function closeRunWindows(state: GameState): void {
  if (state.priority && RUN_STEPS.has(state.priority.step)) state.priority = null;
}
