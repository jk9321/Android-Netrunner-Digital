import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { BLOCK, iceCost, iceCreditNeed, plannedSubroutines, runScore } from '../src/ai/runs';
import { CARDS } from '../src/ai/cards';
import { iceSubroutines } from '../src/core/engine/ice';
import { installIceForTest, installProgramForTest, newGame, runIntoFirstIce, startRunnerTurn } from './helpers';

/**
 * Starlit Knight (34053), Jeff's human game as Corp, 2026-11-09: "Threat 4 -> When the Runner encounters this ice,
 * it gains X 'End the run.' subroutines for the remainder of this run, after its other subroutines. X is equal to the
 * number of tags the Runner has." Subroutines: Give the Runner 1 tag (twice).
 * Rules: the threat N flag is active only at threat level >= N (9.3.6f), threat level = the greatest score (1.17.1a);
 * subroutines an ability gains "after its other subroutines" come after the printed ones (9.8.3e).
 * The engine adds the X subroutines only once the encounter starts, so the Runner AI priced the run against the two
 * printed tag subroutines and ran into it tagged. runs.ts plannedSubroutines adds the ones it would gain.
 */
const STARLIT = '34053';

/** Jeff's game 14 (bug report #32, Nebula vs MuslihaT, hard Runner) replayed to just before move `at`. */
function game14(at: number): GameState {
  const report = JSON.parse(readFileSync(new URL('./fixtures/human-games/report-32.json', import.meta.url), 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const moves = report.moves as GameAction[];
  for (let i = 0; i < at; i++) s = executeAction(s, moves[i]);
  return s;
}
const CARMEN = '30015';

function knight(tags: number, threat: number): { s: GameState; ice: string } {
  const s = newGame();
  startRunnerTurn(s);
  const ice = installIceForTest(s, STARLIT, 'hq');
  s.runner.score = threat;
  s.runner.tags = tags;
  s.runner.credits = 5;
  return { s, ice };
}
const card = (s: GameState, id: string) => s.corp.servers.hq.ice.find(c => c.instanceId === id)!;
const labels = (s: GameState, id: string) => plannedSubroutines(s, card(s, id)).map(sub => sub.label);

describe('Runner AI reads Starlit Knight as it will be met', () => {
  it('at threat 4 the Runner plans for one "End the run." per tag, after the printed tag subroutines (9.8.3e)', () => {
    const { s, ice } = knight(2, 4);
    expect(iceSubroutines(s, card(s, ice))).toHaveLength(2); // the engine: printed only, before the encounter
    const subs = labels(s, ice);
    expect(subs).toHaveLength(4);
    expect(subs.slice(2).every(l => /^end the run\.?$/i.test(l.trim()))).toBe(true);
  });

  it('no gained subroutines below threat 4 (9.3.6f) or with no tags', () => {
    expect(labels(knight(2, 3).s, knight(2, 3).ice)).toHaveLength(2);
    const untagged = knight(0, 4);
    expect(labels(untagged.s, untagged.ice)).toHaveLength(2);
  });

  it('with no killer the tagged Runner reads it as a wall; untagged it is just tags', () => {
    const tagged = knight(2, 4);
    expect(iceCreditNeed(tagged.s, card(tagged.s, tagged.ice))).toBe(BLOCK);
    expect(iceCost(tagged.s, card(tagged.s, tagged.ice))).toBe(BLOCK);
    const untagged = knight(0, 4);
    expect(iceCreditNeed(untagged.s, card(untagged.s, untagged.ice))).toBe(0);
    const low = knight(2, 3);
    expect(iceCreditNeed(low.s, card(low.s, low.ice))).toBe(0);
  });

  it('with a killer the price of getting through is the 2 "End the run." subroutines', () => {
    const { s, ice } = knight(2, 4);
    installProgramForTest(s, CARMEN);
    const need = iceCreditNeed(s, card(s, ice));
    expect(need).toBeGreaterThan(0);
    expect(need).toBeLessThan(BLOCK);
  });

  it('the run score for HQ falls against the tagged Runner, compared with reading the printed subroutines only', () => {
    const { s } = knight(2, 4);
    const entry = CARDS[STARLIT];
    const hook = entry.gainsOnEncounter;
    const withHook = runScore(s, 'hq');
    try {
      delete entry.gainsOnEncounter;
      expect(runScore(s, 'hq')).toBeGreaterThan(withHook);
    } finally {
      entry.gainsOnEncounter = hook;
    }
  });

  it('once the encounter has started they are not counted twice', () => {
    const { s } = knight(2, 4);
    const t = runIntoFirstIce(s, 'hq');
    const ice = t.corp.servers.hq.ice[0];
    expect(t.activeRun?.encounter?.iceId).toBe(ice.instanceId);
    expect(iceSubroutines(t, ice)).toHaveLength(4);
    expect(plannedSubroutines(t, ice)).toHaveLength(4);
  });

  // The bug as Jeff saw it: turn 13 (5 tags, threat 6, 22 credits, no killer) and turn 14 (8 tags) the Runner ran the
  // remote behind the rezzed Starlit Knight and the run ended on its gained subroutines. Replayed, it now runs elsewhere.
  for (const [turn, at, tags] of [[13, 199, 5], [14, 233, 8]] as const) {
    it(`game 14 turn ${turn}: with ${tags} tags it does not run into the rezzed Starlit Knight`, () => {
      const s = game14(at);
      expect(s.turnNumber).toBe(turn);
      expect(s.runner.tags).toBe(tags);
      const ice = s.corp.servers['remote-2'].ice[0];
      expect(ice.cardCode === STARLIT && ice.isRezzed).toBe(true);
      expect(plannedSubroutines(s, ice)).toHaveLength(2 + tags);
      expect(iceCreditNeed(s, ice)).toBe(BLOCK);
      const action = new HeuristicRunnerAI({ planner: true }).chooseAction(s);
      expect(action.type === 'INITIATE_RUN' && action.targetServerId === 'remote-2').toBe(false);
    });
  }
});
