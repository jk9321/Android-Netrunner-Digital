/**
 * The win-now bound reads Flood the Market (36053) by what the board makes it place (found-list row 16; Gemini audit
 * 2026-11-17, triage row 1). "As an additional cost to play this operation, spend click. Choose 1 installed card you can
 * advance. Place 1 advancement counter on that card for each remote server that has a card in its root and is protected
 * by ice." The text parse read it as one counter, so with three such remotes canStillWin cut a line that exists.
 * Rules: 1.17.3a (an agenda is scored at its advancement requirement, so a bound below the counters placed cuts real
 * lines); 5.2.6f (the basic action: advance 1 installed card for a click and a credit).
 */
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { placesCountersOf } from '../src/ai/cards';
import { scoreNowAction } from '../src/ai/winNow';
import { giveCard, installCorpForTest, installIceForTest, newGame } from './helpers';
import { inDecision } from './helpers/pricing';

const FLOOD = '36053';
const HYPE = '36055'; // a card in a root that is not an agenda
const ICE = '30071'; // any ice
const SEND_A_MESSAGE = '30069'; // 5 to advance, 3 points

/** Send a Message (no counters) in remote-1 and three more remotes with a card in the root, all iced; Flood the Market (a Double: 2 clicks) in HQ, 3 clicks. */
function board(): GameState {
  const s = structuredClone(newGame(1));
  s.corp.rd.push(...s.corp.hq.splice(0));
  s.corp.clicks = 3;
  s.corp.credits = 12;
  installCorpForTest(s, SEND_A_MESSAGE, 'remote-1');
  installCorpForTest(s, HYPE, 'remote-2');
  installCorpForTest(s, HYPE, 'remote-3');
  installCorpForTest(s, HYPE, 'remote-4');
  for (const id of ['remote-1', 'remote-2', 'remote-3', 'remote-4']) installIceForTest(s, ICE, id);
  giveCard(s, 'corp', FLOOD);
  return s;
}

describe('Flood the Market: what one use places is a fact of the board (win-now bound)', () => {
  it('four iced remotes with a card in the root: Flood (2 clicks) places 4, one advance makes 5, and the line is found', () => {
    const s = board();
    // Flood places 4 for its 2 clicks, then one advance: 5 = the requirement. Without Flood 3 clicks place 3, short by 2.
    // (Before the fix the bound read Flood as placing 1: it added 0 to the 3 clicks and cut the line.)
    // The line's first action may be the advance (the order of the two does not matter), so the test is that one is found
    expect(inDecision(s, 'corp', () => scoreNowAction(s))).not.toBeNull();
  });

  it('the mirror: two remotes without ice place 2, so the bound (3 clicks + 1 = 4 of 5) says no and no line is found', () => {
    const s = board();
    s.corp.servers['remote-3'].ice = [];
    s.corp.servers['remote-4'].ice = [];
    expect(inDecision(s, 'corp', () => scoreNowAction(s))).toBeNull();
  });

  it('the fact counts remotes with a card in the root and ice only', () => {
    const fact = placesCountersOf(FLOOD)!;
    const s = structuredClone(newGame(1));
    expect(fact(s)).toBe(0);
    installIceForTest(s, ICE, 'remote-1'); // ice, empty root
    expect(fact(s)).toBe(0);
    installCorpForTest(s, HYPE, 'remote-2'); // a card in the root, no ice
    expect(fact(s)).toBe(0);
    installCorpForTest(s, '30060', 'remote-1');
    expect(fact(s)).toBe(1);
    installIceForTest(s, ICE, 'hq'); // a central server, even with a root card and ice, is not a remote
    installCorpForTest(s, '30043', 'hq');
    expect(fact(s)).toBe(1);
    installIceForTest(s, ICE, 'remote-2');
    expect(fact(s)).toBe(2);
  });
});
