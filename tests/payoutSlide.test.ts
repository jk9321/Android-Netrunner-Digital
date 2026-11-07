import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { tuning } from '../src/ai/synergy';
import { inDecision } from './helpers/pricing';

/**
 * Jeff (2026-11-04): "was it using Fermenter and Telework correctly?" In 30 self-play games the Runner clicked for
 * credits on 16 turns while holding a Telework Contract it could afford. Credits spent on installing it were priced on
 * the credit slide (up to 1.8 each when broke) but the 9 credits it pays out at a flat 1, so a broke Runner never found
 * it worth a click. plan.payoutSlide prices credits still to be paid out on the same slide.
 *
 * Position: self-play deal 1001, the Runner's turn 9 with 4 clicks, Telework Contract in the grip, 1 credit.
 */
function ranks(): { telework: number; credit: number } {
  const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/runner-sure-gamble.json', import.meta.url), 'utf8'));
  s.runner.credits = 1;
  const card = s.runner.grip.find(c => c.cardCode === '30027')!; // Telework Contract
  const rk = inDecision(s, 'runner', () => new HeuristicRunnerAI({ synergy: true, planner: false }).rankMainActions(s));
  const score = (f: (a: { type: string; cardInstanceId?: string }) => boolean) => rk.find(r => f(r.action))!.score;
  return { telework: score(a => a.cardInstanceId === card.instanceId), credit: score(a => a.type === 'GAIN_CREDIT') };
}

describe('credits a card will pay out are priced on the credit slide (plan.payoutSlide)', () => {
  it('installs Telework Contract rather than clicking for a credit when broke', () => {
    const r = ranks();
    expect(r.telework).toBeGreaterThan(r.credit);
  });

  // Later plans closed most of the gap without it (2026-11-06: on its own, Telework 0.18 against a credit click 0.17;
  // it only failed after the first test had filled the value caches), so this checks the plan's own lead
  it('without the plan Telework Contract leads a click for a credit by less', () => {
    const on = ranks();
    tuning.plan.payoutSlide = false;
    try {
      const r = ranks();
      expect(r.telework - r.credit).toBeLessThan(on.telework - on.credit);
    } finally {
      tuning.plan.payoutSlide = true;
    }
  });
});
