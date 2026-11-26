import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, activePrompt, cardDef, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { Agent } from '../src/ai/agent';
import { GameRunner } from '../src/ai/playout';

/**
 * Issues #67 and #68 (Jeff's saved games, tests/fixtures/runner-issues/issue-67.json and issue-68.json; brief
 * runner-rework/briefs/i67-i68-pins-count.md, tracker R-27, items I67 and I68). Diagnosis in docs/gemini-prep/issues-67-68.md.
 * Both fixes belong to the Runner rework's R-B (#67 with the #58 family, owner O1 after B2's log; #68 with the prompt work,
 * B3), so each was pinned as a known failure (`it.fails`) beside a twin that passes. #67 is fixed by O1a (the fixed 0.5
 * trash floor gone); #68 by B3b (the host's worth in one owner, counterValues.ts trojanHostWorth).
 *
 * Each board is the saved game replayed move by move with a fresh Normal Runner that observes every board of the replay
 * (its own memory only, no hidden information; rules 1.12, 10.2.2a). The pins state behaviour, not a score, so either fix
 * may sit in the decision's answer or in the value both paths read. Boards are edited only on a structuredClone.
 */

interface Saved {
  config: { seed: number; corpDeck: never; runnerDeck: never };
  startStops?: GameState['stops'];
  moves: GameAction[];
  endLogLength: number;
}
const saved = (n: number): Saved => JSON.parse(readFileSync(new URL(`./fixtures/runner-issues/issue-${n}.json`, import.meta.url), 'utf8'));

/** The saved game before move `at`, and a Normal Runner that watched every board up to and including it. */
function boardBefore(n: number, at: number): { state: GameState; runner: Agent; move: GameAction } {
  const r = saved(n);
  let s = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  // observe: the Normal Runner's memory of what it has seen (runnerAI.ts), not on the Agent interface
  const runner = createAgent('runner', 'normal') as Agent & { observe?: (s: GameState) => void };
  for (let i = 0; i < at; i++) {
    runner.observe?.(s);
    s = executeAction(s, r.moves[i]);
  }
  runner.observe?.(s);
  return { state: structuredClone(s), runner, move: r.moves[at] };
}

// ------------------------------------------------------------------------------------------------ #68
// Topan's ability installs Botulus from the grip and asks "Install Botulus on which ice?" (installRunnerChoice). At T5
// (move 76) every ice is facedown and the HQ ice already hosts the Botulus installed by the same prompt at T3 (move 50);
// the Runner hosts the second copy there too. The click action prices a second copy on the same ice below a first copy
// elsewhere (runnerAI.ts trojanHostValue); the prompt's answer is the fall-through that keeps the first of equal scores.
const BOTULUS = '30004';
const HOST_PROMPT = 76;

/** The host prompt at move 76: its options, which of them already host a Botulus, the recorded answer. */
function hostBoard() {
  const { state, runner, move } = boardBefore(68, HOST_PROMPT);
  const p = activePrompt(state);
  if (!p || p.kind !== 'effect_choice') throw new Error('issue 68: no effect_choice prompt at move 76');
  const hosts = (id: string) => state.runner.rig.programs.filter(c => c.hostedOnId === id && c.cardCode === BOTULUS).length;
  const ice = Object.values(state.corp.servers).flatMap(v => v.ice);
  const options = p.options.map(o => ({ id: o.id, botulus: hosts(o.id), rezzed: !!ice.find(c => c.instanceId === o.id)?.isRezzed }));
  return { state, runner, prompt: p, options, recorded: move };
}

