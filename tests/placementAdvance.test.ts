import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { GameAction, GameState, executeAction, getLegalActions } from '../src/core';
import { HeuristicCorpAI } from '../src/ai';
import { planWith, tuning } from '../src/ai/synergy';

/**
 * Step 4 G1 (spec-step4-placement.md): an agenda is advanced only as a step of a counted line (scoreNow, or a held
 * scoreInTwo line; rules 1.17.3a, 5.2.6f). Pin: deal 1071 turn 7 (The Syndicate v Tickets, please; remote-steals-look.md
 * class B): Offworld Office goes into remote-2, whose ice the Runner pays through (need 5, 9 credits), and the Corp
 * advanced it with no line; the Runner stole it with its counter.
 */
const position = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/placement-1071-t7.json', import.meta.url), 'utf8'));
const OFFWORLD = 'inst-3';
const saved = tuning.plan;
afterEach(() => {
  tuning.plan = saved;
});

const afterInstall = (): GameState => {
  const s = position();
  const install = getLegalActions(s, 'corp').find(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === OFFWORLD && a.targetServerId === 'remote-2' && !a.trashFirst?.length);
  expect(install).toBeDefined();
  return executeAction(s, install!);
};
const advancesOffworld = (a: GameAction) => a.type === 'ADVANCE_CARD' && a.cardInstanceId === OFFWORLD;

describe('step 4 G1: no agenda advance without a counted line (plan.placementAdvance)', () => {
  it('does not advance Offworld Office in a remote the Runner can pay through', () => {
    const s = afterInstall();
    const ranked = new HeuristicCorpAI({ synergy: true }).rankMainActions(s);
    expect(ranked.filter(r => advancesOffworld(r.action)).every(r => r.score === -Infinity)).toBe(true);
    expect(advancesOffworld(new HeuristicCorpAI({ synergy: true }).chooseAction(s))).toBe(false);
  }, 120_000);

  it('the old ranking scored that advance (the pin bites)', () => {
    tuning.plan = planWith(tuning.plan, ['placementAdvance']);
    const s = afterInstall();
    const ranked = new HeuristicCorpAI({ synergy: true }).rankMainActions(s);
    expect(ranked.some(r => advancesOffworld(r.action) && r.score > -Infinity)).toBe(true);
  }, 120_000);
});
