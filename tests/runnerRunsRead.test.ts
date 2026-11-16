/**
 * Where the Runner has actually run (ai-threat-delete, 2026-11-16; brief-threat-delete.md rev 2, red team findings 1-2).
 * The Runner's runs are public: it announces the server it runs (rules 6.1.2a, 6.9.1a). A human who keeps running one
 * server should be read as running it again; self-play cannot show this hole (our Runner runs where its own scorer
 * says), so it is pinned here. Both pins are KNOWN-FAILING, and are owed to Stage D: the Corp reads where the Runner
 * will run and has run as an input to its counts, through the Runner's owner (registry row "Where the Runner will run").
 *
 * - Bugs #15 and #34, HQ: what the Corp stakes on HQ (iceValues serverStake) reads PACE shares only, not the runs the
 *   Runner made there. This fails on beta c5f0ac0 too: #34's HQ fix (Alarm Clock's free run, the run record on HQ) and
 *   the #15 last-turn patch fed only evaluate.ts centralExposure, which no game calls.
 * - Bug #34b, remotes: the run record (plan.runRecord, corpAI noteRuns; deleted) blended the remotes the Runner ran on its last turns into the
 *   threat's run chance. It passed on beta c5f0ac0 and fails since the threat was deleted: the one live thing
 *   ai-threat-delete gives up.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, actingSide, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { serverStake } from '../src/ai/iceValues';
import { withDiagnostics } from '../src/ai/diagnostics';
import { inDecision } from './helpers/pricing';
import { installCorpForTest, installIceForTest, newGame } from './helpers';

const PALISADE = '30072';
const OFFWORLD = '30067'; // Offworld Office, 4 to advance

/** Report #34 (Jeff's Runner test game 2) replayed to the Corp's first decision of `turn`. */
function report34(turn: number): GameState {
  const report = JSON.parse(readFileSync(new URL('./fixtures/human-games/report-34.json', import.meta.url), 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  for (const m of report.moves as GameAction[]) {
    const decision = s.activePlayer === 'corp' && s.corp.clicks > 0 && actingSide(s) === 'corp' && !s.pendingPrompts.length && m.type !== 'START_TURN';
    if (decision && s.turnNumber === turn) break;
    s = executeAction(s, m);
  }
  return s;
}

/**
 * The agenda in remote-1 as the deciding Corp prices it on the decision's first look (agendaWorth through stealOdds),
 * after `agent` has decided the turns before. Lower is a likelier steal.
 */
function remoteAgendaWorth(agent: HeuristicCorpAI, earlier: GameState[], s: GameState): number {
  for (const e of earlier) agent.chooseAction(e);
  return withDiagnostics(d => {
    let first: number | undefined;
    d.onValue = (_q, site, _state, value, args) => {
      // agendaWorth(counters, cost, points, serverId, success, ...): the remote's own steal odds (success undefined)
      if (first === undefined && site === 'agendaWorth' && args[3] === 'remote-1' && args[4] === undefined) first = value;
    };
    agent.chooseAction(s);
    return first!;
  });
}

/** Offworld Office in remote-1 behind a rezzed Palisade a broke Runner with no breaker can't pass, at the Corp's turn `turn`. */
function guardedRemote(turn: number, ranThere: boolean): GameState {
  const s = newGame(3);
  installIceForTest(s, PALISADE, 'remote-1');
  installCorpForTest(s, OFFWORLD, 'remote-1');
  s.runner.credits = 0;
  s.corp.credits = 2;
  s.turnNumber = turn;
  // A run that ended at the ice (unsuccessful: cardPlans' ranLastTurn reads successful runs only)
  s.runnerLastTurnRuns = ranThere ? [{ server: 'remote-1', successful: false } as GameState['runnerLastTurnRuns'][number]] : [];
  return s;
}

describe('the Corp reads where the Runner has actually run (Stage D debt; rules 6.1.2a, 6.9.1a)', () => {
  it.fails('known-failing, bugs #15 and #34 (HQ): after HQ runs on each of the Runner’s last four turns, the Corp stakes more on HQ than with no runs', () => {
    const s = report34(12);
    expect(s.runnerLastTurnRuns.some(r => r.server === 'hq')).toBe(true);
    const none = structuredClone(s);
    none.runnerLastTurnRuns = [];
    const ran = inDecision(s, 'corp', () => serverStake(s, s.corp.servers.hq));
    const never = inDecision(none, 'corp', () => serverStake(none, none.corp.servers.hq));
    expect(ran).toBeGreaterThan(never);
  });

  it.fails('known-failing, bug #34b (remotes), given up by ai-threat-delete: a remote the Runner ran on each of its last three turns is priced likelier to be run than the same remote never run', () => {
    // The Corp that watched three runs on remote-1 (turns 5, 7, 9) against one that saw none, on the same board at turn 11
    const watched = remoteAgendaWorth(new HeuristicCorpAI(), [5, 7, 9].map(t => guardedRemote(t, true)), guardedRemote(11, true));
    const fresh = remoteAgendaWorth(new HeuristicCorpAI(), [], guardedRemote(11, false));
    expect(watched).toBeLessThan(fresh);
  });
});
