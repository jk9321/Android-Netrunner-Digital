/**
 * Counted scoring C1, plan.scoreNow (spec /mnt/project-files/netrunner-ai/redesign/spec-counted-scoring.md): the Corp
 * plays a line that scores an agenda this turn when its exact search (winNow.ts scoreNowAction) finds one, before any
 * judgement. Stage 0b measured the forced version at +2.9 ± 1.7; these are the true misses it named.
 *
 * Rules (Comprehensive Rules v26.03):
 *  - 1.17.3a "The Corp can only score an agenda that has advancement counters on it greater than or equal to its
 *    advancement requirement." 1.17.3b-c: the Corp may score it when it has priority in its own turn; scoring is not
 *    an action and costs no click.
 *  - 1.18.1 advancement counters are placed by advancing; 5.2.6f the basic action "[click], 1[credit]: Advance 1
 *    installed card".
 *  - Dividends N (Project Ingatan): "When you score this agenda, place N agenda counters on it for each excess
 *    advancement counter", so over-advancing one at its requirement is a choice the search leaves to the Corp.
 *  - 1.17.2 "If at any time a player's score is greater than or equal to 7, they win the game at the next checkpoint"
 *    (winNow's case, searched first).
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { GameAction, GameState, actingSide, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';
import { scoreNowAction } from '../src/ai/winNow';
import { giveCard, installCorpForTest, newGame } from './helpers';
import { inDecision } from './helpers/pricing';

/** A recorded game (a human report, or a self-play deal in the same shape) replayed to the Corp's first main-phase decision of turn `turn`. */
function corpTurn(file: string, turn: number): GameState {
  const report = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  for (const m of report.moves as GameAction[]) {
    if (s.turnNumber === turn && s.activePlayer === 'corp' && s.corp.clicks > 0 && actingSide(s) === 'corp' && !s.pendingPrompts.length && m.type !== 'START_TURN') break;
    s = executeAction(s, m);
  }
  return s;
}

/** The Normal Corp plays out the rest of its turn. */
function playTurn(s: GameState): GameState {
  const corp = createAgent('corp', 'normal', {});
  for (let i = 0; i < 30 && s.activePlayer === 'corp' && !s.winner && actingSide(s) === 'corp'; i++) s = executeAction(s, corp.chooseAction(s));
  return s;
}

const was = tuning.plan.scoreNow;
afterEach(() => {
  tuning.plan.scoreNow = was;
});

const PINS: { name: string; file: string; turn: number; agenda: string; points: number }[] = [
  // Send a Message +2 of 5 behind ice, 13 credits: the Corp installed Palisade on another remote and advanced twice, one short
  { name: 'deal 1051 turn 11 (Send a Message one advance short after a Palisade install)', file: 'counted-scoring/deal-1051.json', turn: 11, agenda: 'inst-7', points: 3 },
  // Project Ingatan +0 of 3, 3 credits: the Corp installed and rezzed Spin Doctor, took a credit, installed a second
  { name: 'deal 1711 turn 9 (two Spin Doctors instead of Project Ingatan)', file: 'counted-scoring/deal-1711.json', turn: 9, agenda: 'inst-8', points: 2 },
  // Send a Message +4 of 5, 16 credits: the Corp purged (all three clicks) with a one-advance score open
  { name: 'deal 2931 turn 14 (a purge with a one-advance score open)', file: 'counted-scoring/deal-2931.json', turn: 14, agenda: 'inst-10', points: 3 },
  // Jeff's game: Fujii Asset Retrieval +2 of 5 with 3 credits and 3 clicks; the Corp installed Phật Gioan Baotixita instead
  { name: "report 39 turn 7 (Jeff's game: Fujii Asset Retrieval, three advances and score)", file: 'human-games/report-39.json', turn: 7, agenda: 'inst-25', points: 3 },
];

describe('plan.scoreNow: the Corp scores what it can score this turn (1.17.3a-c, 5.2.6f)', () => {
  for (const pin of PINS) {
    it(`${pin.name}: scored with the switch on, not with it off`, () => {
      const s = corpTurn(pin.file, pin.turn);
      tuning.plan.scoreNow = false;
      const off = playTurn(structuredClone(s));
      expect(off.corp.scoreArea.some(c => c.instanceId === pin.agenda)).toBe(false);
      tuning.plan.scoreNow = true;
      const on = playTurn(structuredClone(s));
      expect(on.corp.scoreArea.some(c => c.instanceId === pin.agenda)).toBe(true);
      expect(on.corp.score).toBe(s.corp.score + pin.points);
    }, 60000);
  }

  it('two agendas a click from scoring and one click: the line scores the one worth more points', () => {
    tuning.plan.scoreNow = true;
    const s = structuredClone(newGame(1));
    s.corp.rd.push(...s.corp.hq.splice(0));
    s.corp.clicks = 1;
    s.corp.credits = 1;
    const above = installCorpForTest(s, '30060', 'remote-1'); // Above the Law, 3 to advance, 2 points
    const message = installCorpForTest(s, '30069', 'remote-2'); // Send a Message, 5 to advance, 3 points
    s.corp.servers['remote-1'].root[0].advancementCounters = 2;
    s.corp.servers['remote-2'].root[0].advancementCounters = 4;
    const a = inDecision(s, 'corp', () => scoreNowAction(s));
    expect(a).toMatchObject({ type: 'ADVANCE_CARD', cardInstanceId: message });
    expect(above).not.toBe(message);
  });

  it('an agenda that can be scored now is scored first, not after a Hedge Fund the turn still affords (1.17.3c)', () => {
    tuning.plan.scoreNow = true;
    const s = structuredClone(newGame(1));
    s.corp.rd.push(...s.corp.hq.splice(0));
    s.corp.clicks = 2;
    s.corp.credits = 5;
    giveCard(s, 'corp', '30075'); // Hedge Fund
    const above = installCorpForTest(s, '30060', 'remote-1'); // Above the Law, 3 to advance
    s.corp.servers['remote-1'].root[0].advancementCounters = 3;
    expect(inDecision(s, 'corp', () => scoreNowAction(s))).toMatchObject({ type: 'SCORE_AGENDA', cardInstanceId: above });
  });

  it('a Dividends agenda at its requirement is left to the Corp, which may over-advance it', () => {
    tuning.plan.scoreNow = true;
    const s = structuredClone(newGame(1));
    s.corp.rd.push(...s.corp.hq.splice(0));
    s.corp.clicks = 3;
    s.corp.credits = 5;
    installCorpForTest(s, '35038', 'remote-1'); // Project Ingatan, 3 to advance, Dividends 1
    s.corp.servers['remote-1'].root[0].advancementCounters = 3;
    expect(inDecision(s, 'corp', () => scoreNowAction(s))).toBeNull();
  });

  it('nothing scorable: no line (the clicks and credits cannot reach the requirement)', () => {
    tuning.plan.scoreNow = true;
    const s = structuredClone(newGame(1));
    s.corp.rd.push(...s.corp.hq.splice(0));
    s.corp.clicks = 3;
    s.corp.credits = 5;
    installCorpForTest(s, '30069', 'remote-1'); // Send a Message, 0 of 5
    expect(inDecision(s, 'corp', () => scoreNowAction(s))).toBeNull();
  });

  it('off by default until its paired batch: no line', () => {
    tuning.plan.scoreNow = false;
    const s = structuredClone(newGame(1));
    s.corp.clicks = 1;
    s.corp.credits = 1;
    installCorpForTest(s, '30060', 'remote-1');
    s.corp.servers['remote-1'].root[0].advancementCounters = 2;
    expect(scoreNowAction(s)).toBeNull();
  });
});
