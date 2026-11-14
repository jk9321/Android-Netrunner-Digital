import { afterEach, describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { HeuristicRunnerAI, createAgent } from '../src/ai';
import { asSide, sideOff, tuning } from '../src/ai/synergy';
import { guessRunnerView, knownRdSlots } from '../src/ai/runnerReply';
import robust from './fixtures/search-hold-window-robust.json';
import t10 from './fixtures/hidden-draws-1001-t10.json';
import runnerT4 from './fixtures/runner-draws-1001-t4.json';
import runnerT6 from './fixtures/runner-draws-1001-t6.json';

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
  it('is on by default', () => {
    expect(saved).toBe(true);
  });
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

/**
 * The Runner's side (Jeff 2026-11-14: "AI runner should not see its own draws"): the Runner planner plays its candidate
 * turns from its own view (runnerReply.ts guessRunnerView), its stack shuffled, because the order of the stack is
 * hidden information (rule 10.2.2a). The fixtures are Runner planner decisions of deal 1001 (Normal v Normal, beta
 * 922dbca) where a candidate line draws and, playing from the real stack, the pick follows the stack's order.
 */
describe('plan.hiddenDraws for the Runner', () => {
  const shipped = [...sideOff.runner];
  afterEach(() => {
    sideOff.runner = [...shipped];
  });
  const reversed = (s: GameState) => {
    const t = structuredClone(s);
    t.runner.stack.reverse();
    return t;
  };
  const runnerPick = (s: GameState) => JSON.stringify(createAgent('runner').chooseAction(structuredClone(s)));

  it('is on for the Runner (not in sideOff.runner)', () => {
    expect(sideOff.runner).not.toContain('hiddenDraws');
  });
  for (const [name, fixture] of [['deal 1001 T4', runnerT4], ['deal 1001 T6', runnerT6]] as const) {
    it(`${name}: from the real stack the stack's order changes the pick; from the Runner's view it does not (10.2.2a)`, () => {
      const s = fixture as unknown as GameState;
      expect(s.activePlayer).toBe('runner');
      sideOff.runner = [...shipped, 'hiddenDraws'];
      expect(runnerPick(reversed(s))).not.toBe(runnerPick(s));
      sideOff.runner = [...shipped];
      expect(runnerPick(reversed(s))).toBe(runnerPick(s));
    }, 60000);
  }
  it('the rule ranking scores a draw on the guessed stack too: DRAW_CARD scores the same with the stack reversed (10.2.2a)', () => {
    const s = runnerT4 as unknown as GameState;
    const drawScore = (t: GameState) => asSide('runner', () => new HeuristicRunnerAI({}).rankMainActions(structuredClone(t)).find(r => r.action.type === 'DRAW_CARD')!.score);
    sideOff.runner = [...shipped, 'hiddenDraws'];
    expect(drawScore(reversed(s))).not.toBe(drawScore(s));
    sideOff.runner = [...shipped];
    expect(drawScore(reversed(s))).toBe(drawScore(s));
  });
  it("the Runner's view keeps its grip and its stack's cards, and only reorders the stack", () => {
    const s = runnerT4 as unknown as GameState;
    const ids = (cards: { instanceId: string }[]) => cards.map(c => c.instanceId);
    const v = guessRunnerView(s, 0);
    expect(ids(v.runner.grip)).toEqual(ids(s.runner.grip));
    expect([...ids(v.runner.stack)].sort()).toEqual([...ids(s.runner.stack)].sort());
    expect(ids(v.corp.rd)).toEqual(ids(s.corp.rd));
    expect(ids(v.corp.hq)).toEqual(ids(s.corp.hq));
    // the deal does not follow the real order (the cards are dealt from instance-id order)
    expect(ids(guessRunnerView(reversed(s), 0).runner.stack)).toEqual(ids(v.runner.stack));
  });
});
