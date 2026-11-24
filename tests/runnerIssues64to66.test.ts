import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, activePrompt, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { Agent } from '../src/ai/agent';
import { GameRunner } from '../src/ai/playout';

/**
 * Issues #64, #65 and #66 (saved games in tests/fixtures/runner-issues/issue-64.json and issue-66.json;
 * issue #65's 64 moves are an exact prefix of issue #66's 261 moves).
 *
 * Diagnosis in docs/gemini-prep/issues-64-66.md. Fixes belong to the Runner rework (stages R-B and R-C1),
 * so each reproducible fault is pinned as a known failure (`it.fails`) beside a setup test and a twin that
 * passes today.
 *
 * Each board is replayed move by move with a fresh Normal Runner that observes every board of the replay
 * (its own memory only, no hidden information; rules 1.12, 10.2.2a), and the turn is played forward by
 * GameRunner with a Normal Corp. Boards are edited on a structuredClone before GameRunner inspects them.
 */

interface Saved {
  config: { seed: number; corpDeck: never; runnerDeck: never };
  startStops?: GameState['stops'];
  moves: GameAction[];
}

const saved = (name: string): Saved =>
  JSON.parse(readFileSync(new URL(`./fixtures/runner-issues/${name}.json`, import.meta.url), 'utf8'));

/** The saved game at the Runner's first run of `turn`, and a Normal Runner that watched every board up to it. */
function boardAtRun(name: string, turn: number): { state: GameState; runner: Agent } {
  const r = saved(name);
  let s = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  const runner = createAgent('runner', 'normal') as Agent & { observe?: (s: GameState) => void };
  for (const move of r.moves) {
    if (s.turnNumber === turn && s.activePlayer === 'runner' && move.type === 'INITIATE_RUN') {
      runner.observe?.(s);
      return { state: structuredClone(s), runner };
    }
    runner.observe?.(s);
    s = executeAction(s, move);
  }
  throw new Error(`${name}: no Runner run in turn ${turn}`);
}

/** The saved game at the start of the Runner's turn `turn`, and a Normal Runner that watched every board up to it. */
function boardAtRunnerTurnStart(name: string, turn: number): { state: GameState; runner: Agent } {
  const r = saved(name);
  let s = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  const runner = createAgent('runner', 'normal') as Agent & { observe?: (s: GameState) => void };
  for (const move of r.moves) {
    if (s.turnNumber === turn && s.activePlayer === 'runner') {
      runner.observe?.(s);
      return { state: structuredClone(s), runner };
    }
    runner.observe?.(s);
    s = executeAction(s, move);
  }
  throw new Error(`${name}: no Runner turn ${turn}`);
}

/** Plays forward from the board until `last` ends, calling `see` with each Runner action and the states around it. */
function play(
  state: GameState,
  runner: Agent,
  last: number,
  see: (a: GameAction, before: GameState, after: GameState) => void
): GameState {
  const g = new GameRunner(state, { runner, corp: createAgent('corp', 'normal') });
  for (let k = 0; k < 4000 && g.state.turnNumber <= last && !g.state.winner; k++) {
    const before = g.state;
    g.step();
    if (g.last?.player === 'runner') see(g.last, before, g.state);
  }
  return g.state;
}

// ------------------------------------------------------------------------------------------------ #64
// AU Co., Semak-samun (35054) rezzed on remote-2 ("End the run unless the Runner suffers 3 net damage",
// only fracters can break). At T4 the Runner has 4 clicks, 5 credits, 3 cards in grip, and no fracter
// (Botulus is on HQ's inner ice). runScore prices the subroutine as 3 net damage with drawBack=true (3.75),
// then answerPrompt at the subroutine chooses "End the run" because evaluate(grip=0) has no drawBack.
const SEMAK_SAMUN = '35054';
const REMOTE_2 = 'remote-2';

function semakRuns(edit?: (s: GameState) => void) {
  const { state, runner } = boardAtRun('issue-64', 4);
  if (edit) edit(state);
  const runs: { endedBySemak: boolean; successful: boolean }[] = [];
  let open: (typeof runs)[number] | null = null;
  play(state, runner, 4, (a, before, after) => {
    if (a.type === 'INITIATE_RUN' || (!before.activeRun && after.activeRun)) {
      open = after.activeRun?.server === REMOTE_2 ? { endedBySemak: false, successful: false } : null;
      if (open) runs.push(open);
    }
    if (!open) return;
    const p = activePrompt(before);
    if (
      a.type === 'RESOLVE_PROMPT' &&
      a.choice.kind === 'effect_choice' &&
      a.choice.optionId === 'end' &&
      p?.kind === 'effect_choice' &&
      p.source.cardCode === SEMAK_SAMUN
    ) {
      open.endedBySemak = true;
    }
    if (!after.activeRun && after.runsThisTurn.some(x => x.server === REMOTE_2 && x.successful)) {
      open.successful = true;
    }
    if (!after.activeRun) open = null;
  });
  return runs;
}

