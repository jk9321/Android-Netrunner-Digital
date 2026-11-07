import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, createCardInstance } from '../src/core';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { tuning } from '../src/ai/synergy';
import { inDecision } from './helpers/pricing';

/**
 * Jeff (2026-11-04): "double check anything that gives credits". A sweep of every money card found the Runner AI ranking
 * Sure Gamble below a click for a credit: in self-play it ended 22 turns holding a Sure Gamble it could afford and clicked
 * for credits instead. The damage clock counted the grip as the Runner's life without the clicks left to draw back
 * (rules 1.7.2b and 10.4.4: the Runner flatlines on more damage than cards in the grip), so every card spent from a full grip looked
 * like a step towards flatline. plan.drawBackLife counts the Runner's remaining clicks as cards it can draw back, up to
 * its maximum hand size.
 *
 * Position: self-play deal 1001, the Runner's turn 9 with 4 clicks and 5 cards; one card swapped for Sure Gamble, 5 credits.
 */
function ranks(): { gamble: number; credit: number } {
  const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/runner-sure-gamble.json', import.meta.url), 'utf8'));
  s.runner.grip.pop();
  const card = createCardInstance(s, '30030'); // Sure Gamble
  s.runner.grip.push(card);
  s.runner.credits = 5;
  const rk = inDecision(s, 'runner', () => new HeuristicRunnerAI({ synergy: true, planner: false }).rankMainActions(s));
  const score = (f: (a: { type: string; cardInstanceId?: string }) => boolean) => rk.find(r => f(r.action))!.score;
  return { gamble: score(a => a.cardInstanceId === card.instanceId), credit: score(a => a.type === 'GAIN_CREDIT') };
}

describe('the Runner plays Sure Gamble rather than clicking for a credit (plan.drawBackLife)', () => {
  it('ranks Sure Gamble above a click for a credit', () => {
    const r = ranks();
    expect(r.gamble).toBeGreaterThan(r.credit);
  });

  it('without the plan Sure Gamble ranks below a click for a credit', () => {
    tuning.plan.drawBackLife = false;
    // and without plan.corpTurnDamage (2026-11-06), which closes the same hole here: the clock read the Corp's damage ice
    tuning.plan.corpTurnDamage = false;
    try {
      const r = ranks();
      expect(r.gamble).toBeLessThan(r.credit);
    } finally {
      tuning.plan.drawBackLife = true;
      tuning.plan.corpTurnDamage = true;
    }
  });
});
