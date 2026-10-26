import { describe, expect, it } from 'vitest';
import { HeuristicRunnerAI } from '../src/ai';
import { creditsAhead } from '../src/ai/runs';
import { installIceForTest, installProgramForTest, newGame, runIntoFirstIce } from './helpers';

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
