import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CardInstance, GameAction, GameState, cardDef } from '../src/core';
import { createAgent } from '../src/ai';
import { rezCandidates } from '../src/ai/playout';
import { countedRez, spendsKept } from '../src/ai/corp/rez';
import { rezMoney } from '../src/ai/corp/rezMoney';

/**
 * Stage D item 3, exploit F1 (item3-rez-money/design-answer.md section 2, point 7, and section 6): the move-level mirrors of the F1 pin
 * (tests/exploitPins.test.ts). On F1's board (a run on HQ with Offworld Office in HQ; the Runner pays through the
 * Palisade with Cleaver; the Corp has 11 and keeps 9 for remote-1 through the rest of the Runner's turn) the toll rez is
 * passed. Each mirror changes one input of the condition (section 6: after the rez the Corp cannot pay the keep counted
 * with the Runner's credits after the toll; every server of that keep is held, and its keep affordable, when the ice is
 * left unrezzed; keeps without the run's server) and the rez is made, as before the fix: the rez is optional either way
 * (rules 6.9.2b, 6.9.2c).
 */
const f1: GameState = JSON.parse(readFileSync(new URL('./fixtures/adversarial/stage-c-f1-hq-toll-rez.json', import.meta.url), 'utf8'));
const T = 120_000;

const iceOf = (s: GameState): CardInstance => s.corp.servers[s.activeRun!.server].ice[s.activeRun!.icePosition!];
const rezzes = (s: GameState): boolean => {
  const ice = iceOf(s);
  const a = createAgent('corp', 'normal').chooseRez!(structuredClone(s), rezCandidates(s, 'approach_ice')) as (GameAction & { cardInstanceId?: string }) | null;
  return a?.type === 'REZ_CARD' && a.cardInstanceId === ice.instanceId;
};
const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';
/** F1's board as an R4 toll: the run on R&D (HQ's two Palisades moved there), no agenda in HQ (Offworld Office into R&D). */
const asR4 = (s0: GameState): GameState => {
  const s = structuredClone(s0);
  const { hq, rd } = s.corp.servers;
  [hq.ice, rd.ice] = [rd.ice, hq.ice];
  s.corp.rd = [...s.corp.hq.filter(isAgenda), ...s.corp.rd];
  s.corp.hq = s.corp.hq.filter(c => !isAgenda(c));
  s.activeRun = { ...s.activeRun!, server: 'rd' };
  return s;
};
const keepRest = (s: GameState, runnerCredits: number) => rezMoney(s, { restOfTurn: { runnerCredits }, except: s.activeRun!.server });

describe('F1 toll rez: the money kept for the rest of the Runner turn', () => {
  it('F1 itself: R3 toll, the rest-of-turn keep without HQ is 9 (remote-1), the rez would leave 8: passed', { timeout: T }, () => {
    expect(cardDef(iceOf(f1)).title).toBe('Palisade');
    expect(f1.corp.credits).toBe(11);
    // The Runner pays 1 through the Palisade (5 -> 4 credits) and has 3 clicks left
    expect(keepRest(f1, 4).keep).toBe(9);
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
    expect(keepRest(s, 4).keep).toBe(6);
    expect(rezMoney(s).keep).toBe(9);
    expect(spendsKept(s, iceOf(s))).toBe(false);
    expect(countedRez(s, iceOf(s))).toBe('rez');
    expect(rezzes(s)).toBe(true);
  });

  it('the run\'s own server is left out: with the Runner at 2 credits HQ would ask 6 more, the keep is remote-1\'s 3: made', { timeout: T }, () => {
    const s: GameState = { ...f1, corp: { ...f1.corp, credits: 7 }, runner: { ...f1.runner, credits: 2, clicks: 1 } };
    expect(keepRest(s, 1).keep).toBe(3);
    expect(rezMoney(s, { restOfTurn: { runnerCredits: 1 } }).keep).toBe(6);
    expect(spendsKept(s, iceOf(s))).toBe(false);
    expect(countedRez(s, iceOf(s))).toBe('rez');
    expect(rezzes(s)).toBe(true);
  });

  it('the run\'s own server is left out, and the pass is made by it: Corp 4, Runner 2 credits and 1 click: the keep is remote-1\'s 3, the rez leaves 1: passed', { timeout: T }, () => {
    const s: GameState = { ...f1, corp: { ...f1.corp, credits: 4 }, runner: { ...f1.runner, credits: 2, clicks: 1 } };
    expect(keepRest(s, 1).keep).toBe(3);
    expect(spendsKept(s, iceOf(s))).toBe(true);
    expect(countedRez(s, iceOf(s))).toBe('pass');
  });

  // Design-answer section 6 (review R1): the pass world, the ice left unrezzed and the Runner keeping its toll
  it('the Runner has 7: with the rez it has 6 and the keep is 9; without it remote-1 cannot be held (keep 0): made', { timeout: T }, () => {
    const s: GameState = { ...f1, runner: { ...f1.runner, credits: 7 } };
    expect(keepRest(s, 6).keep).toBe(9);
    expect(keepRest(s, 7).keep).toBe(0);
    expect(keepRest(s, 7).unholdable).toContain('remote-1');
    expect(spendsKept(s, iceOf(s))).toBe(false);
    expect(countedRez(s, iceOf(s))).toBe('rez');
    expect(rezzes(s)).toBe(true);
  });

  it('the Runner has 4: after the toll it has 3, the keep is 6, the rez leaves 8: made (the keep reads the credits after the toll)', { timeout: T }, () => {
    const s: GameState = { ...f1, runner: { ...f1.runner, credits: 4 } };
    expect(keepRest(s, 3).keep).toBe(6);
    expect(keepRest(s, 4).keep).toBe(9);
    expect(spendsKept(s, iceOf(s))).toBe(false);
    expect(countedRez(s, iceOf(s))).toBe('rez');
    expect(rezzes(s)).toBe(true);
  });

  it('R4: the same toll on R&D with no agenda in HQ: passed; the Corp 3 richer: made', { timeout: T }, () => {
    const s = asR4(f1);
    expect(s.corp.hq.some(isAgenda)).toBe(false);
    expect(cardDef(iceOf(s)).title).toBe('Palisade');
    expect(countedRez(s, iceOf(s))).toBe('pass');
    const rich: GameState = { ...s, corp: { ...s.corp, credits: s.corp.credits + 3 } };
    expect(countedRez(rich, iceOf(rich))).toBe('rez');
    expect(rezzes(rich)).toBe(true);
  });

  // The run under way is over in the rest of the turn (hold.ts afterRun): its rez cost increase (rezCost adds it to
  // every ice while the run lasts) does not price remote-1's three Palisades
  it('the rest-of-turn keep reads the board with the run over: a run rez cost increase of 2 leaves the keep at 9', { timeout: T }, () => {
    const s: GameState = { ...f1, activeRun: { ...f1.activeRun!, iceRezCostIncrease: 2 } };
    expect(keepRest(s, 4).keep).toBe(9);
  });

  it('mirror: the Corp is already below the keep (8 of 9), Jeff\'s R3 stands: made', { timeout: T }, () => {
    const s: GameState = { ...f1, corp: { ...f1.corp, credits: 8 } };
    expect(spendsKept(s, iceOf(s))).toBe(false);
    expect(countedRez(s, iceOf(s))).toBe('rez');
    expect(rezzes(s)).toBe(true);
  });
});
