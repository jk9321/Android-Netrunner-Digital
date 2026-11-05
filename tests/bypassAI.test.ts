import { describe, expect, it } from 'vitest';
import { GameState, actingSide, createCardInstance, executeAction } from '../src/core';
import { answerPrompt, runEventOptions } from '../src/ai/prompts';
import { creditsAhead, runScore, runShortfall } from '../src/ai/runs';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { tuning } from '../src/ai/synergy';
import { cont, giveCard, installIceForTest, installProgramForTest, newGame, run, startRunnerTurn } from './helpers';

const S_DOBRADO = '34012';
const WINDOW = '34077';
const MALANDRAGEM = '34081';
const LASER_POINTER = '34016';
const PHYSARUM = '34082';
const PALISADE = '30072'; // Barrier, strength 2: End the run
const SEMAK_SAMUN = '35054'; // Barrier - AP: End the run unless the Runner suffers 3 net damage
const WHITESPACE = '30074'; // Code Gate: lose 3 credits; end the run if the Runner has 6 credits or less
const AGENDA = '30067';
const SURE_GAMBLE = '30030';
const TITHE = '30073'; // Sentry - AP: 1 net damage, the Corp gains 1
const ALARM_CLOCK = '34078';
const CLEAVER = '30006'; // Fracter: 1 credit breaks up to 2 barrier subroutines

/**
 * Jeff (2026-11-05): are the Mercury bypass cards used and valued right? In
 * 16 self-play games S-Dobrado was played 1 turn of 50 it was held, and one
 * bypass was taken. Run pricing knew nothing about bypass (rules 6.5.8: a
 * bypassed ice's subroutines are neither broken nor resolved), and a "bypass
 * this ice?" prompt only saw what the bypass costs, never the encounter it skips.
 */
