import { describe, it, expect } from 'vitest';
import { executeAction, getLegalActions, isLegalAction, IllegalActionError } from '../src/core';
import { newGame, putInHand, startRunnerTurn } from './helpers';

describe('Legal actions', () => {
  it('every listed action executes without error', () => {
    const state = newGame(3);
    for (const side of ['corp', 'runner'] as const) {
      for (const action of getLegalActions(state, side)) {
        expect(() => executeAction(state, action)).not.toThrow();
      }
    }
  });

  it('offers basic click actions and installs on the Corp turn', () => {
    const state = newGame(3);
    const types = new Set(getLegalActions(state, 'corp').map(a => a.type));
    expect(types).toContain('GAIN_CREDIT');
    expect(types).toContain('DRAW_CARD');
    expect(types).toContain('INSTALL_CARD');
    expect(types).not.toContain('END_TURN'); // clicks must be spent first
  });

  it('drops click actions once clicks run out', () => {
    let state = newGame(3);
    for (let i = 0; i < 3; i++) state = executeAction(state, { type: 'GAIN_CREDIT', player: 'corp' });
    const types = new Set(getLegalActions(state, 'corp').map(a => a.type));
    expect(types).not.toContain('GAIN_CREDIT');
    expect(types).toContain('END_TURN');
  });

  it('only offers run actions to the Runner during a run', () => {
    let state = newGame(3);
    startRunnerTurn(state);
    state = executeAction(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'rd' });
    // No ice passed yet, so the Runner cannot jack out
    expect(getLegalActions(state, 'runner').map(a => a.type).sort()).toEqual(['CONTINUE_RUN']);
    expect(getLegalActions(state, 'corp')).toEqual([]);
  });

  it('rejects illegal actions with a typed error', () => {
    const state = newGame(3);
    state.corp.clicks = 0;
    expect(() => executeAction(state, { type: 'GAIN_CREDIT', player: 'corp' })).toThrow(IllegalActionError);
    expect(isLegalAction(state, { type: 'GAIN_CREDIT', player: 'corp' })).toBe(false);
  });

  it('lists ice installs for each server', () => {
    const state = newGame(3);
    const iceId = putInHand(state, 'corp', 'ice');
    const iceInstalls = getLegalActions(state, 'corp').filter(
      a => a.type === 'INSTALL_CARD' && a.cardInstanceId === iceId
    );
    // new remote + HQ, R&D, Archives
    expect(iceInstalls).toHaveLength(4);
  });
});
