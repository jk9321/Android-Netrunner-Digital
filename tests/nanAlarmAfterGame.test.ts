import { describe, expect, it } from 'vitest';
// The AI's entry first, as lossLog.ts loads it (corpPorts are registered there)
import '../src/ai';
import { AlarmTracker } from '../scripts/alarms';
import { GameState } from '../src/core';
import { newGame, newGameAtSetup } from './helpers';

/**
 * 'valuation not a number' (issue #47) after R-79 (runner-rework/briefs/r79-alarm-after-game.md): the tracker keeps the
 * boards a side decided from in its main phase and evaluates them after the game (done), so the batch driver asks no AI
 * code beside the game. The board worth is a stub the test owns: NaN on one board, finite on the rest.
 */
describe("'valuation not a number' alarm, checked after the game", () => {
  const base = newGame();
  const board = (side: 'corp' | 'runner', turn: number): GameState => ({ ...structuredClone(base), activePlayer: side, turnNumber: turn, activeRun: null, pendingPrompts: [], priority: undefined });

  it('fires once, with the turn and side of the board, only when done() runs', () => {
    const bad = board('runner', 3);
    const asked: GameState[] = [];
    const tracker = new AlarmTracker((state, side) => {
      asked.push(state);
      expect(side).toBe(state.activePlayer);
      return state === bad ? NaN : 1;
    });
    const boards = [board('corp', 3), bad, board('corp', 4)];
    boards.forEach((b, i) => tracker.step(b, boards[i + 1] ?? b, { type: 'GAIN_CREDIT', player: b.activePlayer }));
    // Nothing is evaluated during the game
    expect(asked).toHaveLength(0);
    expect(tracker.alarms.filter(a => a.kind === 'valuation not a number')).toHaveLength(0);
    tracker.done(boards[2]);
    expect(asked).toEqual(boards);
    const nan = tracker.alarms.filter(a => a.kind === 'valuation not a number');
    expect(nan).toEqual([{ kind: 'valuation not a number', turn: 3, side: 'runner', note: 'evaluate NaN before GAIN_CREDIT' }]);
  });

  it('skips boards in a run, with a prompt, or where the action is not the acting side', () => {
    const asked: GameState[] = [];
    const tracker = new AlarmTracker(state => {
      asked.push(state);
      return Infinity;
    });
    const corp = board('corp', 2);
    // A run under way: the Runner acts
    const inRun = { ...board('runner', 2), activeRun: structuredClone(base.activeRun) ?? ({} as NonNullable<GameState['activeRun']>) };
    // The mulligan prompts of a game at setup
    const prompted = newGameAtSetup();
    expect(prompted.pendingPrompts.length).toBeGreaterThan(0);
    tracker.step(corp, corp, { type: 'GAIN_CREDIT', player: 'runner' });
    tracker.step(corp, corp);
    tracker.step(inRun, inRun, { type: 'GAIN_CREDIT', player: 'runner' });
    tracker.step(prompted, prompted, { type: 'GAIN_CREDIT', player: prompted.pendingPrompts[0].side });
    tracker.done(corp);
    expect(asked).toHaveLength(0);
    expect(tracker.alarms.filter(a => a.kind === 'valuation not a number')).toHaveLength(0);
  });

  it('keeps the alarm where it would have been in the list', () => {
    const tracker = new AlarmTracker(() => NaN);
    const first = board('corp', 1);
    tracker.step(first, first, { type: 'GAIN_CREDIT', player: 'corp' });
    // An empty Archives run fires as its step happens: after the board above, before the one below
    const runner = board('runner', 1);
    runner.corp.archives.faceUp = [];
    runner.corp.archives.faceDown = [];
    const ran: GameState = { ...structuredClone(runner), runsThisTurn: [{ server: 'archives', successful: true } as GameState['runsThisTurn'][number]] };
    tracker.step(runner, ran);
    const later = board('corp', 2);
    tracker.step(later, later, { type: 'GAIN_CREDIT', player: 'corp' });
    tracker.done(later);
    expect(tracker.alarms.map(a => `${a.kind} T${a.turn}`)).toEqual(['valuation not a number T1', 'empty Archives run T1', 'valuation not a number T2']);
  });

  it("reads the acting side's real evaluate by default (finite on a fresh board)", () => {
    const tracker = new AlarmTracker();
    const corp = board('corp', 1);
    tracker.step(corp, corp, { type: 'GAIN_CREDIT', player: 'corp' });
    tracker.done(corp);
    expect(tracker.alarms.filter(a => a.kind === 'valuation not a number')).toHaveLength(0);
  });
});
