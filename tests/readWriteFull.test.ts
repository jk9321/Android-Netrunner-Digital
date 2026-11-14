import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { createAgent } from '../src/ai';
import { installProgramForTest, newGame, startRunnerTurn } from './helpers';

/**
 * Jeff's bug report (issue #8, 2026-11-03; Sourdough Starter, Hard Runner): the Runner filled Read-Write Share
 * and never shuffled the cards back. Full at its limit of 4 it can host nothing more and only takes up
 * memory, so (Jeff) the Runner trashes it to shuffle the 4 back into the stack as soon as it is full.
 */
const RWS = '36022';

function withShare(hosted: number): { s: GameState; id: string } {
  const s = newGame();
  startRunnerTurn(s);
  const id = installProgramForTest(s, RWS);
  const share = s.runner.rig.programs.find(p => p.instanceId === id)!;
  share.hostedCards = s.runner.stack.splice(0, hosted);
  return { s, id };
}

const uses = (s: GameState, id: string, agent = createAgent('runner', 'normal')) => {
  const action = agent.chooseAction(s);
  return action.type === 'USE_ABILITY' && action.cardInstanceId === id;
};

describe('a full Read-Write Share is shuffled back (plan.readWriteFull, bug report #8)', () => {
  it('at 4 hosted cards, Normal and Hard use it', () => {
    for (const agent of [createAgent('runner', 'normal'), createAgent('runner', 'hard', { samples: 4, seed: 1 })]) {
      const { s, id } = withShare(4);
      expect(uses(s, id, agent)).toBe(true);
    }
  });

  it('not before it is full', () => {
    const { s, id } = withShare(3);
    expect(uses(s, id)).toBe(false);
  });
});
