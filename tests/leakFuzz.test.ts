import { describe, expect, it } from 'vitest';
import { ALL_DECKS } from '../scripts/nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../src/data/testDecks/nrdb';
import { fuzzGame } from '../scripts/leak-check';
import { fuzzTwinGame, twinCompare } from '../scripts/leak-check-twin';
import { StopLevel, actingSide, createCardInstance, executeAction, getLegalActions, newViewIds, viewFor } from '../src/core';
import { newGame, startRunnerTurn } from './helpers';

// Leak fuzzer, short version (the full one is scripts/leak-fuzz.ts): random legal moves on fixed
// seeds, both players' views checked after every action (src/core/view.ts, multiplayer phase 1).
const decks = [...ALL_DECKS, ...NRDB_TEST_DECKS];
const corps = decks.filter(d => d.side === 'corp');
const runners = decks.filter(d => d.side === 'runner');

describe('Leak fuzzer', () => {
  it('12 random games: no view holds a card its side may not see', () => {
    const failures = [];
    for (let g = 0; g < 12; g++) {
      const res = fuzzGame(700 + g, corps[(g * 7) % corps.length], runners[(g * 5 + 3) % runners.length], 'random', 300);
      failures.push(...res.failures);
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it('4 random games with the screen\'s checks: reconstructions hold nothing hidden, the seat agrees with the engine', () => {
    const failures = [];
    for (let g = 0; g < 4; g++) {
      const res = fuzzGame(800 + g, corps[(g * 3) % corps.length], runners[(g * 5 + 1) % runners.length], 'random', 250, true);
      failures.push(...res.failures);
      expect(res.stats.probeDisagreements).toEqual([]);
    }
    expect(failures).toEqual([]);
  }, 60_000);
});

// Twin-state check (multiplayer phase 2, chunk 2a): the blind side's views must not change shape with a card it can't
// see. Rules 4.2.2 (R&D is hidden from both players) and 7.1.2 (the Corp may not look at a card accessed from R&D).
const HEDGE_FUND = '30075'; // operation
const NICO = '30037'; // asset with a trash cost
const MELIES_LINE = '36026'; // Méliès City Luxury Line: an agenda that costs a click to steal

/** Runs on R&D with `top` and `second` on top, steps (passing, continuing) to the action that accesses the top card. */
function beforeAccess(top: string, second: string, runnerStops: StopLevel, clicks = 4) {
  let s = newGame(5);
  s.stops = { corp: 'full', runner: runnerStops };
  s.corp.rd.unshift(createCardInstance(s, top), createCardInstance(s, second));
  startRunnerTurn(s);
  s.runner.clicks = clicks;
  s.runner.credits = 10;
  s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'rd' });
  for (let i = 0; i < 40; i++) {
    const side = actingSide(s)!;
    const action = getLegalActions(s, side).find(a => (a.type === 'PASS' && !('restOfRun' in a && a.restOfRun)) || a.type === 'CONTINUE_RUN');
    if (!action) throw new Error(`stuck: ${JSON.stringify(s.pendingPrompts[0] ?? s.priority)}`);
    const next = executeAction(s, action);
    if (next.log.slice(s.log.length).some(e => e.event === 'access')) return { s, action, next };
    s = next;
  }
  throw new Error('no access');
}

function twinOfTop(top: string, second: string, runnerStops: StopLevel, clicks?: number) {
  const { s, action, next } = beforeAccess(top, second, runnerStops, clicks);
  const ids = viewFor(s, 'corp', newViewIds(), 'g').ids;
  return twinCompare(s, action, next, ids, 'corp', s.corp.rd[0].instanceId, s.corp.rd[1].instanceId);
}

describe('Twin-state check', () => {
  it('an R&D access of an agenda the Runner cannot steal leaves no gap in the Corp\'s log (4.2.2, 7.1.2)', () => {
    // One click: the run spends it, so Méliès City Luxury Line's extra click to steal can't be paid
    expect(twinOfTop(HEDGE_FUND, MELIES_LINE, 'ai', 1)).toMatchObject({ kind: 'same' });
  });

  it('with the Runner\'s stops at full, an R&D access of a trashable card looks the same to the Corp as an operation (4.2.2, 7.1.2)', () => {
    expect(twinOfTop(HEDGE_FUND, NICO, 'full')).toMatchObject({ kind: 'same' });
  });

  it('20 random games with stops at full: same-shaped views for twins that differ only in hidden cards', () => {
    const failures = [];
    let compared = 0;
    for (let g = 0; g < 20; g++) {
      const res = fuzzTwinGame(900 + g, corps[(g * 7) % corps.length], runners[(g * 5 + 3) % runners.length], 250);
      failures.push(...res.failures);
      compared += res.twin.compared;
    }
    expect(failures).toEqual([]);
    expect(compared).toBeGreaterThan(1000);
  }, 60_000);
});
