import { describe, expect, it } from 'vitest';
import { FUZZ_CORPS, FUZZ_RUNNERS, checkInvariants, cardsByZone, fuzzEngineGame, pairing, summaryLine } from '../scripts/engine-fuzz-check';
import { executeAction } from '../src/core';
import { newGame } from './helpers';

// Engine-invariant fuzzer, tier 1 (tiers 2 and 3 are scripts/engine-fuzz.ts on GitHub Actions: nightly, and the deep
// run before each new set and before beta merges to main). Fixed seeds, so it is deterministic and gates CI. Random
// legal moves on every deck we have, every Comprehensive Rules v26.03 invariant in scripts/engine-fuzz-check.ts
// checked after every action. A failure here prints the seed: reproduce it with scripts/engine-fuzz-replay.ts.
const GAMES = Math.max(FUZZ_CORPS.length, FUZZ_RUNNERS.length);
const SEED0 = 1;
const STEPS = 250;

describe('Engine fuzzer (tier 1, fixed seeds)', () => {
  it(`${GAMES} random games, every deck on its side: no broken invariant`, () => {
    const lines: string[] = [];
    const corps = new Set<string>();
    const runners = new Set<string>();
    for (let g = 0; g < GAMES; g++) {
      const { corp, runner } = pairing(g);
      corps.add(corp.id);
      runners.add(runner.id);
      const res = fuzzEngineGame(SEED0 + g, corp, runner, { maxSteps: STEPS });
      if (res.failures.length) lines.push(summaryLine(res));
    }
    expect(lines).toEqual([]);
    expect(corps.size).toBe(FUZZ_CORPS.length);
    expect(runners.size).toBe(FUZZ_RUNNERS.length);
  }, 90_000);

  it('a game is decided by its seed and decks: the same seed takes the same actions', () => {
    const { corp, runner } = pairing(3);
    const a = fuzzEngineGame(77, corp, runner, { maxSteps: 150 });
    const b = fuzzEngineGame(77, corp, runner, { maxSteps: 150 });
    expect(b.actions).toEqual(a.actions);
    const c = fuzzEngineGame(77, corp, runner, { maxSteps: 150, actions: a.actions });
    expect(c.steps).toBe(a.steps);
  });
});

// The checks must be able to fail: break a copy of a real state and each one fires.
describe('Engine fuzzer checks catch broken states', () => {
  const base = newGame(3);
  const ids = new Set(cardsByZone(base).map(x => x.card.instanceId));
  const broken = (edit: (s: typeof base) => void) => {
    const s = structuredClone(base);
    edit(s);
    return checkInvariants(s, base, ids).failures.map(f => f.check);
  };

  it('the starting state passes', () => {
    expect(checkInvariants(base, null, ids).failures).toEqual([]);
  });

  it('a card in two zones, or lost (4.1.1c, 4.1.2b)', () => {
    expect(broken(s => s.corp.hq.push(s.corp.rd[0]))).toContain('card-in-one-zone');
    expect(broken(s => s.corp.rd.pop())).toContain('card-lost');
  });

  it('negative credits, runaway clicks (1.10.2, 1.11.2)', () => {
    expect(broken(s => (s.runner.credits = -1))).toContain('credits-nonnegative');
    expect(broken(s => (s.corp.clicks = 20))).toContain('clicks-in-range');
  });

  it('score that is not the agenda sum, 7 points with no winner (1.17.1, 1.17.2)', () => {
    expect(broken(s => (s.corp.score = 2))).toContain('score-is-agenda-sum');
    expect(
      broken(s => {
        const agenda = s.corp.rd.shift()!;
        agenda.asAgendaPoints = 7;
        s.corp.scoreArea.push(agenda);
        s.corp.score = 7;
      })
    ).toContain('seven-points-wins');
  });

  it('memory over the limit (3.9.3c)', () => {
    expect(broken(s => (s.runner.memoryUnitsUsed = 9))).toEqual(expect.arrayContaining(['mu-used-is-program-cost', 'mu-within-limit']));
  });

  it('a run with no run phase, a run left open across turns (6.1.1, 6.8)', () => {
    const s0 = executeAction(structuredClone(base), { type: 'GAIN_CREDIT', player: 'corp' });
    const s = structuredClone(s0);
    s.activeRun = { server: 'hq', phase: 'approach_server', accessOnly: false } as typeof s.activeRun;
    s.activePlayer = 'runner';
    s.corp.clicks = 0;
    expect(checkInvariants(s, s0, ids).failures.map(f => f.check)).toEqual(expect.arrayContaining(['run-phase-matches', 'run-closed-at-turn-end']));
  });

  it('a hand over its size as the turn passes (5.5.4)', () => {
    const s = structuredClone(base);
    s.corp.hq.push(...s.corp.rd.splice(0, 3));
    s.activePlayer = 'runner';
    s.corp.clicks = 0;
    expect(checkInvariants(s, base, ids).failures.map(f => f.check)).toContain('hand-size-at-discard-step');
  });
});
