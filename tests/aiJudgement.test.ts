import { RATES } from '../src/ai/valueModel';
import { describe, expect, it } from 'vitest';
import { GameAction, cardDef, createCardInstance, executeAction, getCardDefinition, getLegalActions, isLegalAction } from '../src/core';
import { makeRoomAnswers } from '../src/ai/prompts';
import { runScore, serverValue, subroutineCost } from '../src/ai/runs';
import { HeuristicCorpAI, agendaRemoteNeed, fundedDepth, moneyTarget, unrezzedIceCost, rezReserve, withDeadIceTrashed } from '../src/ai/corpAI';
import { makeRoomInstalls } from '../src/ai/runnerAI';
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
    expect(subroutineCost(state, 'Do 1 net damage.')).toBe(RATES.drawnCard); // a card lost (plan.subCosts)
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

  it('counts unrezzed ice as protection only while the Corp can pay to rez it', () => {
    const state = newGame();
    installForTest(state, 'agenda', 'remote1');
    installIceForTest(state, PALISADE, 'remote1', false);
    installIceForTest(state, PALISADE, 'remote1', false);
    const rez = getCardDefinition(PALISADE).cost ?? 0;
    expect(agendaRemoteNeed(state)).toBe(2 * rez);
    const server = state.corp.servers.remote1;
    expect(fundedDepth(state, server, 2 * rez)).toBe(2);
    expect(fundedDepth(state, server, rez)).toBe(1);
    expect(fundedDepth(state, server, rez - 1)).toBe(0); // broke: no protection at all
  });

  it('aims to hold enough to rez the unrezzed ice on the centrals', () => {
    const state = newGame();
    installIceForTest(state, PALISADE, 'rd', false);
    installIceForTest(state, PALISADE, 'hq', false);
    installIceForTest(state, PALISADE, 'archives', false); // Archives doesn't count
    const rez = getCardDefinition(PALISADE).cost ?? 0;
    expect(moneyTarget(state)).toBe(2 * rez);
    state.corp.servers.rd.ice[0].isRezzed = true;
    expect(moneyTarget(state)).toBe(rez);
  });

  it('counts what rezzing all its unrezzed ice would cost (ice pacing)', () => {
    const state = newGame();
    installIceForTest(state, PALISADE, 'rd', false);
    installIceForTest(state, PALISADE, 'hq', true);
    expect(unrezzedIceCost(state)).toBe(getCardDefinition(PALISADE).cost ?? 0);
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
    expect(chosen).toMatchObject({ trashFirst: [weak] });
    expect(isLegalAction(s, chosen)).toBe(true);
    // Only 1 ice on the server: nothing to save, leave it
    s.corp.servers.hq.ice = s.corp.servers.hq.ice.filter(c => c.instanceId !== unrezzed);
    expect(withDeadIceTrashed(s, install)).toBe(install);
  });

  it('Runner AI considers trashing a program when memory is full (rules 8.5.6c)', () => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.credits = 20;
    const old = installProgramForTest(s, '30006'); // Cleaver (1 MU)
    s.runner.memoryUnitsUsed = s.runner.memoryUnitsTotal - 1;
    const program = createCardInstance(s, '30032'); // Mayfly (2 MU)
    s.runner.grip.push(program);
    const mine = () => makeRoomInstalls(s).filter(a => 'cardInstanceId' in a && a.cardInstanceId === program.instanceId);
    expect(mine()).toEqual([{ type: 'INSTALL_CARD', player: 'runner', cardInstanceId: program.instanceId, trashFirst: [old] }]);
    s.runner.memoryUnitsUsed = 0;
    expect(mine()).toEqual([]);
  });

  it('Runner AI considers trashing a program to answer an install prompt when memory is full (rules 8.5.6c)', () => {
    let s = newGame();
    startRunnerTurn(s);
    const old = installProgramForTest(s, '30006'); // Cleaver (1 MU)
    s.runner.memoryUnitsUsed = s.runner.memoryUnitsTotal - 1;
    const mayfly = createCardInstance(s, '30032'); // Mayfly (2 MU)
    s.runner.heap = [mayfly];
    const scrounge = createCardInstance(s, '35004');
    s.runner.grip.push(scrounge);
    s.runner.clicks = 2;
    s = executeAction(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'runner', cardInstanceId: scrounge.instanceId });
    // The plain answer installs nothing; the AI also weighs the answer that trashes Cleaver first
    const plain = getLegalActions(s, 'runner').find(a => a.type === 'RESOLVE_PROMPT')!;
    expect(makeRoomAnswers(s, plain)).toMatchObject([{ choice: { cardInstanceIds: [mayfly.instanceId], trashFirst: [old] } }]);
  });

  it('Corp trashes weak ice to install where money is tight, not when it has plenty (rules 8.5.6b)', () => {
    const s = newGame();
    const weak = () => {
      const ice = createCardInstance(s, '30072'); // Palisade: Cleaver gets through for 1
      ice.isRezzed = true;
      return ice;
    };
    s.corp.servers.rd.ice = [weak(), weak()];
    s.corp.hq = [createCardInstance(s, '30073')]; // Tithe
    s.runner.rig.programs = [createCardInstance(s, '30006')];
    const best = (credits: number) => {
      s.corp.credits = credits;
      return new HeuristicCorpAI().rankMainActions(s).find(r => r.action.type === 'INSTALL_CARD' && r.action.targetServerId === 'rd')!.action;
    };
    expect(best(8)).not.toHaveProperty('trashFirst');
    // 2 credits: R&D's install cost would leave nothing to rez Tithe; trashing a Palisade makes it work
    expect(best(2)).toMatchObject({ trashFirst: [s.corp.servers.rd.ice[0].instanceId] });
  });
});
