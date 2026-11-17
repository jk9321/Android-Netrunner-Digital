/**
 * Two wins the win-now search could not reach (Stage D, found-list rows 24 and 26; brief
 * stage-d/small-fixes/win-now-reach.md).
 *
 * Row 24, part A (Jeff's game #56, turn 12): Measured Response (35078) "Play only if the threat level is 4 or greater,
 * and only if the Runner made a successful run during their last turn. Do 4 meat damage unless the Runner pays 8
 * credits." The Runner held 2 cards and 6 credits: playing it flatlines the Runner (rules 1.7.2b, 10.4.4: flatlined
 * by more damage than cards in the grip). winNowAction answered null: its bound counted agenda points only.
 *
 * The kill side reads ownTurnDamage (registry V20), so its facts are tied to the engine here too: Neurospike (30049)
 * "Do X net damage, where X is equal to the sum of the printed agenda points on agendas you scored this turn", and
 * Mindscaping (34045) "Do X net damage. X is equal to the number of tags the Runner has, up to 3".
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_CARDS, GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction } from '../src/core';
import { TurnFlag } from '../src/core/engine/cardEffects';
import { deckGameSetup } from '../src/data/decks';
import { ownTurnDamage } from '../src/ai/effectValues';
import { winNowAction, winNowBound } from '../src/ai/winNow';
import { answer, giveCard, installCorpForTest, newGame, play } from './helpers';
import { inDecision } from './helpers/pricing';

const MEASURED_RESPONSE = '35078';
const TOUCH_UPS = '35067';
const SEND_A_MESSAGE = '30069'; // agenda, 5 to advance, 3 points
const SURE_GAMBLE = '30030'; // event
const PENNYSHAVER = '30014'; // hardware

/** Jeff's game (bug report `n`) replayed to the Corp's first main-phase decision of turn `turn` (as tests/winNow.test.ts). */
function corpTurn(n: number, turn: number): GameState {
  const report = JSON.parse(readFileSync(new URL(`./fixtures/human-games/report-${n}.json`, import.meta.url), 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  for (const m of report.moves as GameAction[]) {
    if (s.turnNumber === turn && s.activePlayer === 'corp' && s.corp.clicks > 0 && actingSide(s) === 'corp' && !s.pendingPrompts.length && m.type !== 'START_TURN') break;
    s = executeAction(s, m);
  }
  return s;
}

const winNow = (s: GameState) => inDecision(s, 'corp', () => winNowAction(s));
/** win-now with its bound switched off (test-only): every line searched. */
const uncut = (s: GameState) => {
  winNowBound.uncut = true;
  try {
    return winNow(s);
  } finally {
    winNowBound.uncut = false;
  }
};
const playedCode = (s: GameState, a: GameAction | null) => {
  const id = (a as { cardInstanceId?: string } | null)?.cardInstanceId;
  return id ? [...s.corp.hq, ...Object.values(s.corp.servers).flatMap(v => v.root)].find(c => c.instanceId === id)?.cardCode : undefined;
};

/**
 * Measured Response's kill, built: threat 4 (the Runner's 4 points), a successful run last turn, the Runner on 2 cards
 * and 6 credits, the Corp with 3 clicks and 8 credits, no agenda anywhere (so the points side of the bound says no).
 */
function mrBoard(): GameState {
  const s = structuredClone(newGame(1));
  s.corp.rd.push(...s.corp.hq.splice(0));
  s.runner.stack.push(...s.runner.grip.splice(0));
  s.corp.clicks = 3;
  s.corp.credits = 8;
  s.runner.score = 4;
  s.runner.credits = 6;
  s.runnerLastTurnRuns = [{ server: 'hq', successful: true }] as GameState['runnerLastTurnRuns'];
  giveCard(s, 'corp', MEASURED_RESPONSE);
  giveCard(s, 'runner', SURE_GAMBLE);
  giveCard(s, 'runner', PENNYSHAVER);
  return s;
}

describe('win-now sees a kill by damage (row 24; rules 1.7.2b, 10.4.4)', () => {
  it("Jeff's game #56, turn 12, three clicks: win-now plays Measured Response, and it wins", () => {
    const s = corpTurn(56, 12);
    expect(s.corp.clicks).toBe(3);
    expect(s.runner.grip.length).toBe(2);
    const pick = winNow(s);
    expect(pick?.type).toBe('PLAY_OPERATION_OR_EVENT');
    expect(playedCode(s, pick)).toBe(MEASURED_RESPONSE);
    const after = executeAction(structuredClone(s), pick!);
    expect(after.winner).toBe('corp');
  });

  it('the built board: win-now plays Measured Response, and it flatlines the Runner', () => {
    const s = mrBoard();
    const pick = winNow(s);
    expect(playedCode(s, pick)).toBe(MEASURED_RESPONSE);
    expect(executeAction(structuredClone(s), pick!).winner).toBe('corp');
  });

  it('mirror: the Runner has exactly 8 credits, so paying is its choice: no win', () => {
    const s = mrBoard();
    s.runner.credits = 8;
    expect(winNow(s)).toBeNull();
  });

  it('mirror: a grip of 4 survives 4 damage (10.4.4: more damage than cards): no win', () => {
    const s = mrBoard();
    giveCard(s, 'runner', SURE_GAMBLE);
    giveCard(s, 'runner', SURE_GAMBLE);
    expect(s.runner.grip.length).toBe(4);
    expect(winNow(s)).toBeNull();
  });

  it('mirror: threat 3: Measured Response cannot be played: no win', () => {
    const s = mrBoard();
    s.runner.score = 3;
    expect(winNow(s)).toBeNull();
  });

  it('mirror: no successful run last turn: no win', () => {
    const s = mrBoard();
    s.runnerLastTurnRuns = [{ server: 'hq', successful: false }] as GameState['runnerLastTurnRuns'];
    expect(winNow(s)).toBeNull();
  });

  it('mirror: the Corp has 4 credits and one click, so it cannot pay 5: no win (with a second click it takes a credit first)', () => {
    const s = mrBoard();
    s.corp.credits = 4;
    s.corp.clicks = 1;
    expect(winNow(s)).toBeNull();
    s.corp.clicks = 2;
    expect(winNow(s)?.type).toBe('GAIN_CREDIT');
  });
});

describe("the kill side's cards", () => {
  it('every Corp card that can deal damage on its own turn (read at its most), as canStillKill counts it once a turn', () => {
    // A board at the turn's most: tags and points scored this turn as high as they go. A new card here needs its uses
    // a turn checked against canStillKill's comment (winNow.ts) before it joins this list.
    const s = structuredClone(newGame(1));
    s.runner.tags = 99;
    s.turnFlags[TurnFlag.agendaPointsScored] = 7;
    const found = ALL_CARDS
      .filter(c => c.side_code === 'corp' && c.type_code !== 'ice' && c.type_code !== 'identity')
      .filter(c => ownTurnDamage(s, c.code) > 0)
      .map(c => `${c.code} ${c.title}: ${ownTurnDamage(s, c.code)}`)
      .sort();
    expect(found).toEqual([
      '30049 Neurospike: 7',
      '30061 Clearinghouse: 1',
      '30068 Orbital Superiority: 4',
      '34031 Salvo Testing: 1',
      '34040 Fujii Asset Retrieval: 2',
      '34045 Mindscaping: 3',
      '34063 Angelique Garza Correa: 1',
      '34105 See How They Run: 1',
      '35051 Phật Gioan Baotixita: 3',
      '35078 Measured Response: 4',
    ]);
  });
});

/**
 * Touch-ups (35067): "Place 2 advancement counters on 1 installed card you can advance. If you do, choose a card type
 * and reveal the grip. Choose up to 2 revealed cards of that type. The Runner shuffles those cards into the stack." The
 * search plays moves in the real engine, so on a line through Touch-ups it would name the type knowing the grip. A kill
 * counts only on a line that took no unseen grip card other than by damage (the AI Coordinator's ruling, 19:02Z).
 */
describe('win-now does not plan a kill through the hidden grip (Touch-ups)', () => {
  /** Measured Response's 4 damage against 5 cards (2 events): a kill only if Touch-ups shuffles the 2 events away first. */
  function touchUpsBoard(): GameState {
    const s = mrBoard();
    s.corp.credits = 20;
    s.runner.credits = 0;
    giveCard(s, 'runner', SURE_GAMBLE);
    giveCard(s, 'runner', PENNYSHAVER);
    giveCard(s, 'runner', PENNYSHAVER);
    installCorpForTest(s, SEND_A_MESSAGE, 'remote-1');
    giveCard(s, 'corp', TOUCH_UPS);
    return s;
  }

  it('with the grip unseen: no win, and none with the bound off either (the line names the type knowing the grip)', () => {
    const s = touchUpsBoard();
    expect(s.runner.grip.length).toBe(5);
    expect(winNow(s)).toBeNull();
    expect(uncut(s)).toBeNull();
  });

  it('with the grip seen (the Corp knows every card) the searched line is Touch-ups; the bound does not count it (row 27)', () => {
    const s = touchUpsBoard();
    s.runner.knownToCorp = s.runner.grip.map(c => ({ id: c.instanceId, code: c.cardCode }));
    expect(playedCode(s, uncut(s))).toBe(TOUCH_UPS);
    // The named limit: the kill side compares damage with the grip as it is, and Touch-ups is no damage
    expect(winNow(s)).toBeNull();
  });

  it('after Touch-ups has been played and the events shuffled away, win-now sees the kill on the smaller grip', () => {
    let s = touchUpsBoard();
    const target = s.corp.servers['remote-1'].root[0].instanceId;
    s = play(s, 'corp', s.corp.hq.find(c => c.cardCode === TOUCH_UPS)!.instanceId);
    s = answer(s, { kind: 'effect_cards', cardInstanceIds: [target] });
    s = answer(s, { kind: 'effect_choice', optionId: 'event' });
    s = answer(s, { kind: 'effect_cards', cardInstanceIds: s.runner.grip.filter(c => cardDef(c).type_code === 'event').map(c => c.instanceId) });
    expect(s.runner.grip.length).toBe(3);
    expect(s.corp.clicks).toBe(1);
    const pick = winNow(s);
    expect(playedCode(s, pick)).toBe(MEASURED_RESPONSE);
    expect(executeAction(structuredClone(s), pick!).winner).toBe('corp');
  });
});
