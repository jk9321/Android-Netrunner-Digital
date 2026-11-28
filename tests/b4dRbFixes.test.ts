/**
 * B4d (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/b4d-rb-fixes.md rev 2), bar 1: one pin per fault,
 * each red on beta 0b9d44a and green on the branch, with its control where the brief asks for one. Boards from Gemini's
 * checkpoint audit, the exploit hunt (adversarial/2026-11-27-rb-checkpoint-hunt/states), the Fable audit's probes and
 * the red team's (adversarial/2026-11-27-b4d-rb-fixes/probes).
 */
import { describe, expect, it } from 'vitest';
import { GameState, executeAction, getLegalActions } from '../src/core';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { asSide } from '../src/ai/pricing';
import { installIceForTest, installProgramForTest, newGame, runIntoFirstIce } from './helpers';

const BOTO = '34109';
const CLEAVER = '30006';
const KARUNA = '30047';
const CARMEN = '30015';
const PALISADE = '30072';

/** The run played to its end by the deciding Runner (the Corp passes, answers its prompts with the first answer). */
function playRun(s0: GameState, max = 40): { winner: string | null; acts: string[] } {
  let s = s0;
  const ai = new HeuristicRunnerAI();
  const acts: string[] = [];
  for (let i = 0; i < max && s.activeRun && !s.winner; i++) {
    const corpPrompt = s.pendingPrompts[0]?.side === 'corp';
    const runnerLegal = corpPrompt ? [] : getLegalActions(s, 'runner');
    if (runnerLegal.length === 0) {
      const legal = getLegalActions(s, 'corp');
      if (!legal.length) break;
      const a = legal.find(x => x.type === 'RESOLVE_PROMPT') ?? legal.find(x => x.type === 'CONTINUE_RUN' || x.type === 'PASS') ?? legal[0];
      acts.push(`corp:${a.type}`);
      s = executeAction(s, a);
      continue;
    }
    const a = asSide('runner', () => ai.chooseAction(s));
    acts.push(a.type);
    s = executeAction(s, a);
  }
  return { winner: s.winner ?? null, acts };
}

describe('B4d (f): a subroutine that would flatline is broken with all the credits (rules 1.7.2b, 10.4.4)', () => {
  /** Outer Karunā (2 net, 2 net) before Palisade on a remote, Carmen, 4 credits, 1 card in the grip (Gemini's boards). */
  function karuna(cleaver: boolean): GameState {
    const state = newGame();
    installIceForTest(state, PALISADE, 'remote-9');
    installIceForTest(state, KARUNA, 'remote-9');
    installProgramForTest(state, CARMEN);
    if (cleaver) installProgramForTest(state, CLEAVER);
    const s = runIntoFirstIce(state, 'remote-9');
    s.runner.credits = 4;
    s.runner.grip.splice(1);
    return s;
  }
  it('Karunā before an unbreakable Palisade: breaks both damage subroutines, then jacks out (was flatlined)', () => {
    const { winner, acts } = playRun(karuna(false));
    expect(winner).toBeNull();
    expect(acts).toContain('JACK_OUT');
  });
  it('Karunā before a Palisade Cleaver can break (creditsAhead 3): not flatlined', () => {
    expect(playRun(karuna(true)).winner).toBeNull();
  });

  /** RT1: Boto alone (2 net, then two "trash 1 card from HQ to end the run"), Cleaver, 1 card in the grip. */
  function boto(credits: number): GameState {
    const state = newGame();
    installIceForTest(state, BOTO, 'remote-9');
    installProgramForTest(state, CLEAVER);
    const s = runIntoFirstIce(state, 'remote-9');
    s.runner.credits = credits;
    s.runner.grip.splice(1);
    return s;
  }
  it('RT1: Boto alone at 3 credits (creditsAhead 0): breaks the damage subroutine and lives (was flatlined)', () => {
    expect(playRun(boto(3)).winner).toBeNull();
  });
  it('RT1 control: Boto at 4 credits breaks everything and lives', () => {
    const { winner, acts } = playRun(boto(4));
    expect(winner).toBeNull();
    expect(acts.filter(a => a === 'BREAK_SUBROUTINE').length).toBe(2);
  });
});
