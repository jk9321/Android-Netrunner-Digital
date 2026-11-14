/**
 * Planner speed P2 (spec /mnt/project-files/netrunner-ai/redesign/spec-planner-speed.md): the threat cache serves only
 * values its key determines. With the on-hit audit on (threatModel.ts threatAudit), every cache hit is budgeted again and
 * compared with the value served; a key missing something budgetTurn reads (R&D's contents, Archives, counters on
 * installed cards) shows as a mismatch. Before the fix, deal 1421 served 179 wrong values in 5,397 hits, and deal 1001
 * 74 in 835 (counters); the audit reads 0 on 10 deals with the key as it is. With the counters (or R&D's contents) left
 * out of the key, this test fails with 4 mismatches by turn 14 of deal 1001. About 45 s.
 *
 * Float sums taken in another order (an R&D re-dealt in a playout) differ in the last bits and are counted apart
 * ('near'); a server's success is compared only where the Runner runs it (nothing else reads it).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from '../scripts/nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { clearThreatCaches, threatAudit } from '../src/ai/threatModel';

afterEach(() => {
  threatAudit.on = false;
});

/** The first `actions` actions of a batch deal (seed 1001 + 10 * pairing), Normal v Normal, with the audit on. */
function audit(seed: number, actions: number) {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  valueLoops.clear();
  clearThreatCaches();
  Object.assign(threatAudit, { on: true, checked: 0, mismatches: 0, near: 0, examples: [] });
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  for (let i = 0; i < actions && game.step(); i++);
  threatAudit.on = false;
  return { checked: threatAudit.checked, mismatches: threatAudit.mismatches, examples: threatAudit.examples };
}

describe('threat cache: every hit is the value its board budgets to (on-hit audit)', () => {
  for (const [seed, actions] of [
    [1001, 400],
    // Planner speed tier 2 (rootDeckAverage): a budget served across decisions whose roots priced the Corp's deck
    // differently (147 mismatches with deckRootKey left out of the key), and one priced while a deck card was being
    // priced on the root (1 mismatch until those asks were priced per board)
    [1421, 400],
  ] as const) {
    it(`deal ${seed}, first ${actions} actions`, () => {
      const r = audit(seed, actions);
      expect(r.checked).toBeGreaterThan(50);
      expect(r.mismatches, JSON.stringify(r.examples)).toBe(0);
    }, 300_000);
  }
});
