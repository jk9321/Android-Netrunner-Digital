import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameState, cardDef, executeAction } from '../src/core';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { GameRunner } from '../src/ai/playout';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { MEASURED_PASS, passOddsOf, stealOdds } from '../src/ai/effectValues';
import { asSide, tuning } from '../src/ai/synergy';
import { CALIBRATED_RUN, remoteRunChance, runChance, threat, threatLoss } from '../src/ai/threatModel';
import { installIceForTest, installProgramForTest, newGame } from './helpers';
import { threatStanding } from '../src/ai/evaluate';

/**
 * Structural review item 3 (plan.threatModel; spec "Item 3 spec" of the AI code review doc): the Corp's threat is the
 * Runner AI's own run scorer budgeted over its next turn, on the board as the Runner sees it. The first two checks are
 * the review's: nothing the Runner can't see may change it.
 */

const PALISADE = '30072';
// Off by default on beta (the gate, 2026-11-07): these tests turn it on
const threatDefault = tuning.plan.threatModel;
beforeEach(() => { tuning.plan.threatModel = true; });
afterEach(() => { tuning.plan.threatModel = threatDefault; });
const corpThreat = (s: GameState) => asSide('corp', () => threat(s));
/** What the Runner does with the turn: where it runs, and its own scores (no Corp-side numbers). */
const runnerSide = (s: GameState) => {
  const t = corpThreat(s);
  return { order: t.order, scores: Object.fromEntries(Object.entries(t.servers).map(([id, v]) => [id, v.score])) };
};
const ofType = (cards: GameState['corp']['rd'], type: string) => cards.find(c => cardDef(c).type_code === type)!;

/** A remote holding a facedown card behind one unrezzed ice, and R&D and HQ open. */
function board(): GameState {
  const s = newGame();
  s.activePlayer = 'corp';
  s.corp.credits = 5;
  s.runner.credits = 5;
  const asset = s.corp.rd.splice(s.corp.rd.indexOf(ofType(s.corp.rd, 'asset')), 1)[0];
  s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote Server 1', isRemote: true, ice: [], root: [{ ...asset, isRezzed: false, faceUp: false }] };
  installIceForTest(s, PALISADE, 'remote-1', false);
  return s;
}

describe('the threat reads nothing the Runner cannot see (rule 10.2.2a hidden information)', () => {
  it('an unrezzed ice swapped for another of the same rez-cost class changes nothing', () => {
    const s = board();
    const before = runnerSide(s);
    expect(Number.isFinite(before.scores['remote-1'])).toBe(true); // the Runner prices the remote: the swap is tested
    const other = ofType(s.corp.rd, 'ice');
    const swapped = structuredClone(s);
    swapped.corp.servers['remote-1'].ice[0].cardCode = other.cardCode;
    expect(cardDef(swapped.corp.servers['remote-1'].ice[0]).title).not.toBe('Palisade');
    expect(runnerSide(swapped)).toEqual(before);
    expect(corpThreat(swapped).servers['remote-1'].run).toBe(corpThreat(s).servers['remote-1'].run);
  });

  it('a facedown asset swapped for an agenda (the two trading places with HQ) changes nothing', () => {
    const s = board();
    const agenda = ofType(s.corp.rd, 'agenda');
    s.corp.hq.push(s.corp.rd.splice(s.corp.rd.indexOf(agenda), 1)[0]);
    const before = runnerSide(s);
    const swapped = structuredClone(s);
    const root = swapped.corp.servers['remote-1'].root[0];
    const inHq = swapped.corp.hq.find(c => c.instanceId === agenda.instanceId)!;
    [root.cardCode, inHq.cardCode] = [inHq.cardCode, root.cardCode];
    expect(cardDef(swapped.corp.servers['remote-1'].root[0]).type_code).toBe('agenda');
    expect(runnerSide(swapped)).toEqual(before);
  });

  it('a card in the grip swapped with one in the stack changes nothing (the grip is dealt from the unseen cards)', () => {
    const s = board();
    const before = runnerSide(s);
    const swapped = structuredClone(s);
    const [g, k] = [swapped.runner.grip[0], swapped.runner.stack[0]];
    swapped.runner.grip[0] = k;
    swapped.runner.stack[0] = g;
    expect(runnerSide(swapped)).toEqual(before);
  });

  it('is deterministic: the same board, the same threat', () => {
    expect(runnerSide(structuredClone(board()))).toEqual(runnerSide(board()));
  });
});

