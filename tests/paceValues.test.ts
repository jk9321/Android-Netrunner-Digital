import { describe, expect, it } from 'vitest';
import { PACE } from '../src/ai/effectValues';

/**
 * Audit Step 3 group A (spec-step3-deletions.md, AI-FOLDED-SHELLS): PACE reads as the rates in use. Until beta 5050720
 * the run shares and the 2026-11-06 re-measure were getters laid over older literals (RUN_SHARES, PACE_NOV6); these are
 * the values those getters returned, so the rewrite plays the same.
 */
describe('PACE is the measured pace in use', () => {
  it('pins every rate to the value in effect before the getters went', () => {
    expect({ ...PACE }).toEqual({
      runs: 1.01,
      hqShare: 0.18,
      rdShare: 0.21,
      archivesShare: 0.05,
      remoteShare: 0.56,
      conduitRdShare: 0.19,
      success: 0.77,
      facedownBreach: 0.1,
      stealOrTrash: 0.35,
      paidTrashes: 0.3,
      agendaEvents: 0.31,
      rezzes: 0.39,
      programInstalls: 0.3,
      iceInHand: 0.6,
      drawTurns: 0.7,
    });
  });

  it('has no accessors left: each rate is a plain field', () => {
    for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(PACE))) {
      expect(d.get, key).toBeUndefined();
      expect(d.writable, key).toBe(true);
    }
  });
});
