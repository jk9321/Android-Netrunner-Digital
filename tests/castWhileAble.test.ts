import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef, executeAction } from '../src/core';
import { createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';

const oneCurrencyDefault = tuning.plan.oneCurrency;


/**
 * Jeff (2026-11-04): why can't the Corp manage its econ? The batch "Corp went broke" alarm: 60% of the times the Corp
 * fell under 3 credits it had paid to rez ice in the Runner's runs, often with Hedge Fund (5) stuck in HQ.
 * plan.castWhileAble plays a money operation while the Corp can still afford it, when rezzing its ice would strand it.
 *
 * Position: self-play deal 1212 (Discretion Advised vs Shootin' 'n' Lootin'), the Corp's turn 7: 7 credits, Send a
 * Message in a remote behind Pharos and Ansel 1.0, Ansel and Tithe in HQ, Hedge Fund the next card in R&D. Before the fix
 * the Corp played Predictive Planogram instead and ended on 8 credits holding Hedge Fund; the Runner's runs made it rez
 * 6 credits of ice, leaving 2 and Hedge Fund dead.
 */
function play(): GameState {
  let s: GameState = JSON.parse(readFileSync(new URL('./fixtures/broke-hedge-fund.json', import.meta.url), 'utf8'));
  const corp = createAgent('corp', 'normal');
  for (let i = 0; i < 12 && s.activePlayer === 'corp'; i++) s = executeAction(s, corp.chooseAction(s));
  return s;
}
const inHq = (s: GameState) => s.corp.hq.map(c => cardDef(c).title);

describe('a money operation is played before rezzing ice strands it (plan.castWhileAble)', () => {
  it('plays Hedge Fund this turn', () => {
    const s = play();
    expect(inHq(s)).not.toContain('Hedge Fund');
    expect(s.corp.credits).toBeGreaterThanOrEqual(9);
  }, 30_000);

  it('without the plan Hedge Fund stays in HQ', () => {
    tuning.plan.castWhileAble = false;
    tuning.plan.heldMoney = false;
    // Both are patches on the old ranking (plan.oneCurrency, 2026-11-06: the one-currency Corp plays Hedge Fund on its delta)
    tuning.plan.oneCurrency = false;
    try {
      expect(inHq(play())).toContain('Hedge Fund');
    } finally {
      tuning.plan.oneCurrency = oneCurrencyDefault;
      tuning.plan.castWhileAble = true;
      tuning.plan.heldMoney = true;
    }
  });
});
