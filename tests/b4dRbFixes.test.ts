/**
 * B4d (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/b4d-rb-fixes.md rev 2), bar 1: one pin per fault,
 * each red on beta 0b9d44a and green on the branch, with its control where the brief asks for one. Boards from Gemini's
 * checkpoint audit, the exploit hunt (adversarial/2026-11-27-rb-checkpoint-hunt/states), the Fable audit's probes and
 * the red team's (adversarial/2026-11-27-b4d-rb-fixes/probes).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, createCardInstance, executeAction, getLegalActions } from '../src/core';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { GameRunner } from '../src/ai/playout';
import { asSide } from '../src/ai/pricing';
import { runScore } from '../src/ai/runs';
import { inDecision } from './helpers/pricing';
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

/** A hunt board (adversarial/2026-11-27-rb-checkpoint-hunt/states, copied to tests/fixtures/b4d). */
const board = (file: string): GameState => {
  const raw = JSON.parse(readFileSync(`tests/fixtures/b4d/${file}`, 'utf8'));
  return raw.state ?? raw;
};
/** The rest of the Runner's turn, played by the deciding Runner (planner on) against the rule-based Corp. */
function playTurn(s0: GameState, max = 400): { runs: string[]; end: GameState } {
  const g = new GameRunner(structuredClone(s0), { corp: new HeuristicCorpAI({ planner: false }), runner: new HeuristicRunnerAI({ planner: true }) });
  const runs: string[] = [];
  for (let i = 0; i < max && !g.state.winner; i++) {
    if (!g.step()) break;
    const a = g.last;
    if (a?.type === 'INITIATE_RUN') runs.push(a.targetServerId);
    if (g.state.activePlayer !== s0.activePlayer) break;
  }
  return { runs, end: g.state };
}
const spinDoctorLeft = (s: GameState, server: string) => s.corp.servers[server]?.root.some(c => c.cardCode === '30053') ?? false;

describe('B4d (d): a trash is priced on the credits left at the access, after the ice (hunt finding 1)', () => {
  const seed110 = (credits: number) => {
    const s = board('hunt-seed110-T5-2c-2k.json');
    s.runner.credits = credits;
    return s;
  };
  const seed217 = (credits: number) => {
    const s = board('hunt-seed217-T16.json');
    s.runner.credits = credits;
    return s;
  };
  /** The run's price on the board (the root known: the Runner saw both cards) and the turn as played. */
  const priced = (s: GameState, server: string) => {
    const memory = new Map(s.corp.servers[server].root.map(c => [c.instanceId, c.cardCode]));
    return inDecision(s, 'runner', () => runScore(s, server, { memory, wary: true }));
  };
  const fruitless = (s: GameState, server: string) => {
    const { runs, end } = playTurn(s);
    return runs.includes(server) && spinDoctorLeft(end, server);
  };
  it('seed 110 [Flyswatter | Spin Doctor], 2 credits 2 clicks: no run on remote-1 (was a run that cannot trash)', () => {
    const s = seed110(2);
    expect(priced(s, 'remote-1') ?? -Infinity).toBeLessThanOrEqual(0);
    expect(playTurn(s).runs).not.toContain('remote-1');
  });
  it('seed 110 counter-pin (RT7): at 3 credits the Runner runs remote-1 and trashes Spin Doctor', () => {
    const { runs, end } = playTurn(seed110(3));
    expect(runs).toContain('remote-1');
    expect(spinDoctorLeft(end, 'remote-1')).toBe(false);
  });
  for (const credits of [4, 5])
    it(`seed 217 [Lamplighter | Spin Doctor], ${credits} credits: no run on remote-6 that cannot trash (Carmen spends 4 on the ice)`, () => {
      const s = seed217(credits);
      expect(priced(s, 'remote-6') ?? -Infinity).toBeLessThanOrEqual(0);
      // A credit event first (5 credits: Sure Gamble to 9) makes the run worth it: what is pinned is the run that cannot trash
      expect(fruitless(s, 'remote-6')).toBe(false);
    });
  it('seed 217 counter-pin (RT7): at 7 credits the Runner runs remote-6 and trashes Spin Doctor', () => {
    const { runs, end } = playTurn(seed217(7));
    expect(runs).toContain('remote-6');
    expect(spinDoctorLeft(end, 'remote-6')).toBe(false);
  });
  // R-14l (R-C1, the walk's end board) replaces the stopgap owner: the run's price counts only the ice's run-ending
  // breaks (icePrice prices Tithe's tank at 0 credits), while encounterAction breaks every subroutine priced 1 or more
  // (src/ai/runner/run.ts must-break floor), so the trash stays priced at 2 credits and the run leaves 1 (red team RT4, D2)
  it.fails('R-14l known failure (D2): Tithe in Flyswatter\'s place, Carmen installed: no run on remote-1 at 2 credits', () => {
    const s = seed110(2);
    const tithe = createCardInstance(s, '30073');
    tithe.isRezzed = true;
    s.corp.servers['remote-1'].ice = [tithe];
    installProgramForTest(s, CARMEN);
    const memory = new Map(s.corp.servers['remote-1'].root.map(c => [c.instanceId, c.cardCode]));
    const score = inDecision(s, 'runner', () => runScore(s, 'remote-1', { memory, wary: true }));
    expect(score === null || score <= 0).toBe(true);
  });
});
