import { afterEach, describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';
import { knownRdSlots } from '../src/ai/runnerReply';
import robust from './fixtures/search-hold-window-robust.json';
import t10 from './fixtures/hidden-draws-1001-t10.json';

/**
 * plan.hiddenDraws (spec-search S6): the Corp planner plays its candidate turns from a guess of R&D (runnerReply.ts
 * guessHidden at the decision's seed), not R&D itself: the cards in R&D are hidden information (rule 10.2.2a), so the
 * order of the cards neither player has seen can't change the Corp's pick. Positions both players saw stay (knownRdSlots).
 */
const saved = tuning.plan.hiddenDraws;
afterEach(() => {
  tuning.plan.hiddenDraws = saved;
});

/** `s` with the R&D cards nobody has seen in reverse order. */
function reorderUnseen(s: GameState): GameState {
  const t = structuredClone(s);
  const fixed = knownRdSlots(s);
  const loose = t.corp.rd.filter((_, i) => !fixed.has(i)).reverse();
  t.corp.rd = t.corp.rd.map((c, i) => (fixed.has(i) ? c : loose.shift()!));
  return t;
}

const pick = (s: GameState) => JSON.stringify(createAgent('corp').chooseAction(structuredClone(s)));

describe('plan.hiddenDraws', () => {
  it('deal 1001 T10: off, the real order of the unseen R&D cards changes the pick; on, it does not', () => {
    const s = t10 as unknown as GameState;
    tuning.plan.hiddenDraws = false;
    expect(pick(reorderUnseen(s))).not.toBe(pick(s));
    tuning.plan.hiddenDraws = true;
    expect(pick(reorderUnseen(s))).toBe(pick(s));
  }, 120000);

  it('the pick does not depend on the order of the unseen R&D cards (deal 1031 T9)', () => {
    tuning.plan.hiddenDraws = true;
    const s = robust.state as unknown as GameState;
    const t = reorderUnseen(s);
    expect(t.corp.rd.map(c => c.instanceId)).not.toEqual(s.corp.rd.map(c => c.instanceId));
    expect(pick(t)).toBe(pick(s));
  }, 60000);
});
