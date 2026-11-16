/**
 * A1 (brief-playout-lines.md rev 2): the Corp planner's playouts ask Q4/Q5, the deciding Corp's own two-turn line
 * questions, through the one shared sequence (corp/core.ts lineAsk, playoutLine), each playout on its own copy of the
 * deciding Corp's held line.
 *
 * Rules (Comprehensive Rules v26.03), unchanged by this branch and read by the line: 1.17.3a an agenda is scored once its
 * advancement counters reach its requirement; 1.17.3b-c scoring costs no click and is done with priority in the Corp's
 * own turn; 1.18.1 and 5.2.6f advancing is the basic action "[click], 1[credit]: Advance 1 installed card"; 5.2.6a
 * "[click]: Gain 1[credit]"; 8.5.6 an agenda is installed in a remote's root.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameAction, GameState, executeAction, getLegalActions } from '../src/core';
import { Line, PlannerAI, playout } from '../src/ai/turnPlanner';
import { scoreInTwo } from '../src/ai/corp/lines';
import { withPricing } from '../src/ai/pricing';
import type { HeldLine } from '../src/ai/corp/lines';
import * as core from '../src/ai/corp/core';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { tuning } from '../src/ai/synergy';
import { withDiagnostics } from '../src/ai/diagnostics';
import { scoreInTwoPick } from '../src/ai/corp/placement';
import { giveCard, installIceForTest, newGame } from './helpers';
import { inDecision } from './helpers/pricing';

// Records what each playout's line was started from (the wiring in corpAI.ts plan), and the steps it played
const starts: { held: HeldLine | null; same: boolean }[] = [];
let deciding: HeldLine | null = null;
vi.mock('../src/ai/corp/core', async importOriginal => {
  const orig = await importOriginal<typeof import('../src/ai/corp/core')>();
  return {
    ...orig,
    playoutLine: (held: HeldLine | null, rank: Parameters<typeof orig.playoutLine>[1]) => {
      starts.push({ held: structuredClone(held), same: held !== null && held === deciding });
      return orig.playoutLine(held, rank);
    },
  };
});

const SEND_A_MESSAGE = '30069'; // agenda 5/3
const PHAROS = '30063';
const LONGEVITY_SERUM = '30044'; // agenda 3/2
const BALLISTA = '30062'; // ice, rez 5
const HEDGE_FUND = '30075'; // operation, cost 5: gain 9 credits
const WHITESPACE = '30074'; // code gate: End the run if the Runner has 6 credits or fewer

const was = tuning.plan.scoreInTwo;
afterEach(() => {
  tuning.plan.scoreInTwo = was;
  starts.length = 0;
  deciding = null;
});

/** scoreInTwo.test.ts's deal 1641 turn 7 shape: Send a Message and Pharos in HQ, remote-1 behind two Whitespace, the Runner on 1 credit. */
function shape(): GameState {
  const s = structuredClone(newGame(1));
  s.corp.rd.push(...s.corp.hq.splice(0));
  s.corp.credits = 15;
  s.corp.clicks = 3;
  s.corp.score = 2;
  giveCard(s, 'corp', SEND_A_MESSAGE);
  giveCard(s, 'corp', PHAROS);
  installIceForTest(s, WHITESPACE, 'remote-1', true);
  installIceForTest(s, WHITESPACE, 'remote-1', false);
  s.runner.credits = 1;
  return s;
}

type Inner = { memory: { heldLine: HeldLine | null }; plan(s: GameState, ranked: unknown): GameAction | null; rankMainActions(s: GameState): { action: GameAction; score: number }[] };

