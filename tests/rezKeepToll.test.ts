import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CardInstance, GameAction, GameState, cardDef } from '../src/core';
import { createAgent } from '../src/ai';
import { rezCandidates } from '../src/ai/playout';
import { countedRez, spendsKept } from '../src/ai/corp/rez';
import { rezMoney } from '../src/ai/corp/rezMoney';

/**
 * Stage D item 3, exploit F1 (item3-rez-money/design-answer.md section 2, point 7): the move-level mirrors of the F1 pin
 * (tests/exploitPins.test.ts). On F1's board (a run on HQ with Offworld Office in HQ; the Runner pays through the
 * Palisade with Cleaver; the Corp has 11 and keeps 9 for remote-1 through the rest of the Runner's turn) the toll rez is
 * passed. Each mirror changes one input of the condition (credits >= keepRest and credits - rezCost < keepRest, keepRest
 * without the run's server) and the rez is made, as before the fix: the rez is optional either way (rules 6.9.2b, 6.9.2c).
 */
const f1: GameState = JSON.parse(readFileSync(new URL('./fixtures/adversarial/stage-c-f1-hq-toll-rez.json', import.meta.url), 'utf8'));
const T = 120_000;

const iceOf = (s: GameState): CardInstance => s.corp.servers[s.activeRun!.server].ice[s.activeRun!.icePosition!];
const rezzes = (s: GameState): boolean => {
  const ice = iceOf(s);
  const a = createAgent('corp', 'normal').chooseRez!(structuredClone(s), rezCandidates(s, 'approach_ice')) as (GameAction & { cardInstanceId?: string }) | null;
  return a?.type === 'REZ_CARD' && a.cardInstanceId === ice.instanceId;
};
const keepRest = (s: GameState, runnerCredits: number) => rezMoney(s, { restOfTurn: { runnerCredits }, except: s.activeRun!.server }).keep;

describe('F1 toll rez: the money kept for the rest of the Runner turn', () => {
  it('F1 itself: R3 toll, the rest-of-turn keep without HQ is 9 (remote-1), the rez would leave 8: passed', { timeout: T }, () => {
    expect(cardDef(iceOf(f1)).title).toBe('Palisade');
    expect(f1.corp.credits).toBe(11);
    // The Runner pays 1 through the Palisade (5 -> 4 credits) and has 3 clicks left
    expect(keepRest(f1, 4)).toBe(9);
    expect(spendsKept(f1, iceOf(f1))).toBe(true);
    expect(countedRez(f1, iceOf(f1))).toBe('pass');
  });

  it('mirror: the Corp has 3 more credits, the rez leaves the keep: made', { timeout: T }, () => {
    const s: GameState = { ...f1, corp: { ...f1.corp, credits: f1.corp.credits + 3 } };
    expect(spendsKept(s, iceOf(s))).toBe(false);
    expect(countedRez(s, iceOf(s))).toBe('rez');
    expect(rezzes(s)).toBe(true);
  });

  it('mirror: the Runner has no click left after this run, nothing to keep for: made', { timeout: T }, () => {
    const s: GameState = { ...f1, runner: { ...f1.runner, clicks: 0 } };
    expect(spendsKept(s, iceOf(s))).toBe(false);
    expect(countedRez(s, iceOf(s))).toBe('rez');
    expect(rezzes(s)).toBe(true);
  });

  // The two inputs of the keep the mirrors above leave alone: the horizon's start and the run's own server left out
  it('the Runner has 1 click left: the rest-of-turn keep is 6 (one run on remote-1), not the next turn\'s 9: made', { timeout: T }, () => {
    const s: GameState = { ...f1, runner: { ...f1.runner, clicks: 1 } };
    expect(keepRest(s, 4)).toBe(6);
    expect(rezMoney(s).keep).toBe(9);
    expect(spendsKept(s, iceOf(s))).toBe(false);
    expect(countedRez(s, iceOf(s))).toBe('rez');
    expect(rezzes(s)).toBe(true);
  });

  it('the run\'s own server is left out: with the Runner at 2 credits HQ would ask 6 more, the keep is remote-1\'s 3: made', { timeout: T }, () => {
    const s: GameState = { ...f1, corp: { ...f1.corp, credits: 7 }, runner: { ...f1.runner, credits: 2, clicks: 1 } };
    expect(keepRest(s, 1)).toBe(3);
    expect(rezMoney(s, { restOfTurn: { runnerCredits: 1 } }).keep).toBe(6);
    expect(spendsKept(s, iceOf(s))).toBe(false);
    expect(countedRez(s, iceOf(s))).toBe('rez');
    expect(rezzes(s)).toBe(true);
  });

  it('mirror: the Corp is already below the keep (8 of 9), Jeff\'s R3 stands: made', { timeout: T }, () => {
    const s: GameState = { ...f1, corp: { ...f1.corp, credits: 8 } };
    expect(spendsKept(s, iceOf(s))).toBe(false);
    expect(countedRez(s, iceOf(s))).toBe('rez');
    expect(rezzes(s)).toBe(true);
  });
});
