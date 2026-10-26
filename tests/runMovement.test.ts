import { describe, expect, it } from 'vitest';
import { executeAction, isLegalAction } from '../src/core';
import { HeuristicRunnerAI } from '../src/ai';
import { installIceForTest, newGame, startRunnerTurn, step } from './helpers';

// The Movement Phase (rules 6.9.4): the Runner may jack out after passing ice,
// before the Corp's next chance to rez, and never once the next ice is approached.

const PALISADE = '30072';
const jackOut = { type: 'JACK_OUT', player: 'runner' } as const;

function runnerTurn() {
  const s = newGame();
  startRunnerTurn(s);
  return s;
}

describe('Jacking out', () => {
  it('is allowed after passing ice, and not after the Corp rezzes the next ice', () => {
    let s = runnerTurn();
    installIceForTest(s, PALISADE, 'remote-1', false); // inner
    installIceForTest(s, PALISADE, 'remote-1', false); // outer
    s.corp.credits = 20;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote-1' });
    expect(isLegalAction(s, jackOut)).toBe(false); // approaching the outer ice
    s = step(s); // pass it unrezzed
    expect(s.activeRun?.phase).toBe('movement');
    expect(isLegalAction(s, jackOut)).toBe(true);
    s = step(s); // keep going: approach the inner ice
    expect(s.activeRun?.phase).toBe('approach_ice');
    const inner = s.corp.servers['remote-1'].ice[0];
    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: inner.instanceId });
    expect(isLegalAction(s, jackOut)).toBe(false);
  });

  it('is allowed before approaching a server with no ice (rules 6.1.5b)', () => {
    let s = runnerTurn();
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    expect(s.activeRun?.phase).toBe('movement');
    s = executeAction(s, jackOut);
    expect(s.activeRun).toBeNull();
    expect(s.runsThisTurn[0].successful).toBe(false);
  });

  it('is not allowed once the Runner is about to approach the server', () => {
    let s = runnerTurn();
    s = step(executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' }));
    expect(s.activeRun?.phase).toBe('approach_server');
    expect(isLegalAction(s, jackOut)).toBe(false);
  });

  it('the Runner AI decides in the Movement Phase, not after seeing a rez', () => {
    let s = runnerTurn();
    installIceForTest(s, PALISADE, 'remote-1', false);
    s.corp.credits = 20;
    s.runner.credits = 0;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote-1' });
    const inner = s.corp.servers['remote-1'].ice[0];
    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: inner.instanceId });
    expect(new HeuristicRunnerAI().chooseAction(s).type).not.toBe('JACK_OUT');
  });
});
