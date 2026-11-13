import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { asSide, withPricing } from '../src/ai/pricing';
import { cardRate } from '../src/ai/valueModel';
import { decisionContext, deckAvgStats } from '../src/ai/handValues';
import { newGame } from './helpers';

// Planner speed tier 2 (bars/planner-fast-deckavg.md): in a Corp decision's planner playouts the deck's average card
// prices each deck card's played worth once, on the decision's board, and applies the asking board's credits
// (heldWorth's SOON). v1 froze the whole held worth at the root and the Corp stayed broke more (+6.9 ± 2.7, run
// 43326772375). A decision's own boards (a prompt's answers simulated, the rule ranking) and the Runner's stack price
// per board: the board with Clearinghouse trashed priced at the board that kept it left the meat damage unfired
// (tests/clearinghouseRez.test.ts), and plan.reach's cases install a breaker the root's rig lacks (tests/reach.test.ts).
const playout = <T,>(work: () => T): T => withPricing({ frozen: true }, work);
const withCredits = (s: GameState, credits: number): GameState => ({ ...s, corp: { ...s.corp, credits } });

describe('deck average at the decision root', () => {
  it('a board that spent its money down prices its draws lower, as the per-board average did', () => {
    const root = withCredits(newGame(3), 8);
    const [rich, broke] = asSide('corp', () => {
      decisionContext(root, 'corp');
      return playout(() => [cardRate(root, 'corp'), cardRate(withCredits(root, 0), 'corp')]);
    });
    expect(broke).toBeLessThan(rich);
    // Outside the decision (the per-board price) the same order holds
    const freshRich = cardRate(root, 'corp');
    const freshBroke = cardRate(withCredits(root, 0), 'corp');
    expect(freshBroke).toBeLessThan(freshRich);
  });

  it("prices each deck card once per decision and averages over the asking board's deck", () => {
    const root = withCredits(newGame(4), 6);
    const before = deckAvgStats.priced;
    const [full, drawn, again] = asSide('corp', () => {
      decisionContext(root, 'corp');
      return playout(() => {
        const a = cardRate(root, 'corp');
        // A line that drew the top card: the same prices, one card fewer
        const after: GameState = { ...root, corp: { ...root.corp, rd: root.corp.rd.slice(1) } };
        const b = cardRate(after, 'corp');
        const c = cardRate(root, 'corp');
        return [a, b, c];
      });
    });
    expect(deckAvgStats.priced - before).toBe(root.corp.rd.length);
    expect(again).toBe(full);
    expect(drawn).not.toBe(full);
  });

  it("outside a playout, and for the Runner's stack, the price is the per-board one", () => {
    const root = withCredits(newGame(5), 6);
    const before = deckAvgStats.served;
    asSide('corp', () => {
      decisionContext(root, 'corp');
      cardRate(root, 'corp');
      playout(() => cardRate(root, 'runner'));
    });
    expect(deckAvgStats.served).toBe(before);
  });
});
