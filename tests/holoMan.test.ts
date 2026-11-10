import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, actingSide, cardDef, executeAction } from '../src/core';
import { createAgent } from '../src/ai';



/**
 * Bug report #17 (Jeff's Corp game 1, 2026-11-05): on turn 3 Jeff moved The Holo Man to Offworld Office's remote,
 * used it for 3 counters, advanced once and scored. The AI moved The Holo Man to R&D (the move prompt had no answer of
 * its own), and its ability ranked -7 even next to the agenda: the 4 credits fell under the reserve penalty.
 * plan.holoManMove keeps it with the agenda. The finish was first a rank (plan.finishSetup); counted scoring
 * (plan.scoreNow) now plays it, and step 2 deleted the rank (spec-step2-delete-redundant.md, +0.3 ± 0.4 at games=3).
 * The test that the turn missed it with the old patches off went too: after step 2's deletions the Corp finds it either way.
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

describe('The Holo Man advances the agenda it sits with (plan.holoManMove, plan.scoreNow)', () => {
  it('scores Offworld Office on turn 3', () => {
    expect(scoredOffice(playTurn())).toBe(true);
  }, 30_000);
});
