// ai-value-time (brief-value-time.md): time-only changes to the valuation code give the same numbers as before.
import { describe, expect, it } from 'vitest';
import { tagsWorth } from '../src/ai/evaluate';
import { tagCost } from '../src/ai/runs';
import { createCardInstance, GameState } from '../src/core';
import { newGame, startRunnerTurn } from './helpers';

/** tagCost as it was before step 1: the one-click-fewer copy priced on its own, nothing kept on the original. */
function tagCostBefore(state: GameState): number {
  const s = !state.activeRun ? { ...state, runner: { ...state.runner, clicks: state.runner.clicks - 1 } } : state;
  return tagsWorth(s, 'runner', s.runner.tags + 1) - tagsWorth(s, 'runner', s.runner.tags);
}

function board(runnerTurn: boolean, tags: number): GameState {
  const s = newGame();
  if (runnerTurn) startRunnerTurn(s);
  s.runner.tags = tags;
  s.runner.credits = 5;
  s.corp.credits = 10;
  s.runner.rig.resources = [createCardInstance(s, '35011'), createCardInstance(s, '30034')]; // Rent Rioters, Verbal Plasticity
  return s;
}

describe('step 1: the tag clock kept on the original board', () => {
  for (const runnerTurn of [false, true])
    for (const tags of [0, 1, 2])
      it(`tagCost is the same number as before (${runnerTurn ? "Runner's" : "Corp's"} turn, ${tags} tags), asked once or twice`, () => {
        const before = tagCostBefore(board(runnerTurn, tags));
        const s = board(runnerTurn, tags);
        expect(tagCost(s)).toBe(before);
        expect(tagCost(s)).toBe(before);
      });

  it('the kept loss does not serve the plain tag clock on the same board (different clicks, different key)', () => {
    const fresh = tagsWorth(board(true, 1), 'runner');
    const s = board(true, 1);
    tagCost(s);
    expect(tagsWorth(s, 'runner')).toBe(fresh);
  });

  it('a board changed in place is priced again (the memo drops on a new fingerprint)', () => {
    const s = board(true, 1);
    tagCost(s);
    s.runner.clicks = 1;
    s.runner.credits = 1;
    expect(tagCost(s)).toBe(tagCostBefore(structuredClone(s)));
  });
});
