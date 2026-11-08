import { describe, expect, it } from 'vitest';
import { AlarmTracker } from '../scripts/alarms';
import { GameState } from '../src/core';
import { newGame } from './helpers';

/**
 * 'Corp stayed broke' (Jeff 2026-11-08: going broke is fine to secure an agenda or rez key ice, as long as the Corp
 * builds back up): fired once per stretch of turn starts under 3 credits, at its 2nd start, with the stretch's length;
 * 'Corp went broke' (the dip) is unchanged.
 */
function play(credits: number[]): AlarmTracker {
  const tracker = new AlarmTracker();
  const base = newGame();
  let prev: GameState = { ...structuredClone(base), activePlayer: 'runner', turnNumber: 1 };
  credits.forEach((c, i) => {
    const runnerTurn: GameState = { ...structuredClone(base), activePlayer: 'runner', turnNumber: i + 1 };
    runnerTurn.corp.credits = prev.corp.credits;
    tracker.step(prev, runnerTurn);
    const corpTurn: GameState = { ...structuredClone(base), activePlayer: 'corp', turnNumber: i + 2 };
    corpTurn.corp.credits = c;
    tracker.step(runnerTurn, corpTurn);
    prev = corpTurn;
  });
  tracker.done(prev);
  return tracker;
}
const stayed = (t: AlarmTracker) => t.alarms.filter(a => a.kind === 'Corp stayed broke');

describe("'Corp stayed broke' alarm", () => {
  it('a dip that recovers at the next turn start does not fire it (the dip alarm still does)', () => {
    const t = play([5, 5, 1, 5, 5]);
    expect(stayed(t)).toHaveLength(0);
    expect(t.alarms.filter(a => a.kind === 'Corp went broke')).toHaveLength(1);
  });

  it('two turn starts in a row under 3 fire it once, recovered', () => {
    const t = play([5, 5, 1, 2, 6]);
    expect(stayed(t)).toHaveLength(1);
    expect(stayed(t)[0].detail).toBe('recovered');
    expect(stayed(t)[0].note).toContain('2 turn starts');
  });

  it('three turn starts in a row fire it once with length 3; still broke at the end is never recovered', () => {
    const t = play([5, 5, 1, 0, 2]);
    expect(stayed(t)).toHaveLength(1);
    expect(stayed(t)[0].note).toContain('3 turn starts');
    expect(stayed(t)[0].detail).toBe('never recovered');
  });
});
