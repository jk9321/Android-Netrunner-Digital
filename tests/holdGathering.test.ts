/**
 * The hold count's gathering against the engine (bundle H, netrunner-ai/review-fixes-1119/hold-inputs/brief.md, fix 7).
 * The brute-force reference (tests/holdWalkReference.test.ts) shares the walk's gathering (walkStart, walkIce,
 * walkBoard, runQuestion), so a fact gathered wrongly is wrong in both and the reference agrees. Here the walk's answer
 * is compared with the engine played out instead (scripts/stage-d/hold-oracle.ts, the oracle's method: the Runner's turn
 * or run searched in the engine, every card's own text firing), on boards built for each step the fixes sit in. Boards
 * are played in the engine where they can be, not edited.
 *
 * Rules (Comprehensive Rules v26.03, each checked in the PDF): 1.2.2 a "cannot" wins; 3.9.5b a breaker's strength boost
 * lasts the current encounter; 5.6.3d and 5.7.2d "when a turn ends" (Lycian's derez) at the end of the Corp's and of the
 * Runner's turn; 6.5.8a-c a bypass aborts the Encounter Ice Phase, most at the encounter's beginning; 6.8.5 and 6.9.6d
 * run durations end with the run; 6.9.3a-c the encounter begins, its paid ability window, its subroutines resolve.
 */
import { describe, expect, it } from 'vitest';
import { GameState, activePrompt, executeAction, getLegalActions } from '../src/core';
import { serverHold } from '../src/ai/corp/hold';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { oracleGetsIn } from '../scripts/stage-d/hold-oracle';
import { installIceForTest, installProgramForTest, newGame, startRunnerTurn } from './helpers';

const C = { PALISADE: '30072', MALANDRAGEM: '34081' };
const T = 120_000;

/** A Corp turn-7 board (as tests/reviewPins.test.ts): empty rig and HQ, the Runner at $0 and 4 clicks, the Corp at $20. */
function board(setup: (s: GameState) => void): GameState {
  const s = newGame(3);
  s.corp.hq = [];
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.runner.credits = 0;
  s.corp.credits = 20;
  s.turnNumber = 7;
  setup(s);
  return s;
}
const inCorp = <T>(s: GameState, f: () => T): T => asSide('corp', () => (decisionContext(s, 'corp'), f()));
const nextTurn = (s: GameState, server: string) => inCorp(s, () => serverHold(s, server, { when: 'runnerTurn', corpCredits: s.corp.credits }));
const turnTruth = (s: GameState, server: string, rez: string[] = []) => oracleGetsIn(s, server, 'runnerTurn', rez, undefined, undefined, true).answer;
/** The engine answers the open prompt with the option `id`. */
const choose = (s: GameState, id: string): GameState => {
  const p = activePrompt(s)!;
  const a = getLegalActions(s, p.side).find(x => x.type === 'RESOLVE_PROMPT' && 'optionId' in x.choice && x.choice.optionId === id);
  expect(a).toBeDefined();
  return executeAction(s, a!);
};

describe('fix 5b: next turn reads the Runner cards\' once-per-turn uses as unused', () => {
  // Malandragem (34081): "Once per turn -> When you encounter a piece of ice, if its strength is 3 or less, you may remove
  // 1 hosted power counter to bypass it." Rezzed Palisade on HQ (strength 2, "End the run."), no breaker, Runner $0. The
  // Runner uses Malandragem on a run this turn (the engine's flag once:<id>:0 set), the run ends; asked during its turn,
  // the Runner's next turn has the ability again (turn flags reset as the turn passes), with 1 counter left.
  const used = () => {
    const s0 = board(st => {
      installIceForTest(st, C.PALISADE, 'hq', true);
      installProgramForTest(st, C.MALANDRAGEM);
      st.runner.rig.programs[0].tokens = { power: 2 };
    });
    startRunnerTurn(s0);
    let s = executeAction(s0, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    s = executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' });
    s = choose(s, 'counter');
    while (s.activeRun) {
      const p = activePrompt(s);
      if (p) s = executeAction(s, getLegalActions(s, p.side).find(a => a.type === 'RESOLVE_PROMPT')!);
      else s = executeAction(s, getLegalActions(s, 'runner').find(a => a.type === 'CONTINUE_RUN')!);
    }
    const id = s.runner.rig.programs[0].instanceId;
    expect([s.activePlayer, s.turnFlags[`once:${id}:0`], s.runner.rig.programs[0].tokens.power]).toEqual(['runner', 1, 1]);
    return s;
  };
  it('Malandragem used this turn, 1 counter left: HQ does not hold next turn (the engine gets in)', { timeout: T }, () => {
    const s = used();
    expect(turnTruth(s, 'hq')).toBe('getsIn');
    expect(nextTurn(s, 'hq').holds).toBe(false);
  });
  it('mirror: no counter left, HQ holds next turn (the engine agrees)', { timeout: T }, () => {
    const s = structuredClone(used());
    s.runner.rig.programs[0].tokens = { power: 0 };
    expect(turnTruth(s, 'hq')).toBe('holds');
    expect(nextTurn(s, 'hq').holds).toBe(true);
  });
});
