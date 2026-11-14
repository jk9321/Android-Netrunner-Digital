import { describe, expect, it } from 'vitest';
import { GameState, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from '../scripts/nsg-sample-decks';
import { GameRunner, createAgent } from '../src/ai';
import { SearchRow } from '../src/ai/turnPlanner';
import { withDiagnostics } from '../src/ai/diagnostics';

/**
 * Spec-search S1 (measurement only): the diagnostics sink's onSearch plays every candidate of a Corp planner decision on the
 * rule, hold and finish-first lines after the pick, and must not change the pick. Position: batch deal 1491's Corp turn 1
 * (tests/searchSamples.test.ts), an agenda in HQ and no remote yet (rule 8.5.6: an agenda goes into a remote root).
 */
const SEED = 1491;

function position(): GameState {
  const corp = ALL_DECKS.filter(d => d.side === 'corp');
  const runner = ALL_DECKS.filter(d => d.side === 'runner');
  const pairing = (SEED - 1001) / 10;
  const gr = new GameRunner(createInitialGameState(deckGameSetup(SEED, corp[Math.floor(pairing / runner.length)], runner[pairing % runner.length])), { corp: createAgent('corp'), runner: createAgent('runner') });
  for (let i = 0; i < 50; i++) {
    const s = gr.state;
    if (s.activePlayer === 'corp' && s.turnNumber === 1 && s.corp.clicks === 3 && !s.activeRun && s.pendingPrompts.length === 0 && !(s.priority && s.priority.holder !== 'corp') && s.turnStep?.kind !== 'corp_turn_start') return structuredClone(s);
    gr.step();
  }
  throw new Error('Corp turn 1 not reached');
}

describe('spec-search S1 continuation audit', () => {
  it('logs every candidate on three lines and leaves the pick unchanged', () => {
    const s = position();
    const plain = createAgent('corp').chooseAction(structuredClone(s));
    const rows: SearchRow[] = [];
    const audited = withDiagnostics(d => {
      d.onSearch = r => rows.push(r);
      return createAgent('corp').chooseAction(structuredClone(s));
    });
    expect(audited).toEqual(plain);
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.kind).toBe('hq');
    expect(row.candidates.length).toBeGreaterThan(1);
    for (const c of row.candidates) expect(c.lines.map(l => l.mode)).toEqual(['rule', 'hold', 'finish']);
    // The pick is the best rule line
    const rules = row.candidates.map(c => c.lines[0].value ?? -Infinity);
    expect(row.chosen).toBeCloseTo(Math.max(...rules), 1);
    expect(row.chosen).toBeCloseTo(rules[row.pick], 5);
    // The hold line differs from the rule line exactly where the rule line installs the agenda; at deal 1491 one does
    expect(row.candidates.some(c => c.lines[1].distinct)).toBe(true);
    // The noise floor: each live rule line re-scored on two fresh reply deals
    expect(row.candidates.some(c => c.resample !== null)).toBe(true);
  }, 30000);
});
