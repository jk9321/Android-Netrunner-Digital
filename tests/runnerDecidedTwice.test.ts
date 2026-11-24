import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, activePrompt, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { Agent } from '../src/ai/agent';
import { GameRunner } from '../src/ai/playout';

/**
 * Issues #58 and #59 (Jeff's saved games, tests/fixtures/runner-facts/issues/): a run priced for something the decision
 * inside the run then declines (#58) or cannot pay (#59). Brief runner-rework/briefs/pins-58-59.md; the mechanisms were
 * verified by the A-log (specs/r-a-log-note.md, L13 and L14). The fix belongs to the Runner rework's R-B, so each issue is
 * pinned as a known failure (`it.fails`) beside a twin that passes today.
 *
 * Each board is the saved game replayed move by move up to the Runner's first run of the turn; the Runner under test is
 * a fresh Normal Runner that watched every board of the replay (observe, its own memory only, no hidden information),
 * and the turn is played forward by GameRunner with a Normal Corp. The pins state behaviour over the played turns, not a
 * value of runScore, so the fix may sit in the run's price, in the decision inside the run, or in one place for both.
 * Boards are edited on a structuredClone before GameRunner asks anything of them.
 */

interface Saved {
  config: { seed: number; corpDeck: never; runnerDeck: never };
  startStops?: GameState['stops'];
  moves: GameAction[];
}
const saved = (n: number): Saved => JSON.parse(readFileSync(new URL(`./fixtures/runner-facts/issues/issue-${n}.json`, import.meta.url), 'utf8'));

/** The saved game at the Runner's first run of `turn`, and a Normal Runner that watched every board up to it. */
function boardAt(n: number, turn: number): { state: GameState; runner: Agent } {
  const r = saved(n);
  let s = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  // observe: the Normal Runner's memory of what it has seen (runnerAI.ts), not on the Agent interface
  const runner = createAgent('runner', 'normal') as Agent & { observe?: (s: GameState) => void };
  for (const move of r.moves) {
    if (s.turnNumber === turn && s.activePlayer === 'runner' && move.type === 'INITIATE_RUN') return { state: structuredClone(s), runner };
    runner.observe?.(s);
    s = executeAction(s, move);
  }
  throw new Error(`issue ${n}: no Runner run in turn ${turn}`);
}

/** Plays forward from the board until the turn `last` ends, calling `see` with each Runner action and the state before it. */
function play(state: GameState, runner: Agent, last: number, see: (a: GameAction, before: GameState, after: GameState) => void): GameState {
  const g = new GameRunner(state, { runner, corp: createAgent('corp', 'normal') });
  for (let k = 0; k < 4000 && g.state.turnNumber <= last && !g.state.winner; k++) {
    const before = g.state;
    g.step();
    if (g.last?.player === 'runner') see(g.last, before, g.state);
  }
  return g.state;
}

// ------------------------------------------------------------------------------------------------ #59
// LEO Construction, remote-1 behind Brân 1.0 (3 clicks to break by its bioroid ability) and Bumi 1.0 (2 clicks). With 4
// clicks at turn start the run's click leaves 3: the Runner spends 2 clicks on bioroid breaks, then jacks out (T7, T8,
// T10 of the saved game).
const REMOTE = 'remote-1';
/** The runs on remote-1 played from this board to the end of the turn: bioroid clicks spent, and how each ended. */
function remoteRuns(n: number, turn: number, edit?: (s: GameState) => void) {
  const { state, runner } = boardAt(n, turn);
  if (edit) edit(state);
  const runs: { breaks: number; ended: 'jackedOut' | 'successful' | 'other' }[] = [];
  let open: (typeof runs)[number] | null = null;
  play(state, runner, turn, (a, before, after) => {
    if (a.type === 'INITIATE_RUN' || (!before.activeRun && after.activeRun)) {
      open = after.activeRun?.server === REMOTE ? { breaks: 0, ended: 'other' } : null;
      if (open) runs.push(open);
    }
    if (!open) return;
    if (a.type === 'BIOROID_BREAK') open.breaks++;
    if (a.type === 'JACK_OUT') open.ended = 'jackedOut';
    if (!after.activeRun && after.runsThisTurn.some(x => x.server === REMOTE && x.successful)) open.ended = open.ended === 'jackedOut' ? 'jackedOut' : 'successful';
    if (!after.activeRun) open = null;
  });
  return runs;
}

