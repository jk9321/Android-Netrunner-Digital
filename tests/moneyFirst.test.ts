import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, executeAction } from '../src/core';
import { Agent, HeuristicCorpAI, createAgent } from '../src/ai';
import { moneyPick } from '../src/ai/incomeLine';
import { giveCard, installIceForTest, newGame } from './helpers';
import { inDecision } from './helpers/pricing';

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

/**
 * Review R1 (review-money-m1.md): the count sees credits only, so a play that pays with something else is the Corp's own
 * pick, not the counted one. A Corp turn, 3 clicks, 10 credits, two rezzed Palisades on HQ, the one operation in HQ.
 * realloc() derezzes rezzed ice for credits (rule 8.1.3: turned facedown, its rez cost paid again, 8.1.2); Vulture Fund
 * gives the Corp bad publicity (rule 10.6: credits for the Runner during its runs).
 */
describe('money step M1: a play that pays with something credits do not count is left to the Corp', () => {
  const position = (op: string) => {
    const s = structuredClone(newGame(1));
    s.corp.rd.push(...s.corp.hq.splice(0));
    s.corp.clicks = 3;
    s.corp.credits = 10;
    installIceForTest(s, '30072', 'hq'); // Palisade
    installIceForTest(s, '30072', 'hq');
    giveCard(s, 'corp', op);
    return s;
  };
  it('realloc() (derezzes rezzed ice) is not the counted pick', () => {
    const s = position('36033');
    expect(inDecision(s, 'corp', () => moneyPick(s))).toBeNull();
  });
  it('Vulture Fund (bad publicity) is not the counted pick', () => {
    const s = position('36063');
    expect(inDecision(s, 'corp', () => moneyPick(s))).toBeNull();
  });
  it('Hedge Fund in the same position still is', () => {
    const s = position('30075');
    expect(inDecision(s, 'corp', () => moneyPick(s))).toMatchObject({ type: 'PLAY_OPERATION_OR_EVENT' });
  });
});
