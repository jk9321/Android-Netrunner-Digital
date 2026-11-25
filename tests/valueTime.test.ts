// ai-value-time (brief-value-time.md): time-only changes to the valuation code give the same numbers as before.
import { describe, expect, it } from 'vitest';
import { CARDS, corpFormula } from '../src/ai/cards';
import { agendaOdds, corpEffect } from '../src/ai/effectValues';
import { tagsWorth } from '../src/ai/evaluate';
import { assetRisk } from '../src/ai/cardProfiles';
import { PAYOUT_RISK } from '../src/ai/payoutRisk';
import { cardRate, pointGain } from '../src/ai/valueModel';
import { getCardDefinition } from '../src/data/cards';
import { tagCost } from '../src/ai/runs';
import { createCardInstance, GameState } from '../src/core';
import { newGame, startRunnerTurn } from './helpers';

/** tagCost as it was before step 1: the one-click-fewer copy priced on its own, nothing kept on the original. */
function tagCostBefore(state: GameState): number {
  const s = !state.activeRun ? { ...state, runner: { ...state.runner, clicks: state.runner.clicks - 1 } } : state;
  return tagsWorth(s, 'runner', s.runner.tags + 1) - tagsWorth(s, 'runner', s.runner.tags);
}

function board(runnerTurn: boolean, tags: number): GameState {
  const s = newGame();
  if (runnerTurn) startRunnerTurn(s);
  s.runner.tags = tags;
  s.runner.credits = 5;
  s.corp.credits = 10;
  s.runner.rig.resources = [createCardInstance(s, '35011'), createCardInstance(s, '30034')]; // Rent Rioters, Verbal Plasticity
  return s;
}

describe('step 1: the tag clock kept on the original board', () => {
  for (const runnerTurn of [false, true])
    for (const tags of [0, 1, 2])
      it(`tagCost is the same number as before (${runnerTurn ? "Runner's" : "Corp's"} turn, ${tags} tags), asked once or twice`, () => {
        const before = tagCostBefore(board(runnerTurn, tags));
        const s = board(runnerTurn, tags);
        expect(tagCost(s)).toBe(before);
        expect(tagCost(s)).toBe(before);
      });

  it('the kept loss does not serve the plain tag clock on the same board (different clicks, different key)', () => {
    const fresh = tagsWorth(board(true, 1), 'runner');
    const s = board(true, 1);
    tagCost(s);
    expect(tagsWorth(s, 'runner')).toBe(fresh);
  });

  it('a board changed in place is priced again (the memo drops on a new fingerprint)', () => {
    const s = board(true, 1);
    tagCost(s);
    s.runner.clicks = 1;
    s.runner.credits = 1;
    expect(tagCost(s)).toBe(tagCostBefore(structuredClone(s)));
  });
});

describe('step 2: the tag input to the Corp formulas worked out on first read', () => {
  const codes = Object.keys(CARDS).filter(code => CARDS[code].corp);
  // 3 since F108 (2026-11-25): B-1001's entry reads "tagged" and no longer the tag's price (item 5)
  it('there are Corp formulas, and 3 of them read the tag input', () => {
    expect(codes.length).toBeGreaterThan(40);
    const readers = codes.filter(code => {
      let read = false;
      const ctx = { cost: 0, agenda: 1, card: 1, risk: PAYOUT_RISK.corpBare, get tag() { read = true; return 1; } };
      try {
        corpFormula(board(false, 1), code, ctx);
      } catch {
        // a formula that throws on this board is still counted by what it read first
      }
      return read;
    });
    expect(readers.sort()).toHaveLength(3);
  });

  for (const runnerTurn of [false, true])
    for (const tags of [0, 1])
      it(`every formula gives the same numbers as with the tag worked out first (${runnerTurn ? "Runner's" : "Corp's"} turn, ${tags} tags)`, () => {
        for (const code of codes)
          for (const rezzed of [false, true]) {
            const eager = board(runnerTurn, tags);
            const cost = rezzed ? 0 : getCardDefinition(code).cost ?? 0;
            const agenda = pointGain(eager.corp.score, agendaOdds(eager).points);
            const card = cardRate(eager, 'corp', 'now');
            const tag = tagsWorth(eager, 'corp', 1);
            const risk = getCardDefinition(code).type_code === 'asset' ? assetRisk(eager, false) : PAYOUT_RISK.corpBare;
            expect(corpEffect(board(runnerTurn, tags), code, rezzed), code).toEqual(corpFormula(eager, code, { cost, agenda, card, tag, risk }));
          }
      });
});
