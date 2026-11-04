import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, createCardInstance } from '../src/core';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { asSide, tuning } from '../src/ai/synergy';

/**
 * Jeff (2026-11-04): "double check anything that gives credits". Wildcat Strike ("Resolve 1 of the following of the
 * Corp's choice: gain 6 credits, or draw 4 cards") scored as a card, a click and 2 credits thrown away: the Runner AI
 * followed only its own prompts after playing a card, so the Corp's choice was never resolved and nothing was gained.
 * plan.answerCorpChoice resolves the Corp's answer too before the position is scored.
 *
 * Position: self-play deal 1001, the Runner's turn 9 with 4 clicks; the grip 4 cards and Wildcat Strike, 3 credits.
 */
function ranks(): { wildcat: number; credit: number } {
  const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/runner-sure-gamble.json', import.meta.url), 'utf8'));
  s.runner.grip.pop();
  const card = createCardInstance(s, '30002'); // Wildcat Strike
  s.runner.grip.push(card);
  s.runner.credits = 3;
  const rk = asSide('runner', () => new HeuristicRunnerAI({ synergy: true, planner: false }).rankMainActions(s));
  const score = (f: (a: { type: string; cardInstanceId?: string }) => boolean) => rk.find(r => f(r.action))!.score;
  return { wildcat: score(a => a.cardInstanceId === card.instanceId), credit: score(a => a.type === 'GAIN_CREDIT') };
}

describe("a card the Corp chooses for is scored after the Corp's choice (plan.answerCorpChoice)", () => {
  it('ranks Wildcat Strike above a click for a credit', () => {
    const r = ranks();
    expect(r.wildcat).toBeGreaterThan(r.credit);
  });

  it('without the plan Wildcat Strike scores as a loss', () => {
    tuning.plan.answerCorpChoice = false;
    try {
      expect(ranks().wildcat).toBeLessThan(-2);
    } finally {
      tuning.plan.answerCorpChoice = true;
    }
  });
});
