import { describe, expect, it } from 'vitest';
import { createCardInstance, executeAction, GameState } from '../src/core';
import { answer, installProgramForTest, newGame, startRunnerTurn } from './helpers';

// Rules 3.9.3c: "If the Runner's memory limit decreases below the total memory cost of installed programs ... the
// Runner must trash one or more installed programs such that the total memory cost of the remaining programs does not
// exceed their memory limit. This occurs during the next checkpoint". 10.3.1e: an appropriate set is trashed (no
// object can be left out of it); with several sets the player who controls them chooses.
const DZMZ = '30022'; // hardware: +1 MU
const CLEAVER = '30006'; // 1 MU
const BUZZSAW = '30005'; // 1 MU
const MAYFLY = '30032'; // 2 MU

/** The Runner's turn with DZMZ Optimizer (5 MU) and the given programs, then the Optimizer trashed. */
function overLimit(codes: string[]): [GameState, string[]] {
  const s = newGame();
  startRunnerTurn(s);
  const dzmz = createCardInstance(s, DZMZ);
  s.runner.rig.hardware.push(dzmz);
  const ids = codes.map(code => installProgramForTest(s, code));
  s.runner.rig.hardware = [];
  s.runner.heap.push(dzmz);
  return [executeAction(s, { type: 'GAIN_CREDIT', player: 'runner' }), ids];
}

describe('Over the memory limit (rules 3.9.3c, 10.3.1e)', () => {
  it('at the checkpoint the Runner chooses among the appropriate sets and trashes one', () => {
    const [s, [mayfly, cleaver, buzzsaw, cleaver2]] = overLimit([MAYFLY, CLEAVER, BUZZSAW, CLEAVER]);
    // 5 MU used of 4: any one program covers the 1 MU over; two together are not minimal, so not offered
    const p = s.pendingPrompts[0];
    expect(p).toMatchObject({ kind: 'effect_choice', side: 'runner' });
    expect(p.kind === 'effect_choice' && p.options.map(o => o.id).sort()).toEqual([mayfly, cleaver, buzzsaw, cleaver2].sort());
    expect(() => answer(s, { kind: 'effect_choice', optionId: `${cleaver},${buzzsaw}` })).toThrow(/one of the options/);
    const after = answer(s, { kind: 'effect_choice', optionId: buzzsaw });
    expect(after.runner.rig.programs.map(c => c.instanceId)).toEqual([mayfly, cleaver, cleaver2]);
    expect(after.runner.memoryUnitsUsed).toBe(4);
    expect(after.runner.heap.some(c => c.instanceId === buzzsaw)).toBe(true);
    expect(after.pendingPrompts).toHaveLength(0);
  });

  it('asks nothing while the programs fit', () => {
    const [s] = overLimit([MAYFLY, CLEAVER, BUZZSAW]);
    expect(s.pendingPrompts).toHaveLength(0);
    expect(s.runner.rig.programs).toHaveLength(3);
  });
});
