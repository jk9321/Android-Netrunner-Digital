/**
 * Jeff's game #51 (2026-11-13, report-51.json): "Corp let me pass installed ICE it could afford to steal the game
 * winning agendas from R&D." T12, the Runner on 5 points with 6 credits runs R&D past Paywall and two unrezzed N-Pots;
 * the Corp has 4 credits, N-Pot rezzes for 4 and its three ETR subroutines need 9 credits of the Runner's breakers.
 *   1.7.2a: "A player with a score of 7 or more wins the game."
 *   6.9.2b-c: the Corp can rez the approached ice; if it is not rezzed the run proceeds past it.
 * countedRez had no opinion (R4 is off with an agenda in HQ) and modelRez priced the steal at 5.70 against 22.8 for
 * 4 credits. plan.matchPointRez (spec-match-point-rez.md E1): a rez that stops a run which can win the game is made.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { agendasUnseen, countedRez, matchPoint, rdAgendaOdds, reachablePoints } from '../src/ai/rezModel';
import { tuning } from '../src/ai/synergy';

/** Jeff's game #51 replayed to before move `n` (#222: approaching the outer N-Pot, #219: Paywall). */
function at(n: number): GameState {
  const report = JSON.parse(readFileSync(new URL('./fixtures/human-games/report-51.json', import.meta.url), 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  for (const m of (report.moves as GameAction[]).slice(0, n)) s = executeAction(s, m);
  return s;
}

const approached = (s: GameState) => s.corp.servers[s.activeRun!.server].ice[s.activeRun!.icePosition!];

const withSwitch = <T>(on: boolean, work: () => T): T => {
  const was = tuning.plan.matchPointRez;
  tuning.plan.matchPointRez = on;
  try {
    return work();
  } finally {
    tuning.plan.matchPointRez = was;
  }
};

describe('rez at match point (game #51)', () => {
  it('#222: the Corp rezzes the N-Pot that stops the game-winning R&D run', () => {
    const s = at(222);
    const ice = approached(s);
    expect(cardDef(ice).title).toBe('N-Pot');
    expect(s.runner.score).toBe(5);
    expect(reachablePoints(s)).toBeGreaterThanOrEqual(2);
    expect(matchPoint(s, ice)).toBe(true);
    const rez = withSwitch(true, () => createAgent('corp', 'normal').chooseRez!(s, [ice]));
    expect(rez).toMatchObject({ type: 'REZ_CARD', cardInstanceId: ice.instanceId });
    const after = executeAction(s, rez!);
    expect(after.corp.servers.rd.ice[1].isRezzed).toBe(true);
    // The hole: with the rule off the Corp passes, as in the game
    expect(withSwitch(false, () => createAgent('corp', 'normal').chooseRez!(s, [ice]))).toBeNull();
  });

  it('#219: Paywall alone only tolls, and with it rezzed N-Pot is out of reach, so no opinion', () => {
    const s = at(219);
    expect(cardDef(approached(s)).title).toBe('Paywall');
    expect(matchPoint(s, approached(s))).toBe(false);
  });

  it('no opinion off match point, or when the Runner can pay through', () => {
    const s = at(222);
    const ice = approached(s);
    expect(matchPoint({ ...s, runner: { ...s.runner, score: 2 } }, ice)).toBe(false);
    expect(matchPoint({ ...s, runner: { ...s.runner, credits: 30 } }, ice)).toBe(false);
  });

  it("never reads R&D's order (10.2.2a): R&D reversed gives the same answers", () => {
    const s = at(222);
    const flipped = structuredClone(s);
    flipped.corp.rd.reverse();
    const ice = approached(s);
    expect(reachablePoints(flipped)).toBe(reachablePoints(s));
    expect(withSwitch(true, () => [matchPoint(flipped, ice), countedRez(flipped, ice)])).toEqual(withSwitch(true, () => [matchPoint(s, ice), countedRez(s, ice)]));
  });

  it("E2: R&D's odds by the Corp's own list are 5 agendas in 22 cards at #222, whatever R&D's order", () => {
    const s = at(222);
    expect(s.corp.rd.length).toBe(22);
    expect(agendasUnseen(s)).toBe(5);
    expect(rdAgendaOdds(s).odds).toBeCloseTo(5 / 22, 6);
    const flipped = structuredClone(s);
    flipped.corp.rd.reverse();
    expect(rdAgendaOdds(flipped)).toEqual(rdAgendaOdds(s));
  });
});
