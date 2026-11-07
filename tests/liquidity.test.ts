import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { inDecision } from './helpers/pricing';

/**
 * Jeff (2026-11-06, his Corp game with A Teia, bug report #28): "The runner should have saved up for Sure Gamble to fix
 * its econ some. The credit slider should have incentivized that." The Runner AI sat on 0-5 credits from turn 2 to 14.
 * Telework Contract's hosted credits were priced on the credit slide from the credits in hand, so each credit gained
 * made them look less needed: at 5 credits Sure Gamble gained 6.1 in cash, lost 3.5 on the contract and scored 0.1,
 * below drawing a card (1.1). plan.liquidity prices credits still on a card on the slide from half the Runner's need
 * (or from its credits, when it holds more), so they lose nothing as cash comes in.
 *
 * Position: the game replayed to the Runner's turn 14 with 2 clicks left: 5 credits, Sure Gamble in the grip, Telework
 * Contract and Fermenter installed.
 */
function position(): GameState {
  const report = JSON.parse(readFileSync(new URL('./fixtures/human-games/report-28.json', import.meta.url), 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  for (const move of report.moves as GameAction[]) {
    if (s.activePlayer === 'runner' && s.turnNumber === 14 && s.runner.clicks === 2 && !s.activeRun && s.pendingPrompts.length === 0) return s;
    s = executeAction(s, move);
  }
  throw new Error('turn 14 not reached');
}

function ranks(): { gamble: number; draw: number } {
  const s = position();
  expect(s.runner.credits).toBe(5);
  const rk = inDecision(s, 'runner', () => new HeuristicRunnerAI({ synergy: true, planner: false }).rankMainActions(s));
  const gamble = rk.find(r => 'cardInstanceId' in r.action && s.runner.grip.some(c => c.instanceId === (r.action as { cardInstanceId: string }).cardInstanceId && cardDef(c).title === 'Sure Gamble'))!;
  return { gamble: gamble.score, draw: rk.find(r => r.action.type === 'DRAW_CARD')!.score };
}

describe('money still on a card is no reason to skip Sure Gamble (plan.liquidity)', () => {
  it('plays Sure Gamble at 5 credits rather than drawing', () => {
    const r = ranks();
    expect(r.gamble).toBeGreaterThan(r.draw);
  });
});