describe('where the Runner runs', () => {
  it('a bare remote with an agenda in it reads 1 (openSteal falls out)', () => {
    const s = newGame();
    s.activePlayer = 'corp';
    const agenda = s.corp.rd.splice(s.corp.rd.indexOf(ofType(s.corp.rd, 'agenda')), 1)[0];
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote Server 1', isRemote: true, ice: [], root: [{ ...agenda, isRezzed: false, faceUp: false }] };
    expect(corpThreat(s).servers['remote-1'].run).toBe(1);
    expect(asSide('corp', () => stealOdds(s, 'remote-1'))).toBe(1);
  });

  it('an agenda about to go into a new bare remote reads 1 too (the probe)', () => {
    const s = newGame();
    s.activePlayer = 'corp';
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote Server 1', isRemote: true, ice: [], root: [] };
    expect(asSide('corp', () => remoteRunChance(s, 'remote-1'))).toBe(1);
  });

  it('a remote behind rezzed ice the rig cannot break reads 0', () => {
    const s = board();
    s.runner.rig.programs = [];
    s.corp.servers['remote-1'].ice[0].isRezzed = true;
    installIceForTest(s, PALISADE, 'remote-1');
    expect(corpThreat(s).servers['remote-1'].run).toBe(0);
    expect(asSide('corp', () => stealOdds(s, 'remote-1'))).toBe(0);
  });

  it('bug report #15 (the Runner walked into HQ every turn): the threat runs where the Runner AI now runs', () => {
    // The spec expected HQ here. The Runner AI on beta, played out from this board with its real grip, runs R&D only
    // (its HQ run scores -1.0: 3.4 for the access against the toll and the click), and so does the threat
    let s: GameState = JSON.parse(readFileSync(new URL('./fixtures/bug-report-15-turn10.json', import.meta.url), 'utf8'));
    for (let i = 0; i < 3; i++) s = executeAction(s, { type: 'GAIN_CREDIT', player: 'corp' });
    const predicted = corpThreat(s).order;
    const gr = new GameRunner(structuredClone(s), { corp: new HeuristicCorpAI({ synergy: true, planner: false }), runner: new HeuristicRunnerAI({ synergy: true }) });
    let started = false;
    for (let i = 0; i < 300 && gr.step(); i++) {
      if (gr.state.activePlayer === 'runner') started = true;
      else if (started && !gr.state.activeRun) break;
    }
    expect(gr.state.runnerLastTurnRuns.map(r => r.server)).toEqual(predicted);
    expect(predicted).toEqual(['rd']);
  });

  it('round 2: a remote the Runner can’t pay into today is still at risk on the turns after (threatStanding)', () => {
    // Cleaver against one rezzed Palisade on a remote (strength 4): 3 credits to get through. Broke, the Runner can't
    // this turn; a turn's income later (RUNNER_TURN_INCOME) it can, so an agenda waiting two turns is not safe
    const s = newGame();
    s.activePlayer = 'corp';
    s.runner.rig.programs = [];
    installProgramForTest(s, '30006');
    s.runner.credits = 0;
    const agenda = s.corp.rd.splice(s.corp.rd.indexOf(ofType(s.corp.rd, 'agenda')), 1)[0];
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote Server 1', isRemote: true, ice: [], root: [{ ...agenda, isRezzed: false, faceUp: false }] };
    installIceForTest(s, PALISADE, 'remote-1');
    const first = asSide('corp', () => stealOdds(s, 'remote-1'));
    expect(first).toBe(0);
    expect(asSide('corp', () => threatStanding(s, 'remote-1', 1, first))).toBe(1);
    expect(asSide('corp', () => threatStanding(s, 'remote-1', 2, first))).toBeLessThan(0.2);
  });

  it('the switch is the Corp’s: the Runner AI keeps its own plan (sideOff.runner)', () => {
    expect(tuning.plan.threatModel).toBe(true);
    expect(asSide('runner', () => tuning.plan.threatModel)).toBe(false);
  });

  it('round 2: plan.measuredPass prices unrezzed ice at the measured rates (the first layer, then each after it)', () => {
    const s = board();
    const measured = tuning.plan.measuredPass;
    try {
      tuning.plan.measuredPass = true;
      expect(asSide('corp', () => passOddsOf(s, 'remote-1'))).toBeCloseTo(MEASURED_PASS.rich.first);
      installIceForTest(s, PALISADE, 'remote-1', false);
      expect(asSide('corp', () => passOddsOf(s, 'remote-1'))).toBeCloseTo(MEASURED_PASS.rich.first * MEASURED_PASS.rich.more);
      s.corp.credits = 1;
      expect(asSide('corp', () => passOddsOf(s, 'remote-1'))).toBeCloseTo(MEASURED_PASS.broke.first * MEASURED_PASS.broke.more);
      // The Runner's side keeps its own guess
      expect(asSide('runner', () => tuning.plan.measuredPass)).toBe(false);
    } finally {
      tuning.plan.measuredPass = measured;
    }
  });

  /** Runs `body` with plan switches set, then puts them back. */
  const withPlan = <T>(on: Partial<typeof tuning.plan>, body: () => T): T => {
    const before = { ...tuning.plan };
    Object.assign(tuning.plan, on);
    try {
      return body();
    } finally {
      Object.assign(tuning.plan, before);
    }
  };

  it('round 3: plan.threatSpend credits the Corp with what the Runner spends getting in (an iced remote taxes it)', () => {
    // Cleaver through a rezzed Palisade into a remote holding an agenda: the Runner pays to get in
    const s = newGame();
    s.activePlayer = 'corp';
    s.runner.rig.programs = [];
    installProgramForTest(s, '30006');
    s.runner.credits = 8;
    s.runner.clicks = 0;
    const agenda = s.corp.rd.splice(s.corp.rd.indexOf(ofType(s.corp.rd, 'agenda')), 1)[0];
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote Server 1', isRemote: true, ice: [], root: [{ ...agenda, isRezzed: false, faceUp: false }] };
    installIceForTest(s, PALISADE, 'remote-1');
    const t = corpThreat(s);
    expect(t.order).toContain('remote-1');
    const spent = s.runner.credits + (4 - t.runs) - t.endCredits; // its credit clicks in, the tolls out
    expect(spent).toBeGreaterThan(0);
    const off = withPlan({ threatSpend: false }, () => asSide('corp', () => threatLoss(structuredClone(s))));
    const on = withPlan({ threatSpend: true }, () => asSide('corp', () => threatLoss(structuredClone(s))));
    expect(on).toBeLessThan(off);
  });

  it('round 3: plan.calibratedRun reads the budget at the measured hit rates', () => {
    const s = newGame();
    s.activePlayer = 'corp';
    const agenda = s.corp.rd.splice(s.corp.rd.indexOf(ofType(s.corp.rd, 'agenda')), 1)[0];
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote Server 1', isRemote: true, ice: [], root: [{ ...agenda, isRezzed: false, faceUp: false }] };
    withPlan({ calibratedRun: true }, () => {
      expect(asSide('corp', () => runChance(structuredClone(s), 'remote-1'))).toBe(CALIBRATED_RUN.remote.picked);
      const order = corpThreat(structuredClone(s)).order;
      for (const id of ['hq', 'rd'] as const) expect(asSide('corp', () => runChance(structuredClone(s), id))).toBe(order.includes(id) ? CALIBRATED_RUN[id].picked : CALIBRATED_RUN[id].not);
    });
    expect(asSide('corp', () => runChance(structuredClone(s), 'remote-1'))).toBe(1);
  });
});
