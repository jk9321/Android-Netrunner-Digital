import { describe, expect, it } from 'vitest';
import { ALL_CARDS, getCardScript } from '../src/core';
import { knownSubroutineCost } from '../src/ai/runs';
import { newGame } from './helpers';

describe('AI ice danger', () => {
  it('recognises the wording of every subroutine in the card pool', () => {
    const state = newGame();
    const unknown = ALL_CARDS.flatMap(card =>
      (getCardScript(card.code)?.ice?.subroutines ?? [])
        .filter(sub => knownSubroutineCost(state, sub.label) === undefined)
        .map(sub => `${card.title}: ${sub.label}`),
    );
    expect(unknown).toEqual([]);
  });
});
