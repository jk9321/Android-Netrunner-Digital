/**
 * F108 (brief netrunner-ai/tag-owner/brief-build.md rev 1, bar 1; ruling netrunner-ai/tag-owner/ruling.md A and B):
 * what a tag puts at risk for the Runner is priced once, by its owner, the tag clock (evaluate.ts tagsWorth). The rules
 * it prices: a tagged Runner's resources can be trashed by the Corp's basic action, a click and 2 credits (Comprehensive
 * Rules 5.2.6g; rule 10.5.3: the action trashes a resource), and the Runner can remove a tag for a click and 2 credits
 * (rule 5.2.5f; rule 10.5.4).
 *
 * (a) a Runner card's own per-turn term is the same tagged and untagged (perTurn, payoutWait: the tagged risk is gone);
 * (b) one more tag moves evaluate by the clock's own change, once (the Corp's strength has no tag line), a first tag and
 *     a later one;
 * (c) mid-run, the same change is tagCost (a unit identity of (b) and tagCost's definition, runs.ts);
 * (d) inside the Runner view's clock, a resource is priced at its rig term on the untagged board (full worth);
 * (e) B-1001's entry prices no tag: two tagged boards whose clocks differ give it the same worth.
 * Each test asserts its board's condition first. On the merge base (beta 11eaa87) every one of them fails: the numbers
 * are in the hand-off.
 */
import { describe, expect, it } from 'vitest';
import { CardInstance, GameState, createCardInstance } from '../src/core';
import { runnerEffect, corpEffect } from '../src/ai/effectValues';
import { evaluate, handAndClicks, runnerRigValue, sideStrength, tagLossPerTurn, tagsWorth, corpBoardValue } from '../src/ai/evaluate';
import { sideCreditValue } from '../src/ai/valueModel';
import { tagCost } from '../src/ai/runs';
import { CLICK } from '../src/ai/valueModel';
import { inDecision } from './helpers/pricing';
import { installCorpForTest, newGame, run } from './helpers';

/** The Runner's turn, 4 clicks and 6 credits; the Corp with 8 credits. */
function runnerTurn(): GameState {
  const s = newGame();
  s.activePlayer = 'runner';
  s.runner.clicks = 4;
  s.runner.credits = 6;
  s.corp.credits = 8;
  return s;
}
const withTags = (s: GameState, n: number): GameState => {
  const t = structuredClone(s);
  t.runner.tags = n;
  return t;
};
function install(s: GameState, code: string): CardInstance {
  const c = createCardInstance(s, code);
  c.isRezzed = true;
  c.faceUp = true;
  const type = c.cardCode === '34006' ? 'programs' : c.cardCode === '34014' ? 'hardware' : 'resources';
  s.runner.rig[type].push(c);
  return c;
}

describe('F108 (a): a Runner card’s own per-turn term is the same tagged and untagged', () => {
  // Lago Paranoá Shelter (resource), Monkeywrench (program), Hermes (hardware): each entry's worth is perTurn's
  for (const [code, title] of [
    ['34009', 'Lago Paranoá Shelter'],
    ['34006', 'Monkeywrench'],
    ['34014', 'Hermes'],
  ] as const) {
    it(`${title}: inside the Runner's decision`, () => {
      const s = runnerTurn();
      const card = install(s, code);
      const term = (b: GameState) => inDecision(b, 'runner', () => runnerEffect(b, code, b.runner.rig.programs.concat(b.runner.rig.hardware, b.runner.rig.resources).find(c => c.instanceId === card.instanceId)));
      const untagged = term(s);
      expect(untagged).toBeGreaterThan(0.5); // the board's condition: a per-turn worth to discount
      expect(term(withTags(s, 1))).toBeCloseTo(untagged!, 9);
      expect(term(withTags(s, 2))).toBeCloseTo(untagged!, 9);
    });
  }
});

/**
 * A board where nothing but the clock reads a tag: the Runner's only rig card is Rent Rioters (a flat worth, no per-turn
 * term), its grip six Cookbooks (flat keep values); the Corp's HQ and R&D are Government Subsidies only (the sample deck
 * holds cards whose damage reads a tag, Orbital Superiority, Neurospike, and a punisher, Retribution). Every part of
 * evaluate other than the clock is asserted equal with and without the tag, part by part.
 */
