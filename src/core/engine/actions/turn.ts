import { ConcedeAction, EndTurnAction, StartTurnAction } from '../../types/actions';
import { SideCode } from '../../types/card';
import { GameState } from '../../types/state';
import { addLog } from '../log';
import { requireActionPhase, illegal } from '../helpers';
import { pushPrompt, sideName } from '../prompts';
import { fireTrigger } from '../triggers';
import { maxHandSize, refillRecurringCredits, turnFlag, TurnFlag } from '../cardEffects';
import { flatline } from '../damage';
import { onWindowClose, openWindow, passPriority } from '../priority';

export function handSize(state: GameState, side: SideCode): number {
  return side === 'corp' ? state.corp.hq.length : state.runner.grip.length;
}

/** A player may concede at any time, even mid-run or while a decision is pending; the other side wins. */
export function concede(state: GameState, action: ConcedeAction): void {
  const winner: SideCode = action.player === 'corp' ? 'runner' : 'corp';
  state.winner = winner;
  state.winReason = `${sideName(action.player)} conceded`;
  addLog(state, 'system', `${sideName(winner)} wins: ${sideName(action.player)} conceded.`);
}

/**
 * Ends the action phase. The rest of the turn (discard phase, handing over)
 * is a sequence of steps that pauses whenever a card ability asks a question
 * and carries on from resumeTurn() once it is answered.
 */
export function endTurn(state: GameState, action: EndTurnAction): void {
  const side = action.player;
  requireActionPhase(state, side);
  if (state[side].clicks > 0) illegal('You must spend all clicks before ending your turn');
  if (state.turnStep) illegal('The turn is already ending');
  state.turnStep = { kind: 'end_turn', side, stage: 'action_ended' };
  fireTrigger(state, { type: 'action_phase_ends', side });
  resumeTurn(state);
}

/** Carries the end of a turn or the Corp's draw forward until a prompt needs an answer. */
export function resumeTurn(state: GameState): void {
  while (state.turnStep && state.pendingPrompts.length === 0 && !state.winner) {
    const step = state.turnStep;
    if (step.kind === 'corp_draw') {
      state.turnStep = null;
      mandatoryDraw(state);
      continue;
    }
    if (step.kind === 'corp_turn_start' || step.kind === 'runner_turn_start') return; // a paid ability window is open
    const side = step.side;
    switch (step.stage) {
      case 'action_ended': {
        const limit = maxHandSize(state, side);
        if (side === 'runner' && limit < 0) {
          // Core damage can push the maximum hand size below 0: the Runner is flatlined.
          state.turnStep = null;
          flatline(state);
          return;
        }
        const excess = handSize(state, side) - Math.max(0, limit);
        if (excess > 0) {
          step.stage = 'discarding';
          pushPrompt(state, {
            kind: 'discard',
            side,
            count: excess,
            message: `${sideName(side)}: discard ${excess} card(s) down to your maximum hand size of ${limit}.`,
          });
          return;
        }
        step.stage = 'discarded';
        break;
      }
      case 'discarding':
        return; // waiting on the discard prompt
      case 'discarded':
        // The paid ability window after discarding (rules 5.6.3b, 5.7.2b); the turn ends when it closes
        step.stage = 'discard_window';
        openWindow(state, side === 'corp' ? 'corp_discard' : 'runner_discard');
        return;
      case 'discard_window':
        return; // waiting on the window
      case 'handover':
        state.turnStep = null;
        handOver(state, side);
        break;
    }
  }
}

/** After the discard prompt is answered: the discard phase continues. */
export function finishDiscard(state: GameState): void {
  const step = state.turnStep;
  if (step?.kind === 'end_turn' && step.stage === 'discarding') step.stage = 'discarded';
}

