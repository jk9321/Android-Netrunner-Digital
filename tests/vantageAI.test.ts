import { describe, expect, it } from 'vitest';
import { activePrompt, ALL_CARDS, cardDef, createCardInstance, executeAction, GameState, getLegalActions } from '../src/core';
import { accessWorth } from '../src/ai/effectValues';
import { answerPrompt, meliesSide } from '../src/ai/prompts';
import { bestBreakPlan, chainReactionBonus, runBudget, runScore, tagCost } from '../src/ai/runs';
import { myoshuSaving, perfectRecallTarget } from '../src/ai/corpAI';
import { stealthCreditWorth } from '../src/ai/counterValues';
import { createAgent } from '../src/ai';
import { giveCard, installIceForTest, installProgramForTest, newGame, play, run, runIntoFirstIce, runnerInstall, setIdentity, startRunnerTurn } from './helpers';

const V = { caveat: '36032', corsair: '36004', methuselah: '36020', baker: '36015', ansel2: '36028', paywall: '36052', grubber: '36050' };
const agendaWorth = (points: number) => ALL_CARDS.find(d => d.type_code === 'agenda' && d.agenda_points === points && d.pack_code === 'sg')!.code;
const AGENDA_2 = agendaWorth(2);
const AGENDA_3 = agendaWorth(3);
const CHAIN_REACTION = '36001';

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

  it('Chain Reaction: a run on a central it still needs earns a share of the play, while the clicks last', () => {
    const s = newGame();
    startRunnerTurn(s);
    installIceForTest(s, V.grubber, 'hq');
    installIceForTest(s, V.paywall, 'rd');
    expect(chainReactionBonus(s, 'archives')).toBe(0); // not in the grip
    giveCard(s, 'runner', CHAIN_REACTION);
    s.runner.clicks = 4;
    const first = chainReactionBonus(s, 'archives');
    expect(first).toBeGreaterThan(0);
    s.runsThisTurn.push({ server: 'archives', successful: true });
    expect(chainReactionBonus(s, 'archives')).toBe(0); // done already
    s.runner.clicks = 3;
    expect(chainReactionBonus(s, 'hq')).toBeCloseTo(first * 1.5); // 2 left to run
    s.runner.clicks = 2;
    expect(chainReactionBonus(s, 'hq')).toBe(0); // no click left to play it after the runs
  });

  it('Myōshu: saves toward 10 credits with an agenda installed on an earlier turn, and keeps them', () => {
    const s = newGame();
    s.corp.hq.push(createCardInstance(s, '36061'));
    expect(myoshuSaving(s)).toBe(false); // no older agenda out
    const agenda = createCardInstance(s, AGENDA_2);
    agenda.installedTurn = 'earlier';
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote Server 1', isRemote: true, ice: [], root: [agenda] };
    s.corp.credits = 6;
    s.corp.clicks = 3;
    expect(myoshuSaving(s)).toBe(true);
    expect(myoshuSaving(s, true)).toBe(false);
    s.corp.credits = 10;
    expect(myoshuSaving(s, true)).toBe(true);
  });

  it('plans runs with the credits that pay only during runs (Methuselah, Touchstone)', () => {
    const s = newGame();
    startRunnerTurn(s);
    const pool = runBudget(s);
    methuselah(s, 2);
    expect(runBudget(s)).toBe(pool + 2);
  });

  it('Rotary: takes the tag for the extra access when an access is worth more than the tag', () => {
    let s = newGame();
    startRunnerTurn(s);
    setIdentity(s, 'runner', '36009'); // Vic: the first tag a turn is cheap
    [s] = runnerInstall(s, '36014');
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    for (let i = 0; i < 30 && s.activeRun; i++) {
      const p = activePrompt(s);
      if (p?.kind === 'effect_choice' && p.source.cardCode === '36014') {
        const a = answerPrompt(s, 'runner');
        expect(a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'effect_choice' && a.choice.optionId).toBe(accessWorth(s) > tagCost(s) ? 'tag' : 'no');
        expect(accessWorth(s)).toBeGreaterThan(tagCost(s));
        return;
      }
      s = executeAction(s, createAgent(p?.side ?? 'runner', 'normal').chooseAction(s));
    }
    throw new Error('no Rotary prompt');
  });

  it('Methuselah: feeds it only a copy of installed hardware, never a card it still wants (Jeff, Sourdough)', () => {
    let s = newGame();
    startRunnerTurn(s);
    [s] = runnerInstall(s, V.methuselah);
    s.runner.grip = [];
    s.runner.credits = 10;
    giveCard(s, 'runner', '36021');
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    let a = answerPrompt(s, 'runner');
    expect(a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'effect_cards' && a.choice.cardInstanceIds).toEqual([]);
    s = newGame();
    startRunnerTurn(s);
    [s] = runnerInstall(s, V.methuselah);
    s.runner.grip = [];
    giveCard(s, 'runner', '36021');
    const copy = giveCard(s, 'runner', V.methuselah);
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    a = answerPrompt(s, 'runner');
    expect(a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'effect_cards' && a.choice.cardInstanceIds).toEqual([copy]);
  });

  it('Baker: the first stealth credit is worth a Baker run past central ice, the rest run money', () => {
    let s = newGame();
    startRunnerTurn(s);
    expect(stealthCreditWorth(s)).toBeCloseTo(0.9); // no Baker
    [s] = runnerInstall(s, V.baker);
    methuselah(s, 0);
    const first = stealthCreditWorth(s);
    expect(first).toBeGreaterThan(2);
    s.runner.rig.hardware.at(-1)!.tokens.credit = 3;
    expect(stealthCreditWorth(s)).toBeLessThan(first);
  });
});

