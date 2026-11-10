/**
 * Counted scoring C4 (spec /mnt/project-files/netrunner-ai/redesign/spec-counted-scoring.md): Hard with plan.scoreNow
 * and plan.scoreInTwo both ON. Hard reads both layers through search.ts (scoreNow after winNow in decide, the held
 * two-turn line in chooseAction); these are the Normal pins played by Hard.
 *
 * Rules (Comprehensive Rules v26.03): 1.17.3a "The Corp can only score an agenda that has advancement counters on it
 * greater than or equal to its advancement requirement"; 1.17.3b-c scoring is not an action and costs no click; 1.18.1
 * and 5.2.6f "[click], 1[credit]: Advance 1 installed card"; 1.17.2 a score of 7 or more wins at the next checkpoint;
 * 3.4.3a and 6.9.2b-c ice rezzed as it is approached, unrezzed ice passed (the hold the two-turn count reads).
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { GameAction, GameState, actingSide, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';
import { giveCard, installIceForTest, newGame } from './helpers';

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

const was = { now: tuning.plan.scoreNow, two: tuning.plan.scoreInTwo };
afterEach(() => {
  tuning.plan.scoreNow = was.now;
  tuning.plan.scoreInTwo = was.two;
});
const bothOn = () => {
  tuning.plan.scoreNow = true;
  tuning.plan.scoreInTwo = true;
};

/** Hard plays the Corp until the Runner's turn (or, with `turns` 2, through the Corp's next turn, Normal as the Runner). */
function play(s: GameState, turns = 1): GameState {
  const corp = createAgent('corp', 'hard', { timeMs: 50 });
  const runner = createAgent('runner', 'normal', {});
  let corpTurns = 1;
  for (let i = 0; i < 150 && !s.winner; i++) {
    const side = actingSide(s);
    const before = s.activePlayer;
    s = executeAction(s, (side === 'corp' ? corp : runner).chooseAction(s));
    if (before === 'runner' && s.activePlayer === 'corp') corpTurns++;
    if (before === 'corp' && s.activePlayer === 'runner' && corpTurns === turns) break;
  }
  return s;
}

const PINS = [
  { file: 'counted-scoring/deal-1051.json', turn: 11, agenda: 'inst-7' },
  { file: 'counted-scoring/deal-1711.json', turn: 9, agenda: 'inst-8' },
  { file: 'counted-scoring/deal-2931.json', turn: 14, agenda: 'inst-10' },
  { file: 'human-games/report-39.json', turn: 7, agenda: 'inst-25' },
];

describe('counted scoring C4: Hard with both switches ON', () => {
  for (const pin of PINS) {
    it(`${pin.file} turn ${pin.turn}: Hard scores it this turn`, () => {
      bothOn();
      const after = play(structuredClone(corpTurn(pin.file, pin.turn)));
      expect(after.corp.scoreArea.some(c => c.instanceId === pin.agenda)).toBe(true);
    }, 60000);
  }

  it("report #33 turn 20 (Jeff's game): Hard still takes the win", () => {
    bothOn();
    expect(play(structuredClone(corpTurn('human-games/report-33.json', 20))).winner).toBe('corp');
  }, 60000);

  it('deal 1641 turn 7 shape: Hard plays the two-turn line and scores Send a Message next turn', () => {
    const s = structuredClone(newGame(1));
    s.corp.rd.push(...s.corp.hq.splice(0));
    s.corp.credits = 15;
    s.corp.clicks = 3;
    s.corp.score = 2;
    giveCard(s, 'corp', '30069'); // Send a Message, 5 to advance, 3 points
    giveCard(s, 'corp', '30063'); // Pharos
    installIceForTest(s, '30074', 'remote-1', true); // Whitespace
    installIceForTest(s, '30074', 'remote-1', false);
    s.runner.credits = 1;
    bothOn();
    expect(play(s, 2).corp.score).toBe(5);
  }, 60000);
});
