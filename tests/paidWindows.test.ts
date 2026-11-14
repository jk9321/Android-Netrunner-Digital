import { describe, expect, it } from 'vitest';
import { GameAction, GameState, SideCode, StopLevel, actingSide, currentStep, executeAction, getLegalActions, isLegalAction } from '../src/core';
import { installCorpForTest, installIceForTest, newGame, newGameAtSetup, startRunnerTurn } from './helpers';

/**
 * The paid ability windows of the turn and run structure (rules 9.2.7a lists
 * 11), how priority passes in each (rules 9.2.7a: the active player first,
 * and the window closes when a player who received priority from the
 * opponent passes without acting), and the stop levels that auto-pass a
 * player's priority (full control stops everywhere).
 */

const PALISADE = '30072'; // Barrier, rez 3
const MANEGARM = '30042'; // Manegarm Skunkworks: upgrade, rez 2

const stops = (state: GameState, level: StopLevel, sides: SideCode[] = ['corp', 'runner']): GameState =>
  sides.reduce((s, side) => executeAction(s, { type: 'SET_STOPS', player: side, level }), state);

/** Where the game is: the window, who holds priority in it, and whose turn it is. */
const at = (state: GameState) => ({ step: currentStep(state), holder: actingSide(state) });

/** The player with priority passes: PASS, or the Corp's Start turn, or the Runner's Continue in a run. */
function pass(state: GameState): GameState {
  const side = actingSide(state)!;
  const legal = getLegalActions(state, side);
  const prompt = legal.find(a => a.type === 'RESOLVE_PROMPT');
  const action = state.pendingPrompts.length > 0 ? prompt : legal.find(a => a.type === 'PASS') ?? legal.find(a => a.type === 'START_TURN') ?? legal.find(a => a.type === 'CONTINUE_RUN');
  if (!action) throw new Error(`${side} cannot pass: ${legal.map(a => a.type).join(', ')}`);
  return executeAction(state, action);
}

const act = (state: GameState, action: GameAction) => executeAction(state, action);

/** The Corp ends its turn with no clicks left and, with both on full control, the game walks every turn window. */
function corpEndsTurn(state: GameState): GameState {
  state.corp.clicks = 0;
  return act(state, { type: 'END_TURN', player: 'corp' });
}

describe('turn windows with full control (rules 5.6, 5.7)', () => {
  it('stops before each Corp action for the Runner, then carries out the declared action (5.6.2a)', () => {
    let state = stops(newGame(), 'full');
    const credits = state.corp.credits;
    expect(at(state)).toEqual({ step: 'corp_action', holder: 'corp' });
    state = act(state, { type: 'GAIN_CREDIT', player: 'corp' });
    // Taking an action passes priority; the Runner gets its chance first
    expect(at(state)).toEqual({ step: 'corp_action', holder: 'runner' });
    expect(state.corp.credits).toBe(credits);
    expect(state.priority?.intent?.type).toBe('GAIN_CREDIT');
    // The Runner may not take actions of its own here, only abilities or pass
    expect(isLegalAction(state, { type: 'GAIN_CREDIT', player: 'runner' })).toBe(false);
    state = pass(state);
    expect(state.corp.credits).toBe(credits + 1);
    expect(at(state)).toEqual({ step: 'corp_action', holder: 'corp' });
  });

  it('walks the discard window, the Runner turn start window and the Runner action window (5.6.3b, 5.7.1b, 5.7.1e)', () => {
    let state = corpEndsTurn(stops(newGame(), 'full'));
    // The Runner gets priority before the Corp's turn ends (the declared end of turn waits)
    expect(at(state)).toEqual({ step: 'corp_action', holder: 'runner' });
    state = pass(state);
    // Discarding down to hand size is not a window; the window follows it
    while (state.pendingPrompts.length > 0) state = pass(state);
    expect(at(state)).toEqual({ step: 'corp_discard', holder: 'corp' });
    state = pass(state);
    expect(at(state)).toEqual({ step: 'corp_discard', holder: 'runner' });
    state = pass(state);
    expect(state.activePlayer).toBe('runner');
    expect(at(state)).toEqual({ step: 'runner_turn_start', holder: 'runner' });
    // Clicks are gained before this window (5.7.1a)
    expect(state.runner.clicks).toBe(state.runner.maxClicks);
    state = pass(state);
    expect(at(state)).toEqual({ step: 'runner_turn_start', holder: 'corp' });
    state = pass(state);
    expect(at(state)).toEqual({ step: 'runner_action', holder: 'runner' });
  });

  it('opens the Runner discard window and the Corp draw window (5.7.2b, 5.6.1b)', () => {
    let state = stops(newGame(), 'full');
    startRunnerTurn(state);
    state.runner.clicks = 0;
    state = act(state, { type: 'END_TURN', player: 'runner' });
    expect(at(state)).toEqual({ step: 'runner_action', holder: 'corp' });
    state = pass(state);
    while (state.pendingPrompts.length > 0) state = pass(state);
    expect(at(state)).toEqual({ step: 'runner_discard', holder: 'runner' });
    state = pass(pass(state));
    expect(state.activePlayer).toBe('corp');
    expect(at(state)).toEqual({ step: 'corp_draw', holder: 'corp' });
    const hq = state.corp.hq.length;
    // The Corp's pass here is Start turn; then the Runner has priority before the draw
    expect(isLegalAction(state, { type: 'START_TURN', player: 'corp' })).toBe(true);
    state = pass(state);
    expect(at(state)).toEqual({ step: 'corp_draw', holder: 'runner' });
    expect(state.corp.hq.length).toBe(hq);
    state = pass(state);
    expect(state.corp.hq.length).toBe(hq + 1);
    expect(at(state)).toEqual({ step: 'corp_action', holder: 'corp' });
  });
});