/** Hands the turn to the other player. */
function handOver(state: GameState, side: SideCode): void {
  if (side === 'runner') {
    state.runnerLastTurnRuns = state.runsThisTurn;
    // "Play only if the Runner stole or trashed a Corp card during their last turn" (Oppo Research)
    state.runnerLastTurnStoleOrTrashed = turnFlag(state, TurnFlag.agendasStolen) + turnFlag(state, TurnFlag.runnerTrashedCorpCards) > 0;
  }
  state.runsThisTurn = [];
  state.turnFlags = {};
  if (side === 'corp') {
    state.activePlayer = 'runner';
    state.phase = 'runner_turn';
    // Caveat Emptor: +1 or -1 allotted click for this turn
    const bonus = state.runner.bonusClicksNextTurn ?? 0;
    state.runner.clicks = Math.max(0, state.runner.maxClicks + bonus);
    state.runner.bonusClicksNextTurn = 0;
    addLog(state, 'corp', `Corp ended turn. Runner turn begins (${state.runner.clicks} clicks).`);
    // The paid ability window before the Runner's turn formally begins (rules 5.7.1b)
    state.turnStep = { kind: 'runner_turn_start' };
    openWindow(state, 'runner_turn_start');
    return;
  }
  state.turnNumber += 1;
  addLog(state, 'system', `--- Turn ${state.turnNumber} ---`);
  beginCorpTurn(state);
}

/**
 * Starts a Corp turn (rules 5.6.1): the Corp gains clicks, then gets a paid
 * ability window (rez non-ice cards, score, paid abilities) before the turn
 * formally begins. START_TURN is the Corp passing in it.
 */
export function beginCorpTurn(state: GameState): void {
  state.activePlayer = 'corp';
  state.phase = 'corp_turn';
  const bonus = state.corp.bonusClicksNextTurn ?? 0;
  state.corp.clicks = state.corp.maxClicks + bonus;
  state.corp.bonusClicksNextTurn = 0;
  if (bonus > 0) addLog(state, 'corp', `Corp gets ${bonus} extra [click] this turn.`);
  state.turnStep = { kind: 'corp_turn_start' };
  openWindow(state, 'corp_draw');
}

/** The Corp passes in the window before their turn begins (gameEngine treats START_TURN as passing). */
export function startTurn(state: GameState, action: StartTurnAction): void {
  if (action.player !== 'corp' || state.turnStep?.kind !== 'corp_turn_start') illegal('Not waiting to start a turn');
  passPriority(state, 'corp');
}

// The window before the Corp's turn begins closed: recurring credits, "when your turn begins", then the mandatory draw
onWindowClose('corp_draw', state => {
  state.turnStep = null;
  continueCorpTurnStart(state);
});

// The window before the Runner's turn begins closed: recurring credits, then "when your turn begins" (5.7.1c-d)
onWindowClose('runner_turn_start', state => {
  state.turnStep = null;
  refillRecurringCredits(state, 'runner');
  fireTrigger(state, { type: 'turn_begins', side: 'runner' });
});

// The window after discarding closed: the turn formally ends (5.6.3d, 5.7.2d)
for (const step of ['corp_discard', 'runner_discard'] as const) {
  onWindowClose(step, state => {
    const turn = state.turnStep;
    if (turn?.kind !== 'end_turn' || turn.stage !== 'discard_window') return;
    turn.stage = 'handover';
    fireTrigger(state, { type: 'discard_phase_ends', side: turn.side });
    resumeTurn(state);
  });
}

function continueCorpTurnStart(state: GameState): void {
  refillRecurringCredits(state, 'corp');
  fireTrigger(state, { type: 'turn_begins', side: 'corp' });
  if (state.winner) return;
  state.turnStep = { kind: 'corp_draw' };
  resumeTurn(state);
}

function mandatoryDraw(state: GameState): void {
  if (state.corp.rd.length === 0) {
    state.winner = 'runner';
    state.winReason = 'Corp decked out (R&D empty during mandatory draw)';
    addLog(state, 'system', 'Runner wins: Corp cannot perform mandatory draw from empty R&D.');
    return;
  }
  state.corp.hq.push(state.corp.rd.shift()!);
  addLog(state, 'corp', `Corp gained ${state.corp.clicks} clicks and drew 1 card (Mandatory Draw).`);
}
