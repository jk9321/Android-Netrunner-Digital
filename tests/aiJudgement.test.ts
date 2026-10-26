import { describe, expect, it } from 'vitest';
import { GameAction, cardDef, createCardInstance, getCardDefinition, isLegalAction } from '../src/core';
import { runScore, serverValue, subroutineCost } from '../src/ai/runs';
import { rezReserve, withDeadIceTrashed } from '../src/ai/corpAI';
import { evaluate } from '../src/ai/evaluate';
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

  it("judges the Corp's facedown cards by the odds, not by what they really are", () => {
    const state = newGame();
    const id = installForTest(state, 'agenda', 'remote1');
    const agenda = state.corp.servers.remote1.root.find(c => c.instanceId === id)!;
    agenda.advancementCounters = 2;
    const asset = state.corp.rd.find(c => cardDef(c).type_code === 'asset')!;
    // The same position with the remote card and an R&D asset swapped: the Runner can't tell them apart
    const swapped = structuredClone(state);
    const remote = swapped.corp.servers.remote1.root.find(c => c.instanceId === id)!;
    const inRd = swapped.corp.rd.find(c => c.instanceId === asset.instanceId)!;
    [remote.cardCode, inRd.cardCode] = [inRd.cardCode, remote.cardCode];
    expect(evaluate(swapped, 'runner')).toBeCloseTo(evaluate(state, 'runner'));
    // The Corp knows its own cards
    expect(evaluate(swapped, 'corp')).not.toBeCloseTo(evaluate(state, 'corp'));
  });

  it('Corp trashes ice the Runner breaks for a credit when installing much tougher ice behind it (rules 8.5.6b)', () => {
    const s = newGame();
    installProgramForTest(s, '30006'); // Cleaver
    const weak = installIceForTest(s, '30072', 'hq'); // Palisade: 1 credit with Cleaver
    const unrezzed = installIceForTest(s, '30072', 'hq', false);
    const tough = createCardInstance(s, '30054'); // Funhouse: no decoder to break it
    s.corp.hq.push(tough);
    const install: GameAction = { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: tough.instanceId, targetServerId: 'hq' };
    const chosen = withDeadIceTrashed(s, install);
    expect(chosen).toMatchObject({ trashIceIds: [weak] });
    expect(isLegalAction(s, chosen)).toBe(true);
    // Only 1 ice on the server: nothing to save, leave it
    s.corp.servers.hq.ice = s.corp.servers.hq.ice.filter(c => c.instanceId !== unrezzed);
    expect(withDeadIceTrashed(s, install)).toBe(install);
  });
});
