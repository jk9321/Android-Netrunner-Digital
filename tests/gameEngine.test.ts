import { describe, it, expect } from 'vitest';
import { executeAction } from '../src/core';
import { newGame, answer, startRunnerTurn } from './helpers';

describe('Netrunner Rules Engine', () => {
  it('initializes game state correctly according to official rules', () => {
    const state = newGame();

    // Turn 1 Corp starts
    expect(state.activePlayer).toBe('corp');
    expect(state.turnNumber).toBe(1);

    // Corp starting resources
    expect(state.corp.credits).toBe(5);
    expect(state.corp.clicks).toBe(3);
    expect(state.corp.hq.length).toBe(6); // 5-card opening hand + turn-1 mandatory draw
    expect(state.corp.servers.hq).toBeDefined();
    expect(state.corp.servers.rd).toBeDefined();
    expect(state.corp.servers.archives).toBeDefined();

    // Runner starting resources
    expect(state.runner.credits).toBe(5);
    expect(state.runner.clicks).toBe(0); // gained when the Runner's turn begins
    expect(state.runner.grip.length).toBe(5);
  });

  it('handles gaining credits via clicks', () => {
    let state = newGame();

    state = executeAction(state, { type: 'GAIN_CREDIT', player: 'corp' });
    expect(state.corp.credits).toBe(6);
    expect(state.corp.clicks).toBe(2);
  });

  it('transitions turn from Corp to Runner properly', () => {
    let state = newGame();

    // Corp spends 3 clicks
    state = executeAction(state, { type: 'GAIN_CREDIT', player: 'corp' });
    state = executeAction(state, { type: 'GAIN_CREDIT', player: 'corp' });
    state = executeAction(state, { type: 'GAIN_CREDIT', player: 'corp' });
    expect(state.corp.clicks).toBe(0);

    // End corp turn
    state = executeAction(state, { type: 'END_TURN', player: 'corp' });
    // 6 cards in HQ after the turn-1 draw: discard 1 before the turn passes
    expect(state.activePlayer).toBe('corp');
    expect(state.pendingPrompts[0]).toMatchObject({ kind: 'discard', side: 'corp', count: 1 });
    state = answer(state, { kind: 'discard', cardInstanceIds: [state.corp.hq[0].instanceId] });
    expect(state.corp.archives.faceDown).toHaveLength(1);
    expect(state.activePlayer).toBe('runner');
    expect(state.phase).toBe('runner_turn');
    expect(state.runner.clicks).toBe(4);
  });

  it('allows Runner to initiate and complete a run on a central server', () => {
    let state = newGame();

    // Pass turn to runner
    startRunnerTurn(state);

    // Initiate run on HQ
    state = executeAction(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    expect(state.activeRun).toBeDefined();
    expect(state.activeRun?.server).toBe('hq');
    expect(state.runner.clicks).toBe(3);

    // HQ has no ice: the Runner may jack out, then goes on to approach the server and access
    expect(state.activeRun?.phase).toBe('movement');
    state = executeAction(state, { type: 'CONTINUE_RUN', player: 'runner' });
    expect(state.activeRun?.phase).toBe('approach_server');
    state = executeAction(state, { type: 'CONTINUE_RUN', player: 'runner' });
    expect(state.activeRun).toBeNull(); // Run completed
    expect(state.phase).toBe('runner_turn');
  });
});
