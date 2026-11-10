import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef, executeAction } from '../src/core';
import { createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';

/**
 * Jeff (2026-11-05): the Corp should build econ before it sets up ice and scores. A held money operation was counted
 * twice: as a card in HQ and, through moneyReach, as half its net gain on the credit slide. Playing it gave up both
 * for credits the slide had partly counted already, so Hedge Fund at 5 credits scored below a click for a credit.
 * plan.heldMoney leaves the card moneyReach counts out of HQ's worth.
 *
 * Position: the Petty Cash fixture (deal 906, the Corp's turn 4: 3 credits, HQ Seamless Launch, Petty Cash,
 * Nanomanagement, Bumi 1.0, Spin Doctor), with plan.pettyCashFirst (the special case for Petty Cash) off: the
 * general fix alone plays Petty Cash rather than clicking for a credit.
 */
function play(): GameState {
  let s: GameState = JSON.parse(readFileSync(new URL('./fixtures/petty-cash-first.json', import.meta.url), 'utf8'));
  s.log = [];
  const corp = createAgent('corp', 'normal');
  for (let i = 0; i < 12 && s.activePlayer === 'corp'; i++) s = executeAction(s, corp.chooseAction(s));
  return s;
}
const inHq = (s: GameState) => s.corp.hq.map(c => cardDef(c).title);

describe('a held money operation is counted once (plan.heldMoney)', () => {
  it('plays Petty Cash without the Petty Cash special case', () => {
    tuning.plan.pettyCashFirst = false;
    // On the old threat (plan.threatModel off): with the threat model's leaf the Corp's turn here is a near tie (Petty
    // Cash's line 0.03 behind a credit click, the leaf's run charge deciding), flagged in the item 3 hand-off
    const threat = tuning.plan.threatModel;
    tuning.plan.threatModel = false;
    // plan.hiddenDraws (S6) off: on one guess of R&D the turn ends on a click for a credit (pettyCashFirst.test.ts)
    tuning.plan.hiddenDraws = false;
    try {
      // plan.oneCurrency counts it once by construction (HQ by count, the slide's credits); its planned turn may open a
      // remote first (pettyCashFirst.test.ts), but never clicks for a credit while holding it
      const s = play();
      if (tuning.plan.oneCurrency) expect(s.log.some(l => l.message === 'Corp spent [click] to gain 1 credit.')).toBe(false);
      else expect(inHq(s)).not.toContain('Petty Cash');
    } finally {
      tuning.plan.pettyCashFirst = true;
      tuning.plan.threatModel = threat;
      tuning.plan.hiddenDraws = true;
    }
  });
});
