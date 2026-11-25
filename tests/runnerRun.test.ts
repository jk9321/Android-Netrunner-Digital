import { describe, expect, it, vi } from 'vitest';
import { GameAction, GameState, getLegalActions } from '../src/core';
import { availableCredits } from '../src/core/engine/cardEffects';
import { encounteredIce, iceSubroutines } from '../src/core/engine/ice';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { approachClickReserve, runAction } from '../src/ai/runner/run';
import { RUNNER_TERMS } from '../src/ai/runner/terms';
import { bestBreakPlan, creditsAhead, needsBiggerHand, planCost, subroutineCost, tankDamage } from '../src/ai/runs';
import { asSide } from '../src/ai/pricing';
import { installCorpForTest, installIceForTest, installProgramForTest, newGame, runIntoFirstIce, runnerInstall, startRunnerTurn, step } from './helpers';

/**
 * R-B B2 bar 10 (brief netrunner-ai/runner-rework/briefs/b2-run.md rev 1; red team 2026-11-25 findings 6 and 9): the
 * decision during a run, moved into src/ai/runner/run.ts, on one board per branch, the branches the pools reach rarely
 * or never among them (Banner, Ansel 2.0's pair click, N-Pot's credits, the 0.5 margin deciding, the run-ending bioroid click that stands in
 * for the unreachable fallback click). Each answer was
 * RECORDED ON THE BASE (beta 57b02d6, before run.ts existed) through the agent (`new HeuristicRunnerAI().chooseAction`),
 * and here must be the same from run.ts's runAction, called inside asSide('runner') on the Runner's turn (the scope every
 * caller gives it), and from the agent. The branch each board takes was read on the base with
 * scripts/runner-rework/core-reach.ts's counters (the comment on each row).
 *
 * Bar 2: each planted fault of the lockstep (scripts/runner-rework/core-faults.ts) shown to change its input on a unit
 * state first.
 */

// A mutable copy of the terms, so the bar 2 test can move one by 1e-9 (the fault's own patch moves the literal instead)
vi.mock('../src/ai/runner/terms', async importOriginal => {
  const m = await importOriginal<typeof import('../src/ai/runner/terms')>();
  return { RUNNER_TERMS: { ...m.RUNNER_TERMS } };
});

const PALISADE = '30072'; // barrier, end the run; 4 strength on a remote
const CLEAVER = '30006'; // fracter, 3 strength: 1 credit breaks up to 2 barrier subroutines, 2 credits +1 strength
const TITHE = '30073'; // sentry: 1 net damage; the Corp gains 1 credit
const BUMI = '35041'; // bioroid sentry: lose a click to break 1 subroutine
const BRAN = '30039'; // bioroid barrier: lose a click to break 1 subroutine; install ice inward, end the run, end the run
const MANEGARM = '30042'; // upgrade: on approach, end the run unless the Runner spends 2 clicks or pays 5 credits
const BOTULUS = '30004'; // trojan: a hosted virus counter breaks 1 subroutine on its host
const BANNER = '34005'; // fracter: 2 credits, the barrier's subroutines cannot end the run this encounter
const ANSEL2 = '36028'; // bioroid sentry: lose 2 clicks to break up to 2 subroutines
const NPOT = '35064'; // code gate: 3 credits to break 1 subroutine (the Runner's own ability)
const WHITESPACE = '30074'; // code gate: the Runner loses 3 credits; end the run if it has 6 or less
const SANG_KANCIL = '35020'; // decoder, 2 strength: 1 credit breaks 1 code gate subroutine
const KARUNA = '30047'; // sentry, 3 strength: 2 net damage, twice
const CARMEN = '30015'; // killer, 2 strength
const DOOMSCROLL = '35063'; // sentry: a tag, 1 net damage, 2 net damage with 2 tags
const ECHELON = '30025'; // killer, 1 strength per installed icebreaker
const URTICA = '30045'; // Urtica Cipher, an advanceable trap

/** A remote-9 built by `build`, the Runner in the encounter with its outermost ice, then `set` on that state. */
function remote(build: (s: GameState) => void, set: (s: GameState) => void = () => {}): GameState {
  const state = newGame();
  build(state);
  const s = runIntoFirstIce(state, 'remote-9');
  set(s);
  return s;
}

