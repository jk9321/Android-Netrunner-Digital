import { describe, it, expect } from 'vitest';
import { createRng, nextFloat, shuffleInPlace, executeAction, GameAction, GameState } from '../src/core';
import { newGame, answer } from './helpers';

const deckOrder = (s: GameState) => ({
  hq: s.corp.hq.map(c => c.cardCode),
  rd: s.corp.rd.map(c => c.cardCode),
  grip: s.runner.grip.map(c => c.cardCode),
  stack: s.runner.stack.map(c => c.cardCode),
});

describe('Seeded RNG', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => nextFloat(a));
    const seqB = Array.from({ length: 20 }, () => nextFloat(b));
    expect(seqA).toEqual(seqB);
    seqA.forEach(x => {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    });
  });

  it('shuffles to a permutation of the input', () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const shuffled = shuffleInPlace(createRng(7), [...input]);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(input);
    expect(shuffled).not.toEqual(input);
  });
});

describe('Deterministic games', () => {
  it('deals identically for the same seed and differently for another', () => {
    expect(deckOrder(newGame(123))).toEqual(deckOrder(newGame(123)));
    expect(deckOrder(newGame(123))).not.toEqual(deckOrder(newGame(456)));
  });

  it('replays a sequence of actions to an identical state', () => {
    const actions: GameAction[] = [
      { type: 'GAIN_CREDIT', player: 'corp' },
      { type: 'GAIN_CREDIT', player: 'corp' },
      { type: 'GAIN_CREDIT', player: 'corp' },
      { type: 'END_TURN', player: 'corp' },

      { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'archives' },
      { type: 'CONTINUE_RUN', player: 'runner' }, // no ice: decline to jack out
      { type: 'CONTINUE_RUN', player: 'runner' },
      { type: 'GAIN_CREDIT', player: 'runner' },
      { type: 'GAIN_CREDIT', player: 'runner' },
      { type: 'GAIN_CREDIT', player: 'runner' },
      { type: 'END_TURN', player: 'runner' },
    ];
    // Answer any discard prompt with the first card(s) in hand.
    const step = (state: GameState, action: GameAction) => {
      const next = executeAction(state, action);
      const p = next.pendingPrompts[0];
      if (p?.kind !== 'discard') return next;
      const hand = p.side === 'corp' ? next.corp.hq : next.runner.grip;
      return answer(next, { kind: 'discard', cardInstanceIds: hand.slice(0, p.count).map(c => c.instanceId) });
    };
    const play = () => actions.reduce(step, newGame(99));
    const final = play();
    expect(final).toEqual(play());
    expect(final.turnNumber).toBe(2);
  });

  it('keeps state plain JSON (serializable for saves, replays and multiplayer)', () => {
    const state = newGame(5);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(state.corp.hq[0]).not.toHaveProperty('def');
  });

  it('does not mutate the input state', () => {
    const state = newGame(8);
    const snapshot = structuredClone(state);
    executeAction(state, { type: 'GAIN_CREDIT', player: 'corp' });
    expect(state).toEqual(snapshot);
  });
});
