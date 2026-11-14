/**
 * Bug report #43 (Jeff's Runner test game 11 vs the Normal Corp, Teia, 2026-11-09): "it didn't seem to know what to do ...
 * Afraid to rez ice or something despite having plenty of money". The Runner won 8-2.
 *
 * Turn 7: the Corp on 20 credits, the Runner on 5 points, HQ with no ice, and Mycoweb and Cloud Eater in HQ. Every ice
 * install ranked -Infinity and the Corp clicked to draw three times. The ice-pacing guard (corpAI installScore: no ice
 * the Corp can't afford to rez on top of the unrezzed ice already out) counted every unrezzed ice on the board: two
 * Attini (6 each) on remotes holding nothing or assets and the Mycoweb on R&D (8), 20 credits it never meant to spend,
 * so the board's own unrezzed ice locked out the ice HQ needed (Jeff: "that ICE just shouldn't count as protection
 * unless it CAN rez it"). plan.icePacingPriced dropped the guard while plan.ownIceKnown prices the ice; it cost about 7
 * points through over-icing, stayed parked off and was deleted in audit Step 3. Turn 7 stays pinned as known-failing.
 *
 * Turn 6 (plan.ownIceKnown, effectValues.ts): Fujii Asset Retrieval on 2 counters behind an unrezzed Attini, the Corp on
 * 20 credits; the Runner approached and the Corp passed (rules 6.9.2b-c: unrezzed ice is passed) and lost 3 points.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { HeuristicCorpAI } from '../src/ai';
import { rezCandidates } from '../src/ai/playout';
import { tuning } from '../src/ai/synergy';

const report = () => JSON.parse(readFileSync(new URL('./fixtures/human-games/report-43.json', import.meta.url), 'utf8'));

/** Game 11 replayed until `stop` says so. */
function replay(stop: (s: GameState, m: GameAction) => boolean): GameState {
  const r = report();
  let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  for (const m of r.moves as GameAction[]) {
    if (stop(s, m)) return s;
    s = executeAction(s, m);
  }
  throw new Error('position not reached');
}

/** The Corp's first main-phase decision of turn 7. */
const turn7 = () => replay((s, m) => s.turnNumber === 7 && s.activePlayer === 'corp' && s.corp.clicks > 0 && actingSide(s) === 'corp' && !s.pendingPrompts.length && m.type !== 'START_TURN');

/** The Runner approaching the Attini on Remote Server 1 at turn 6, the Corp to answer. */
const attini = () => replay(s => s.turnNumber === 6 && s.activePlayer === 'runner' && s.priority?.holder === 'corp' && s.priority.step === 'approach_ice' && !s.pendingPrompts.length);

const withSwitch = <T>(key: 'ownIceKnown', on: boolean, work: () => T): T => {
  const was = tuning.plan[key];
  tuning.plan[key] = on;
  try {
    return work();
  } finally {
    tuning.plan[key] = was;
  }
};

const iceInstalls = (s: GameState, server: string) =>
  new HeuristicCorpAI({ planner: false })
    .rankMainActions(s)
    .filter(r => r.action.type === 'INSTALL_CARD' && r.action.targetServerId === server && cardDef(findCardAnywhere(s, r.action.cardInstanceId)!).type_code === 'ice');

describe('game 11 (bug report #43): the Corp with money ices HQ and rezzes its ice', () => {
  it('turn 7: the position as Jeff met it (20 credits, HQ bare, the Runner on 5)', () => {
    const s = turn7();
    expect(s.corp.credits).toBe(20);
    expect(s.runner.score).toBe(5);
    expect(s.corp.servers.hq.ice).toHaveLength(0);
    expect(s.corp.hq.filter(c => cardDef(c).type_code === 'ice').length).toBeGreaterThanOrEqual(2);
  });

  // Known-failing pin (CLAUDE.md: Jeff's games stay pinned): the ice-pacing guard still blocks every HQ ice install here.
  // plan.icePacingPriced, which dropped the guard while ownIceKnown prices the ice, was parked off (about -7 points
  // through over-icing) and deleted in audit Step 3; the hole waits for ice pacing priced by the leaf.
  it.fails('turn 7: some ice install on HQ is playable (#43 open: every one ranks -Infinity)', { timeout: 60_000 }, () => {
    const ranked = iceInstalls(turn7(), 'hq');
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.some(r => Number.isFinite(r.score))).toBe(true);
  });

  it('turn 6: the Attini in front of Fujii Asset Retrieval (2 counters) is rezzed with plan.ownIceKnown; passed without it', { timeout: 60_000 }, () => {
    const pick = (on: boolean) =>
      withSwitch('ownIceKnown', on, () => {
        const s = attini();
        expect(s.activeRun!.server).toBe('remote-1');
        const cands = rezCandidates(s, 'approach_ice');
        expect(cands.map(c => cardDef(c).title)).toEqual(['Attini']);
        const rez = new HeuristicCorpAI({ synergy: true }).chooseRez(s, cands);
        return rez ? cardDef(findCardAnywhere(s, (rez as { cardInstanceId: string }).cardInstanceId)!).title : 'pass';
      });
    expect(pick(true)).toBe('Attini');
    expect(pick(false)).toBe('pass');
  });
});