function clockOnlyBoard(): GameState {
  const s = runnerTurn();
  s.corp.hq = Array.from({ length: 5 }, () => createCardInstance(s, '30064')); // Government Subsidy
  s.corp.rd = Array.from({ length: 20 }, () => createCardInstance(s, '30064'));
  s.runner.grip = Array.from({ length: 6 }, () => createCardInstance(s, '30009')); // Cookbook
  s.runner.rig.resources = [];
  install(s, '35011'); // Rent Rioters
  return s;
}
/** evaluate's parts other than the tag clock, Runner view (sideStrength's lines; evaluate.ts). */
function otherParts(s: GameState) {
  return inDecision(s, 'runner', () => ({
    runnerCredits: sideCreditValue(s, 'runner', 'runner'),
    runnerHandClicks: handAndClicks(s, 'runner', 'runner'),
    runnerRig: runnerRigValue(s),
    // The Runner's strength less its credits, hand, rig and clock: points, core damage and the damage clock
    runnerRest: sideStrength(s, 'runner', 'runner') + tagsWorth(s, 'runner') - sideCreditValue(s, 'runner', 'runner') - handAndClicks(s, 'runner', 'runner') - runnerRigValue(s),
    corpCredits: sideCreditValue(s, 'corp', 'runner'),
    corpHandClicks: handAndClicks(s, 'corp', 'runner'),
    corpBoard: corpBoardValue(s, 'runner'),
  }));
}
const evalRunner = (s: GameState) => inDecision(s, 'runner', () => evaluate(s, 'runner'));
const clock = (s: GameState) => inDecision(s, 'runner', () => tagsWorth(s, 'runner'));

describe('F108 (b): one more tag moves evaluate by the tag clock’s own change, once', () => {
  for (const [from, label] of [
    [0, 'a first tag (0 to 1)'],
    [1, 'a later tag (1 to 2)'],
  ] as const) {
    it(`${label}, the Runner's view`, () => {
      const s = withTags(clockOnlyBoard(), from);
      const more = withTags(s, from + 1);
      // The board's condition: every other part of evaluate is equal, and the clock moves
      const a = otherParts(s);
      const b = otherParts(more);
      for (const k of Object.keys(a) as (keyof typeof a)[]) expect(b[k], k).toBeCloseTo(a[k], 9);
      const dClock = clock(more) - clock(s);
      expect(dClock).toBeGreaterThan(0.05);
      expect(evalRunner(more) - evalRunner(s)).toBeCloseTo(-dClock, 2);
    });
  }
});

describe('F108 (c): mid-run, one more tag moves evaluate by tagCost (a unit identity of (b) and tagCost)', () => {
  it('a run on HQ, the Runner untagged', () => {
    const s = run(clockOnlyBoard(), 'hq');
    expect(s.activeRun).toBeTruthy(); // the board's condition: tagCost takes no click
    const more = withTags(s, 1);
    const a = otherParts(s);
    const b = otherParts(more);
    for (const k of Object.keys(a) as (keyof typeof a)[]) expect(b[k], k).toBeCloseTo(a[k], 9);
    const price = inDecision(s, 'runner', () => tagCost(s));
    expect(price).toBeGreaterThan(0.05);
    expect(evalRunner(more) - evalRunner(s)).toBeCloseTo(-price, 2);
  });
});

describe('F108 (d): inside the Runner view’s clock, a resource is priced at its rig term on the untagged board', () => {
  // One resource on the board, the Corp with 2 credits or more and nothing in HQ (no punisher can be held), so the clock's
  // per-turn loss is that resource's term less the trash action's click and 2 credits
  for (const [code, title] of [
    ['34009', 'Lago Paranoá Shelter'],
    ['35034', 'Side Hustle'],
  ] as const) {
    it(title, () => {
      const s = runnerTurn();
      s.runner.rig.resources = [];
      s.corp.rd.push(...s.corp.hq);
      s.corp.hq = [];
      const bare = structuredClone(s);
      install(s, code);
      const full = inDecision(s, 'runner', () => runnerRigValue(s)) - inDecision(bare, 'runner', () => runnerRigValue(bare));
      expect(full).toBeGreaterThan(CLICK + 2); // the board's condition: the resource is worth the trash action
      const tagged = withTags(s, 1);
      expect(inDecision(tagged, 'runner', () => tagLossPerTurn(tagged, 'runner'))).toBeCloseTo(full - (CLICK + 2), 6);
    });
  }
});

describe('F108 (e): B-1001’s entry prices no tag', () => {
  it('two tagged boards whose clocks differ give the installed, known B-1001 the same worth', () => {
    const board = (resource: boolean) => {
      const s = withTags(runnerTurn(), 1);
      s.runner.rig.resources = [];
      if (resource) install(s, '34009'); // Lago Paranoá Shelter
      const id = installCorpForTest(s, '34065', 'remote-1', true); // B-1001, rezzed
      const b1001 = s.corp.servers['remote-1'].root.find(c => c.instanceId === id)!;
      b1001.runnerKnows = true;
      return s;
    };
    const one = board(false);
    const two = board(true);
    // The board's condition: the clock's price of a tag (the Corp's view, as given) differs between the two
    const tag = (s: GameState) => inDecision(s, 'corp', () => tagsWorth(s, 'corp', 1));
    expect(Math.abs(tag(two) - tag(one))).toBeGreaterThan(0.5);
    const worth = (s: GameState) => inDecision(s, 'corp', () => corpEffect(s, '34065', true)!.keep);
    expect(worth(two)).toBeCloseTo(worth(one), 9);
  });
});
