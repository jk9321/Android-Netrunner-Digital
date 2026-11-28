import { describe, expect, it } from 'vitest';
import { CardInstance, createCardInstance, GameState } from '../src/core';
import '../src/ai'; // corpPorts filled (the Vic board's boardNeed reads keep)
import { CARDS } from '../src/ai/cards';
import { cardTag, tagRemoved, tagsWorth, tagTaken } from '../src/ai/evaluate';
import { muWorth, optionalTerm, perTurn } from '../src/ai/effectValues';
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

  it("on the board the six Runner formulas read the owner's tag, not the flat (arm F)", () => {
    const on = (tags: number, code: string) => {
      const s = board(tags);
      const card = createCardInstance(s, code);
      s.runner.rig.resources.push(card);
      return { s, card };
    };
    const bg = on(0, '36013');
    // Borrowed Goods on the board: its install tag is already taken (red team minor 4), so no tag term
    expect(CARDS['36013'].runner!(bg.s, '36013', bg.card)).toBe(muWorth(bg.s));
    const foaf = CARDS['34074'].runner!;
    const ft = on(1, '34074');
    const fu = on(0, '34074');
    expect(foaf(ft.s, '34074', ft.card)).toBe(5 + tagRemoved(ft.s) - CLICK); // Friend of a Friend
    expect(foaf(fu.s, '34074', fu.card)).toBe(optionalTerm(9 - tagTaken(fu.s) * 0.7 - CLICK));
    const badge = CARDS['34003'].counters!.power!; // Solidarity Badge: the card's 0.5 kept
    const bt = on(1, '34003');
    expect(badge(bt.s, bt.card)).toBe(optionalTerm(Math.max(cardRate(bt.s, 'runner', 'later'), tagRemoved(bt.s) * 0.5)));
  });

  it('off the board (in the hand, drawn) and inside the deck average, they read the flat rate, as beta did (arm F)', () => {
    const untagged = board(0);
    const tagged = board(1);
    const flat = RATES.tagAgainstRunner;
    const hand = (s: GameState, code: string) => createCardInstance(s, code);
    expect(cardTag(untagged, '36013')).toBe(flat);
    expect(CARDS['36013'].runner!(untagged, '36013', hand(untagged, '36013'))).toBe(muWorth(untagged) - flat);
    expect(CARDS['34074'].runner!(tagged, '34074', hand(tagged, '34074'))).toBe(5 + flat - CLICK);
    expect(CARDS['34074'].runner!(untagged, '34074', hand(untagged, '34074'))).toBe(optionalTerm(9 - flat * 0.7 - CLICK));
    const badge = CARDS['34003'].counters!.power!;
    expect(badge(tagged, hand(tagged, '34003'))).toBe(optionalTerm(Math.max(cardRate(tagged, 'runner', 'later'), flat * 0.5)));
    // on the board too, inside the averaging frame (the deck's average card)
    const s = board(0);
    s.runner.rig.resources.push(createCardInstance(s, '36013'));
    expect(cardTag(s, '36013')).toBe(tagTaken(s));
    withPricing({ averaging: true }, () => expect(cardTag(s, '36013')).toBe(flat));
  });

  it('a second copy in the hand reads the flat while the installed copy reads the owner (red team minor 3: by instance)', () => {
    const s = board(0);
    const installed = createCardInstance(s, '34074');
    s.runner.rig.resources.push(installed);
    const inHand = createCardInstance(s, '34074');
    expect(cardTag(s, '34074', false, installed)).toBe(tagTaken(s));
    expect(cardTag(s, '34074', false, inHand)).toBe(RATES.tagAgainstRunner);
    // counterWorthOf's probe instance falls back to the code: any installed copy
    const probe = { cardCode: '34074', instanceId: 'probe', tokens: {} } as unknown as CardInstance;
    expect(cardTag(s, '34074', false, probe)).toBe(tagTaken(s));
  });

  it("Hannah untagged on the board prices the later tag gone as one taken now, not 0 (Runner rework coordinator's read)", () => {
    const s = board(0);
    const card = createCardInstance(s, '34008');
    s.runner.rig.resources.push(card);
    const tagged0 = 0.3; // liberation.ts tagged(): untagged, a tag-me deck plans around being tagged
    const first = 2 * CLICK + 0.5 * tagTaken(s) * tagged0;
    expect(tagTaken(s)).toBeGreaterThan(0);
    expect(CARDS['34008'].runner!(s, '34008', card)).toBeGreaterThanOrEqual(first);
    expect(CARDS['34008'].runner!(s, '34008', card)).toBeGreaterThan(2 * CLICK);
  });

  it('optional terms floor at 0 (rules 9.5.3, 9.6.9): an ability is never worth less than not using it', () => {
    expect(optionalTerm(-1.96)).toBe(0);
    expect(optionalTerm(4.4)).toBe(4.4);
  });

  it("Arruaceiras Crew skips the tag when tagged (its term is 0): bit for bit the full-B5 value (lever 4)", () => {
    const s = board(1);
    const card = createCardInstance(s, '34073');
    s.runner.rig.resources.push(card);
    const full = perTurn(s, 0.3 * (2 - 0.3 * tagTaken(s) * (1 - 1)), 'runner') + 1.5;
    expect(Object.is(CARDS['34073'].runner!(s, '34073', card), full)).toBe(true);
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
