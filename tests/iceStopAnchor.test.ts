import { describe, expect, it } from 'vitest';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { iceWorth } from '../src/ai/iceValues';
import { decisionContext } from '../src/ai/handValues';
import { tuning } from '../src/ai/synergy';
import { giveCard, installIceForTest, newGame, startRunnerTurn } from './helpers';

const PALISADE = '30072'; // barrier, no breaker installed: the Runner can't get past it
const SURE_GAMBLE = '30030';

/**
 * Jeff (2026-11-05): the Runner AI clicked for credits with Sure Gamble in hand. With
 * plan.iceStopRunner, ice it can't break was worth its credits + 8, so each credit gained
 * raised every such ice by a credit and Sure Gamble scored below a click for 1 credit.
 */
describe('ice cap anchored at the decision (plan.iceStopAnchor)', () => {
  function setup() {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.credits = 8;
    const hq = installIceForTest(s, PALISADE, 'hq');
    installIceForTest(s, PALISADE, 'rd');
    const sg = giveCard(s, 'runner', SURE_GAMBLE);
    return { s, hq, sg };
  }

  it("gaining credits doesn't raise the worth of ice the Runner can't break", () => {
    const { s, hq } = setup();
    decisionContext(s, 'runner');
    const ice = s.corp.servers.hq.ice.find(c => c.instanceId === hq)!;
    const richer = { ...s, runner: { ...s.runner, credits: 20 } };
    expect(iceWorth(richer, ice, 'runner')).toBe(iceWorth(s, ice, 'runner'));
  });

  it('plays Sure Gamble over clicking for a credit', () => {
    const { s, sg } = setup();
    const ranked = new HeuristicRunnerAI({ planner: false }).rankMainActions(s);
    const play = ranked.find(r => 'cardInstanceId' in r.action && r.action.cardInstanceId === sg)!;
    const credit = ranked.find(r => r.action.type === 'GAIN_CREDIT')!;
    expect(play.score).toBeGreaterThan(credit.score);
  });

  it('without the anchor, the old cap followed the credits (what the test guards against)', () => {
    const { s, sg } = setup();
    tuning.plan.iceStopAnchor = false;
    try {
      const ranked = new HeuristicRunnerAI({ planner: false }).rankMainActions(s);
      const play = ranked.find(r => 'cardInstanceId' in r.action && r.action.cardInstanceId === sg)!;
      const credit = ranked.find(r => r.action.type === 'GAIN_CREDIT')!;
      expect(play.score).toBeLessThan(credit.score);
    } finally {
      tuning.plan.iceStopAnchor = true;
    }
  });
});
