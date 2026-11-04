import { describe, expect, it } from 'vitest';
import { answerPrompt, psiBid } from '../src/ai/prompts';
import { bestBreakPlan, knownSubroutineCost } from '../src/ai/runs';
import { giveCard, installIceForTest, installProgramForTest, newGame, run, scoreForTest, startRunnerTurn } from './helpers';
import { activePrompt, GameState } from '../src/core';

const L = { audrey: '34004', banner: '34005', lobisomem: '34090', spike: '34092', slap: '34026', ablative: '34034', valentao: '34060', piranhas: '34117', capacitor: '34116' };
const GRUBBER = '36050'; // barrier, strength 5, 2 subroutines

function iceOn(s: GameState, code: string, server = 'hq') {
  const id = installIceForTest(s, code, server);
  return s.corp.servers[server].ice.find(c => c.instanceId === id)!;
}
function program(s: GameState, code: string) {
  const id = installProgramForTest(s, code);
  return s.runner.rig.programs.find(c => c.instanceId === id)!;
}

describe('Liberation AI', () => {
  it('Psi Games: bids from a mix, only what it can pay, and never from the other side', () => {
    const bids = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = newGame(seed);
      bids.add(psiBid(s, 'corp', ['0', '1', '2']));
    }
    expect([...bids].sort()).toEqual(['0', '1', '2']);
    expect(psiBid(newGame(), 'runner', ['0'])).toBe('0');
  });

  it('Audrey v2: breaks with virus counters, and trashes grip cards for strength', () => {
    const s = newGame();
    startRunnerTurn(s);
    const audrey = program(s, L.audrey);
    const ice = iceOn(s, L.ablative); // barrier, strength 1, End the run
    expect(bestBreakPlan(s, ice, 1)).toBeNull();
    audrey.tokens.virus = 1;
    giveCard(s, 'runner', '30001');
    const plan = bestBreakPlan(s, ice, 1)!;
    expect(plan.breaker.instanceId).toBe(audrey.instanceId);
    expect(plan.boostsNeeded).toBe(1);
    s.runner.grip = [];
    expect(bestBreakPlan(s, ice, 1)).toBeNull();
  });

  it('Lobisomem: breaks barriers with its X ability while it has a power counter', () => {
    const s = newGame();
    startRunnerTurn(s);
    const lobisomem = program(s, L.lobisomem);
    const ice = iceOn(s, L.ablative);
    expect(bestBreakPlan(s, ice, 1)).toBeNull();
    lobisomem.tokens.power = 1;
    expect(bestBreakPlan(s, ice, 1)).toMatchObject({ breakByAbility: true, boostsNeeded: 0 });
  });

  it('Banner: 2 credits get it through a barrier that only ends the run', () => {
    const s = newGame();
    startRunnerTurn(s);
    program(s, L.banner);
    expect(bestBreakPlan(s, iceOn(s, L.ablative), 1)).toMatchObject({ credits: 2, breakByAbility: true });
    expect(bestBreakPlan(s, iceOn(s, GRUBBER, 'rd'), 2)).toBeNull(); // Grubber's subroutines do more than end the run
  });

  it('Pressure Spike: plans on +9 for 2 credits at threat 4', () => {
    const s = newGame();
    startRunnerTurn(s);
    program(s, L.spike);
    const ice = iceOn(s, GRUBBER);
    const normal = bestBreakPlan(s, ice, 2)!;
    expect(normal.boostByAbility).toBeFalsy();
    s.corp.score = 4;
    const spike = bestBreakPlan(s, ice, 2)!;
    expect(spike).toMatchObject({ boostByAbility: true, boostsNeeded: 1 });
    expect(spike.credits).toBeLessThan(normal.credits);
  });

  it('Slap Vandal: only plans on its host ice', () => {
    const s = newGame();
    startRunnerTurn(s);
    const host = iceOn(s, L.ablative);
    const other = iceOn(s, L.ablative, 'rd');
    const slap = program(s, L.slap);
    slap.hostedOnId = host.instanceId;
    expect(bestBreakPlan(s, host, 1)?.breaker.instanceId).toBe(slap.instanceId);
    expect(bestBreakPlan(s, other, 1)).toBeNull();
  });

  it('Lightning Laboratory: spends its counter on a run on HQ, not on Archives', () => {
    for (const [server, rezzes] of [['hq', 1], ['archives', 0]] as const) {
      let s = scoreForTest(newGame(), '34097');
      iceOn(s, GRUBBER, server).isRezzed = false;
      s = run(s, server);
      const prompt = activePrompt(s)!;
      expect(prompt.kind === 'effect_cards' && prompt.source.cardCode).toBe('34097');
      const action = answerPrompt(s, 'corp');
      expect(action.type === 'RESOLVE_PROMPT' && action.choice.kind === 'effect_cards' && action.choice.cardInstanceIds.length).toBe(rezzes);
    }
  });

  it('takes Salvo Testing's optional core damage', () => {
    const s = scoreForTest(newGame(), '34031');
    const salvo = answerPrompt(s, 'corp');
    expect(salvo.type === 'RESOLVE_PROMPT' && salvo.choice.kind === 'effect_choice' && salvo.choice.optionId).toBe('yes');
  });

  it('reads the conditional Liberation subroutines', () => {
    const s = newGame();
    s.corp.credits = 10;
    s.runner.credits = 2;
    expect(knownSubroutineCost(s, 'End the run if you have more credits than the Runner.')).toBe(Infinity);
    s.runner.credits = 20;
    expect(knownSubroutineCost(s, 'End the run if you have more credits than the Runner.')).toBeLessThan(Infinity);
    s.runner.tags = 0;
    expect(knownSubroutineCost(s, 'Gain 1 [credit] for each tag the Runner has.')).toBe(0);
  });
});
