import { describe, expect, it } from 'vitest';
import { executeAction, GameState, getLegalActions, isLegalAction } from '../src/core';
import { HeuristicCorpAI } from '../src/ai';
import { installCorpForTest, newGame, passTurn } from './helpers';

const NICO = '30037';

/** Corp turn 1 and the Runner's turn pass; the Corp's turn 2 starts. */
function toCorpTurn2(state: GameState): GameState {
  return passTurn(passTurn(state));
}

// Rules 5.6.1: the Corp gains clicks, then a paid ability window (rez non-ice,
// score, paid abilities), then recurring credits, "turn begins", the mandatory draw.
describe('Before the Corp turn begins', () => {
  it('lets the Corp rez an asset before the mandatory draw, so "when your turn begins" fires', () => {
    let s = newGame();
    s.corp.credits = 10;
    const nico = installCorpForTest(s, NICO, 'remote-1');
    s = toCorpTurn2(s);
    const hq = s.corp.hq.length;
    expect(s.turnStep?.kind).toBe('corp_turn_start');
    expect(s.corp.clicks).toBe(3);
    // Not drawn yet, and no click actions until the turn begins
    expect(isLegalAction(s, { type: 'GAIN_CREDIT', player: 'corp' })).toBe(false);
    expect(isLegalAction(s, { type: 'END_TURN', player: 'corp' })).toBe(false);
    expect(getLegalActions(s, 'corp')).toContainEqual({ type: 'START_TURN', player: 'corp' });

    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: nico });
    const credits = s.corp.credits;
    s = executeAction(s, { type: 'START_TURN', player: 'corp' });
    expect(s.turnStep ?? null).toBeNull();
    expect(s.corp.hq.length).toBe(hq + 1);
    expect(s.corp.credits).toBe(credits + 3); // Nico paid out this turn
    expect(isLegalAction(s, { type: 'GAIN_CREDIT', player: 'corp' })).toBe(true);
  });

  it('starts the turn straight away when the Corp has nothing to rez or score', () => {
    let s = passTurn(newGame()); // Corp turn 1 ends with nothing installed
    const hq = s.corp.hq.length;
    s = passTurn(s);
    expect(s.activePlayer).toBe('corp');
    expect(s.turnStep ?? null).toBeNull();
    expect(s.corp.hq.length).toBe(hq + 1);
  });

  it('only the Corp can start their turn, and only in the window', () => {
    let s = newGame();
    installCorpForTest(s, NICO, 'remote-1');
    expect(isLegalAction(s, { type: 'START_TURN', player: 'corp' })).toBe(false);
    s = toCorpTurn2(s);
    expect(isLegalAction(s, { type: 'START_TURN', player: 'runner' })).toBe(false);
  });

  it('the AI rezzes an economy asset before starting its turn', () => {
    let s = newGame();
    s.corp.credits = 10;
    const nico = installCorpForTest(s, NICO, 'remote-1');
    s = toCorpTurn2(s);
    const ai = new HeuristicCorpAI();
    expect(ai.chooseAction(s)).toEqual({ type: 'REZ_CARD', player: 'corp', cardInstanceId: nico });
    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: nico });
    expect(ai.chooseAction(s)).toEqual({ type: 'START_TURN', player: 'corp' });
  });
});