describe('run windows with full control (rules 6.9)', () => {
  function runOn(state: GameState, server: string): GameState {
    startRunnerTurn(state);
    state = act(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: server });
    // The Corp's priority before the run action is carried out (5.7.1e)
    expect(at(state)).toEqual({ step: 'runner_action', holder: 'corp' });
    return pass(state);
  }

  it('walks initiation, approach, movement and the approach to the server (6.9.1e, 6.9.2b, 6.9.4b, 6.9.4e)', () => {
    const state = stops(newGame(), 'full');
    installIceForTest(state, PALISADE, 'hq', false);
    let s = runOn(state, 'hq');
    const seen: string[] = [];
    while (s.activeRun) {
      const { step, holder } = at(s);
      seen.push(`${step}:${holder}`);
      s = pass(s);
    }
    expect(seen).toEqual([
      'run_initiation:runner',
      'run_initiation:corp',
      'approach_ice:runner',
      'approach_ice:corp',
      // Unrezzed ice is passed without an encounter (6.9.2c)
      'movement:runner',
      'movement:corp',
      'approach_server:runner',
      'approach_server:corp',
    ]);
  });

  it('has a move-inward window before inner ice (6.9.4e)', () => {
    const state = stops(newGame(), 'full');
    installIceForTest(state, PALISADE, 'hq', false);
    installIceForTest(state, PALISADE, 'hq', false);
    let s = runOn(state, 'hq');
    const seen: string[] = [];
    while (s.activeRun) {
      seen.push(`${at(s).step}:${at(s).holder}`);
      s = pass(s);
    }
    expect(seen.slice(4, 10)).toEqual([
      'movement:runner',
      'movement:corp',
      'move_inward:runner',
      'move_inward:corp',
      'approach_ice:runner',
      'approach_ice:corp',
    ]);
  });

  it('has an encounter window at rezzed ice, before subroutines fire (6.9.3b)', () => {
    const state = stops(newGame(), 'full');
    installIceForTest(state, PALISADE, 'hq', true);
    let s = runOn(state, 'hq');
    while (at(s).step !== 'encounter') s = pass(s);
    expect(at(s)).toEqual({ step: 'encounter', holder: 'runner' });
    s = pass(s);
    expect(at(s)).toEqual({ step: 'encounter', holder: 'corp' });
    expect(s.activeRun?.phase).toBe('encounter_ice');
    // The Corp passes: unbroken subroutines resolve and Palisade ends the run
    s = pass(s);
    expect(s.activeRun).toBeNull();
  });

  it('lets a player pass the rest of the run', () => {
    const state = stops(newGame(), 'full');
    installIceForTest(state, PALISADE, 'hq', false);
    let s = runOn(state, 'hq');
    s = pass(s); // Runner passes initiation
    expect(at(s)).toEqual({ step: 'run_initiation', holder: 'corp' });
    s = act(s, { type: 'PASS', player: 'corp', restOfRun: true });
    // The Corp no longer stops, not even at the unrezzed ice
    while (s.activeRun) {
      expect(at(s).holder).toBe('runner');
      s = pass(s);
    }
  });

  it('jacking out in the movement phase waits for the Corp, and happens when it passes (6.9.4b)', () => {
    const state = stops(newGame(), 'full');
    installIceForTest(state, PALISADE, 'hq', false);
    let s = runOn(state, 'hq');
    while (at(s).step !== 'movement') s = pass(s);
    s = act(s, { type: 'JACK_OUT', player: 'runner' });
    expect(s.activeRun).not.toBeNull();
    expect(at(s)).toEqual({ step: 'movement', holder: 'corp' });
    s = pass(s);
    expect(s.activeRun).toBeNull();
  });
});

