/**
 * Planner speed: the tag clock's rig-loss cache (evaluate.ts rigLosses, tagRigKey) serves only values its key
 * determines. With the on-hit audit on, every hit is priced again and compared exactly with the value served; a key
 * missing something runnerRigValue reads shows as a mismatch.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from '../scripts/nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { clearThreatCaches } from '../src/ai/threatModel';
import { clearTagRigCache, tagRigAudit } from '../src/ai/evaluate';

afterEach(() => {
  tagRigAudit.on = false;
});

function audit(seed: number, actions: number) {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  valueLoops.clear();
  clearThreatCaches();
  clearTagRigCache();
  Object.assign(tagRigAudit, { on: true, checked: 0, mismatches: 0, examples: [] });
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  for (let i = 0; i < actions && game.step(); i++);
  tagRigAudit.on = false;
  return { checked: tagRigAudit.checked, mismatches: tagRigAudit.mismatches, examples: tagRigAudit.examples };
}

describe('tag rig cache: every hit is the value its board prices to (on-hit audit)', () => {
  for (const [seed, actions] of [
    [1001, 400],
    [1441, 400],
  ] as const) {
    it(`deal ${seed}, first ${actions} actions`, () => {
      const r = audit(seed, actions);
      expect(r.checked).toBeGreaterThan(50);
      expect(r.mismatches, JSON.stringify(r.examples)).toBe(0);
    }, 300_000);
  }
});
