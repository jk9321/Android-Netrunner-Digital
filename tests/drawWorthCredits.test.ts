import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { cardDef } from '../src/core';
import { createCardInstance } from '../src/core/engine/gameState';
import { HAND_FLOOR, SOON, clickWorth, heldWorth, playedWorth } from '../src/ai/handValues';
import { cardRate } from '../src/ai/valueModel';
import { knownIncome, nextTurn, runnerEarnings } from '../src/ai/nextTurnMoney';
import { newGame } from './helpers';

/**
 * plan.drawWorthCredits (code audit, 2026-11-06): the average card a draw brings is worth more when the side can pay
 * for what it draws (heldWorth: a card it can afford is played sooner). The cache kept the first credit count of the
 * turn: the same turn at 3 credits was priced as at 0, and so was a click (clickWorth: at least a draw), and
 * tests/brokeCorp.test.ts passed alone and failed after another.
 */
const turn17 = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/bug-report-2-turn17.json', import.meta.url), 'utf8'));
const at = (credits: number, id: string): GameState => {
  const s = turn17();
  s.corp.credits = credits;
  s.id = id;
  return s;
};

describe('a draw is priced on the credits the side has now (plan.drawWorthCredits)', () => {
  it('the same turn at 5 credits is priced as a fresh look at 5 credits', () => {
    const fresh = clickWorth(at(5, 'fresh-5'), 'corp');
    expect(fresh).not.toBeCloseTo(clickWorth(at(0, 'fresh-0'), 'corp'));
    clickWorth(at(0, 'same'), 'corp');
    expect(clickWorth(at(5, 'same'), 'corp')).toBeCloseTo(fresh);
  });
});

/**
 * R-14h (issue #65; brief runner-rework/briefs/r14h-last-credits-fix.md bar 1): a card that arrives on a later turn is
 * tested against the money it is played with on that turn (handValues.ts drawMoney, 'later'), a card in hand or lost from
 * it now against the credits on the board ('now'). Each board asserts its condition first.
 */
