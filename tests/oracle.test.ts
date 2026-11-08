import { afterEach, describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { tuning } from '../src/ai/synergy';
import { runnerView } from '../src/ai/threatModel';
import { corpSeenGrip, oracleSteal } from '../src/ai/oracle';
import { installIceForTest, newGame, putInHand } from './helpers';
import { inDecision } from './helpers/pricing';
import { pricing } from '../src/ai/pricing';

/**
 * Tuning pass round 2, phase 1 (spec-round2.md): the measurement oracles. Each is off by default; on, it gives the
 * Corp one piece of hidden information (rules 10.2.2a-b: the grip, R&D order and facedown cards are hidden) for a
 * batch. These pin that each does what it says when on and nothing when off.
 */

const saved = structuredClone(tuning.plan.oracle);
afterEach(() => {
  tuning.plan.oracle = structuredClone(saved);
});
const ids = (cards: { instanceId: string }[]) => cards.map(c => c.instanceId).sort();

describe('oracle.grip', () => {
  const start = (): GameState => newGame(3);

  it('off: the Corp counts none of an unrevealed grip as seen, and guesses the grip from the unseen pool', () => {
    const s = start();
    const seen = inDecision(s, 'corp', () => corpSeenGrip(s));
    expect(seen.size).toBe(0);
    // The threat's grip is a deal from grip + stack in instance order: not the real grip
    const guessed = inDecision(s, 'corp', () => runnerView(s).runner.grip);
    expect(ids(guessed)).not.toEqual(ids(s.runner.grip));
  });

  it('on: the whole grip counts as seen, so the threat plays the real grip (the stack stays a guess)', () => {
    tuning.plan.oracle.grip = true;
    const s = start();
    const seen = inDecision(s, 'corp', () => corpSeenGrip(s));
    expect([...seen].sort()).toEqual(ids(s.runner.grip));
    const view = inDecision(s, 'corp', () => runnerView(s));
    expect(ids(view.runner.grip)).toEqual(ids(s.runner.grip));
    expect(ids(view.runner.stack)).toEqual(ids(s.runner.stack));
  });

  it('is off for the Runner deciding (sideOff.runner): it never tells the Runner anything', () => {
    tuning.plan.oracle.grip = true;
    const s = start();
    expect(inDecision(s, 'runner', () => corpSeenGrip(s)).size).toBe(0);
  });
});

describe('oracle.safestRemote', () => {
  const PALISADE = '30072';
  /** An agenda drawn into HQ (the decision's start) and the end of the Corp's turn with it installed in a new remote. */
  function agendaInstalled(iced: boolean): { start: GameState; end: GameState } {
    const start = newGame(5);
    const id = putInHand(start, 'corp', 'agenda');
    const end = structuredClone(start);
    const card = end.corp.hq.splice(end.corp.hq.findIndex(c => c.instanceId === id), 1)[0];
    end.corp.servers['remote-9'] = { id: 'remote-9', name: 'Server 9', isRemote: true, ice: [], root: [card] };
    if (iced) installIceForTest(end, PALISADE, 'remote-9', true);
    end.corp.clicks = 0;
    end.runner.credits = iced ? 0 : 5;
    return { start, end };
  }

  it('off: the honest estimate stands (no answer from the oracle)', () => {
    const { start, end } = agendaInstalled(false);
    expect(inDecision(start, 'corp', () => oracleSteal(end, 'remote-9'))).toBeUndefined();
  });

  it('on: an agenda put in a bare remote is stolen on the Runner AI\'s next turn (1)', () => {
    tuning.plan.oracle.safestRemote = true;
    const { start, end } = agendaInstalled(false);
    expect(inDecision(start, 'corp', () => oracleSteal(end, 'remote-9'))).toBe(1);
  });

  it("puts the deciding Corp's pricing context back after playing the Runner's turn out", () => {
    tuning.plan.oracle.safestRemote = true;
    const { start, end } = agendaInstalled(false);
    inDecision(start, 'corp', () => {
      const before = { known: pricing().known, corp: pricing().known.corp, runner: pricing().known.runner, anchor: pricing().anchor, side: pricing().side };
      oracleSteal(end, 'remote-9');
      expect(pricing().known).toBe(before.known);
      expect(pricing().known.corp).toBe(before.corp);
      expect(pricing().known.runner).toBe(before.runner);
      expect(pricing().anchor).toBe(before.anchor);
      expect(pricing().side).toBe('corp');
      expect(pricing().oracleRunning).toBe(false);
    });
  });

  it('on: behind rezzed Palisade against a Runner with no credits or breakers it stands (0)', () => {
    tuning.plan.oracle.safestRemote = true;
    const { start, end } = agendaInstalled(true);
    end.runner.rig.programs = [];
    end.runner.grip = [];
    expect(inDecision(start, 'corp', () => oracleSteal(end, 'remote-9'))).toBe(0);
  });

  it('on: tells only agendas installed this turn, only at the end of the Corp turn, and never the Runner', () => {
    tuning.plan.oracle.safestRemote = true;
    const { start, end } = agendaInstalled(false);
    // Installed before this decision: not in HQ when it started
    expect(inDecision(end, 'corp', () => oracleSteal(end, 'remote-9'))).toBeUndefined();
    // Clicks left: the turn isn't over, the honest estimate stands
    const midTurn = { ...end, corp: { ...end.corp, clicks: 1 } };
    expect(inDecision(start, 'corp', () => oracleSteal(midTurn, 'remote-9'))).toBeUndefined();
    expect(inDecision(start, 'runner', () => oracleSteal(end, 'remote-9'))).toBeUndefined();
  });
});
