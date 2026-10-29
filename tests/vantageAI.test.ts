import { describe, expect, it } from 'vitest';
import { ALL_CARDS, cardDef, createCardInstance, GameState, getLegalActions } from '../src/core';
import { answerPrompt, meliesSide } from '../src/ai/prompts';
import { bestBreakPlan, runScore } from '../src/ai/runs';
import { perfectRecallTarget } from '../src/ai/corpAI';
import { createAgent } from '../src/ai';
import { giveCard, installIceForTest, installProgramForTest, newGame, play, run, runIntoFirstIce, startRunnerTurn } from './helpers';

const V = { caveat: '36032', corsair: '36004', methuselah: '36020', baker: '36015', ansel2: '36028', paywall: '36052', grubber: '36050' };
const agendaWorth = (points: number) => ALL_CARDS.find(d => d.type_code === 'agenda' && d.agenda_points === points && d.pack_code === 'sg')!.code;
const AGENDA_2 = agendaWorth(2);
const AGENDA_3 = agendaWorth(3);

function corpPlays(s: GameState, code: string, credits: number): GameState {
  s.activePlayer = 'corp';
  s.phase = 'corp_turn';
  s.turnStep = null;
  s.corp.clicks = 3;
  const id = giveCard(s, 'corp', code);
  s.corp.credits = credits;
  return play(s, 'corp', id);
}

/** A stealth console holding `credits` hosted credits. */
function methuselah(s: GameState, credits: number): void {
  const c = createCardInstance(s, V.methuselah);
  c.isRezzed = true;
  c.tokens.credit = credits;
  s.runner.rig.hardware.push(c);
}

describe('AI with Vantage Point cards', () => {
  it('Méliès U: varies the secret side by turn, mostly HQ and R&D', () => {
    const s = newGame();
    const picks: Record<string, number> = {};
    for (let t = 1; t <= 120; t++) {
      s.turnNumber = t;
      picks[meliesSide(s)] = (picks[meliesSide(s)] ?? 0) + 1;
    }
    expect(Object.keys(picks).sort()).toEqual(['archives', 'hq', 'rd']);
    expect(picks.archives).toBeLessThan(picks.hq);
    // Same game and turn: same pick
    s.turnNumber = 7;
    expect(meliesSide(s)).toBe(meliesSide(s));
  });

  it('Caveat Emptor: takes 6 and a Runner click unless the Corp is nearly broke', () => {
    let s = corpPlays(newGame(), V.caveat, 15);
    let a = answerPrompt(s, 'corp');
    expect(a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'effect_choice' && a.choice.optionId).toBe('six');
    s = corpPlays(newGame(), V.caveat, 5);
    a = answerPrompt(s, 'corp');
    expect(a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'effect_choice' && a.choice.optionId).toBe('ten');
  });

  it('Corsair: plans on its -3 strength ability only with stealth credits to pay for it', () => {
    const s = newGame();
    startRunnerTurn(s);
    installProgramForTest(s, V.corsair);
    const id = installIceForTest(s, V.grubber, 'hq'); // barrier, strength 5
    const grubber = s.corp.servers.hq.ice.find(c => c.instanceId === id)!;
    expect(bestBreakPlan(s, grubber, 2)).toBeNull();
    methuselah(s, 2);
    const plan = bestBreakPlan(s, grubber, 2);
    expect(plan?.breaker.cardCode).toBe(V.corsair);
    expect(plan?.boostsNeeded).toBe(2); // 5 strength: two -3s
    expect(plan?.credits).toBe(4); // 2 lowers and 2 breaks
  });

  it('Baker: a run on Archives is worth the best of HQ and R&D with a stealth credit', () => {
    const s = newGame();
    startRunnerTurn(s);
    const plain = runScore(s, 'archives');
    methuselah(s, 1);
    const baker = runScore(s, 'archives', { baker: true });
    expect(baker).toBeGreaterThan(Number.isFinite(plain) ? plain : -1e9);
  });

  it('Ansel 2.0: spends its 2 clicks on the two worst subroutines together', () => {
    let s = newGame();
    installIceForTest(s, V.ansel2, 'hq');
    s = runIntoFirstIce(s, 'hq');
    s.runner.clicks = 3;
    expect(s.activeRun?.encounter).toBeTruthy();
    const action = createAgent('runner', 'normal').chooseAction(s);
    expect(action.type).toBe('BIOROID_BREAK');
    if (action.type !== 'BIOROID_BREAK') return;
    expect(action.subroutineIndices).toHaveLength(2);
    expect(action.subroutineIndices).toContain(3); // end the run
    expect(getLegalActions(s, 'runner')).toContainEqual(action);
  });

  it('Perfect Recall: reveals the best agenda in HQ on an HQ run', () => {
    let s = newGame();
    s.corp.hq = s.corp.hq.filter(c => cardDef(c).type_code !== 'agenda');
    const small = createCardInstance(s, AGENDA_2);
    const big = createCardInstance(s, AGENDA_3);
    s.corp.hq.push(small, big);
    s = run(s, 'hq');
    expect(s.activeRun).toBeTruthy();
    expect(perfectRecallTarget(s)).toBe(big.instanceId);
  });
});
