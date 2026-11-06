import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, actingSide, cardDef, executeAction } from '../src/core';
import { createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';
import { legacyRanking } from './legacyRanking';

// plan.oneCurrency: these pin the old Corp ranking (tests/legacyRanking.ts)
legacyRanking(["scores Offworld Office on turn 3"]);

/**
 * Bug report #17 (Jeff's Corp game 1, 2026-11-05): on turn 3 Jeff moved The Holo Man to Offworld Office's remote,
 * used it for 3 counters, advanced once and scored. The AI moved The Holo Man to R&D (the move prompt had no answer of
 * its own), and its ability ranked -7 even next to the agenda: the 4 credits fell under the reserve penalty.
 * plan.holoManMove keeps it with the agenda; plan.finishSetup ranks a play that lets the turn finish an agenda like the
 * advance that would.
 *
 * Position: the start of the Corp's turn 3 (before its turn begins), rebuilt from the report.
 */
function playTurn(): GameState {
  let s: GameState = JSON.parse(readFileSync(new URL('./fixtures/bug-report-17-turn3.json', import.meta.url), 'utf8'));
  const corp = createAgent('corp', 'normal');
  const runner = createAgent('runner', 'normal');
  const turn = s.turnNumber;
  for (let i = 0; i < 30 && s.activePlayer === 'corp' && s.turnNumber === turn; i++) s = executeAction(s, (actingSide(s) === 'runner' ? runner : corp).chooseAction(s));
  return s;
}
const scoredOffice = (s: GameState) => s.corp.scoreArea.some(c => cardDef(c).title === 'Offworld Office');

describe('The Holo Man advances the agenda it sits with (plan.holoManMove, plan.finishSetup)', () => {
  it('scores Offworld Office on turn 3', () => {
    expect(scoredOffice(playTurn())).toBe(true);
  }, 30_000);

  for (const off of ['holoManMove', 'finishSetup'] as const) {
    it(`without plan.${off} it didn't`, () => {
      tuning.plan[off] = false;
      try {
        expect(scoredOffice(playTurn())).toBe(false);
      } finally {
        tuning.plan[off] = true;
      }
    }, 30_000);
  }
});