describe('acting in a window', () => {
  it("drops the active player's declared action when the opponent acts first, and gives priority back (9.2.7a)", () => {
    let state = stops(newGame(), 'full');
    const manegarm = installCorpForTest(state, MANEGARM, 'hq');
    state.corp.credits = 10;
    startRunnerTurn(state);
    const clicks = state.runner.clicks;
    state = act(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    expect(at(state)).toEqual({ step: 'runner_action', holder: 'corp' });
    state = act(state, { type: 'REZ_CARD', player: 'corp', cardInstanceId: manegarm });
    // The Corp keeps priority after acting; the declared run is gone
    expect(at(state)).toEqual({ step: 'runner_action', holder: 'corp' });
    expect(state.priority?.intent).toBeUndefined();
    state = pass(state);
    expect(at(state)).toEqual({ step: 'runner_action', holder: 'runner' });
    expect(state.activeRun).toBeNull();
    expect(state.runner.clicks).toBe(clicks);
  });
});

describe('auto-skip', () => {
  it('passes for players with nothing to do: runs and actions go straight through', () => {
    let state = stops(newGame(), 'auto');
    state = act(state, { type: 'GAIN_CREDIT', player: 'corp' });
    expect(at(state)).toEqual({ step: 'corp_action', holder: 'corp' });
    startRunnerTurn(state);
    installIceForTest(state, PALISADE, 'hq', true);
    state = act(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    // Straight to the rezzed ice; the Corp has no unrezzed card and no ability to use
    expect(at(state)).toEqual({ step: 'approach_ice', holder: 'runner' });
    state = act(state, { type: 'CONTINUE_RUN', player: 'runner' });
    expect(at(state)).toEqual({ step: 'encounter', holder: 'runner' });
  });

  it('stops the Corp at unrezzed ice and before the server only when it can rez there', () => {
    for (const credits of [0, 20]) {
      let state = stops(newGame(), 'auto');
      installIceForTest(state, PALISADE, 'hq', false);
      installCorpForTest(state, MANEGARM, 'hq');
      state.corp.credits = credits;
      startRunnerTurn(state);
      state = act(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
      expect(at(state)).toEqual({ step: 'approach_ice', holder: 'runner' });
      state = act(state, { type: 'CONTINUE_RUN', player: 'runner' });
      const seen: string[] = [];
      while (state.activeRun) {
        if (at(state).holder === 'corp') seen.push(at(state).step!);
        state = pass(state);
      }
      expect(seen).toEqual(credits ? ['approach_ice', 'approach_server'] : []);
    }
  });

  it('stops the Corp before the Runner turn begins only when it can rez or use something', () => {
    for (const credits of [0, 20]) {
      let state = stops(newGame(), 'auto');
      installCorpForTest(state, MANEGARM, 'remote-1');
      state = corpEndsTurn(state);
      state.corp.credits = credits;
      while (state.pendingPrompts.length > 0 || at(state).holder !== state.activePlayer) {
        if (at(state).step === 'runner_turn_start') break;
        state = pass(state);
      }
      expect(at(state).step === 'runner_turn_start' && at(state).holder === 'corp').toBe(credits > 0);
    }
  });

  it('with none, passes every window of the opponent, even unrezzed ice; the player\'s own moves still wait', () => {
    let state = stops(newGame(), 'none');
    installIceForTest(state, PALISADE, 'hq', false);
    installCorpForTest(state, MANEGARM, 'hq');
    state.corp.credits = 20;
    startRunnerTurn(state);
    state = act(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    const seen: string[] = [];
    while (state.activeRun) {
      seen.push(`${at(state).step}:${at(state).holder}`);
      state = pass(state);
    }
    expect(seen.every(s => s.endsWith(':runner'))).toBe(true);
    expect(seen).toContain('approach_ice:runner');
  });

  it('leaves the action phase fully playable after auto-passing the turn start (no stale legal actions)', () => {
    let state = stops(newGameAtSetup(), 'auto');
    // Nothing to do before the turn begins: the Corp's window passes by itself
    while (state.pendingPrompts.length > 0) state = pass(state);
    expect(at(state)).toEqual({ step: 'corp_action', holder: 'corp' });
    const types = new Set(getLegalActions(state, 'corp').map(a => a.type));
    expect(types).toContain('GAIN_CREDIT');
    expect(types).toContain('INSTALL_CARD');
    expect(types).not.toContain('START_TURN');
  });

  it("keeps the AI's stops when it plays: no stop before the Runner's turn", () => {
    let state = stops(newGame(), 'ai');
    installCorpForTest(state, MANEGARM, 'remote-1');
    state = corpEndsTurn(state);
    while (state.pendingPrompts.length > 0) state = pass(state);
    expect(at(state)).toEqual({ step: 'runner_action', holder: 'runner' });
  });
});
