import { describe, expect, it } from 'vitest';
import { cardDef, executeAction, GameState } from '../src/core';
import { newGame, startRunnerTurn } from './helpers';

function runOn(state: GameState, serverId: string): GameState {
  startRunnerTurn(state);
  let s = executeAction(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: serverId });
  while (s.activeRun && s.pendingPrompts.length === 0) s = executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' });
  return s;
}

/** Moves the first card of a type to the top of R&D or into an otherwise empty HQ. */
function place(state: GameState, type: string, zone: 'rd' | 'hq'): string {
  const idx = state.corp.rd.findIndex(c => cardDef(c).type_code === type);
  const [card] = state.corp.rd.splice(idx, 1);
  if (zone === 'rd') state.corp.rd.unshift(card);
  else state.corp.hq = [card];
  return card.cardCode;
}

// Rules 7.1.2: "While the Runner is accessing a card, the Corp is allowed to look
// at it as well, except when the card is being accessed from R&D."
describe('R&D accesses are secret from the Corp', () => {
  it('logs an R&D access without the card for the Corp', () => {
    const state = newGame();
    const code = place(state, 'ice', 'rd');
    const after = runOn(state, 'rd');
    const entry = after.log.find(e => e.event === 'access')!;
    expect(entry.cardCode).toBe(code);
    expect(entry.message).toContain(cardDef({ cardCode: code } as never).title);
    expect(entry.secret).toEqual({ from: 'corp', publicMessage: 'Runner accessed a card in R&D.' });
  });

  it('keeps HQ accesses visible to the Corp', () => {
    const state = newGame();
    place(state, 'ice', 'hq');
    const after = runOn(state, 'hq');
    const entry = after.log.find(e => e.event === 'access')!;
    expect(entry.secret).toBeUndefined();
  });
});
