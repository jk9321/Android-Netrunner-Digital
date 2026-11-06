import { describe, expect, it } from 'vitest';
import { GameState, activePrompt, cardDef, executeAction } from '../src/core';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { answerPrompt } from '../src/ai/prompts';
import { iceWorth } from '../src/ai/iceValues';
import { pendingFreeRezzes } from '../src/ai/freeRez';
import { tuning } from '../src/ai/synergy';
import { RATES } from '../src/ai/valueModel';
import { giveCard, installCorpForTest, installIceForTest, installProgramForTest, newGame } from './helpers';
import { legacyRanking } from './legacyRanking';

// plan.oneCurrency: these pin the old Corp ranking (tests/legacyRanking.ts)
legacyRanking(["installs Pharos it cannot pay for while Send a Message waits on the board (ice pacing)", "with Send a Message one advance from scored and 4 credits, installs Pharos first and rezzes it for free"]);

const PALISADE = '30072'; // barrier, rez 3
const WHITESPACE = '30074'; // code gate
const PHAROS = '30063'; // barrier, rez 7
const SEND_A_MESSAGE = '30069'; // 5/3: when scored or stolen, rez 1 installed ice ignoring all costs
const UNLEASH = '36044';
const UNITY = '30026'; // decoder only: barriers stop this Runner

/** Mid-game: HQ and R&D behind rezzed Palisades, a Runner with a decoder, an empty HQ. */
function board(): GameState {
  const s = newGame(3);
  s.corp.hq = [];
  installIceForTest(s, PALISADE, 'rd', true);
  installIceForTest(s, PALISADE, 'hq', true);
  installProgramForTest(s, UNITY);
  s.runner.credits = 6;
  s.turnNumber = 7;
  return s;
}

/** Send a Message in a remote behind a rezzed Whitespace, `counters` advanced. */
function withSendAMessage(s: GameState, counters: number): string {
  installIceForTest(s, WHITESPACE, 'remote1', true);
  const id = installCorpForTest(s, SEND_A_MESSAGE, 'remote1');
  s.corp.servers.remote1.root[0].advancementCounters = counters;
  return id;
}

function withPlan<T>(on: boolean, work: () => T): T {
  const was = tuning.plan.freeRez;
  tuning.plan.freeRez = on;
  try {
    return work();
  } finally {
    tuning.plan.freeRez = was;
  }
}

/** Plays the Corp AI's turn to its end. */
function corpTurn(s: GameState): GameState {
  const ai = new HeuristicCorpAI();
  for (let i = 0; i < 20 && s.activePlayer === 'corp'; i++) {
    const action = ai.chooseAction(s);
    if (action.type === 'END_TURN') break;
    s = executeAction(s, action);
  }
  return s;
}

const allIce = (s: GameState) => Object.values(s.corp.servers).flatMap(server => server.ice);

// Send a Message: "When this agenda is scored or stolen, you may rez 1 installed piece of ice, ignoring all costs."
// Ignoring all costs makes the rez cost 0 (rules 1.16.5c); the Runner must steal an agenda it accesses (rules 7.1.6, 7.2.3).
describe('Corp AI cheats out expensive ice with a free rez (plan.freeRez)', () => {
  it('counts an installed Send a Message, and Unleash only while the Runner has a tag to remove', () => {
    const s = board();
    expect(pendingFreeRezzes(s)).toBe(0);
    withSendAMessage(s, 0);
    expect(pendingFreeRezzes(s)).toBe(1);
    giveCard(s, 'corp', UNLEASH);
    expect(pendingFreeRezzes(s)).toBe(1);
    s.runner.tags = 1;
    expect(pendingFreeRezzes(s)).toBe(2);
  });

  it('values an unaffordable Pharos as ice it will have while Send a Message is installed', () => {
    const s = board();
    s.corp.credits = 2;
    const id = installIceForTest(s, PHAROS, 'rd', false);
    const pharos = () => s.corp.servers.rd.ice.find(c => c.instanceId === id)!;
    expect(iceWorth(s, pharos(), 'corp')).toBe(RATES.ice);
    withSendAMessage(s, 0);
    expect(iceWorth(s, pharos(), 'corp')).toBeGreaterThan(RATES.ice + 2);
    expect(withPlan(false, () => iceWorth(s, pharos(), 'corp'))).toBe(RATES.ice);
  });

  it('installs Pharos it cannot pay for while Send a Message waits on the board (ice pacing)', () => {
    const s = board();
    s.corp.credits = 4;
    installIceForTest(s, PALISADE, 'remote1', true);
    withSendAMessage(s, 2);
    giveCard(s, 'corp', PHAROS);
    const installsPharos = () =>
      new HeuristicCorpAI().rankMainActions(s).some(r => r.action.type === 'INSTALL_CARD' && cardDef(s.corp.hq.find(c => c.instanceId === (r.action as { cardInstanceId: string }).cardInstanceId)!).title === 'Pharos' && r.score > -Infinity);
    expect(withPlan(false, installsPharos)).toBe(false);
    expect(installsPharos()).toBe(true);
  });

  it('with Send a Message one advance from scored and 4 credits, installs Pharos first and rezzes it for free', () => {
    const run = () => {
      const s = board();
      s.corp.credits = 4;
      withSendAMessage(s, 4);
      giveCard(s, 'corp', PHAROS);
      giveCard(s, 'corp', PALISADE);
      return corpTurn(s);
    };
    const after = run();
    expect(after.corp.score).toBe(3);
    expect(allIce(after).some(c => c.cardCode === PHAROS && c.isRezzed)).toBe(true);
    // Before: Pharos couldn't be installed, so the free rez went to a Palisade
    const old = withPlan(false, run);
    expect(allIce(old).some(c => c.cardCode === PHAROS)).toBe(false);
  });

  it('the free rez goes to the ice that saves the most, when the Corp could pay for either', () => {
    const s = board();
    s.runner.rig.programs = []; // no breakers: every barrier is a full stop, so only the rez cost tells them apart
    s.runner.memoryUnitsUsed = 0;
    s.corp.credits = 10;
    installIceForTest(s, PALISADE, 'remote2', false);
    installIceForTest(s, PHAROS, 'remote3', false);
    withSendAMessage(s, 5);
    let after = executeAction(s, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: s.corp.servers.remote1.root[0].instanceId });
    const prompt = activePrompt(after);
    expect(prompt?.kind === 'effect_cards' ? prompt.source.cardCode : undefined).toBe(SEND_A_MESSAGE);
    after = executeAction(after, answerPrompt(after, 'corp', undefined, true));
    expect(after.corp.servers.remote3.ice[0].isRezzed).toBe(true);
    expect(after.corp.servers.remote2.ice[0].isRezzed).toBe(false);
    expect(after.corp.credits).toBe(10);
  });
});
