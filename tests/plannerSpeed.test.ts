/**
 * Planner speed (spec /mnt/project-files/netrunner-ai/redesign/spec-planner-speed.md): the count cuts the planner's work.
 *
 * Rules (Comprehensive Rules v26.03): 1.17.3a the Corp may score an installed agenda with advancement counters equal to or
 * greater than its advancement requirement; 5.2.6f it may advance a card in its action phase.
 *
 * Position (tests/fixtures/planner-speed-t17.json): Discretion Advised vs Party Hard (tests/aiGames.ts), turn 17, the
 * Corp with 3 clicks and 1 credit, Luminal Transubstantiation (2 advancement counters) on remote-2 behind rezzed Ansel 1.0
 * and Pharos. Advancing it scores it this turn, which scoreNow finds; the planner took 60 s here to pick the same advance.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { GameState, executeAction } from '../src/core';
import { createAgent } from '../src/ai';
import { withDiagnostics } from '../src/ai/diagnostics';
import { tuning } from '../src/ai/synergy';

const saved = { ...tuning.plan };
afterEach(() => {
  Object.assign(tuning.plan, saved);
});
const t17 = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/planner-speed-t17.json', import.meta.url), 'utf8'));

describe('P1: the count has decided, the planner is not run', () => {
  // Rewritten in Step 4 Stage C7: under the order the Corp first clicks twice for a credit (the counted score question
  // lets a pick go first when it does not stop the score), then advances and scores; no planner search runs before the
  // score. The ranking advanced Luminal at once
  it('a scoreNow line: Luminal advanced and scored this turn (1.17.3a, 5.2.6f), with no planner search before the score', () => {
    withDiagnostics(d => {
      let s = t17();
      const corp = createAgent('corp', 'normal');
      for (let i = 0; i < 12 && s.activePlayer === 'corp' && !s.winner; i++) {
        const a = corp.chooseAction(s);
        s = executeAction(s, a);
        if (a.type === 'SCORE_AGENDA') break;
      }
      expect(s.corp.scoreArea.some(c => c.instanceId === 'inst-3')).toBe(true);
      expect(d.planner.decisions).toBe(0);
    });
  }, 30000);
});