describe('Runner AI bypass (plan.bypass)', () => {
  function setup(): GameState {
    const s = newGame();
    startRunnerTurn(s);
    installIceForTest(s, PALISADE, 'hq'); // no breakers: HQ and R&D are shut
    installIceForTest(s, PALISADE, 'rd');
    s.corp.hq = Array.from({ length: 5 }, () => createCardInstance(s, AGENDA));
    s.runner.grip = [];
    for (let i = 0; i < 5; i++) giveCard(s, 'runner', SURE_GAMBLE); // Sure Gambles: a full grip
    s.runner.credits = 5;
    return s;
  }
  const withPlan = <T,>(on: boolean, work: () => T): T => {
    const was = tuning.plan.bypass;
    tuning.plan.bypass = on;
    try {
      return work();
    } finally {
      tuning.plan.bypass = was;
    }
  };

  it('S-Dobrado: the first ice encountered is free (rules 6.5.8a)', () => {
    const s = setup();
    expect(runScore(s, 'hq')).toBe(-Infinity);
    expect(withPlan(false, () => runScore(s, 'hq', runEventOptions(S_DOBRADO, s)))).toBe(-Infinity);
    expect(runScore(s, 'hq', runEventOptions(S_DOBRADO, s))).toBeGreaterThan(0);
  });

  it('S-Dobrado bypasses only the outermost ice: a second blocking ice still keeps it out below threat 4', () => {
    const s = setup();
    installIceForTest(s, PALISADE, 'hq');
    expect(runScore(s, 'hq', runEventOptions(S_DOBRADO, s))).toBe(-Infinity);
    s.runner.score = 4; // threat 4: a click bypasses the second
    expect(runScore(s, 'hq', runEventOptions(S_DOBRADO, s))).toBeGreaterThan(0);
  });

  it('the AI plays S-Dobrado into HQ when its ice keeps a plain run out', () => {
    const s = setup();
    s.runner.score = 5;
    for (let i = 0; i < 5; i++) giveCard(s, 'runner', S_DOBRADO);
    const ai = new HeuristicRunnerAI();
    let state = s;
    for (let i = 0; i < 40 && state.activePlayer === 'runner' && !state.winner; i++) state = executeAction(state, ai.chooseAction(state));
    expect(state.runner.heap.some(c => c.cardCode === S_DOBRADO)).toBe(true);
    expect(state.winner).toBe('runner');
  });

  it('Window of Opportunity: ice the Corp cannot rez again is not encountered (6.9.1c, 6.9.2c)', () => {
    const s = setup();
    s.corp.credits = 0;
    expect(runScore(s, 'hq', runEventOptions(WINDOW, s))).toBeGreaterThan(0);
    s.corp.credits = 10; // the Corp rezzes it again: the Runner still has no way past
    expect(runScore(s, 'hq', runEventOptions(WINDOW, s))).toBe(-Infinity);
  });

  it('Malandragem in the rig makes small ice passable, once a turn (counter price)', () => {
    const s = setup();
    const m = installProgramForTest(s, MALANDRAGEM);
    s.runner.rig.programs.find(c => c.instanceId === m)!.tokens.power = 2;
    expect(withPlan(false, () => runScore(s, 'hq'))).toBe(-Infinity);
    expect(runScore(s, 'hq')).toBeGreaterThan(0);
    expect(runShortfall(s, 'hq')).not.toBeNull();
    s.turnFlags[`once:${m}:0`] = 1; // used this turn
    expect(runScore(s, 'hq')).toBe(-Infinity);
  });

  it('Physarum Entangler prices its host at a credit a subroutine (not barriers)', () => {
    const s = setup();
    s.runner.credits = 3;
    s.corp.servers.hq.ice = [];
    const ws = installIceForTest(s, WHITESPACE, 'hq');
    expect(runShortfall(s, 'hq')).toBeNull();
    const p = installProgramForTest(s, PHYSARUM);
    s.runner.rig.programs.find(c => c.instanceId === p)!.hostedOnId = ws;
    expect(runShortfall(s, 'hq')).toBe(2 - 3);
    expect(runScore(s, 'hq')).toBeGreaterThan(0);
  });

  it('Laser Pointer is trashed to bypass AP ice that costs more than it is worth', () => {
    let s = setup();
    s.corp.servers.hq.ice = [];
    installIceForTest(s, SEMAK_SAMUN, 'hq');
    installProgramForTest(s, LASER_POINTER);
    s = cont(run(s, 'hq'));
    const prompt = s.pendingPrompts[0];
    expect(prompt && 'source' in prompt && prompt.source.step).toBe('bypass');
    const yes = answerPrompt(s, 'runner', undefined, true);
    expect(yes.type === 'RESOLVE_PROMPT' && yes.choice.kind === 'effect_choice' && yes.choice.optionId).toBe('yes');
  });

  it("Malandragem's bypass is taken on a Palisade it cannot break", () => {
    let s = setup();
    const m = installProgramForTest(s, MALANDRAGEM);
    s.runner.rig.programs.find(c => c.instanceId === m)!.tokens.power = 2;
    s = cont(run(s, 'hq'));
    const yes = answerPrompt(s, 'runner', undefined, true);
    expect(yes.type === 'RESOLVE_PROMPT' && yes.choice.kind === 'effect_choice' && yes.choice.optionId).toBe('counter');
  });

  it('keeps the Malandragem counter when a breaker gets through for a credit', () => {
    let s = setup();
    installProgramForTest(s, CLEAVER);
    const m = installProgramForTest(s, MALANDRAGEM);
    s.runner.rig.programs.find(c => c.instanceId === m)!.tokens.power = 2;
    s = cont(run(s, 'hq'));
    const no = answerPrompt(s, 'runner', undefined, true);
    expect(no.type === 'RESOLVE_PROMPT' && no.choice.kind === 'effect_choice' && no.choice.optionId).toBe('no');
  });

  it('the AI plays Window of Opportunity into HQ when the Corp cannot rez the ice again', () => {
    const s = setup();
    s.runner.score = 5;
    s.corp.credits = 0;
    for (let i = 0; i < 5; i++) giveCard(s, 'runner', WINDOW);
    const ai = { runner: new HeuristicRunnerAI(), corp: new HeuristicCorpAI() };
    let state = s;
    for (let i = 0; i < 60 && state.activePlayer === 'runner' && !state.winner; i++) state = executeAction(state, ai[actingSide(state) ?? 'runner'].chooseAction(state));
    expect(state.runner.heap.some(c => c.cardCode === WINDOW)).toBe(true);
    expect(state.winner).toBe('runner');
  });

  it('keeps no credits for ice further in that Malandragem will bypass (creditsAhead)', () => {
    let s = setup();
    s.corp.servers.hq.ice = [];
    installIceForTest(s, PALISADE, 'hq'); // inner: no breaker for it
    installIceForTest(s, TITHE, 'hq'); // outer: tanked
    const m = installProgramForTest(s, MALANDRAGEM);
    s.runner.rig.programs.find(c => c.instanceId === m)!.tokens.power = 2;
    s = cont(run(s, 'hq'));
    expect(s.activeRun?.encounter).toBeTruthy();
    expect(withPlan(false, () => creditsAhead(s))).toBe(Infinity);
    expect(creditsAhead(s)).toBe(0);
  });

  it('Alarm Clock: takes its HQ run when the 2-click bypass gets past HQ\u2019s ice', () => {
    const s = setup();
    s.runner.score = 5;
    const ac = createCardInstance(s, ALARM_CLOCK);
    ac.isRezzed = true;
    s.runner.rig.hardware.push(ac);
    expect(runScore(s, 'hq', { alarmClock: true })).toBeGreaterThan(0);
    expect(withPlan(false, () => runScore(s, 'hq', { alarmClock: true }))).toBe(-Infinity);
  });
});

