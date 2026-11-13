import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS as DECKS } from '../scripts/nsg-sample-decks';
import { playAIGame } from '../src/ai';

/**
 * Every Corp deck plays a full AI vs AI game to a winner. The games are split over
 * PARTS test files (tests/aiGames.partN.test.ts) so vitest runs them in parallel:
 * in one file they took 7.3 of beta CI's 10 minutes (2026-11-13). The deal for each
 * game (seed 100 + its index, Runner deck by index) is the same as before the split.
 */
export const PARTS = 4;

// Game index -> part, balanced by beta CI times on 2026-11-13 (CI run 43479302173). Games added
// later (new decks) fall back to index % PARTS; rebalance when one part gets much slower.
const PART_OF: Record<number, number> = {
  16: 0, 2: 0, 12: 0, 0: 0, 10: 0, 13: 0, // ~106 s
  4: 1, 14: 1, 5: 1, // ~110 s
  7: 2, 11: 2, 3: 2, 8: 2, // ~111 s
  9: 3, 1: 3, 15: 3, 6: 3, // ~110 s
};

const corpDecks = DECKS.filter(d => d.side === 'corp');
const runnerDecks = DECKS.filter(d => d.side === 'runner');

export function aiGames(part: number): void {
  describe(`heuristic AI (part ${part + 1} of ${PARTS})`, () => {
    corpDecks.forEach((corpDeck, i) => {
      if ((PART_OF[i] ?? i % PARTS) !== part) return;
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
}
