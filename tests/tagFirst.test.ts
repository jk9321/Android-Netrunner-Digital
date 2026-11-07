import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef, executeAction } from '../src/core';
import { createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';

const oneCurrencyDefault = tuning.plan.oneCurrency;

/**
 * Jeff (2026-11-05): the Corp leaves tags unused. Once the Runner AI played its money resources, the "tag not used"
 * alarm rose from 52 to 79 per 663 games. A tag usually lasts only until the Runner's next turn (rule 5.2.7g: click,
 * 2 credits: remove 1 tag), but the Corp installed first and was then too poor to trash (5.2.6: trash 1 resource only
 * while the Runner is tagged). plan.tagFirst.
 *
 * Position: self-play deal 1213 (Discretion Advised vs Shootin' 'n' Lootin'), the Corp's turn 3: 6 credits, 3 clicks;
 * the Runner tagged with 1 credit, Side Hustle (5 credits hosted, 1 short of paying out 6) and Open Market installed.
 * Before the fix: Urtica Cipher, Ansel 1.0, a draw, the tag unused.
 */
function play(): GameState {
  let s: GameState = JSON.parse(readFileSync(new URL('./fixtures/tag-first-side-hustle.json', import.meta.url), 'utf8'));
  const corp = createAgent('corp', 'normal');
  for (let i = 0; i < 15 && s.activePlayer === 'corp'; i++) s = executeAction(s, corp.chooseAction(s));
  return s;
}
const rig = (s: GameState) => s.runner.rig.resources.map(c => cardDef(c).title);

describe('a tag is used while the Runner still has it (plan.tagFirst)', () => {
  it('trashes Side Hustle this turn', () => {
    expect(rig(play())).not.toContain('Side Hustle');
  });

  it('without the plan the Corp installs first and leaves the tag unused', () => {
    tuning.plan.tagFirst = false;
    // and without plan.runnerKnown (code audit, 2026-11-06), on which the Corp trashes Side Hustle here even without it
    tuning.plan.runnerKnown = false;
    // and plan.corpTurnDamage (2026-11-06), with which the Corp also trashes it here
    tuning.plan.corpTurnDamage = false;
    // and the ranking it was found on: the one-currency Corp trashes Side Hustle without the plan (oneCurrency.test.ts)
    tuning.plan.oneCurrency = false;
    // and the planner before its search was widened (plan.plannerSearch, item 4): with it the Corp trashes Side Hustle here without the plan
    tuning.plan.plannerSearch = false;
    try {
      expect(rig(play())).toEqual(expect.arrayContaining(['Side Hustle', 'Open Market']));
    } finally {
      tuning.plan.plannerSearch = true;
      tuning.plan.tagFirst = true;
      tuning.plan.runnerKnown = true;
      tuning.plan.corpTurnDamage = true;
      tuning.plan.oneCurrency = oneCurrencyDefault;
    }
  });
});
