/**
 * F117 / R-96 (brief netrunner-ai/f117-deck-arrivals/design-brief.md rev 2, "The view.ts helper"): the face rule for a
 * prompt's cards has one copy (core/view.ts promptCardFaces), which viewFor calls and the Runner AI's promptShownIds calls
 * without building the view (viewShownBeforePrompts for its inputs). Bar: on played games, every prompt's shown set by
 * the helper equals the one viewFor's own view gives (what promptShownIds read before), for both sides.
 */
import { describe, expect, it } from 'vitest';
import { GameState, activePrompt, createInitialGameState, newViewIds, viewFor } from '../src/core';
import { promptCardFaces, viewShownBeforePrompts } from '../src/core/view';
import { deckGameSetup } from '../src/data/decks';
import { NRDB_TEST_DECKS } from '../scripts/nrdb-test-decks';
import { ALL_DECKS } from '../scripts/nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { promptShownIds } from '../src/ai/runner/prompt';

/** The face-up ids of `side`'s first pending prompt, as viewFor's view shows them (promptShownIds' old reading). */
function byView(state: GameState, side: 'corp' | 'runner'): string[] {
  const p = state.pendingPrompts.find(x => x.side === side);
  if (!p) return [];
  const { view, ids } = viewFor(state, side, newViewIds(), state.id);
  const mine = view.pendingPrompts.find(x => x.id === p.id);
  return (mine?.cards ?? []).filter(c => c.cardCode !== undefined && ids.real[c.instanceId]).map(c => ids.real[c.instanceId]).sort();
}
/** The same by the helper (the side's first prompt: no earlier prompt of the view has shown a card before it). */
function byHelper(state: GameState, side: 'corp' | 'runner'): string[] {
  const p = state.pendingPrompts.find(x => x.side === side);
  if (!p) return [];
  const { faced, onTable } = viewShownBeforePrompts(state, side);
  return promptCardFaces(p, id => faced.has(id), id => onTable.has(id))
    .filter(([, face]) => face)
    .map(([id]) => id)
    .sort();
}

function deal(seed: number, corp: string, runner: string): GameState {
  const pool = [...ALL_DECKS, ...NRDB_TEST_DECKS];
  const c = pool.find(d => d.side === 'corp' && d.name === corp)!;
  const r = pool.find(d => d.side === 'runner' && d.name === runner)!;
  return createInitialGameState(deckGameSetup(seed, c, r));
}

describe('F117: the prompt face rule, one copy', () => {
  it('the helper shows what viewFor shows, at every prompt of played games', () => {
    const corps = [...ALL_DECKS, ...NRDB_TEST_DECKS].filter(d => d.side === 'corp');
    const runners = [...ALL_DECKS, ...NRDB_TEST_DECKS].filter(d => d.side === 'runner');
    let prompts = 0;
    let shown = 0;
    for (let k = 0; k < 3; k++) {
      const g = new GameRunner(deal(3001 + k, corps[(5 * k) % corps.length].name, runners[(7 * k + 3) % runners.length].name), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
      for (let i = 0; i < 90 && g.step(); i++) {
        const s = g.state;
        if (!s.pendingPrompts.length) continue;
        for (const side of ['corp', 'runner'] as const) {
          const want = byView(s, side);
          expect(byHelper(s, side)).toEqual(want);
          shown += want.length;
        }
        if (activePrompt(s)?.side === 'runner') expect([...promptShownIds(structuredClone(s))].sort()).toEqual(byView(s, 'runner'));
        prompts++;
      }
    }
    process.stderr.write(`f117View: ${prompts} prompts, ${shown} shown\n`);
    expect(prompts).toBeGreaterThan(20);
    expect(shown).toBeGreaterThan(0);
  }, 120_000);
});