describe('issue #59: a run priced past two bioroids by more clicks than are left', () => {
  // Setup, state only (an `it.fails` also passes on a thrown error, so the boards are checked apart from the pin)
  it('#59 setup: at T7, T8 and T10 remote-1 is behind two rezzed ice and the Runner has 4 clicks', () => {
    for (const turn of [7, 8, 10]) {
      const { state } = boardAt(59, turn);
      expect(state.corp.servers[REMOTE].ice.filter(c => c.isRezzed).length, `turn ${turn}`).toBe(2);
      expect(state.runner.clicks, `turn ${turn}`).toBe(4);
    }
  });

  // Passes when the Runner does not start a run on remote-1 that it then abandons after paying bioroid clicks: it
  // prices the bioroids' clicks together (the fix's place is R-B's choice), so it either gets in or does not run
  it.fails('#59 T7, T8, T10: the Runner does not spend clicks on Brân and Bumi and then jack out', { timeout: 60_000 }, () => {
    for (const turn of [7, 8, 10]) {
      const runs = remoteRuns(59, turn);
      expect(
        runs.filter(r => r.breaks > 0 && r.ended === 'jackedOut'),
        `turn ${turn}`
      ).toEqual([]);
    }
  });

  // Twin: the same T7 board with the 2 clicks the price assumed (6 at turn start): the Runner runs remote-1 and gets in
  it('#59 twin: with the clicks the price assumes the Runner runs remote-1, breaks both bioroids and gets in', { timeout: 60_000 }, () => {
    const runs = remoteRuns(59, 7, s => {
      s.runner.clicks += 2;
    });
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.some(r => r.breaks > 0 && r.ended === 'successful')).toBe(true);
    expect(runs.some(r => r.ended === 'jackedOut')).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ #58
// Synapse Global, Public Access Plaza (35062) rezzed in remote-3, threat 2 from T3: "Threat 2 -> When the Runner trashes
// this asset (while it is rezzed), give them 1 tag." The Runner runs remote-3, declines the trash for the tag, and runs it
// again the next turn for the same card (saved game T3 to T6: declined 4 times, the Plaza paid the Corp each turn).
const PLAZA = '35062';
/** From T3 to the end of T6: each access answer on the Plaza, and the runs on its server after the first decline while it is there. */
function plazaTurns(edit?: (s: GameState) => void) {
  const { state, runner } = boardAt(58, 3);
  if (edit) edit(state);
  const answers: { turn: number; trash: boolean; threat: number }[] = [];
  let declined: { id: string; server: string } | null = null;
  let runsAfter = 0;
  play(state, runner, 6, (a, before) => {
    const p = activePrompt(before);
    if (a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'access_trash' && p?.kind === 'access_trash') {
      const server = Object.values(before.corp.servers).find(v => v.root.some(c => c.instanceId === p.cardInstanceId && c.cardCode === PLAZA));
      if (server) {
        answers.push({ turn: before.turnNumber, trash: a.choice.trash, threat: Math.max(before.corp.score, before.runner.score) });
        if (!a.choice.trash && !declined) declined = { id: p.cardInstanceId, server: server.id };
      }
    }
    if (a.type === 'INITIATE_RUN' && declined && a.targetServerId === declined.server) {
      const still = before.corp.servers[declined.server]?.root.some(c => c.instanceId === declined!.id);
      if (still) runsAfter++;
    }
  });
  return { answers, runsAfter };
}

describe('issue #58: a trash priced into the run and declined at the access for its tag', () => {
  // Passes when the Runner either trashes the Plaza at its first access or, having declined it for the tag, does not run
  // its server again for it while the tag still stands (threat 2): the run's worth and the access answer agree
  it.fails('#58 T3-T6: after declining the Plaza for its tag the Runner does not run its server again for it', { timeout: 60_000 }, () => {
    const { answers, runsAfter } = plazaTurns();
    expect(answers.length === 0 || answers[0].trash || runsAfter === 0).toBe(true);
  });

  // Setup, state only (an `it.fails` also passes on a thrown error, so the board is checked apart from the pin)
  it('#58 setup: at T3 the Plaza is rezzed in a remote and the threat level is 2 or more', () => {
    const { state } = boardAt(58, 3);
    expect(Object.values(state.corp.servers).some(v => v.isRemote && v.root.some(c => c.cardCode === PLAZA && c.isRezzed))).toBe(true);
    expect(Math.max(state.corp.score, state.runner.score)).toBeGreaterThanOrEqual(2);
  });

  // Twin: the same T3 board at threat 1 (no tag on the trash): the Runner trashes the Plaza at the first access
  it('#58 twin: below threat 2 the Runner trashes the Plaza at its first access', { timeout: 60_000 }, () => {
    const { answers } = plazaTurns(s => {
      s.corp.score = Math.min(s.corp.score, 1);
      s.runner.score = Math.min(s.runner.score, 1);
    });
    expect(answers.length).toBeGreaterThan(0);
    expect(answers[0]).toMatchObject({ turn: 3, trash: true, threat: 1 });
  });
});
