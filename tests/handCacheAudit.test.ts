/**
 * Audit Step 2 (AI-CACHE-HIDDEN-STATE, spec /mnt/project-files/netrunner-ai/audit-fixes/spec-step2-cache-state.md;
 * findings in step2-cache-findings.md there). Three module maps keep keys that leave out part of what their value reads:
 * handValues clickWorth (the board), handValues drawWorth (what R&D, Archives, the grip and the heap hold, installed
 * cards' counters and hosts, the run under way) and effectValues damageThreat (which cards are out of the pool, not only
 * how many). Exact keys cost the Corp +19-50% decision time, so they stay as known debt (Step 4/5: exact hand-value keys
 * and the Runner's stack priced once per decision), and each map is kept to one game (valueModel scopeToGame).
 *
 * 1. Scoping: a deal plays the same after other games in the process as alone. Before, deal 2181 after its g3 shard's
 *    earlier deals answered a Corp prompt on turn 9 differently (batch identity 218 of 221; scripts/cache-bisect.ts).
 *    Here a short deal runs before a fixed stretch of another and that stretch's actions must not change.
 * 2. Debt pin: with each map's on-hit audit on (every hit worked out again on the asking board), the wrong hits on fixed
 *    deals stay at or under today's count (a short stretch, so the fast checks stay fast). They may only go down: lower the pins when a fix lands.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GameAction, cardDef, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from '../scripts/nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { clearHandCaches, clickAudit, clickWorth, drawAudit } from '../src/ai/handValues';
import { threatsAudit } from '../src/ai/effectValues';

const audits = { click: clickAudit, draw: drawAudit, threat: threatsAudit };

afterEach(() => {
  for (const a of Object.values(audits)) a.on = false;
});

/** The first `actions` actions of a batch deal (seed 1001 + 10 * pairing), Normal v Normal. */
function play(seed: number, actions: number): string[] {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  valueLoops.clear();
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const out: string[] = [];
  for (let i = 0; i < actions && game.step(); i++) out.push(JSON.stringify(game.last as GameAction | null));
  return out;
}

describe('hand-value maps: kept to one game', () => {
  // clickWorth's key (game, turn, clicks, credits, hand) used to leave out the board, so a second board of the same turn
  // was served the first one's value, unless the map was emptied at its size cap in between. Before the scoping, how full
  // the map was from earlier games decided that: here 2,000 boards of another game fill it to its cap first.
  it("another game's entries don't change which value a hit serves", () => {
    const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
    const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
    const deal = (seed: number) => {
      const p = Math.floor((seed - 1001) / 10);
      return createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length]));
    };
    const other = deal(1001);
    // Deal 2181 after both mulligans: the Corp's first turn
    const game = new GameRunner(deal(2181), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
    game.step();
    game.step();
    const b1 = game.state;
    // The same turn, clicks, credits and hand, with an R&D ice installed on HQ: another board, the same key
    const b2 = structuredClone(b1);
    const at = b2.corp.rd.findIndex(c => cardDef(c).type_code === 'ice');
    b2.corp.servers.hq.ice.push(...b2.corp.rd.splice(at, 1));
    const between = { ...b1, corp: { ...b1.corp, credits: b1.corp.credits + 1 } };
    const served = (prefill: boolean): number => {
      clearHandCaches();
      if (prefill) for (let i = 0; i < 2000; i++) clickWorth({ ...other, corp: { ...other.corp, credits: i } }, 'corp');
      clickWorth(b1, 'corp');
      clickWorth(between, 'corp');
      return clickWorth(b2, 'corp');
    };
    expect(served(true)).toBe(served(false));
  }, 120_000);
});

describe("clickWorth's key holds the board", () => {
  // Two boards with the same game, turn, clicks, credits and hand (the old key) but another ice installed: each is priced
  // on its own board, whichever was asked first (tests/threatCacheAudit deal 1421 served such a stale click worth)
  it('a second board with the same old key is priced on its own board', () => {
    const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
    const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
    const p = Math.floor((2181 - 1001) / 10);
    const game = new GameRunner(createInitialGameState(deckGameSetup(2181, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
    game.step();
    game.step();
    const b1 = game.state;
    const b2 = structuredClone(b1);
    const at = b2.corp.rd.findIndex(c => cardDef(c).type_code === 'ice');
    b2.corp.servers.hq.ice.push(...b2.corp.rd.splice(at, 1));
    clearHandCaches();
    const alone = clickWorth(b2, 'corp');
    clearHandCaches();
    const first = clickWorth(b1, 'corp');
    expect(first).not.toBe(alone);
    expect(clickWorth(b2, 'corp')).toBe(alone);
  }, 120_000);
});

/** Wrong hits per map on the first `actions` actions of a deal (on-hit audits on). */
function audit(seed: number, actions: number) {
  for (const a of Object.values(audits)) Object.assign(a, { on: true, checked: 0, mismatches: 0, errors: [] });
  play(seed, actions);
  for (const a of Object.values(audits)) a.on = false;
  // A click worth summed in another order (the Runner's planner view deals its stack in another order, ai-runner-draws)
  // differs in the last bits only: not a wrong hit
  const wrong = (k: string, a: { mismatches: number; errors: number[] }) => (k === 'click' ? a.errors.filter(e => e > 1e-9).length : a.mismatches);
  return Object.fromEntries(Object.entries(audits).map(([k, a]) => [k, { checked: a.checked, wrong: wrong(k, a) }]));
}

describe('hand-value maps: known wrong hits may only go down (on-hit audit)', () => {
  // Pins measured on the branch after Step 1 (2026-11-14): 2181's first 25 actions checked about 3.3k, 15.8k and 52k
  // hits (about 6 s; this file runs in the fast checks), with 1855 and 176 wrong for click and threat. With the board in
  // clickWorth's key (ai-runner-draws): 1.6k, 11.2k and 43.6k checked, 0 and 124 wrong. drawWorth has no wrong hit this early, so its pin is 0: any
  // new wrong hit fails. The whole-deal rates are in step2-cache-findings.md; measure longer stretches with
  // scripts/cache-audit.ts. A fix that makes a key more complete lowers these: update the pin.
  const PINS: Record<number, { actions: number; click: number; draw: number; threat: number }> = {
    2181: { actions: 25, click: 0, draw: 0, threat: 124 },
  };
  for (const [seed, pin] of Object.entries(PINS)) {
    it(`deal ${seed}, first ${pin.actions} actions`, () => {
      const r = audit(Number(seed), pin.actions);
      expect(r.click.checked).toBeGreaterThan(50);
      expect(r.draw.checked).toBeGreaterThan(50);
      expect(r.threat.checked).toBeGreaterThan(50);
      expect(r.click.wrong, JSON.stringify(r)).toBeLessThanOrEqual(pin.click);
      expect(r.draw.wrong, JSON.stringify(r)).toBeLessThanOrEqual(pin.draw);
      expect(r.threat.wrong, JSON.stringify(r)).toBeLessThanOrEqual(pin.threat);
    }, 60_000);
  }
});
