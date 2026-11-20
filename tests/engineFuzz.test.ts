import { describe, expect, it } from 'vitest';
import { FUZZ_CORPS, FUZZ_DECKS, FUZZ_RUNNERS, checkInvariants, cardsByZone, fuzzEngineGame, pairing, summaryLine } from '../scripts/engine-fuzz-check';
import { createInitialGameState, executeAction, getLegalActions } from '../src/core';
import { rdShuffleProbe } from '../src/core/engine/rdKnowledge';
import { deckGameSetup } from '../src/data/decks';
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

// Seeds the deep run (Actions run 43567426403, beta 92f5c96) failed on, one per kind: memory over the limit (3.9.3c),
// a sabotage with no legal answer (10.12.3b), Tucana offering a new remote under A Teia (1.2.2), Detente's access on the
// Corp's turn (a legal state the check flagged), two Cupellations paid with 1 credit (1.16.1)
const DEEP_SEEDS: [number, string, string][] = [
  [1000072681, 'hb-precision-design', 'nrdb-rising-tide'],
  [1000074432, 'nrdb-wage-working', 'core-bowel-movements'],
  [1000024823, 'lib-a-teia-startup', 'vp-sourdough-starter'],
  [1000003900, 'vp-zwift-deth', 'core-dashing-mad'],
  [1000022624, 'lib-built-to-launch', 'lib-trick-shot-zahya'],
];

describe('Engine fuzzer, seeds the deep run failed on', () => {
  it.each(DEEP_SEEDS)('seed %i, %s vs %s', (seed, corp, runner) => {
    const deck = (id: string) => FUZZ_DECKS.find(d => d.id === id)!;
    const res = fuzzEngineGame(seed, deck(corp), deck(runner), { maxSteps: 500 });
    expect(res.failures.length ? summaryLine(res) : '').toBe('');
  }, 30_000);
});

// Seeds the deep run of 2026-11-20 (Actions run 44736659830, beta 062dd0f0) failed on, each played a few steps past
// its failing step: a make-room prompt with no answer, the trash pricing Principia out of reach (1.14.5, 8.5.6c; Madani,
// Arissana), a program hosted on Muse trashed twice with its host (4.1.1c, 1.13.13), and Scrounge's second question
// listing a program Muse's search had just installed (9.6.5a). Unit tests: tests/makeRoom.test.ts.
const DEEP_SEEDS_1120: [number, string, string, number][] = [
  [1120134654, 'core-brick-stack', 'nrdb-rising-tide', 190],
  [1120109228, 'nrdb-big-hands', 'nrdb-tadpole-of-wealth', 270],
  [1120169013, 'core-gimbatul', 'lib-bright-eyes', 85],
  [1120113068, 'nrdb-big-hands', 'nrdb-tadpole-of-wealth', 245],
  [1120075505, 'lib-response-rush-nuvem', 'lib-tao-s-angels', 185],
];

describe('Engine fuzzer, seeds the 2026-11-20 deep run failed on', () => {
  it.each(DEEP_SEEDS_1120)('seed %i, %s vs %s', (seed, corp, runner, steps) => {
    const deck = (id: string) => FUZZ_DECKS.find(d => d.id === id)!;
    const res = fuzzEngineGame(seed, deck(corp), deck(runner), { maxSteps: steps });
    expect(res.failures.length ? summaryLine(res) : '').toBe('');
  }, 30_000);
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

// Nightly run 43914434290 (2026-11-16): 37 games failed corp-rd-memory-forgets-shuffle because the probe counted
// shuffles made only while checking legality (isLegalAction runs each candidate move on the state). The Corp kept
// its memory rightly: R&D was never shuffled in the game (rules 4.2.2, 8.7.3 apply to a shuffle that happened).
describe('Engine fuzzer R&D shuffle probe', () => {
  it('a shuffle tried only in a legality check is not counted', () => {
    const corp = FUZZ_DECKS.find(d => d.id === 'nrdb-big-hands')!;
    const runner = FUZZ_DECKS.find(d => d.id === 'nrdb-bypass-orris-bypass')!;
    const s = createInitialGameState(deckGameSetup(2077302628, corp, runner));
    const shuffles = rdShuffleProbe.shuffles;
    const legal = getLegalActions(s, 'corp'); // the Corp's mulligan, offered here, shuffles R&D
    expect(legal.length).toBeGreaterThan(0);
    expect(rdShuffleProbe.shuffles).toBe(shuffles);
    expect(rdShuffleProbe.trial).toBe(0);
  });

  it('nightly seed 2077302628 (Big Hands, Corp keeps its R&D memory) passes', () => {
    const corp = FUZZ_DECKS.find(d => d.id === 'nrdb-big-hands')!;
    const runner = FUZZ_DECKS.find(d => d.id === 'nrdb-bypass-orris-bypass')!;
    const res = fuzzEngineGame(2077302628, corp, runner, { maxSteps: 130 });
    expect(res.failures).toEqual([]);
  });

  it('seed 2077300668: Oracle Thinktank declared while the Runner holds priority is checked on a copy, not counted', () => {
    const corp = FUZZ_DECKS.find(d => d.id === 'nrdb-big-hands')!;
    const runner = FUZZ_DECKS.find(d => d.id === 'lib-bright-eyes')!;
    const res = fuzzEngineGame(2077300668, corp, runner, { maxSteps: 230 });
    expect(res.failures).toEqual([]);
  });
});