const BOARDS: Record<string, () => GameState> = {
  // After passing the outer Tithe: the inner Palisade needs 3 (one boost, one break)
  'jackOut(2)': () => jackOut(2),
  'jackOut(3)': () => jackOut(3),
  fullBreak: () => remote(s => (installIceForTest(s, PALISADE, 'remote-9'), installProgramForTest(s, CLEAVER)), s => void (s.runner.credits = 6)),
  'etrOnly(1)': () => remote(s => (installIceForTest(s, WHITESPACE, 'remote-9'), installProgramForTest(s, SANG_KANCIL)), s => void (s.runner.credits = 1)),
  tank: () => remote(s => void installIceForTest(s, TITHE, 'remote-9'), s => void (s.runner.credits = 5)),
  'bioroid(3)': () => remote(s => void installIceForTest(s, BUMI, 'remote-9'), s => ((s.runner.clicks = 3), (s.runner.credits = 0))),
  // The bioroid fallback click (base runnerAI.ts:220-221) is unreachable on a bioroid: its input, a run-ending
  // subroutine with a click to break it, is answered by the bioroid block first (the run-ending click, no reserve test)
  bioroidEtr: () => remote(s => void installIceForTest(s, BRAN, 'remote-9'), s => ((s.runner.clicks = 3), (s.runner.credits = 0))),
  'manegarm(3)': () => manegarm(3),
  'manegarm(2)': () => manegarm(2),
  botulus: () => {
    const state = newGame();
    const ice = installIceForTest(state, PALISADE, 'remote-9');
    const [s1] = runnerInstall(state, BOTULUS, ice);
    const s = runIntoFirstIce(s1, 'remote-9');
    s.runner.credits = 6;
    return s;
  },
  'lethal(3)': () => remote(s => (installIceForTest(s, KARUNA, 'remote-9'), installProgramForTest(s, CARMEN)), s => ((s.runner.credits = 8), s.runner.grip.splice(3))),
  // Banner used this encounter (its effect set on the state): the barrier's "End the run." is priced 0
  banner: () => remote(s => (installIceForTest(s, PALISADE, 'remote-9'), installProgramForTest(s, BANNER)), s => ((s.runner.credits = 6), (s.activeRun!.encounter!.cannotEndRun = true))),
  ansel: () => remote(s => void installIceForTest(s, ANSEL2, 'remote-9'), s => ((s.runner.clicks = 3), (s.runner.credits = 0))),
  npot: () => remote(s => void installIceForTest(s, NPOT, 'remote-9'), s => void (s.runner.credits = 9)),
  // Echelon on Doomscroll: the full break's plan costs 5, the tank 4.5, inside the 0.5 margin
  margin: () => remote(s => (installIceForTest(s, DOOMSCROLL, 'remote-9'), installProgramForTest(s, ECHELON)), s => ((s.runner.credits = 9), (s.runner.clicks = 3))),
};
function jackOut(credits: number): GameState {
  let s = remote(st => (installIceForTest(st, PALISADE, 'remote-9'), installIceForTest(st, TITHE, 'remote-9'), installProgramForTest(st, CLEAVER)));
  for (let i = 0; i < 6 && s.activeRun && s.activeRun.phase !== 'movement'; i++) s = step(s);
  s.runner.credits = credits;
  return s;
}
function manegarm(clicks: number): GameState {
  return remote(
    s => (installIceForTest(s, BUMI, 'remote-9'), installCorpForTest(s, MANEGARM, 'remote-9', true)),
    s => ((s.runner.clicks = clicks), (s.runner.credits = 0)),
  );
}

