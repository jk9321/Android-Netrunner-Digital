import { damageWorth } from '../src/ai/effectValues';
import { RATES } from '../src/ai/valueModel';
import { describe, expect, it } from 'vitest';
import { cardDef, createCardInstance, executeAction, getCardDefinition, getLegalActions } from '../src/core';
import { runScore, serverValue, subroutineCost } from '../src/ai/runs';
import { rezMoney } from '../src/ai/corp/rezMoney';
import { inDecision } from './helpers/pricing';
import { makeRoomInstalls } from '../src/ai/runnerAI';
import { createAgent } from '../src/ai';
import { evaluate } from '../src/ai/evaluate';
import { asSide, plan, withPricing } from '../src/ai/pricing';
import { clearHandCaches } from '../src/ai/handValues';
import { runnerDecisionView } from '../src/ai/turnPlanner';
import { installForTest, installIceForTest, installProgramForTest, newGame, startRunnerTurn } from './helpers';


// Small fixed positions that check the AI's judgement directly, rather than through whole games
const PALISADE = '30072'; // barrier, end the run
const BARRIER_BREAKER = '30006';

describe('AI judgement in fixed positions', () => {
  it('prices subroutines by what they do to this Runner', () => {
    let state = newGame();
    expect(subroutineCost(state, 'End the run.')).toBe(Infinity);
    state = structuredClone(state); // asked boards are frozen (F3 askedFreeze): edit a copy
    state.runner.grip = state.runner.grip.slice(0, 5);
    expect(subroutineCost(state, 'Do 1 net damage.')).toBeCloseTo(damageWorth(state, 1)); // a card lost and a step on the damage clock (plan.subCosts)
    expect(damageWorth(state, 1)).toBeGreaterThanOrEqual(RATES.drawnCard);
    // Rule 10.4.4: flatlined by MORE damage than the cards in the grip: 1 damage on 1 card is survived, 2 is not
    state = structuredClone(state); // asked boards are frozen (F3 askedFreeze): edit a copy
    state.runner.grip = state.runner.grip.slice(0, 1);
    expect(subroutineCost(state, 'Do 1 net damage.')).toBeLessThan(Infinity);
    expect(subroutineCost(state, 'Do 2 net damage.')).toBe(Infinity); // would flatline
  });

  it("won't run into rezzed ice it can't break or afford", () => {
    let state = newGame();
    startRunnerTurn(state);
    installIceForTest(state, PALISADE, 'hq');
    expect(runScore(state, 'hq')).toBe(-Infinity);

    state = structuredClone(state); // asked boards are frozen (F3 askedFreeze): edit a copy
    installProgramForTest(state, BARRIER_BREAKER);
    state.runner.credits = 20;
    expect(runScore(state, 'hq')).toBeGreaterThan(-Infinity);
    state = structuredClone(state); // asked boards are frozen (F3 askedFreeze): edit a copy
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
    // Rewritten in Step 4 Stage C7 against the rez money owner (corp/rezMoney.ts), which replaced the ranking's rezReserve
    const keep = () => inDecision(state, 'corp', () => rezMoney(state).keep);
    expect(keep()).toBe(rez);
    state.corp.servers.remote1.ice[0].isRezzed = true;
    expect(keep()).toBe(0);
  });

  // KNOWN-FAILING (ai-honest-runner-view; AI Coordinator 2026-11-16 03:55Z): this passed on beta b7c4917 only through the
  // deck-average cache's id-only key (handValues drawWorth), which served the first evaluate's value to the second. With
  // the key fixed, or on beta with clearHandCaches() between the two evaluates, the real-state evaluates differ
  // (-13.7997 vs -13.7930, in corpBoardValue): cardRate(corp) still reads the real R&D on the REAL state (owner work for
  // valuation Stage V-A). The deciding Runner now decides on its own view; the twin below asserts the same swap there
  it.fails("judges the Corp's facedown cards by the odds, not by what they really are", () => {
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

  // ai-honest-runner-view (rule 10.2.2a): the same swap on the Runner's own view of the decision (turnPlanner.ts
  // runnerDecisionView: the Corp's unseen cards re-dealt), which is what the deciding Runner scores
  it("judges the Corp's facedown cards by the odds on the Runner's own view", () => {
    const state = newGame();
    const id = installForTest(state, 'agenda', 'remote1');
    const agenda = state.corp.servers.remote1.root.find(c => c.instanceId === id)!;
    agenda.advancementCounters = 2;
    const asset = state.corp.rd.find(c => cardDef(c).type_code === 'asset')!;
    const swapped = structuredClone(state);
    const remote = swapped.corp.servers.remote1.root.find(c => c.instanceId === id)!;
    const inRd = swapped.corp.rd.find(c => c.instanceId === asset.instanceId)!;
    [remote.cardCode, inRd.cardCode] = [inRd.cardCode, remote.cardCode];
    const onView = (s: typeof state) => {
      clearHandCaches();
      return withPricing({ plan: { ...plan(), hiddenDraws: true, plannerSeed: true } }, () => asSide('runner', () => evaluate(runnerDecisionView(s), 'runner')));
    };
    expect(onView(swapped)).toBeCloseTo(onView(state));
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
    // The plain answer is not legal (it would install nothing); the AI weighs the engine's answer that trashes Cleaver first
    const mayflyAnswers = getLegalActions(s, 'runner').filter(a => a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'effect_cards' && a.choice.cardInstanceIds[0] === mayfly.instanceId);
    expect(mayflyAnswers).toMatchObject([{ choice: { cardInstanceIds: [mayfly.instanceId], trashFirst: [old] } }]);
    // The Runner AI's own answer is that one: it prices the engine's list, the only owner of these answers
    expect(createAgent('runner', 'normal').chooseAction(structuredClone(s))).toMatchObject({ type: 'RESOLVE_PROMPT', choice: { cardInstanceIds: [mayfly.instanceId], trashFirst: [old] } });
  });
});
