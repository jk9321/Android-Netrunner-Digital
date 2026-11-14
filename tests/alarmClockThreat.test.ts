/**
 * Bug report #34 (Jeff's Runner test game 2 vs the Normal Corp, 2026-11-09): Alarm Clock ran HQ at the start of every
 * Runner turn and the Corp's threat model (threatModel.ts budgetTurn) never counted it: it budgets click by click, and
 * this run costs no click.
 *   Alarm Clock: "When your turn begins, you may run HQ. The first time you encounter a piece of ice during that run,
 *   you may spend [click][click] to bypass it."
 *   5.7.1d: "The Runner's turn formally begins. Conditions related to the turn beginning are met." (before the Runner's
 *   first action, 5.7.1f)
 *   6.5.8a: "When an effect allows the Runner to BYPASS a piece of ice, the Encounter Ice Phase is aborted and the
 *   Runner immediately proceeds to pass that ice."
 * plan.alarmClockThreat counts the free run the way the Runner AI answers the prompt (prompts.ts: runScore with
 * { alarmClock: true }, its click given back). Note: at Jeff's own game-2 positions the Runner AI declines the run
 * (its HQ worth is below the 2-click bypass), so this pins the modelling; the record of what the Runner actually ran is
 * a separate item.
 */
import { describe, expect, it } from 'vitest';
import { GameState, createCardInstance } from '../src/core';
import { threat } from '../src/ai/threatModel';
import { tuning } from '../src/ai/synergy';
import { giveCard, installIceForTest, newGame } from './helpers';
import { inDecision } from './helpers/pricing';

const ALARM_CLOCK = '34078';
const PALISADE = '30072'; // Barrier, strength 2: End the run
const AGENDA = '30067';
const SURE_GAMBLE = '30030';

/** The Corp's turn: HQ full of agendas behind a Palisade the Runner can't break, the Runner on 5 points. */
function board(alarm: boolean): GameState {
  const s = newGame();
  installIceForTest(s, PALISADE, 'hq');
  installIceForTest(s, PALISADE, 'rd');
  s.corp.hq = Array.from({ length: 5 }, () => createCardInstance(s, AGENDA));
  s.runner.grip = [];
  for (let i = 0; i < 5; i++) giveCard(s, 'runner', SURE_GAMBLE);
  s.runner.credits = 5;
  s.runner.score = 5;
  if (alarm) {
    const ac = createCardInstance(s, ALARM_CLOCK);
    ac.isRezzed = true;
    s.runner.rig.hardware.push(ac);
  }
  return s;
}

const withSwitch = <T>(on: boolean, work: () => T): T => {
  const was = tuning.plan.alarmClockThreat;
  tuning.plan.alarmClockThreat = on;
  try {
    return work();
  } finally {
    tuning.plan.alarmClockThreat = was;
  }
};

const hq = (s: GameState) => inDecision(s, 'corp', () => threat(s)).servers.hq;

describe('the threat counts Alarm Clock’s free HQ run (plan.alarmClockThreat, rules 5.7.1d, 6.5.8a)', () => {
  it('HQ is run when the turn begins, past the Palisade the bypass skips', () => {
    const t = hq(board(true));
    expect(t.run).toBe(1);
    expect(t.success).toBeGreaterThan(0.9);
  });

  it('without Alarm Clock the Palisade keeps the Runner out', () => {
    expect(hq(board(false)).run).toBe(0);
  });

  it('switched off, the budget never saw the free run', () => {
    expect(withSwitch(false, () => hq(board(true))).run).toBe(0);
  });
});
