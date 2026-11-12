import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, executeAction } from '../src/core';
import { Agent, HeuristicCorpAI, createAgent } from '../src/ai';

/**
 * Money step M1 (incomeLine.ts moneyPick): a playable econ operation that nets credits is the counted
 * pick for its click (rules 1.10, 5.2.6), behind a held two-turn score line's steps. Pin from M0: deal 1001 turn 1, The
 * Syndicate, 5 credits, 3 clicks, Hedge Fund in HQ (play 5, gain 9). The held line installs Palisade and Superconducting
 * Hub; the spare click was a click for a credit (6 credits at the turn's end). With M1 it is Hedge Fund (9).
 */
const position = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/money-1001-t1.json', import.meta.url), 'utf8'));

function turn(ai: Agent): { picks: string[]; credits: number } {
  const s0 = position();
  let s = s0;
  const picks: string[] = [];
  for (let i = 0; i < 12 && s.activePlayer === 'corp' && s.turnNumber === s0.turnNumber; i++) {
    const a: GameAction = ai.chooseAction(s);
    const id = (a as { cardInstanceId?: string }).cardInstanceId;
    const c = id ? s.corp.hq.find(x => x.instanceId === id) : undefined;
    picks.push(c ? `${a.type}:${cardDef(c).title}` : a.type);
    s = executeAction(s, a);
  }
  return { picks, credits: s.corp.credits };
}

// Before M1 both Corps clicked for a credit on the spare click and ended on 6 (checked with the temporary switch off
// before the fold, 7db8eb5)
describe('money step M1: a netting econ operation is the counted pick', () => {
  it('the Normal and the Hard Corp play Hedge Fund on the spare click', { timeout: 120_000 }, () => {
    for (const ai of [new HeuristicCorpAI({ synergy: true }), createAgent('corp', 'hard')]) {
      const t = turn(ai);
      expect(t.picks.slice(0, 2)).toEqual(['INSTALL_CARD:Palisade', 'INSTALL_CARD:Superconducting Hub']);
      expect(t.picks).toContain('PLAY_OPERATION_OR_EVENT:Hedge Fund');
      expect(t.credits).toBe(9);
    }
  });
});
