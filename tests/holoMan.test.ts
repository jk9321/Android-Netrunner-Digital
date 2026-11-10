import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, actingSide, cardDef, executeAction } from '../src/core';
import { createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';

const oneCurrencyDefault = tuning.plan.oneCurrency;
const threatDefault = tuning.plan.threatModel;


/**
 * Bug report #17 (Jeff's Corp game 1, 2026-11-05): on turn 3 Jeff moved The Holo Man to Offworld Office's remote,
 * used it for 3 counters, advanced once and scored. The AI moved The Holo Man to R&D (the move prompt had no answer of
 * its own), and its ability ranked -7 even next to the agenda: the 4 credits fell under the reserve penalty.
 * plan.holoManMove keeps it with the agenda. The finish was first a rank (plan.finishSetup); counted scoring
 * (plan.scoreNow) now plays it, and step 2 deleted the rank (spec-step2-delete-redundant.md, +0.3 ± 0.4 at games=3).
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

  it("without counted scoring (and the planner fixes that also find it) it didn't", () => {
    // the one-currency Corp finds the finish too (2026-11-06)
    tuning.plan.oneCurrency = false;
    // and the planner on the threat model (item 3) finds it without either patch: its leaf no longer charges the
    // two-sample Runner reply's steals, so the patches are pinned on the old threat
    tuning.plan.threatModel = false;
    // and the planner before its search was widened (plan.plannerSearch, item 4): with it the finish is found without the patch
    tuning.plan.plannerSearch = false;
    // and before plan.hiddenDraws (S6): on one guess of R&D the old planner happens to find the finish here
    tuning.plan.hiddenDraws = false;
    // and before counted scoring (plan.scoreNow, spec-counted-scoring.md C1): its search finds the finish too
    tuning.plan.scoreNow = false;
    try {
      expect(scoredOffice(playTurn())).toBe(false);
    } finally {
      tuning.plan.scoreNow = true;
      tuning.plan.hiddenDraws = true;
      tuning.plan.oneCurrency = oneCurrencyDefault;
      tuning.plan.threatModel = threatDefault;
      tuning.plan.plannerSearch = true;
    }
  }, 30_000);
});