describe('issue #64: run priced as tanking Semak-samun damage, then ended at the subroutine prompt', () => {
  it('#64 setup: at T4 Semak-samun is rezzed on remote-2, grip is 3, and Botulus is not on Semak-samun', () => {
    const { state } = boardAtRun('issue-64', 4);
    const ice = state.corp.servers[REMOTE_2].ice;
    expect(ice.length).toBe(1);
    expect(ice[0].cardCode).toBe(SEMAK_SAMUN);
    expect(ice[0].isRezzed).toBe(true);
    expect(state.runner.grip.length).toBe(3);
    expect(state.runner.credits).toBe(5);
    expect(state.runner.rig.programs.some(p => p.hostedOnId === ice[0].instanceId)).toBe(false);
  });

  // Passes when the Runner makes no run on remote-2 that Semak-samun's subroutine ends
  // (it either does not run there or takes the damage / breaks and gets past).
  it.fails('#64 T4: the Runner makes no run on remote-2 that Semak-samun ends', { timeout: 15_000 }, () => {
    const runs = semakRuns();
    expect(runs.filter(r => r.endedBySemak)).toEqual([]);
  });

  // Twin: the same T4 board with 3 extra cards in grip (6 cards, so taking 3 net damage leaves 3 cards
  // instead of an empty grip): the Runner runs remote-2, takes the 3 net damage and gets in.
  it('#64 twin: with a 6-card grip the Runner runs remote-2, tanks Semak-samun and gets in', { timeout: 15_000 }, () => {
    const runs = semakRuns(s => {
      s.runner.grip.push(...s.runner.stack.splice(0, 3));
    });
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.some(r => r.successful)).toBe(true);
    expect(runs.some(r => r.endedBySemak)).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ #65
// The Syndicate, Regolith Mining License (30071) rezzed in unprotected remote-2 (trash cost 3).
// From T4 Runner start (4 clicks, 1 credit), the Runner draws, clicks for 1c twice (reaching 3c),
// runs remote-2, accesses Regolith and declines to trash because dropping to 0c lowers Verbal Plasticity's
// cardRate-based rig value by -2.102 on top of the -5.127 credit spend.
const REGOLITH = '30071';

function regolithAccesses(edit?: (s: GameState) => void) {
  const { state, runner } = boardAtRunnerTurnStart('issue-66', 4);
  if (edit) edit(state);
  const accesses: { credits: number; trash: boolean }[] = [];
  play(state, runner, 4, (a, before) => {
    const p = activePrompt(before);
    if (a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'access_trash' && p?.kind === 'access_trash') {
      const card = before.corp.servers[REMOTE_2]?.root.find(c => c.instanceId === p.cardInstanceId && c.cardCode === REGOLITH);
      if (card) accesses.push({ credits: before.runner.credits, trash: a.choice.trash });
    }
  });
  return accesses;
}

describe('issue #65: run priced for trashing rezzed Regolith Mining License, then declined at access', () => {
  it('#65 setup: at T4 start Regolith Mining License is rezzed in unprotected remote-2 and Runner has 1 credit', () => {
    const { state } = boardAtRunnerTurnStart('issue-66', 4);
    expect(state.corp.servers[REMOTE_2].ice.length).toBe(0);
    expect(state.corp.servers[REMOTE_2].root.some(c => c.cardCode === REGOLITH && c.isRezzed)).toBe(true);
    expect(state.runner.credits).toBe(1);
    expect(state.runner.clicks).toBe(4);
  });

  // Passes when every Runner access of rezzed Regolith Mining License that it can pay to trash ends
  // with it trashed (or the Runner makes no such run).
  it.fails('#65 T4: every affordable access of rezzed Regolith Mining License ends with it trashed', { timeout: 15_000 }, () => {
    const accesses = regolithAccesses();
    expect(accesses.filter(x => x.credits >= 3 && !x.trash)).toEqual([]);
  });

  // Twin: the same T4 board with +4 credits (5 credits total, so trashing Regolith for 3 leaves 2 credits
  // instead of dropping to 0): the Runner runs remote-2 and trashes Regolith Mining License.
  it('#65 twin: with 4 extra credits the Runner accesses and trashes Regolith Mining License', { timeout: 15_000 }, () => {
    const accesses = regolithAccesses(s => {
      s.runner.credits += 4;
    });
    expect(accesses.length).toBeGreaterThan(0);
    expect(accesses.every(x => x.trash)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ #66a
// The Syndicate, remote-3 protected by Karunā, Brân 1.0, Tithe, Brân 1.0 (inner to outer).
// On T15 and T16 both Brân 1.0s are rezzed (each takes 3 bioroid clicks); with 4 clicks at turn start
// the run's click leaves 3: the Runner spends all 3 clicks on outer Brân 1.0, then jacks out because
// inner Brân 1.0 needs 7 credits (clicks=0) and the Runner only has 4 credits.
// (On T14 outer Brân 1.0 is still unrezzed and Normal Corp declines to rez it; T15 and T16 reproduce.)
const REMOTE_3 = 'remote-3';
const BRAN = '30039';

function remote3Runs(turn: number, edit?: (s: GameState) => void) {
  const { state, runner } = boardAtRun('issue-66', turn);
  if (edit) edit(state);
  const runs: { breaks: number; ended: 'jackedOut' | 'successful' | 'other' }[] = [];
  let open: (typeof runs)[number] | null = null;
  play(state, runner, turn, (a, before, after) => {
    if (a.type === 'INITIATE_RUN' || (!before.activeRun && after.activeRun)) {
      open = after.activeRun?.server === REMOTE_3 ? { breaks: 0, ended: 'other' } : null;
      if (open) runs.push(open);
    }
    if (!open) return;
    if (a.type === 'BIOROID_BREAK') open.breaks++;
    if (a.type === 'JACK_OUT') open.ended = 'jackedOut';
    if (!after.activeRun && after.runsThisTurn.some(x => x.server === REMOTE_3 && x.successful)) {
      open.ended = open.ended === 'jackedOut' ? 'jackedOut' : 'successful';
    }
    if (!after.activeRun) open = null;
  });
  return runs;
}

describe('issue #66a: a run priced past two rezzed Brân 1.0s by more clicks than are left', () => {
  it('#66a setup: at T14-T16 remote-3 has 4 ice (two Brân 1.0s, both rezzed by T15), 4 clicks, and non-empty root on T16', () => {
    for (const turn of [14, 15, 16]) {
      const { state } = boardAtRun('issue-66', turn);
      const srv = state.corp.servers[REMOTE_3];
      expect(srv.ice.length, `turn ${turn}`).toBe(4);
      expect(srv.ice.filter(c => c.cardCode === BRAN).length, `turn ${turn}`).toBe(2);
      expect(srv.ice.filter(c => c.cardCode === BRAN && c.isRezzed).length, `turn ${turn}`).toBe(turn === 14 ? 1 : 2);
      expect(state.runner.clicks, `turn ${turn}`).toBe(4);
      // #66b check: remote-3 root is NOT empty on T16 (unrezzed Manegarm Skunkworks still installed)
      expect(srv.root.length, `turn ${turn} root`).toBeGreaterThan(0);
    }
  });

  // Passes when on T14, T15 and T16 the Runner makes no run on remote-3 in which it spends bioroid clicks
  // and then jacks out.
  it.fails('#66a T14, T15, T16: the Runner does not spend bioroid clicks on Brân 1.0 and then jack out', { timeout: 15_000 }, () => {
    for (const turn of [14, 15, 16]) {
      const runs = remote3Runs(turn);
      expect(
        runs.filter(r => r.breaks > 0 && r.ended === 'jackedOut'),
        `turn ${turn}`
      ).toEqual([]);
    }
  });

  // Twin: the same T16 board with the outer Brân 1.0 unrezzed (Corp has 0 credits, so only one rezzed
  // Brân 1.0 stands in the way, which the Runner's 3 clicks after initiating the run cover): the Runner
  // breaks it with clicks and does not jack out in movement.
  it('#66a twin: with only one rezzed Brân 1.0 on T16 the Runner breaks it with clicks and gets past without jacking out', { timeout: 15_000 }, () => {
    const runs = remote3Runs(16, s => {
      s.corp.servers[REMOTE_3].ice[3].isRezzed = false;
    });
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.some(r => r.breaks === 3 && r.ended !== 'jackedOut')).toBe(true);
    expect(runs.some(r => r.ended === 'jackedOut')).toBe(false);
  });
});
