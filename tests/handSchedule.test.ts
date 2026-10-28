import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tuning } from '../src/ai/synergy';
import { SCHEDULE, noteKnownHand, scheduleClick, scheduleValue } from '../src/ai/handValues';
import { evaluate } from '../src/ai/evaluate';
import { handFilter } from '../src/ai/valueModel';
import { createCardInstance, executeAction } from '../src/core';
import { newGame, startRunnerTurn } from './helpers';

const MARJANAH = '30016'; // fracter, cost 0
const CARMEN = '30015';
const RED_TEAM = '30018';

/** The Runner on its turn with only the given cards in grip. */
function runnerWith(codes: string[], credits: number) {
  const s = newGame();
  startRunnerTurn(s);
  s.runner.grip = codes.map(code => createCardInstance(s, code));
  s.runner.credits = credits;
  noteKnownHand(s, 'runner');
  return s;
}

describe('the hand schedule (Jeff, 2026-10-28; plan.handSchedule)', () => {
  // Switched off, kept for re-testing: checked on its own, without the damage clock (a smaller grip is a step toward a flatline)
  beforeAll(() => {
    tuning.plan.handSchedule = { corp: true, runner: true };
    tuning.plan.damageClock = false;
  });
  afterAll(() => {
    tuning.plan.handSchedule = { corp: false, runner: false };
    tuning.plan.damageClock = true;
  });

  it('when credits hold the plan back, a click is worth about a credit', () => {
    const s = runnerWith([CARMEN, RED_TEAM], 0);
    expect(scheduleClick(s, 'runner')).toBeGreaterThanOrEqual(1);
    expect(scheduleClick(s, 'runner')).toBeLessThan(1.5);
  });

  it('a card worth playing gives a click more worth than a credit', () => {
    const s = runnerWith([CARMEN], 10);
    s.runner.clicks = 1;
    expect(scheduleClick(s, 'runner')).toBeGreaterThan(1);
  });

  it('a card waiting turns to be played is worth less than one played now', () => {
    const now = runnerWith([CARMEN], 10);
    const later = runnerWith([CARMEN], 10);
    later.runner.clicks = 0;
    // With no clicks left Carmen waits a turn: its worth over a credit click is cut by the discount
    expect(scheduleValue(later, 'runner')).toBeLessThan(scheduleValue(now, 'runner') - 4);
    expect(SCHEDULE.discount).toBeLessThan(1);
  });

  it('a card over the hand limit at the end of the turn is a small filter, not a card', () => {
    const s = runnerWith([CARMEN, CARMEN, CARMEN, CARMEN, CARMEN], 0);
    s.runner.clicks = 0;
    const full = scheduleValue(s, 'runner');
    s.runner.grip.push(createCardInstance(s, RED_TEAM));
    expect(scheduleValue(s, 'runner') - full).toBeCloseTo(handFilter());
  });

  it('a full hand of good cards: drawing is not worth more than a credit', () => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.credits = 5;
    noteKnownHand(s, 'runner');
    expect(s.runner.grip.length).toBe(5);
    const draw = evaluate(executeAction(s, { type: 'DRAW_CARD', player: 'runner' }), 'runner');
    const credit = evaluate(executeAction(s, { type: 'GAIN_CREDIT', player: 'runner' }), 'runner');
    expect(draw).toBeLessThan(credit);
  });

  it('installing a card the plan plays now costs the plan nothing', () => {
    const s = runnerWith([MARJANAH], 5);
    const before = evaluate(s, 'runner');
    const card = s.runner.grip[0];
    const after = evaluate(executeAction(s, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: card.instanceId }), 'runner');
    expect(Math.abs(after - before)).toBeLessThan(0.5);
  });
});
