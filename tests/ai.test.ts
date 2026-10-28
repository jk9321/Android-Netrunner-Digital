import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/core';
import { DECKS, deckGameSetup } from '../src/data/decks';
import { playAIGame } from '../src/ai';

const corpDecks = DECKS.filter(d => d.side === 'corp');
const runnerDecks = DECKS.filter(d => d.side === 'runner');

describe('heuristic AI', () => {
  // Every Corp deck against a Runner deck, AI on both sides
  corpDecks.forEach((corpDeck, i) => {
    const runnerDeck = runnerDecks[i % runnerDecks.length];
    it(`${corpDeck.name} vs ${runnerDeck.name} plays to a finish`, () => {
      const start = createInitialGameState(deckGameSetup(100 + i, corpDeck, runnerDeck));
      const { state } = playAIGame(start);
      expect(state.winner, `turn ${state.turnNumber}, score ${state.corp.score}-${state.runner.score}`).toBeTruthy();
    }, 90000); // the whole-turn planner plays out every turn
  });
});
