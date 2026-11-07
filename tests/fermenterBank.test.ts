import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef, findCardAnywhere } from '../src/core';
import { HeuristicRunnerAI } from '../src/ai';
import { tuning } from '../src/ai/synergy';
import { inDecision } from './helpers/pricing';

/**
 * Bug report #17 (Jeff's Corp game 1, 2026-11-05): the Runner held two Fermenters, 10 and 5 counters (30 credits),
 * from turn 10 on while it clicked for credits on 0 to 5 credits, until Jeff's Flyswatter purged them. Each counter
 * was priced at a flat 1.75, and each Fermenter as if its credits were the first the Runner would gain, so a bank of
 * 10 outweighed 20 credits to a broke Runner. plan.fermenterBank prices the whole bank on one stretch of the credit
 * slide, 2% off each counter for every counter banked (a purge takes the lot).
 *
 * Position: the Runner's turn 10 after its first click, 5 credits, 3 clicks, Fermenters on 10 and 5 counters.
 */
function position(): GameState {
  return JSON.parse(readFileSync(new URL('./fixtures/bug-report-17-fermenters.json', import.meta.url), 'utf8'));
}

const top = (s: GameState) => {
  const [best] = inDecision(s, 'runner', () => new HeuristicRunnerAI({ synergy: true, planner: false }).rankMainActions(s));
  return best.action.type === 'USE_ABILITY' ? `use ${cardDef(findCardAnywhere(s, best.action.cardInstanceId)!).title}` : best.action.type;
};

describe('a big Fermenter bank is cashed when the Runner is short (plan.fermenterBank)', () => {
  it('cashes a Fermenter on 5 credits with 15 counters banked', () => {
    expect(top(position())).toBe('use Fermenter');
  });

  it('without the plan it held the bank', () => {
    tuning.plan.fermenterBank = false;
    try {
      expect(top(position())).not.toBe('use Fermenter');
    } finally {
      tuning.plan.fermenterBank = true;
    }
  });
});
