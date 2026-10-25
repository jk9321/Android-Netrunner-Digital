import { describe, expect, it } from 'vitest';
import { getCardDefinition } from '../src/core';
import { runScore, serverValue, subroutineCost } from '../src/ai/runs';
import { rezReserve } from '../src/ai/corpAI';
import { installForTest, installIceForTest, installProgramForTest, newGame, startRunnerTurn } from './helpers';

// Small fixed positions that check the AI's judgement directly, rather than through whole games
const PALISADE = '30072'; // barrier, end the run
const BARRIER_BREAKER = '30006';

describe('AI judgement in fixed positions', () => {
  it('prices subroutines by what they do to this Runner', () => {
    const state = newGame();
    expect(subroutineCost(state, 'End the run.')).toBe(Infinity);
    state.runner.grip = state.runner.grip.slice(0, 5);
    expect(subroutineCost(state, 'Do 1 net damage.')).toBe(2);
    state.runner.grip = state.runner.grip.slice(0, 1);
    expect(subroutineCost(state, 'Do 1 net damage.')).toBe(Infinity); // would flatline
  });

  it("won't run into rezzed ice it can't break or afford", () => {
    const state = newGame();
    startRunnerTurn(state);
    installIceForTest(state, PALISADE, 'hq');
    expect(runScore(state, 'hq')).toBe(-Infinity);

    installProgramForTest(state, BARRIER_BREAKER);
    state.runner.credits = 20;
    expect(runScore(state, 'hq')).toBeGreaterThan(-Infinity);
    state.runner.credits = 0;
    expect(runScore(state, 'hq')).toBe(-Infinity);
  });

  it('values R&D above an empty Archives', () => {
    const state = newGame();
    state.corp.archives.faceUp = [];
    state.corp.archives.faceDown = [];
    expect(serverValue(state, 'rd')).toBeGreaterThan(serverValue(state, 'archives'));
  });

  it('keeps money to rez the ice protecting an agenda', () => {
    const state = newGame();
    installForTest(state, 'agenda', 'remote1');
    installIceForTest(state, PALISADE, 'remote1', false);
    const rez = getCardDefinition(PALISADE).cost ?? 0;
    expect(rezReserve(state)).toBe(rez);
    state.corp.servers.remote1.ice[0].isRezzed = true;
    expect(rezReserve(state)).toBe(0);
  });
});
