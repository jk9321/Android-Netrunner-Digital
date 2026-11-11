import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { GameAction, GameState } from '../src/core';
import { HeuristicCorpAI } from '../src/ai';
import { planWith, tuning } from '../src/ai/synergy';

/**
 * Step 4 G2 (spec-step4-placement.md): no agenda into a remote the Runner can pay through by the count (holdCost
 * against runnerBudget); a payable remote gives it up for certain, HQ at most as one random card of several (rules 7.1,
 * 7.4.1). Pin: deal 1071 turn 7 (remote-steals-look.md class B): Offworld Office went into remote-2, need 5 against the
 * Runner's 9 credits, and was stolen.
 */
const position = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/placement-1071-t7.json', import.meta.url), 'utf8'));
const OFFWORLD = 'inst-3';
const saved = tuning.plan;
afterEach(() => {
  tuning.plan = saved;
});
const intoRemote2 = (a: GameAction) => a.type === 'INSTALL_CARD' && a.cardInstanceId === OFFWORLD && a.targetServerId === 'remote-2';

describe('step 4 G2: no agenda into a payable remote (plan.placementInstall)', () => {
  it('keeps Offworld Office out of remote-2', () => {
    const s = position();
    const ranked = new HeuristicCorpAI({ synergy: true }).rankMainActions(s);
    expect(ranked.filter(r => intoRemote2(r.action)).every(r => r.score === -Infinity)).toBe(true);
    expect(intoRemote2(new HeuristicCorpAI({ synergy: true }).chooseAction(s))).toBe(false);
  }, 120_000);

  it('the old ranking scored that install (the pin bites)', () => {
    tuning.plan = planWith(tuning.plan, ['placementInstall']);
    const ranked = new HeuristicCorpAI({ synergy: true }).rankMainActions(position());
    expect(ranked.some(r => intoRemote2(r.action) && r.score > -Infinity)).toBe(true);
  }, 120_000);
});
