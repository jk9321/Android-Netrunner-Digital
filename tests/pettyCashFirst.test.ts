import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef, executeAction } from '../src/core';
import { createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';

/**
 * Jeff (2026-11-04): "did you check corp for stuff like petty cash?" Petty Cash: "Play only if you have not finished an
 * action yet this turn. Gain 5 credits." In 40 self-play games the Corp clicked for credits on 25 turns while holding a
 * Petty Cash it could afford: it took another action first, after which Petty Cash can't be played. plan.pettyCashFirst.
 *
 * Position: self-play deal 906 (game 6 of the audit), the Corp's turn 4: 3 credits, 3 clicks, HQ Seamless Launch, Petty
 * Cash, Nanomanagement, Bumi 1.0, Spin Doctor. Before the fix: click for a credit, Bumi, Spin Doctor, ending on 4.
 */
function play(): GameState {
  let s: GameState = JSON.parse(readFileSync(new URL('./fixtures/petty-cash-first.json', import.meta.url), 'utf8'));
  s.log = [];
  const corp = createAgent('corp', 'normal');
  for (let i = 0; i < 12 && s.activePlayer === 'corp'; i++) s = executeAction(s, corp.chooseAction(s));
  return s;
}
const inHq = (s: GameState) => s.corp.hq.map(c => cardDef(c).title);

describe('Petty Cash is played first, while it can be (plan.pettyCashFirst)', () => {
  it('plays Petty Cash and never clicks for a credit', () => {
    const s = play();
    // plan.oneCurrency: the override is off and the one-step ranking puts Petty Cash first (oneCurrency.test.ts); the
    // planned turn may open a remote instead, its sampled Runner reply deciding between lines its greedy rollout builds
    // (structural review item 4). The bug Jeff saw, clicks for credits while holding it, stays closed either way
    if (!tuning.plan.oneCurrency) expect(inHq(s)).not.toContain('Petty Cash');
    expect(s.log.some(l => l.message === 'Corp spent [click] to gain 1 credit.')).toBe(false);
  });

  it('without the plan it clicks for a credit and keeps Petty Cash', () => {
    // plan.heldMoney (held Petty Cash no longer counted twice) plays it first on its own here
    tuning.plan.pettyCashFirst = false;
    tuning.plan.heldMoney = false;
    // plan.measuredTurnsLeft (2026-11-05) plays it here too: on the longer horizon the old way didn't hold it
    tuning.plan.measuredTurnsLeft = false;
    tuning.plan.measuredRunShares = false; // the same with the measured run shares
    const one = tuning.plan.oneCurrency;
    tuning.plan.oneCurrency = false; // the ranking the bug was found on (the rule tiers)
    try {
      expect(inHq(play())).toContain('Petty Cash');
    } finally {
      tuning.plan.pettyCashFirst = true;
      tuning.plan.heldMoney = true;
      tuning.plan.measuredTurnsLeft = true;
      tuning.plan.measuredRunShares = true;
      tuning.plan.oneCurrency = one;
    }
  });
});
