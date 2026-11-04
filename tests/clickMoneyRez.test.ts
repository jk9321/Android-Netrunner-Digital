import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, createCardInstance, executeAction, findCardAnywhere } from '../src/core';
import { createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';

/**
 * Jeff (2026-11-04): the Corp rezzed Regolith Mining License, then never used it before he trashed it, so it was just
 * 2 credits down. Regolith pays out only by clicks; plan.clickMoneyRez rezzes it when a click is left to take the
 * money, or in the window just before the Corp's turn begins (rule 5.6.1b), never at the end of a turn with no clicks.
 *
 * Position: bug report #15's turn 10 with an unrezzed Regolith alone in a remote, the Corp out of clicks with 5 credits.
 */
function endOfTurn(): { state: GameState; regolith: string } {
  const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/bug-report-15-turn10.json', import.meta.url), 'utf8'));
  const reg = createCardInstance(s, '30071');
  s.corp.servers['remote-9'] = { ...s.corp.servers['remote-1'], id: 'remote-9', ice: [], root: [reg] };
  s.corp.clicks = 0;
  s.corp.credits = 5;
  return { state: s, regolith: reg.instanceId };
}

function finishTurn(s: GameState): GameState {
  const corp = createAgent('corp', 'normal');
  const runner = createAgent('runner', 'normal');
  for (let i = 0; i < 8 && (s.activePlayer === 'corp' || s.pendingPrompts.length > 0); i++) s = executeAction(s, (s.pendingPrompts[0]?.side === 'runner' ? runner : corp).chooseAction(s));
  return s;
}

describe('click-paid money assets are rezzed when they can be used (plan.clickMoneyRez)', () => {
  it('leaves Regolith unrezzed with no click left', () => {
    const { state, regolith } = endOfTurn();
    expect(findCardAnywhere(finishTurn(state), regolith)?.isRezzed).toBe(false);
  });

  it('without the plan it rezzed Regolith at the end of the turn', () => {
    tuning.plan.clickMoneyRez = false;
    try {
      const { state, regolith } = endOfTurn();
      expect(findCardAnywhere(finishTurn(state), regolith)?.isRezzed).toBe(true);
    } finally {
      tuning.plan.clickMoneyRez = true;
    }
  });
});
