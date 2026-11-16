import { describe, expect, it } from 'vitest';
import { GameState, createCardInstance } from '../src/core';
import { revealInHand } from '../src/core/engine/helpers';
import { moneyPick } from '../src/ai/incomeLine';
import { muWorth } from '../src/ai/effectValues';
import { asSide } from '../src/ai/pricing';
import { giveCard, installCorpForTest, newGame } from './helpers';
import { inDecision } from './helpers/pricing';

/**
 * Hidden information (comprehensive rules 10.2.2a: "cards in HQ or R&D, cards in the Runner's grip or stack" are hidden;
 * 10.2.2b: a player can't learn them without a game effect; 10.2.3a: only the counts are open). Jeff's rule: the Corp AI
 * may know both deck lists, never what is in a hand or the draw order. Spec: netrunner-ai/audit-fixes/spec-honest-reads.md.
 */

const CLEAVER = '30006'; // fracter
const FILLER = '30020'; // Creative Commission
const HEDGE_FUND = '30075';
const HOSPITALITY = '34103'; // Corporate Hospitality: spend a click, gain 6, draw 2, a card from Archives to HQ
const SEAMLESS = '30040'; // Seamless Launch: 2 advancement counters
const OFFWORLD = '30067'; // Offworld Office, 4 to advance

const runnerCards = (s: GameState, codes: string[]) => codes.map(code => createCardInstance(s, code));

// The breakerReach and tankPreps describes went with the ranking's hold count (Step 4 Stage C7); the hold owner that
// replaced them reads no grip and no R&D order (tests/corpOwners.test.ts, serverHold, 10.2.2a)

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
