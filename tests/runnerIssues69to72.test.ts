import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { Agent } from '../src/ai/agent';
import { GameRunner } from '../src/ai/playout';

/**
 * Issues #69 to #72 (bug reports filed 2026-11-24/25 against main 7793179, rechecked on beta 12ee4b4 after the Runner
 * fixes for #58, #65 and #67 landed). Fixtures tests/fixtures/runner-issues/issue-69.json to issue-72.json are the saved
 * games (moves from the first comment of each issue); all four replay move for move with the recorded log length
 * (scripts/runner-rework/issues-69-72.ts). #69 and #70 are the same game (seed 2957335227) at T4 and T10.
 *
 * Each board is the saved game replayed to the start of the Runner's reported turn with a fresh Normal Runner that
 * observes every board (its own memory only, no hidden information; rules 1.12, 10.2.2a); the current Normal Runner and
 * Corp then play to the end of that turn. A fault that still happens on beta is pinned as a known failure (`it.fails`)
 * beside a setup test that checks the board apart from the pin (an `it.fails` also passes on a thrown error). #70 does
 * not happen on beta and is pinned as passing. The pins state behaviour, not a score. Boards are edited only on a
 * structuredClone.
 */

interface Saved {
  config: { seed: number; corpDeck: never; runnerDeck: never };
  startStops?: GameState['stops'];
  moves: GameAction[];
}
const saved = (n: number): Saved => JSON.parse(readFileSync(new URL(`./fixtures/runner-issues/issue-${n}.json`, import.meta.url), 'utf8'));
type Observer = Agent & { observe?: (s: GameState) => void };

/** The saved game before move `at`, and a Normal Runner that watched every board up to and including it. */
function boardBefore(n: number, at: number): { state: GameState; runner: Observer; move: GameAction } {
  const r = saved(n);
  let s = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  // observe: the Normal Runner's memory of what it has seen (runnerAI.ts), not on the Agent interface
  const runner = createAgent('runner', 'normal') as Observer;
  for (let i = 0; i < at; i++) {
    runner.observe?.(s);
    s = executeAction(s, r.moves[i]);
  }
  runner.observe?.(s);
  return { state: structuredClone(s), runner, move: r.moves[at] };
}

/** Plays the board's turn to its end, calling `see` with each action (both sides), the state before it and after it. */
function playTurn(state: GameState, runner: Observer, see: (a: GameAction, before: GameState, after: GameState) => void): GameState {
  const turn = state.turnNumber;
  const g = new GameRunner(state, { runner, corp: createAgent('corp', 'normal') });
  for (let k = 0; k < 3000 && g.state.turnNumber === turn && !g.state.winner; k++) {
    const before = g.state;
    runner.observe?.(before);
    if (!g.step()) break;
    if (g.last) see(g.last, before, g.state);
  }
  return g.state;
}

const titleIn = (s: GameState, a: GameAction): string => {
  const id = (a as { cardInstanceId?: string }).cardInstanceId;
  const c = id ? findCardAnywhere(s, id) : undefined;
  return c ? cardDef(c).title : '';
};
const titles = (cards: GameState['corp']['servers'][string]['ice']) => cards.map(c => [cardDef(c).title, c.isRezzed]);

// ------------------------------------------------------------------------------------------------ #69
// T3 (move 45): 4 clicks, 5 credits, no ice on HQ, R&D or Archives (only Ping on Remote 1). The Runner plays Tread Lightly
// ("Run any server. During that run, the rez cost of each piece of ice is increased by 3") into R&D, which has no ice:
// the event and its credit buy nothing a click run would not (installing ice is a Corp action, and the Corp takes no
// actions during the Runner's turn).
const TREAD_AT = 45;

