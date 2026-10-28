import { describe, expect, it } from 'vitest';
import { HeuristicRunnerAI } from '../src/ai';
import { creditsAhead, runScore, serverValue } from '../src/ai/runs';
import { PACE } from '../src/ai/effectValues';
import { GameState, activePrompt, executeAction } from '../src/core';
import { installCorpForTest, installIceForTest, installProgramForTest, newGame, runIntoFirstIce, startRunnerTurn } from './helpers';

const PALISADE = '30072'; // barrier, end the run; strength 4 on a remote
const CLEAVER = '30006'; // fracter, strength 3: 2 credits for +1, 1 credit breaks 2 barrier subroutines

/** A remote behind two rezzed Palisades, the Runner encountering the outer one with Cleaver installed. */
function twoPalisades(credits: number) {
  const state = newGame();
  installIceForTest(state, PALISADE, 'remote-9'); // inner
  installIceForTest(state, PALISADE, 'remote-9'); // outer
  installProgramForTest(state, CLEAVER);
  const s = runIntoFirstIce(state, 'remote-9');
  s.runner.credits = credits;
  return s;
}

describe('Runner AI run budget', () => {
  it('keeps the credits the rezzed ice further in needs', () => {
    const s = twoPalisades(6);
    expect(s.activeRun?.phase).toBe('encounter_ice');
    expect(creditsAhead(s)).toBe(3); // the inner Palisade: one boost and one break
  });

  it("doesn't pay to break ice when it can't afford the rezzed ice behind it", () => {
    // 4 credits: enough for the outer Palisade (3), not for both (6). Paying would only end in a jack out.
    const action = new HeuristicRunnerAI().chooseAction(twoPalisades(4));
    expect(action.type).toBe('CONTINUE_RUN');
  });

  it('breaks the outer ice when it can pay for the whole way in', () => {
    const action = new HeuristicRunnerAI().chooseAction(twoPalisades(6));
    expect(action.type).toBe('BOOST_BREAKER');
  });
});

const BUMI = '35041'; // bioroid sentry: lose a click to break a subroutine (trash a program, 1 core damage)
const MANEGARM = '30042'; // upgrade: on approach, end the run unless the Runner spends 2 clicks or pays 5 credits

/** R&D behind a rezzed Bumi 1.0, with a rezzed Manegarm Skunkworks in the root (Jeff's game). */
function manegarmGame(clicks: number, credits: number, withManegarm = true) {
  const state = newGame();
  installIceForTest(state, BUMI, 'rd');
  if (withManegarm) installCorpForTest(state, MANEGARM, 'rd', true);
  startRunnerTurn(state);
  state.runner.clicks = clicks;
  state.runner.credits = credits;
  return state;
}

/** Lets the Runner AI play the run on R&D until the Manegarm prompt (or the run ends). */
function runToManegarm(state: GameState, ai = new HeuristicRunnerAI()) {
  let s = executeAction(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'rd' });
  for (let i = 0; i < 20 && s.activeRun && !activePrompt(s); i++) s = executeAction(s, ai.chooseAction(s));
  return s;
}

describe('Runner AI and Manegarm Skunkworks (rules 6.9.4g, 1.16.11b)', () => {
  it('counts a rezzed Manegarm in the cost of a run', () => {
    // Without it: 0.7. With it: 2 clicks more (-2), a little back for an upgrade worth trashing
    expect(runScore(manegarmGame(4, 7), 'rd')).toBeLessThan(runScore(manegarmGame(4, 7, false), 'rd') - 1);
  });

  it("doesn't start a run it can't pay Manegarm for", () => {
    // 2 clicks: the run takes one, Bumi's subroutines are tanked, 1 click and 4 credits can't pay Manegarm
    const state = manegarmGame(2, 4);
    state.corp.servers.rd.ice = [];
    expect(runScore(state, 'rd')).toBe(-Infinity);
    state.runner.credits = 5;
    expect(runScore(state, 'rd')).toBeGreaterThan(-Infinity);
  });

  it('values the server it is running while the run is on', () => {
    const s = runToManegarm(manegarmGame(5, 7));
    expect(s.activeRun).toBeTruthy();
    expect(serverValue(s, 'rd')).toBeGreaterThan(3);
  });

  it('pays Manegarm with its spare clicks instead of ending the run', () => {
    // Jeff's game: Bumi broken with 2 clicks, 2 clicks and credits left at Manegarm
    const s = runToManegarm(manegarmGame(5, 7));
    const prompt = activePrompt(s)!;
    expect(prompt.kind === 'effect_choice' && prompt.source.cardCode).toBe(MANEGARM);
    // Clicks are priced by the best plays in hand (plan.clickByPlay): with nothing to play they are cheap
    s.runner.grip = [];
    const action = new HeuristicRunnerAI().chooseAction(s);
    expect(action.type === 'RESOLVE_PROMPT' && action.choice.kind === 'effect_choice' && action.choice.optionId).toBe('clicks');
  });

  it('keeps its clicks for strong installs in hand when the access is worth less (plan.clickByPlay)', () => {
    // Carmen and Marjanah in grip: 2 clicks buy more than one early R&D access.
    // Checked at a slower run pace (fewer, less successful runs): at the measured pace the access wins
    const pace = PACE as unknown as Record<string, number>;
    const saved = { ...pace };
    Object.assign(pace, { runs: 0.9, success: 0.6, hqShare: 0.3, rdShare: 0.35, remoteShare: 0.35 });
    try {
      const s = runToManegarm(manegarmGame(5, 7));
      const action = new HeuristicRunnerAI().chooseAction(s);
      expect(action.type === 'RESOLVE_PROMPT' && action.choice.kind === 'effect_choice' && action.choice.optionId).toBe('end');
    } finally {
      Object.assign(pace, saved);
    }
  });

  it('pays 5 credits when it has no clicks to spare and the access is worth it', () => {
    // Late in the game an R&D access is worth more than 5 credits (plan.runModel: steals on the point clock)
    const start = manegarmGame(4, 12);
    start.corp.score = 5;
    start.runner.score = 5;
    const s = runToManegarm(start);
    expect(s.runner.clicks).toBeLessThan(2);
    const action = new HeuristicRunnerAI().chooseAction(s);
    expect(action.type === 'RESOLVE_PROMPT' && action.choice.kind === 'effect_choice' && action.choice.optionId).toBe('pay');
  });

  it("keeps 2 clicks for Manegarm instead of breaking every bioroid subroutine when credits can't cover it", () => {
    const s = runToManegarm(manegarmGame(4, 3));
    const prompt = activePrompt(s);
    expect(prompt?.kind === 'effect_choice' && prompt.source.cardCode).toBe(MANEGARM);
    expect(s.runner.clicks).toBe(2);
  });
});
