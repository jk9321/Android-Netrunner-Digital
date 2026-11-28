/**
 * Speed pass lever G (src/ai/boards.ts; addendum-g.md rev 2, ruling-rev0.md "Lever G red team, ruled" and "G0, ruled"):
 * one board per (board object, action), served again to the AI's own steps. Pins: the same ask gets the same object and
 * the engine's board; the key holds the asker's frozen flag and decision seed (G0's deal 2691); a miss runs on G's own
 * copy of the action (red team finding 2); a served board is frozen in the tests; and the cap of boards kept counts from
 * 0 at each top-level decision (boardsTop, handValues.ts inDecision with no anchor).
 */
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, executeAction } from '../src/core';
import '../src/ai';
import { BOARDS_CAP, boardCounts, builtBoard } from '../src/ai/boards';
import { withPricing } from '../src/ai/pricing';
import { newGame } from './helpers';
import { inDecision } from './helpers/pricing';

const credit = (): GameAction => ({ type: 'GAIN_CREDIT', player: 'corp' }) as GameAction;

describe('lever G: one board per (board, action)', () => {
  it('serves the same object for the same ask, equal to the engine board, read only', () => {
    const s = newGame(1);
    inDecision(s, 'corp', () => {
      const a = builtBoard(s, credit());
      // The same action built elsewhere, with its fields in another order: one key
      const b = builtBoard(s, { player: 'corp', type: 'GAIN_CREDIT' } as GameAction);
      expect(b).toBe(a);
      expect(JSON.stringify(a)).toBe(JSON.stringify(executeAction(s, credit())));
      expect(Object.isFrozen(a)).toBe(true);
    });
  });

  it('keys the asker frozen flag and decision seed: a frozen or seeded frame gets its own board', () => {
    const s = newGame(1);
    inDecision(s, 'corp', () => {
      const open = builtBoard(s, credit());
      const frozen = withPricing({ frozen: true }, () => builtBoard(s, credit()));
      const seeded = withPricing({ decisionSeed: 7 }, () => builtBoard(s, credit()));
      expect(frozen).not.toBe(open);
      expect(seeded).not.toBe(open);
      expect(seeded).not.toBe(frozen);
      expect(withPricing({ frozen: true }, () => builtBoard(s, credit()))).toBe(frozen);
    });
  });

  it("builds on its own copy of the action: no served board holds the caller's action object", () => {
    // A person's stops ('full'): the engine keeps the action itself as the window's intent (core priority.ts
    // declareIntent; red team finding 2, the 41-of-200 case), so the engine's own board does hold the caller's object
    const s = { ...newGame(1), stops: { corp: 'full', runner: 'full' } } as GameState;
    const theirs = credit();
    expect(executeAction(s, theirs).priority?.intent).toBe(theirs);
    inDecision(s, 'corp', () => {
      const mine = credit();
      const board = builtBoard(s, mine);
      const holds = (x: unknown): boolean => x === mine || (!!x && typeof x === 'object' && Object.values(x).some(holds));
      expect(board.priority?.intent).toEqual(mine);
      expect(holds(board)).toBe(false);
    });
  });

  it('keeps at most BOARDS_CAP boards a top-level decision, and counts from 0 at the next one', () => {
    const s = newGame(1);
    inDecision(s, 'corp', () => {
      expect(boardCounts.held).toBe(0);
      boardCounts.held = BOARDS_CAP;
      // Past the cap: the engine's board, built and not kept (no value changes)
      const a = builtBoard(s, credit());
      const b = builtBoard(s, credit());
      expect(b).not.toBe(a);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      expect(boardCounts.held).toBe(BOARDS_CAP);
    });
    // A new top-level decision: the count starts again and the board is kept
    inDecision(s, 'corp', () => {
      expect(boardCounts.held).toBe(0);
      const a = builtBoard(s, credit());
      expect(builtBoard(s, credit())).toBe(a);
      expect(boardCounts.held).toBe(1);
    });
  });
});
