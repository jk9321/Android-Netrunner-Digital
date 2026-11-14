import { describe, expect, it } from 'vitest';
import { CardInstance, GameState, createCardInstance } from '../src/core';
import { revealInHand } from '../src/core/engine/helpers';
import { breakerReach, protectionCost } from '../src/ai/corpAI';
import { moneyPick } from '../src/ai/incomeLine';
import { muWorth } from '../src/ai/effectValues';
import { asSide } from '../src/ai/pricing';
import { giveCard, installCorpForTest, installIceForTest, installProgramForTest, newGame } from './helpers';
import { inDecision } from './helpers/pricing';

/**
 * Hidden information (comprehensive rules 10.2.2a: "cards in HQ or R&D, cards in the Runner's grip or stack" are hidden;
 * 10.2.2b: a player can't learn them without a game effect; 10.2.3a: only the counts are open). Jeff's rule: the Corp AI
 * may know both deck lists, never what is in a hand or the draw order. Spec: netrunner-ai/audit-fixes/spec-honest-reads.md.
 */

const CLEAVER = '30006'; // fracter
const FILLER = '30020'; // Creative Commission
const PALISADE = '30072'; // barrier, end the run
const DOOMSCROLL = '35063'; // tag, 1 net damage, 2 net damage at 2+ tags
const HEDGE_FUND = '30075';
const HOSPITALITY = '34103'; // Corporate Hospitality: spend a click, gain 6, draw 2, a card from Archives to HQ
const SEAMLESS = '30040'; // Seamless Launch: 2 advancement counters
const OFFWORLD = '30067'; // Offworld Office, 4 to advance

const runnerCards = (s: GameState, codes: string[]): CardInstance[] => codes.map(code => createCardInstance(s, code));

describe('breakerReach reads the grip and the stack as one unseen pool (rules 10.2.2a)', () => {
  // One deal of 21 cards with one Cleaver: the cards get their instance ids once, then are split between grip and stack
  const deal = (cleaverInGrip: boolean, seen = false) => {
    const s = structuredClone(newGame());
    s.runner.rig.programs = [];
    s.runner.knownToCorp = [];
    const cards = runnerCards(s, [CLEAVER, ...Array.from({ length: 20 }, () => FILLER)]);
    const [cleaver, ...filler] = cards;
    s.runner.grip = cleaverInGrip ? [cleaver, ...filler.slice(0, 4)] : filler.slice(0, 5);
    s.runner.stack = cleaverInGrip ? filler.slice(4) : [...filler.slice(5, 12), cleaver, ...filler.slice(12)];
    if (seen) revealInHand(s, 'runner', [cleaver]);
    const ice = createCardInstance(s, PALISADE);
    ice.isRezzed = true;
    return { s, ice };
  };

  it('is the same whether the unseen Cleaver is in the grip or the stack', () => {
    const a = deal(true);
    const b = deal(false);
    expect(breakerReach(a.s, a.ice)).toBe(breakerReach(b.s, b.ice));
  });

  it('is the same when the stack is reordered', () => {
    const a = deal(false);
    const b = deal(false);
    b.s.runner.stack.reverse();
    expect(breakerReach(a.s, a.ice)).toBe(breakerReach(b.s, b.ice));
  });

  it('a Cleaver the Corp was shown in the grip costs no draws, and less than an unseen one', () => {
    const shown = deal(true, true);
    const unseen = deal(true);
    const reach = breakerReach(shown.s, shown.ice);
    expect(reach).toBeLessThan(breakerReach(unseen.s, unseen.ice));
    // No draws: its install cost, a click to install and the break
    expect(reach).toBeGreaterThan(3);
    expect(reach).toBeLessThan(8);
  });
});

