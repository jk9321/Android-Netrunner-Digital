import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS as DECKS } from '../scripts/nsg-sample-decks';
import { playAIGame } from '../src/ai';

const corpDecks = DECKS.filter(d => d.side === 'corp');
const runnerDecks = DECKS.filter(d => d.side === 'runner');

describe('heuristic AI', () => {
  // Every Corp deck against a Runner deck, AI on both sides
  corpDecks.forEach((corpDeck, i) => {
    const runnerDeck = runnerDecks[i % runnerDecks.length];
    it(`${corpDeck.name} vs ${runnerDeck.name} plays to a finish`, async () => {
      // Let the worker answer vitest between games: they run for minutes in all, and its calls time out after 60 s
      await new Promise(resolve => setTimeout(resolve, 0));
      const start = createInitialGameState(deckGameSetup(100 + i, corpDeck, runnerDeck));
      const { state } = playAIGame(start);
      expect(state.winner, `turn ${state.turnNumber}, score ${state.corp.score}-${state.runner.score}`).toBeTruthy();
    }, 420000); // the whole-turn planner plays out every turn (2026-11-05: Agency vs Prick Thyself took 87 s on beta alone, about 3.5 s a turn;
    // 2026-11-11 step 3: Discretion Advised vs Party Hard now runs a longer game with four remotes, 307 s alone, 153 s of it
    // the Corp's turn 17; the counted rez code itself took 0.05 s of it)
  });
});
