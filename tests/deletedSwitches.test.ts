import { describe, expect, it } from 'vitest';
import { DELETED, FOLDED, planWith, tuning } from '../src/ai/synergy';

/**
 * Audit Step 3 group C (spec-step3-deletions.md): an off switch deleted with the paths only it reached throws when a
 * PLAN_OFF or planWith names it, as a folded name does, so an old batch command can't silently test nothing.
 */
describe('deleted plan switches', () => {
  it('are gone from the plan and from the folded list', () => {
    for (const name of DELETED) {
      expect(name in tuning.plan, name).toBe(false);
      expect(FOLDED.includes(name), name).toBe(false);
    }
  });

  it('throw when named, on or off', () => {
    for (const name of DELETED) {
      expect(() => planWith(tuning.plan, [name])).toThrow(/deleted \(audit Step 3\)/);
      expect(() => planWith(tuning.plan, [`+${name}`])).toThrow(/deleted \(audit Step 3\)/);
    }
  });
});
