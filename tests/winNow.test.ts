/**
 * Bug report #33 (Jeff's Runner test game 1, 2026-11-09, played against Hard): at 6-6 on turn 20 the Corp held Above the
 * Law (3 to advance, 2 points) and Slash and Burn Agriculture in HQ with 18 credits and 3 clicks.
 *   Slash and Burn Agriculture: "[click], 1[credit], reveal and trash this agenda from HQ: Place 2 advancement counters
 *   on 1 installed card that you can advance."
 * Install Above the Law, advance it, Slash and Burn onto it, score: 8 points.
 *   1.17.3a-c: the Corp can score an agenda whose advancement counters are at least its advancement requirement;
 *   scoring is not an action and costs no click.
 *   1.17.2: "If at any time a player's score is greater than or equal to 7, they win the game at the next checkpoint."
 * Normal installed Slash and Burn and advanced it once; Hard iced HQ. plan.winNow (winNow.ts) searches the turn exactly
 * for a winning line first.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, actingSide, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';
import { winNowAction } from '../src/ai/winNow';
import { inDecision } from './helpers/pricing';

/** Jeff's game (bug report `n`) replayed to the Corp's first main-phase decision of turn `turn`. */
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

/** The Corp AI plays out the rest of its turn. */
function playTurn(s: GameState, level: 'normal' | 'hard'): GameState {
  const corp = createAgent('corp', level, { timeMs: 50 });
  for (let i = 0; i < 30 && s.activePlayer === 'corp' && !s.winner && actingSide(s) === 'corp'; i++) s = executeAction(s, corp.chooseAction(s));
  return s;
}

const withSwitch = <T>(on: boolean, work: () => T): T => {
  const was = tuning.plan.winNow;
  tuning.plan.winNow = on;
  try {
    return work();
  } finally {
    tuning.plan.winNow = was;
  }
};

describe('the Corp takes a win this turn (plan.winNow, rules 1.17.2, 1.17.3)', () => {
  it('report #33 turn 20: Normal installs Above the Law, Slash and Burns it and scores the game', () => {
    const s = corpTurn(33, 20);
    expect(s.corp.score).toBe(6);
    const after = playTurn(structuredClone(s), 'normal');
    expect(after.winner).toBe('corp');
    expect(after.corp.score).toBe(8);
  });

  it('report #33 turn 20: so does Hard', () => {
    const after = playTurn(structuredClone(corpTurn(33, 20)), 'hard');
    expect(after.winner).toBe('corp');
  });

  it('report #33 turn 19 (no win this turn): no line is found, so the pick is left to its judgement', () => {
    const s = corpTurn(33, 19);
    expect(inDecision(s, 'corp', () => winNowAction(s))).toBeNull();
  });

  it('switched off, no line is offered (Normal then installed Slash and Burn and advanced it once, the replay shows)', () => {
    const s = corpTurn(33, 20);
    expect(inDecision(s, 'corp', () => winNowAction(s))).toMatchObject({
      type: 'INSTALL_CARD',
      asNewRemote: true,
    });
    expect(withSwitch(false, () => inDecision(s, 'corp', () => winNowAction(s)))).toBeNull();
  });
});