describe('issue #69: Tread Lightly played to run a server with no ice', () => {
  it('#69 setup: at T3 R&D, HQ and Archives have no ice, Tread Lightly is in the grip, and the recorded move plays it', () => {
    const { state, move } = boardBefore(69, TREAD_AT);
    expect(state.turnNumber).toBe(3);
    expect(state.activePlayer).toBe('runner');
    expect(state.runner.clicks).toBe(4);
    for (const server of ['hq', 'rd', 'archives']) expect(state.corp.servers[server].ice).toEqual([]);
    expect(state.runner.grip.some(c => cardDef(c).title === 'Tread Lightly')).toBe(true);
    expect(titleIn(state, move)).toBe('Tread Lightly');
  });

  // Passes when every Tread Lightly run this turn goes to a server with at least one piece of ice. Known-failing: B4a 7(a)
  // (ai-runner-hidden-zones) made it pass on this board alone (HQ priced from the seen cards surely still there, the
  // Runner plain-ran R&D and kept Tread Lightly), and with F3's exact value caches merged in (beta 9154f02) the Runner
  // plain-runs R&D, then plays Tread Lightly into HQ, which has no ice. The price of an event that buys nothing a click
  // run would not is issue #69's (tracker I69, R-B), so the pin stays a known failure until that fix.
  it.fails('#69 T3: the Runner does not play Tread Lightly into a server with no ice', { timeout: 60_000 }, () => {
    const { state, runner } = boardBefore(69, TREAD_AT);
    const iceless: string[] = [];
    let tread = false;
    playTurn(state, runner, (a, before, after) => {
      if (a.player === 'runner' && a.type === 'PLAY_OPERATION_OR_EVENT') tread = titleIn(before, a) === 'Tread Lightly';
      if (tread && !before.activeRun && after.activeRun) {
        if (after.corp.servers[after.activeRun.server].ice.length === 0) iceless.push(after.activeRun.server);
        tread = false;
      }
    });
    expect(iceless).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ #70
// T9 (move 150): 4 clicks, 3 credits (4 after a click). Remote 2 holds only a rezzed Public Access Plaza (trash cost 2;
// at threat 2 trashing it gives a tag) and no ice. The recorded turn ran Remote 2 and declined to trash the
// Plaza: a run for nothing. Same family as #58 (Plaza run-and-decline, fixed on beta by F108); the beta Runner does not
// make that run.
const PLAZA_AT = 150;

describe('issue #70: a run on an iceless remote for a known Plaza, then the trash declined', () => {
  it('#70 setup: at T9 Remote 2 has no ice and one rezzed Public Access Plaza, and the recorded turn runs it and declines', () => {
    const { state } = boardBefore(70, PLAZA_AT);
    expect(state.turnNumber).toBe(9);
    expect(state.activePlayer).toBe('runner');
    const remote = state.corp.servers['remote-2'];
    expect(remote.ice).toEqual([]);
    expect(titles(remote.root)).toEqual([['Public Access Plaza', true]]);
    const r = saved(70);
    expect(r.moves[152]).toMatchObject({ type: 'INITIATE_RUN', targetServerId: 'remote-2' });
    expect(r.moves[155]).toMatchObject({ type: 'RESOLVE_PROMPT', choice: { kind: 'access_trash', trash: false } });
  });

  it('#70 T9: the Runner does not access the rezzed Plaza and then decline to trash it', { timeout: 60_000 }, () => {
    const { state, runner } = boardBefore(70, PLAZA_AT);
    const declined: number[] = [];
    playTurn(state, runner, (a, before) => {
      if (a.player !== 'runner' || a.type !== 'RESOLVE_PROMPT' || a.choice.kind !== 'access_trash' || a.choice.trash) return;
      const p = before.pendingPrompts[0] as { cardInstanceId?: string } | undefined;
      const c = p?.cardInstanceId ? findCardAnywhere(before, p.cardInstanceId) : undefined;
      if (c && c.isRezzed && cardDef(c).title === 'Public Access Plaza') declined.push(before.runner.credits);
    });
    expect(declined).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ #71
// T8, T9, T11, T12: Remote 2 is behind a rezzed Lamplighter (known since T5), "Give the Runner 1 tag unless they pay 3
// credits" then "End the run if the Runner is tagged". With fewer than 3 credits at the encounter and no breaker that can
// break it, the first subroutine tags the Runner and the second ends the run (subroutines resolve 1 at a time in order,
// rule 9.8.7b): four runs ended at
// the same ice. The Runner's price reads "End the run if the Runner is tagged" against its tags before the encounter
// (src/ai/runs.ts SUB_RULES), so the tag the first subroutine gives is not seen.
const LAMPLIGHTER_TURNS: [turn: number, at: number][] = [[8, 148], [9, 163], [11, 201], [12, 221]];

/** From the board, the runs this turn that Lamplighter ended. */
function lamplighterEnds(at: number): number {
  const { state, runner } = boardBefore(71, at);
  let ends = 0;
  let fired = false;
  playTurn(state, runner, (_a, before, after) => {
    for (const l of after.log.slice(before.log.length)) {
      const m = (l as { message?: string }).message ?? '';
      if (m.startsWith('Lamplighter subroutine fires: End the run if the Runner is tagged')) fired = true;
      else if (fired && m === 'The run was ended.') ends++;
      if (m === 'The run was ended.' || m.includes('initiated a run')) fired = false;
    }
  });
  return ends;
}

describe('issue #71: runs into a rezzed Lamplighter with no money for its tag and no breaker for it', () => {
  it('#71 setup: Lamplighter is rezzed on Remote 2 at T8, T9, T11 and T12 and the Runner starts each with under 3 credits', () => {
    for (const [turn, at] of LAMPLIGHTER_TURNS) {
      const { state } = boardBefore(71, at);
      expect([state.turnNumber, state.activePlayer]).toEqual([turn, 'runner']);
      expect(titles(state.corp.servers['remote-2'].ice)).toEqual([['Lamplighter', true]]);
      expect(state.runner.credits).toBeLessThan(3);
    }
  });

  for (const [turn, at] of LAMPLIGHTER_TURNS) {
    // Passes when no run this turn is ended by Lamplighter's second subroutine
    it.fails(`#71 T${turn}: the Runner makes no run that Lamplighter tags and ends`, { timeout: 60_000 }, () => {
      expect(lamplighterEnds(at)).toBe(0);
    });
  }
});

// ------------------------------------------------------------------------------------------------ #72
// T8 (move 113): Karunā rezzed on Remote 3 since T7 ("Do 2 net damage. The Runner may jack out." / "Do 2 net damage."),
// no killer installed (rig: Baker, DZMZ Optimizer). The Runner runs Remote 3 with its last click, takes the first 2 net
// damage and jacks out (rule 6.1.5): two cards lost for nothing. Either the run was worth the 4 damage and the jack-out is
// the decision changing its mind, or it was not and the run should not have been made.
const KARUNA_AT = 113;

describe('issue #72: a run into a known Karunā, the first damage taken, then a jack-out', () => {
  it('#72 setup: at T8 Remote 3 is behind a rezzed Karunā and the Runner has no installed breaker for a sentry', () => {
    const { state } = boardBefore(72, KARUNA_AT);
    expect([state.turnNumber, state.activePlayer, state.runner.clicks]).toEqual([8, 'runner', 4]);
    expect(titles(state.corp.servers['remote-3'].ice)).toEqual([['Karunā', true]]);
    expect(state.runner.rig.programs.map(c => cardDef(c).title)).toEqual(['Baker']);
    const r = saved(72);
    expect(r.moves[121]).toMatchObject({ type: 'INITIATE_RUN', targetServerId: 'remote-3' });
    expect(r.moves[124]).toMatchObject({ type: 'RESOLVE_PROMPT', choice: { kind: 'effect_choice', optionId: 'jack' } });
  });

  // Passes when no run this turn takes Karunā's damage and then jacks out at its prompt
  it.fails('#72 T8: the Runner does not take Karunā\'s first damage and then jack out', { timeout: 60_000 }, () => {
    const { state, runner } = boardBefore(72, KARUNA_AT);
    const jacked: string[] = [];
    playTurn(state, runner, (a, before) => {
      if (a.player === 'runner' && a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'effect_choice' && a.choice.optionId === 'jack' && before.activeRun) jacked.push(before.activeRun.server);
    });
    expect(jacked).toEqual([]);
  });
});
