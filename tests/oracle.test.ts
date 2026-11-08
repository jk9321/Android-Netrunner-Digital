import { afterEach, describe, expect, it } from 'vitest';
import { GameState, cardDef } from '../src/core';
import { tuning } from '../src/ai/synergy';
import { runnerView } from '../src/ai/threatModel';
import { corpDrawPool, corpSeenGrip, oracleSteal } from '../src/ai/oracle';
import { guessHidden } from '../src/ai/runnerReply';
import { installIceForTest, newGame, newGameAtSetup, putInHand } from './helpers';
import { placeOracleIce } from '../scripts/oracle-ice';
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

describe('ORACLE_ICE board setup (scripts/oracle-ice.ts)', () => {
  it.each(['hq', 'archives', 'remote'] as const)('puts the first ice of R&D rezzed on %s, from the deck, with no new instance', target => {
    const s = newGameAtSetup(2);
    const ice = s.corp.rd.find(c => cardDef(c).type_code === 'ice')!;
    const hq = ids(s.corp.hq);
    const rd = s.corp.rd.length;
    const next = s.nextInstanceId;
    expect(placeOracleIce(s, target)).toBe(true);
    const server = target === 'remote' ? s.corp.servers[`remote-${s.corp.remoteCounter}`] : s.corp.servers[target];
    expect(server.ice).toEqual([expect.objectContaining({ instanceId: ice.instanceId, isRezzed: true })]);
    expect(s.corp.rd.length).toBe(rd - 1);
    expect(ids(s.corp.hq)).toEqual(hq);
    expect(s.nextInstanceId).toBe(next);
  });

  it('skips a deal whose R&D holds no ice', () => {
    const s = newGameAtSetup(2);
    s.corp.rd = s.corp.rd.filter(c => cardDef(c).type_code !== 'ice');
    expect(placeOracleIce(s, 'hq')).toBe(false);
    expect(s.corp.servers.hq.ice).toEqual([]);
  });
});

describe('oracle.rd', () => {
  it("off: a draw is R&D's contents, and the Corp's guesses re-deal R&D", () => {
    const s = newGame(4);
    expect(inDecision(s, 'corp', () => corpDrawPool(s))).toBe(s.corp.rd);
    const guess = inDecision(s, 'corp', () => guessHidden(s, 0));
    expect(guess.corp.rd.map(c => c.instanceId)).not.toEqual(s.corp.rd.map(c => c.instanceId));
  });

  it("on: the Corp's next draw is R&D's top card, and its guesses keep R&D's order", () => {
    tuning.plan.oracle.rd = true;
    const s = newGame(4);
    expect(inDecision(s, 'corp', () => corpDrawPool(s))).toEqual([s.corp.rd[0]]);
    const guess = inDecision(s, 'corp', () => guessHidden(s, 0));
    expect(guess.corp.rd.map(c => c.instanceId)).toEqual(s.corp.rd.map(c => c.instanceId));
    // The Runner deciding never knows it
    expect(inDecision(s, 'runner', () => corpDrawPool(s))).toBe(s.corp.rd);
  });
});

describe('oracle.think', () => {
  it('off: the shipped planner width and reply samples; on: wider for the Corp only', async () => {
    const { plannerCandidates, replySamples, thinkAlwaysTries, THINK } = await import('../src/ai/oracle');
    const s = newGame(4);
    expect(inDecision(s, 'corp', () => [plannerCandidates('corp', 4), replySamples(2), thinkAlwaysTries('corp')])).toEqual([4, 2, false]);
    tuning.plan.oracle.think = true;
    expect(inDecision(s, 'corp', () => [plannerCandidates('corp', 4), replySamples(2), thinkAlwaysTries('corp')])).toEqual([THINK.candidates, THINK.samples, true]);
    expect(inDecision(s, 'runner', () => [plannerCandidates('runner', 4), replySamples(2), thinkAlwaysTries('runner')])).toEqual([4, 2, false]);
  });
});

describe('oracle.money (scripts/oracle-money.ts)', () => {
  it('gives the Corp one credit as a new state, leaving the old one as it was', async () => {
    const { withOracleMoney } = await import('../scripts/oracle-money');
    const s = newGame(4);
    const credits = s.corp.credits;
    const next = withOracleMoney(s);
    expect(next.corp.credits).toBe(credits + 1);
    expect(s.corp.credits).toBe(credits);
    expect(next.runner).toBe(s.runner);
  });
});

describe('oracle.ts load order (hand-off identical check, 2026-11-08)', () => {
  it('imports no AI decision module: a new import edge moved 39 of 221 deals with every oracle off', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/ai/oracle.ts', 'utf8');
    const imports = [...src.matchAll(/^import .* from '(.*)';$/gm)].map(m => m[1]);
    expect(imports.filter(i => /corpAI|runnerAI|playout|turnPlanner|runnerReply|search|evaluate/.test(i))).toEqual([]);
  });
});
