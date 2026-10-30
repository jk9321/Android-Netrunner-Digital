import { describe, expect, it } from 'vitest';
import { executeAction, getLegalActions, isLegalAction } from '../src/core';
import { cont, installIceForTest, newGame, run, setIdentity } from './helpers';

describe('Game over', () => {
  // Rules 1.7.1 and 10.3.1c: the game ends as soon as a player wins
  it('drops decisions still waiting and ends the run once a player wins', () => {
    let s = newGame();
    setIdentity(s, 'runner', '35001'); // Ryō "Phoenix" Ōno
    installIceForTest(s, '30073', 'hq'); // Tithe: its subroutines resolve
    s.runner.grip.push(...s.runner.stack.splice(0, 5));
    s = cont(cont(cont(run(s, 'hq'))));
    const ryo = s.pendingPrompts[0];
    expect(ryo?.side).toBe('corp'); // the Corp owes Ryō an HQ trash
    s = executeAction(s, { type: 'CONCEDE', player: 'corp' });
    expect(s.winner).toBe('runner');
    expect(s.pendingPrompts).toEqual([]);
    expect(s.activeRun).toBeNull();
    expect(getLegalActions(s, 'corp')).toEqual([]);
    expect(isLegalAction(s, { type: 'RESOLVE_PROMPT', player: 'corp', promptId: ryo.id, choice: { kind: 'effect_cards', cardInstanceIds: [] } })).toBe(false);
  });
});