describe('A1: the planner playouts ask Q4/Q5 on their own copy of the held line', () => {
  it("no leak: every playout starts from a fresh copy of the deciding Corp's held line, which the playouts never change", () => {
    tuning.plan.scoreInTwo = true;
    const s = shape();
    const credit = getLegalActions(s, 'corp').find(a => a.type === 'GAIN_CREDIT')!;
    // The deciding Corp holds the line begun on this turn (its first step not yet played)
    const begun = inDecision(s, 'corp', () => scoreInTwoPick(s, credit, null));
    expect(begun.held?.line).toMatchObject({ agenda: 'Send a Message', server: 'remote-1' });
    const agent = new HeuristicCorpAI() as unknown as Inner;
    agent.memory.heldLine = begun.held;
    deciding = begun.held;
    const before = structuredClone(begun.held);
    const counts = withDiagnostics(d => {
      inDecision(s, 'corp', () => agent.plan(s, agent.rankMainActions(s)));
      return d.playoutLine;
    });
    // Two or more candidates were played out, and a playout played the line's step (so a copy changed)
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(counts.q5Asks).toBeGreaterThan(0);
    expect(counts.q5Steps).toBeGreaterThan(0);
    for (const start of starts) {
      expect(start.same).toBe(false);
      expect(start.held).toEqual(before);
    }
    expect(agent.memory.heldLine).toBe(begun.held);
    expect(agent.memory.heldLine).toEqual(before);
  }, 60000);

  it("lineAsk is corpDecide's sequence: the line's step first, the veto on a spare click, the held line kept", () => {
    tuning.plan.scoreInTwo = true;
    const s = shape();
    const credit = getLegalActions(s, 'corp').find(a => a.type === 'GAIN_CREDIT')!;
    const r = inDecision(s, 'corp', () => core.lineAsk(s, null, lineFirst => lineFirst ?? credit));
    // No held line: Q5 finds the line and its first step is the agenda's install into remote-1
    expect(r.later).toBe(false);
    expect(r.lineFirst).toMatchObject({ type: 'INSTALL_CARD', targetServerId: 'remote-1' });
    expect(r.action).toMatchObject({ type: 'INSTALL_CARD', targetServerId: 'remote-1' });
    expect(r.held?.line).toMatchObject({ agenda: 'Send a Message', advanceNow: 2 });
  });

  it('a score that is the order\'s first entry is played before Q5 (red team 7)', () => {
    const line = core.playoutLine(null, () => []);
    const score = { type: 'SCORE_AGENDA', cardInstanceId: 'x' } as unknown as GameAction;
    const counts = withDiagnostics(d => {
      expect(line.step(shape(), score)).toBe(score);
      return d.playoutLine;
    });
    expect(counts).toMatchObject({ scoreFirst: 1, q5Asks: 0 });
  });

  it('a playout begins the two-turn line its first action makes possible (fails without the playout line, as on beta b7c4917)', () => {
    // 5 credits, 3 clicks, no remote; Longevity Serum, Ballista and Hedge Fund in HQ; the Runner on 3 credits. At the root
    // no line holds (Ballista's rez 5 is the whole bank); after Hedge Fund (9 credits) the line is Ballista on a new
    // remote and the agenda behind it, three advances next turn (1.18.1, 5.2.6f) to score it (1.17.3a)
    tuning.plan.scoreInTwo = true;
    const s = structuredClone(newGame(1));
    s.corp.rd.push(...s.corp.hq.splice(0));
    s.corp.credits = 5;
    s.corp.clicks = 3;
    s.runner.credits = 3;
    const agenda = giveCard(s, 'corp', LONGEVITY_SERUM);
    const op = giveCard(s, 'corp', HEDGE_FUND);
    const ice = giveCard(s, 'corp', BALLISTA);
    const hf = getLegalActions(s, 'corp').find(a => a.type === 'PLAY_OPERATION_OR_EVENT' && a.cardInstanceId === op)!;
    expect(inDecision(s, 'corp', () => scoreInTwo(s))).toBeNull();
    const after = executeAction(s, hf);
    expect(inDecision(after, 'corp', () => scoreInTwo(after))).toMatchObject({ agendaId: agenda, form: 'install+ice', iceId: ice, server: 'new remote' });
    const rollout = new HeuristicCorpAI({ planner: false });
    const beta: PlannerAI = { rank: x => rollout.rankMainActions(x), answer: x => rollout.chooseAction(x) };
    const branch: PlannerAI = { ...beta, line: () => core.playoutLine(null, (x, h) => rollout.rankMainActions(x, undefined, h)) };
    const play = (ai: PlannerAI) => {
      const line: Line = [];
      const value = inDecision(s, 'corp', () => withPricing({ frozen: true }, () => playout(s, 'corp', hf, ai, line)));
      return { value, moves: line.map(l => l.action) };
    };
    const off = play(beta);
    const on = play(branch);
    // As on beta: the order's first entry each step (a draw, then the ice to HQ), no agenda installed
    expect(off.moves.some(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === agenda)).toBe(false);
    // With the line: the ice on a new remote, then the agenda into it
    expect(on.moves).toMatchObject([
      { type: 'INSTALL_CARD', cardInstanceId: ice, asNewRemote: true },
      { type: 'INSTALL_CARD', cardInstanceId: agenda, targetServerId: 'remote-1' },
    ]);
    expect(on.value).not.toBe(off.value);
  }, 60000);
});
