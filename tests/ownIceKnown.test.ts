/**
 * Bug reports #39 and #41 (Jeff's Runner test games 7 and 9 vs the Normal Corp, 2026-11-09): "poor decisions in a server
 * I could clearly breach", "putting agendas behind ICE he couldn't rez". Game 9 turn 16, the Runner on 6: Send a Message
 * (3 points, the game) went into Remote 2 behind an unrezzed Pharos (rez 7, the Corp on 6 credits) and a Flyswatter
 * Unity breaks for a credit.
 *   3.4.3a: "Unlike assets and upgrades, ice can normally only be rezzed while being approached during a run."
 *   6.9.2b-c: the Corp can rez the approached ice; if it is not rezzed the run proceeds past it (Movement Phase).
 * The Corp knows its own ice and credits, so ice it can't pay for is passed and ice it can is the real ice against the
 * rig. The leaf priced both by the Runner-side unrezzed pass rates (stealOdds 0.30 here). plan.ownIceKnown prices them
 * as the Corp knows them (reach.ts knownIce, the copy plan.reachStrength had inside the OFF plan.reach).
 * What this pins is the pricing: at both positions the planner still installs the agenda (its continuation installs
 * whenever one can go in: search shape, handed to the search thread).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, findCardAnywhere, getLegalActions } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { runSuccess, stealOdds } from '../src/ai/effectValues';
import { tuning } from '../src/ai/synergy';
import { inDecision } from './helpers/pricing';

/** Jeff's game (bug report `n`) replayed to the Corp's first main-phase decision of turn `turn`. */
function corpTurn(n: number, turn: number): GameState {
  const report = JSON.parse(readFileSync(new URL(`./fixtures/human-games/report-${n}.json`, import.meta.url), 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  for (const m of report.moves as GameAction[]) {
    if (s.turnNumber === turn && s.activePlayer === 'corp' && s.corp.clicks > 0 && actingSide(s) === 'corp' && !s.pendingPrompts.length && m.type !== 'START_TURN') break;
    s = executeAction(s, m);
  }
  return s;
}

/** The position after the Corp installs `title` into `server`. */
function installed(n: number, turn: number, title: string, server: string): GameState {
  const s = corpTurn(n, turn);
  const install = getLegalActions(s, 'corp').find(a => a.type === 'INSTALL_CARD' && a.targetServerId === server && cardDef(findCardAnywhere(s, a.cardInstanceId)!).title === title)!;
  return executeAction(s, install);
}

const withSwitch = <T>(on: boolean, work: () => T): T => {
  const was = tuning.plan.ownIceKnown;
  tuning.plan.ownIceKnown = on;
  try {
    return work();
  } finally {
    tuning.plan.ownIceKnown = was;
  }
};

const odds = (on: boolean, s: GameState, server: string) =>
  withSwitch(on, () => {
    const fresh = structuredClone(s);
    return {
      steal: inDecision(fresh, 'corp', () => stealOdds(fresh, server)),
      success: inDecision(fresh, 'corp', () => runSuccess(fresh, server)),
    };
  });

describe('the Corp prices its own unrezzed ice as it knows it (plan.ownIceKnown, rules 3.4.3a, 6.9.2b-c)', () => {
  it('report #41 turn 16: Send a Message behind a Pharos it can’t rez and a Flyswatter the rig breaks is a sure steal', () => {
    const s = installed(41, 16, 'Send a Message', 'remote-2');
    expect(s.corp.credits).toBeLessThan(7); // Pharos rezzes for 7
    expect(odds(true, s, 'remote-2').steal).toBeGreaterThan(0.95);
    expect(odds(false, s, 'remote-2').steal).toBeLessThan(0.4);
  });

  it('report #41 turn 16: HQ’s three ice, the ones the budget covers priced as the real ice, keep the Runner out more', () => {
    const s = installed(41, 16, 'Send a Message', 'remote-2');
    expect(odds(true, s, 'hq').success).toBeLessThan(odds(false, s, 'hq').success);
  });

  it('report #39 turn 8: on 2 credits the unrezzed Tatu-Bola behind the rezzed Boto is passed', () => {
    const s = installed(39, 8, 'Sericulture Expansion', 'remote-1');
    expect(odds(true, s, 'remote-1').success).toBeGreaterThan(odds(false, s, 'remote-1').success);
  });

  it('with no unrezzed ice nothing changes', () => {
    const s = installed(41, 16, 'Send a Message', 'remote-2');
    expect(odds(true, s, 'archives')).toEqual(odds(false, s, 'archives'));
  });
});