describe('tankPreps draws up by count, not by the real top of the stack (rules 10.2.2a)', () => {
  // Rezzed Doomscroll inside a rezzed Palisade on HQ; the Runner has a fracter, no killer, and 1 card in the grip
  const board = (swap: boolean, reverse: boolean) => {
    const s = newGame();
    const doom = installIceForTest(s, DOOMSCROLL, 'hq');
    installIceForTest(s, PALISADE, 'hq');
    s.corp.servers.hq.ice.forEach(i => (i.isRezzed = true));
    installProgramForTest(s, CLEAVER);
    s.runner.credits = 12;
    s.runner.knownToCorp = [];
    const pool = [...s.runner.grip, ...s.runner.stack];
    // The same cards, split differently: the first or the last card of the pool in the grip
    s.runner.grip = swap ? pool.slice(-1) : pool.slice(0, 1);
    s.runner.stack = swap ? pool.slice(0, -1) : pool.slice(1);
    if (reverse) s.runner.stack.reverse();
    return { s, ice: s.corp.servers.hq.ice.find(i => i.instanceId === doom)! };
  };

  it('prices Doomscroll the same whichever unseen card is in the grip and whatever the stack order', () => {
    const base = board(false, false);
    const want = protectionCost(base.s, base.ice);
    for (const [swap, reverse] of [[true, false], [false, true], [true, true]]) {
      const b = board(swap, reverse);
      expect(protectionCost(b.s, b.ice)).toBe(want);
    }
  });
});

describe('moneyPick does not count on the cards an econ operation draws (rules 10.2.2a)', () => {
  // Corp turn, 4 clicks, 5 credits, Offworld Office (4 to advance) installed on an earlier turn with no counters, Hedge
  // Fund and Corporate Hospitality in HQ. Hedge Fund leaves 3 clicks (3 counters, no score). Hospitality leaves 2 clicks
  // and draws 2: with two Seamless Launches on top of R&D that is a score, but the Corp can't know what is on top.
  const position = (top: string[]) => {
    const s = structuredClone(newGame(1));
    s.corp.rd.push(...s.corp.hq.splice(0));
    s.corp.rd.unshift(...top.map(code => createCardInstance(s, code)));
    s.corp.clicks = 4;
    s.corp.credits = 5;
    installCorpForTest(s, OFFWORLD, 'remote1');
    giveCard(s, 'corp', HEDGE_FUND);
    giveCard(s, 'corp', HOSPITALITY);
    return s;
  };

  it('picks the same operation whatever the top of R&D is', () => {
    const lucky = position([SEAMLESS, SEAMLESS]);
    const plain = position([FILLER, FILLER]);
    const a = inDecision(lucky, 'corp', () => moneyPick(lucky));
    const b = inDecision(plain, 'corp', () => moneyPick(plain));
    expect(a).not.toBeNull();
    const title = (s: GameState, act: typeof a) => s.corp.hq.find(c => c.instanceId === (act as { cardInstanceId: string }).cardInstanceId)?.cardCode;
    expect(title(lucky, a)).toBe(title(plain, b));
  });
});

describe('muWorth counts only the grip programs the Corp was shown when the Corp decides (rules 10.2.2a)', () => {
  // Five Cleavers (1 MU each) against the base 4 MU: the grip needs more memory than the rig has
  const grip = (programs: boolean, seen = false) => {
    const s = structuredClone(newGame());
    s.runner.knownToCorp = [];
    s.runner.memoryUnitsUsed = 0;
    s.runner.grip = runnerCards(s, Array.from({ length: 5 }, () => (programs ? CLEAVER : FILLER)));
    if (seen) revealInHand(s, 'runner', s.runner.grip);
    return s;
  };

  it('the Corp prices it the same whatever unseen cards are in the grip', () => {
    expect(asSide('corp', () => muWorth(grip(true)))).toBe(asSide('corp', () => muWorth(grip(false))));
  });

  it('programs the Corp was shown still count, and the Runner still reads its own grip', () => {
    const shown = asSide('corp', () => muWorth(grip(true, true)));
    expect(shown).toBeGreaterThan(asSide('corp', () => muWorth(grip(false))));
    expect(asSide('runner', () => muWorth(grip(true)))).toBe(shown);
    expect(asSide('runner', () => muWorth(grip(true)))).toBeGreaterThan(asSide('runner', () => muWorth(grip(false))));
  });
});
