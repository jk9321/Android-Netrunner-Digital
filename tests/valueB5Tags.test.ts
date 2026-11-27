import { describe, expect, it } from 'vitest';
import { createCardInstance, GameState } from '../src/core';
import '../src/ai'; // corpPorts filled (the Vic board's boardNeed reads keep)
import { CARDS } from '../src/ai/cards';
import { tagRemoved, tagsWorth, tagTaken } from '../src/ai/evaluate';
import { muWorth } from '../src/ai/effectValues';
import { tagCost } from '../src/ai/runs';
import { asSide, withPricing } from '../src/ai/pricing';
import { clearHandCaches } from '../src/ai/handValues';
import { CLICK, RATES, cardRate } from '../src/ai/valueModel';
import { newGame, startRunnerTurn } from './helpers';

/**
 * V-B B5 (brief rev 2 B5, rulings 8, 10, 12 and the mechanism ruling in stage-vb/labels.md): one tag is the tag owner's own
 * difference (tagTaken, tagRemoved; viewer runner), read by tagCost and the six Runner formulas that priced it at the flat 3;
 * inside the tag clock the owner still serves the flat; Vic's drawn card stays the flat (a loop guard: see below).
 */
function board(tags: number, identity?: string): GameState {
  const s = newGame();
  startRunnerTurn(s);
  if (identity) s.runner.identity = createCardInstance(s, identity);
  s.runner.tags = tags;
  s.runner.credits = 5;
  s.corp.credits = 10;
  s.runner.rig.resources = [createCardInstance(s, '35011'), createCardInstance(s, '30034')]; // worth trashing
  return s;
}

describe('V-B B5: a tag read from its owner', () => {
  it("tagCost is tagTaken on the one-click-fewer copy (value-identical to its old subtraction)", () => {
    for (const tags of [0, 1, 2]) {
      const s = board(tags);
      const c = { ...s, runner: { ...s.runner, clicks: s.runner.clicks - 1 } };
      const old = tagsWorth(c, 'runner', tags + 1, s) - tagsWorth(c, 'runner', tags, s);
      expect(tagCost(board(tags))).toBe(old);
    }
  });

  it("tagTaken and tagRemoved are the owner's differences, as the Runner sees it", () => {
    const s = board(1);
    expect(tagTaken(s)).toBe(tagsWorth(s, 'runner', 2) - tagsWorth(s, 'runner', 1));
    expect(tagRemoved(s)).toBe(tagsWorth(s, 'runner', 1) - tagsWorth(s, 'runner', 0));
    expect(tagRemoved(s)).toBeGreaterThan(0);
  });

  it('inside the tag clock the owner serves the flat 3, so a resource priced by the clock sees it as before', () => {
    const s = board(0);
    withPricing({ pricingTagLoss: true }, () => expect(tagTaken(s)).toBe(RATES.tagAgainstRunner));
  });

  it("the six Runner formulas read the owner's tag, not the flat", () => {
    const untagged = board(0);
    const tagged = board(1);
    expect(CARDS['36013'].runner!(untagged, '36013')).toBe(muWorth(untagged) - tagTaken(untagged)); // Borrowed Goods
    const foaf = CARDS['34074'].runner!;
    expect(foaf(tagged, '34074')).toBe(5 + tagRemoved(tagged) - CLICK); // Friend of a Friend
    expect(foaf(untagged, '34074')).toBe(9 - tagTaken(untagged) * 0.7 - CLICK);
    const badge = CARDS['34003'].counters!.power as (s: GameState) => number; // Solidarity Badge: the card's 0.5 kept
    expect(badge(tagged)).toBe(Math.max(cardRate(tagged, 'runner', 'later'), tagRemoved(tagged) * 0.5));
  });
});

describe("V-B B5: Vic's drawn card stays the flat (loop guard)", () => {
  // Read from the deck (cardRate) inside the tag owner, the average prices Borrowed Goods, whose formula now reads the tag
  // owner: tags runner > runner card 36013 > tags runner (found by tests/nanFix.test.ts). The brief: a redirect that closes
  // a loop is a loop guard, so Vic's term keeps RATES.drawnCard
  it('a Vic board with Borrowed Goods in the stack prices its tags without a loop, on both sides', () => {
    clearHandCaches();
    const s = board(0, '36009'); // untagged: Borrowed Goods' formula then reads a tag taken
    s.runner.stack.unshift(createCardInstance(s, '36013'));
    for (const side of ['corp', 'runner'] as const) expect(Number.isFinite(asSide(side, () => tagsWorth(s, 'runner', 2)))).toBe(true);
  });
});
