import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { agendaOdds } from '../src/ai/effectValues';
import { tuning } from '../src/ai/synergy';

/**
 * Thread "Find why self-play games end decked" (2026-11-06), from Gemini's analysis. Position: self-play deal 2172
 * (Peculiarity vs The Catalyst), the Runner's turn 23, late game with 7 rezzed cards on the board.
 */
// unseenOdds stays off (tuning pass 1)
beforeEach(() => { tuning.plan.unseenOdds = true; });
afterEach(() => { tuning.plan.unseenOdds = false; });

const position = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/empty-grip-runner.json', import.meta.url), 'utf8'));

describe('agenda odds leave out cards seen not to be agendas (plan.unseenOdds)', () => {
  it('installed ice and rezzed root cards leave the pool', () => {
    const s = position();
    const on = agendaOdds(s).odds;
    tuning.plan.unseenOdds = false;
    try {
      const off = agendaOdds({ ...s, id: `${s.id}-off` } as GameState).odds;
      expect(on).toBeGreaterThan(off * 1.3);
    } finally {
      tuning.plan.unseenOdds = true;
    }
  });
});
// The tankNoEtr describe (protectionCost) went with the ranking's hold count (Step 4 Stage C7): the hold owner
// (corp/hold.ts) counts only run-ending subroutines (iceCreditNeed), so no tank price reaches it
