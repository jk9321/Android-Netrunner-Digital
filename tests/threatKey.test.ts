import { afterEach, describe, expect, it } from 'vitest';
import { tuning } from '../src/ai/synergy';
import { threat } from '../src/ai/threatModel';
import { withDiagnostics } from '../src/ai/diagnostics';
import { newGame } from './helpers';
import { inDecision } from './helpers/pricing';

/**
 * plan.threatKey (Phase 2 K4b): the threat's board cache keys the Runner's grip by what the Corp can tell apart. Kept
 * from tests/reach.test.ts when plan.reach (K1-K3) was deleted in audit Step 3.
 */
describe('plan.threatKey (K4b)', () => {
  const savedKey = tuning.plan.threatKey;
  afterEach(() => { tuning.plan.threatKey = savedKey; });
  // (grip part only: the pricing part is plan.threatKeyPricing)
  /** The same pool with a different card in the grip: the threat deals the same grip either way (rule 10.2.2a: the Corp can't tell them apart). */
  const pair = () => {
    const a = structuredClone(newGame(3));
    const b = structuredClone(a);
    const g = b.runner.grip[0];
    b.runner.grip[0] = b.runner.stack[0];
    b.runner.stack[0] = g;
    return [a, b];
  };
  it('on: two boards that differ only in which pool card sits in the grip share one budget', () => {
    tuning.plan.threatKey = true;
    const [a, b] = pair();
    inDecision(a, 'corp', () => threat(a));
    const tb = withDiagnostics(d => {
      const t = inDecision(b, 'corp', () => threat(b));
      expect(d.threat.budgeted).toBe(0);
      return t;
    });
    expect(tb).toEqual(inDecision(a, 'corp', () => threat(a)));
  });
  it('off: each is budgeted', () => {
    tuning.plan.threatKey = false;
    const [a, b] = pair();
    inDecision(a, 'corp', () => threat(a));
    withDiagnostics(d => {
      inDecision(b, 'corp', () => threat(b));
      expect(d.threat.budgeted).toBe(1);
    });
  });
});