/** Recorded on beta 57b02d6 through the agent (see the file comment); the branch the base took, as core-reach.ts names it. */
const RECORDED: Record<string, GameAction> = {
  'jackOut(2)': { type: 'JACK_OUT', player: 'runner' }, // move.asked, jackout
  'jackOut(3)': { type: 'CONTINUE_RUN', player: 'runner' }, // move.asked, jackout.equal, continue
  fullBreak: { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: 'inst-64' }, // full
  'etrOnly(1)': { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: 'inst-64', subroutineIndices: [1] }, // etrOnly
  tank: { type: 'CONTINUE_RUN', player: 'runner' }, // end, enc.continue (nothing to break with: the subroutines resolve)
  'bioroid(3)': { type: 'BIOROID_BREAK', player: 'runner', subroutineIndex: 1 }, // bioroid.spare (no Manegarm)
  bioroidEtr: { type: 'BIOROID_BREAK', player: 'runner', subroutineIndex: 1 }, // bioroid.etr (the fallback's input)
  'manegarm(3)': { type: 'BIOROID_BREAK', player: 'runner', subroutineIndex: 1 }, // reserve.read, bioroid.spare
  'manegarm(2)': { type: 'CONTINUE_RUN', player: 'runner' }, // reserve.read, reserve.held, end
  botulus: { type: 'USE_ABILITY', player: 'runner', cardInstanceId: 'inst-64', abilityIndex: 0 }, // botulus
  'lethal(3)': { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: 'inst-64' }, // lethal, full
  banner: { type: 'CONTINUE_RUN', player: 'runner' }, // banner, none
  ansel: { type: 'BIOROID_BREAK', player: 'runner', subroutineIndex: 2, subroutineIndices: [2, 3] }, // bioroid.pair
  npot: { type: 'BIOROID_BREAK', player: 'runner', subroutineIndex: 0 }, // selfBreak.npot
  margin: { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: 'inst-64' }, // margin.window, full.margin
};

describe("the decision during a run (runner/run.ts), board by board, as the base's agent answered", () => {
  for (const name of Object.keys(RECORDED)) {
    it(name, () => {
      const s = BOARDS[name]();
      expect(s.activePlayer).toBe('runner');
      expect(s.activeRun).toBeTruthy();
      const legal = getLegalActions(s, 'runner');
      expect(asSide('runner', () => runAction(s, legal) ?? legal[0])).toEqual(RECORDED[name]);
      expect(new HeuristicRunnerAI().chooseAction(s)).toEqual(RECORDED[name]);
    });
  }
});

describe('bar 2: each planted fault changes its input on a unit state', () => {
  it("the jack-out test made '>=' (jackOutEqual): with exactly the credits the ice ahead needs, the test is asked and the two forms differ", () => {
    const s = jackOut(3);
    asSide('runner', () => {
      expect(creditsAhead(s)).toBe(availableCredits(s, 'runner'));
      expect(getLegalActions(s, 'runner').some(a => a.type === 'JACK_OUT')).toBe(true);
    });
  });
  it('the tanking margin 0.5 made 0 (marginZero): the full break costs more than the tank and at most 0.5 more', () => {
    const s = BOARDS.margin();
    asSide('runner', () => {
      const ice = encounteredIce(s)!;
      const subs = iceSubroutines(s, ice).map((x, i) => ({ i, label: x.label, cost: subroutineCost(s, x.label) }));
      const lethal = tankDamage(s, subs).lethal;
      for (const x of subs) if (x.i === lethal) x.cost = Infinity;
      const must = subs.filter(x => x.cost >= 1);
      const tank = must.reduce((n, x) => n + x.cost, 0);
      const plan = planCost(bestBreakPlan(s, ice, must.length)!);
      expect(plan).toBeGreaterThan(tank);
      expect(plan).toBeLessThanOrEqual(tank + 0.5);
    });
  });
  it('the click reserve returning 0 (reserveZero): the Manegarm reserve is 2 and holds the spare click', () => {
    const s = manegarm(2);
    asSide('runner', () => {
      expect(approachClickReserve(s)).toBe(2);
      expect(s.runner.clicks - 1).toBeLessThan(approachClickReserve(s));
    });
  });
  it("a term moved by 1e-9 (bigHand): the big-hand draw's score moves by the same", () => {
    const s = newGame();
    startRunnerTurn(s);
    installCorpForTest(s, URTICA, 'remote-9');
    s.corp.servers['remote-9'].root[0].advancementCounters = 2;
    s.runner.grip.splice(1);
    const draw = () => asSide('runner', () => new HeuristicRunnerAI().rankMainActions(s).find(x => x.action.type === 'DRAW_CARD')!.score);
    expect(asSide('runner', () => needsBiggerHand(s))).toBe(true);
    const terms = RUNNER_TERMS as { bigHandDraw: number };
    const was = terms.bigHandDraw;
    const before = draw();
    try {
      terms.bigHandDraw = was + 1e-9;
      expect(draw()).not.toBe(before);
      expect(draw() - before).toBeCloseTo(1e-9, 12);
    } finally {
      terms.bigHandDraw = was;
    }
    expect(draw()).toBe(before);
  });
});
