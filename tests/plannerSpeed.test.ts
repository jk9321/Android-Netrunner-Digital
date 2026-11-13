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
import { GameState } from '../src/core';
import { createAgent } from '../src/ai';
import { plannerStats } from '../src/ai/turnPlanner';
import { tuning } from '../src/ai/synergy';

const saved = { ...tuning.plan };
afterEach(() => {
  Object.assign(tuning.plan, saved);
});
const t17 = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/planner-speed-t17.json', import.meta.url), 'utf8'));

describe('P1: the count has decided, the planner is not run', () => {
  it('a scoreNow line: advance Luminal (1.17.3a, 5.2.6f), with no planner search', () => {
    const before = plannerStats.decisions;
    const pick = createAgent('corp', 'normal').chooseAction(t17());
    expect(pick).toMatchObject({ type: 'ADVANCE_CARD', cardInstanceId: 'inst-3' });
    expect(plannerStats.decisions).toBe(before);
  }, 30000);
});
