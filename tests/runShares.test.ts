import { describe, expect, it } from 'vitest';
import { PACE } from '../src/ai/effectValues';
import { tuning } from '../src/ai/synergy';

/**
 * Jeff, 2026-11-05 (thread "Find why AI card valuation misses cards"): the run-odds report (scripts/run-odds.ts,
 * 23,039 self-play runs) found the AI's runs go 18% to HQ, 21% R&D, 5% Archives and 57% to remotes, where the model
 * assumed 27/20/15/39. plan.measuredRunShares prices run-paying cards on the measured mix.
 */
const shares = () => [PACE.hqShare, PACE.rdShare, PACE.archivesShare, PACE.remoteShare];

describe('the share of runs on each server (plan.measuredRunShares)', () => {
  it('is the measured mix, and the old one with the plan off', () => {
    expect(shares()).toEqual([0.18, 0.21, 0.05, 0.56]);
    tuning.plan.measuredRunShares = false;
    try {
      expect(shares()).toEqual([0.27, 0.2, 0.15, 0.39]);
    } finally {
      tuning.plan.measuredRunShares = true;
    }
  });

  it('adds up to every run', () => {
    expect(shares().reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
  });
});