describe('issue #68: a second Botulus hosted on the ice that already hosts one', () => {
  // Twin (the fixture's facts): three facedown hosts, the first already hosts a Botulus, and the person's game recorded the first
  it('#68 twin: at move 76 the prompt offers three facedown ice, the first hosts a Botulus, and the recorded answer is the first', () => {
    const { prompt, options, recorded } = hostBoard();
    expect(prompt.message).toBe('Install Botulus on which ice?');
    expect(options.length).toBe(3);
    expect(options.every(o => !o.rezzed)).toBe(true);
    expect(options.map(o => o.botulus)).toEqual([1, 0, 0]);
    expect(recorded).toMatchObject({ type: 'RESOLVE_PROMPT', choice: { kind: 'effect_choice', optionId: options[0].id } });
  });

  // Passes when the Runner does not host the second copy on the ice that already hosts one while another legal host hosts none.
  // Turned by B3b (counterValues.ts trojanHostWorth: input 1, an unknown facedown host is the unseen pool's mean; input 2, a
  // later copy's counters are worth only the room the first one's leave on the host's subroutines)
  it('#68 T5: the Runner does not put a second Botulus on the ice that already hosts one', { timeout: 15_000 }, () => {
    const { state, runner, options } = hostBoard();
    const answer = runner.chooseAction(state);
    if (answer.type !== 'RESOLVE_PROMPT' || answer.choice.kind !== 'effect_choice') throw new Error(`not a host answer: ${JSON.stringify(answer)}`);
    const optionId = answer.choice.optionId;
    const picked = options.find(o => o.id === optionId)!;
    const emptyLeft = options.some(o => o.botulus === 0);
    expect({ hostsBotulusAlready: picked.botulus > 0, emptyLeft }).toEqual({ hostsBotulusAlready: false, emptyLeft: true });
  });
});

// ------------------------------------------------------------------------------------------------ #67
// T8 (move 130): 4 clicks, 8 credits, 0 tags; B-1001 rezzed and known in Remote 1, trash cost 3,
// behind Starlit Knight with Botulus (7 counters). The flat ranking puts the Remote 1 run fourth of 8; the turn planner
// plays it; the access answer then declines the trash (keep 17.12 against trash 13.56).
const RUN_AT = 130;
const REMOTE_1 = 'remote-1';
const B1001 = 'B-1001';

/** From the T8 board to the end of T8: each access answer on B-1001 in Remote 1. */
function b1001Accesses(): { trash: boolean; credits: number }[] {
  const { state, runner } = boardBefore(67, RUN_AT);
  const g = new GameRunner(state, { runner, corp: createAgent('corp', 'normal') });
  const out: { trash: boolean; credits: number }[] = [];
  for (let k = 0; k < 4000 && g.state.turnNumber <= state.turnNumber && !g.state.winner; k++) {
    const before = g.state;
    g.step();
    const a = g.last;
    const p = activePrompt(before);
    if (a?.player === 'runner' && a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'access_trash' && p?.kind === 'access_trash') {
      const card = before.corp.servers[REMOTE_1]?.root.find(c => c.instanceId === p.cardInstanceId);
      if (card && cardDef(card).title === B1001) out.push({ trash: a.choice.trash, credits: before.runner.credits });
    }
  }
  return out;
}

describe('issue #67: a run on Remote 1 for B-1001, then the trash declined at the access', () => {
  // Twin (today's turn as recorded): the board, and the recorded T8 run on Remote 1 whose access declined to trash B-1001
  it('#67 twin: at T8 B-1001 is rezzed and known in Remote 1, and the recorded turn runs it and declines the trash', () => {
    const { state, move } = boardBefore(67, RUN_AT);
    expect(state.turnNumber).toBe(8);
    expect(state.activePlayer).toBe('runner');
    expect(state.runner.clicks).toBe(4);
    expect(state.runner.tags).toBe(0);
    const root = state.corp.servers[REMOTE_1].root;
    expect(root.map(c => [cardDef(c).title, c.isRezzed, cardDef(c).trash_cost])).toEqual([[B1001, true, 3]]);
    expect(move).toMatchObject({ type: 'INITIATE_RUN', targetServerId: REMOTE_1 });
    const r = saved(67);
    const access = r.moves.slice(RUN_AT).find(m => m.type === 'RESOLVE_PROMPT' && m.choice.kind === 'access_trash');
    expect(access).toMatchObject({ choice: { kind: 'access_trash', trash: false } });
    expect(state.runner.credits).toBeGreaterThanOrEqual(3);
  });

  // Passes when the Runner either does not make the run on Remote 1 this turn or trashes B-1001 when it gets there.
  // Fixed by brief O1a (tracker R-14b): B-1001 was priced at serverWorth's fixed 0.5 under water, now 0 (rules 1.19.2, 7.1.5)
  it('#67 T8: the Runner does not run Remote 1 and then decline to trash B-1001', { timeout: 30_000 }, () => {
    const accesses = b1001Accesses();
    expect(accesses.filter(x => x.credits >= 3 && !x.trash)).toEqual([]);
  });
});