describe("a card that arrives on a later turn is tested against that turn's money (R-14h)", () => {
  // the ruled form (rulings 16): every click but two earns (one draws the card, one plays it); the Corp stays at today's credits
  const runnerMoney = (s: GameState) => s.runner.credits + runnerEarnings(s, nextTurn(s))[Math.max(0, s.runner.maxClicks - 2)];
  /** A starter board whose stack is exactly `codes`, with `credits` (a fresh object each time: the money is kept per board). */
  const runnerBoard = (codes: string[], credits: number, id: string, edit?: (s: GameState) => void): GameState => {
    const s = newGame();
    s.id = id;
    s.runner.stack = codes.map(code => createCardInstance(s, code));
    s.runner.credits = credits;
    edit?.(s);
    return s;
  };
  const later = (s: GameState) => cardRate(s, 'runner', 'later');
  const now = (s: GameState) => cardRate(s, 'runner', 'now');
  // Programs, hardware and resources whose played worth does not read the credits (Unity 3, DZMZ Optimizer 2, Mayfly 1,
  // Cookbook 1, Smartware Distributor 0, Pantograph 2, Telework Contract 1, Fermenter 1); Sure Gamble 5 likewise
  const CHEAP = ['30026', '30022', '30032', '30009', '30033', '30023', '30027', '30007'];
  const SURE_GAMBLE = '30030';

  it('(a) a trash down to 1 credit that leaves the new money above every deck cost leaves the later average where it was', () => {
    const before = runnerBoard(CHEAP, 4, 'r14h-a-4');
    const after = runnerBoard(CHEAP, 1, 'r14h-a-1');
    // the condition: the same played worths, every cost within both boards' new money, some cost over the after board's credits
    for (let i = 0; i < CHEAP.length; i++) expect(playedWorth(after, after.runner.stack[i])).toBe(playedWorth(before, before.runner.stack[i]));
    const costs = after.runner.stack.map(c => cardDef(c).cost ?? 0);
    expect(Math.max(...costs)).toBeLessThanOrEqual(runnerMoney(after));
    expect(Math.max(...costs)).toBeGreaterThan(after.runner.credits);
    expect(later(after)).toBe(later(before));
    // today's test still steps (a card in hand, a card lost now)
    expect(now(after)).toBeLessThan(now(before));
  });

  it("(a') a trash that crosses a deck card's cost under the new money still moves the later average: the step is moved, not removed", () => {
    const codes = [...CHEAP, SURE_GAMBLE];
    const before = runnerBoard(codes, 3, 'r14h-a2-3');
    const after = runnerBoard(codes, 0, 'r14h-a2-0');
    const sure = cardDef(after.runner.stack[CHEAP.length]).cost ?? 0;
    expect(playedWorth(after, after.runner.stack[CHEAP.length])).toBe(playedWorth(before, before.runner.stack[CHEAP.length]));
    expect(sure).toBeGreaterThan(runnerMoney(after));
    expect(sure).toBeLessThanOrEqual(runnerMoney(before));
    expect(later(after)).toBeLessThan(later(before));
  });

  it("(b) two boards that differ only in Smartware Distributor's hosted credits read different later averages (the money is in the key)", () => {
    const codes = ['30018', '30006']; // Red Team 5, Cleaver 3
    const withSmartware = (hosted: number) => (s: GameState) => {
      const smart = createCardInstance(s, '30033');
      smart.tokens.credit = hosted;
      s.runner.rig.resources.push(smart);
    };
    const none = runnerBoard(codes, 2, 'r14h-b', withSmartware(0));
    const one = runnerBoard(codes, 2, 'r14h-b', withSmartware(1));
    expect(runnerMoney(one)).toBe(runnerMoney(none) + 1);
    expect(playedWorth(one, one.runner.stack[0])).toBe(playedWorth(none, none.runner.stack[0]));
    expect(cardDef(none.runner.stack[0]).cost).toBe(runnerMoney(one));
    expect(later(none)).not.toBe(later(one));
  });

  it("(b') two boards with the same money and different credits read different later averages (the key keeps the credits)", () => {
    const codes = ['30027', '30007']; // Telework Contract, Fermenter: their payouts slide with the credits (payoutSlide)
    const smart = (hosted: number) => (s: GameState) => {
      const c = createCardInstance(s, '30033');
      c.tokens.credit = hosted;
      s.runner.rig.resources.push(c);
    };
    const x = runnerBoard(codes, 8, 'r14h-b2', smart(1));
    const y = runnerBoard(codes, 9, 'r14h-b2', smart(0));
    expect(runnerMoney(x)).toBe(runnerMoney(y));
    expect(playedWorth(x, x.runner.stack[0])).not.toBe(playedWorth(y, y.runner.stack[0]));
    expect(later(x)).not.toBe(later(y));
  });

  it("(c) a card in hand and a 'now' read keep today's test", () => {
    const s = runnerBoard(CHEAP, 1, 'r14h-c');
    const unity = createCardInstance(s, '30026'); // cost 3: within the new money, over the credits
    expect(cardDef(unity).cost).toBeLessThanOrEqual(runnerMoney(s));
    expect(heldWorth(s, unity, 'runner')).toBe(Math.max(HAND_FLOOR, SOON.later * playedWorth(s, unity)));
    const rich = runnerBoard(CHEAP, 3, 'r14h-c-3');
    expect(now(s)).toBeLessThan(now(rich));
    expect(later(s)).toBeGreaterThan(now(s));
  });

  it("(d) the Corp's later card reads today's credits, as its held HQ card does (the Corp side's ruling; its form is R-14q)", () => {
    const board = (hosted: number, id: string) => {
      const s = newGame();
      s.id = id;
      s.corp.credits = 0;
      const nico = createCardInstance(s, '30037'); // Nico Campaign: 3 a turn from the credits it holds
      nico.isRezzed = true;
      nico.tokens.credit = hosted;
      s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote Server 1', isRemote: true, ice: [], root: [nico] };
      s.corp.rd = ['30048', '30040', '30073'].map(code => createCardInstance(s, code)); // Hansei Review 5, Seamless Launch 1, Tithe 1
      return s;
    };
    const dry = board(0, 'r14h-d-0');
    const paid = board(9, 'r14h-d-9');
    // the condition: the Corp's next turn pays 3 more on the paid board, and the deck's played worths are the same
    expect(knownIncome(paid)).toBe(knownIncome(dry) + 3);
    for (let i = 0; i < 3; i++) expect(playedWorth(paid, paid.corp.rd[i])).toBe(playedWorth(dry, dry.corp.rd[i]));
    expect(cardRate(paid, 'corp', 'later')).toBe(cardRate(dry, 'corp', 'later'));
    expect(cardRate(paid, 'corp', 'later')).toBe(cardRate(paid, 'corp', 'now'));
    for (const c of paid.corp.hq) expect(heldWorth(paid, c, 'corp')).toBe(Math.max(HAND_FLOOR, ((cardDef(c).cost ?? 0) <= paid.corp.credits ? SOON.now : SOON.later) * playedWorth(paid, c)));
  });
});
