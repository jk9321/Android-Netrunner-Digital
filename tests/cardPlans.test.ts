import { describe, expect, it } from 'vitest';
import { CARD_PLANS, boardPlansWorth, handPlanWorth } from '../src/ai/cardPlans';
import { corpCardValue, evaluate } from '../src/ai/evaluate';
import { heldWorth } from '../src/ai/handValues';
import { ALL_CARDS, cardDef, createCardInstance, GameState } from '../src/core';
import { giveCard, newGame, runnerInstall, startRunnerTurn } from './helpers';

const AGENDA = ALL_CARDS.find(d => d.type_code === 'agenda' && d.agenda_points === 2 && d.pack_code === 'sg')!.code;

const inHand = (s: GameState, side: 'corp' | 'runner', code: string) => {
  const id = giveCard(s, side, code);
  return (side === 'corp' ? s.corp.hq : s.runner.grip).find(c => c.instanceId === id)!;
};

describe('card plans (Jeff, 2026-10-30; plan.cardPlans)', () => {
  it('every plan names a real card of its side', () => {
    for (const [code, plan] of Object.entries(CARD_PLANS)) {
      const s = newGame();
      expect(cardDef(createCardInstance(s, code)).side_code).toBe(plan.side);
    }
  });

  it('Myōshu is worth more in HQ as the Corp saves toward 10 credits with an older agenda out', () => {
    const s = newGame();
    const myoshu = inHand(s, 'corp', '36061');
    s.corp.credits = 2;
    const poor = handPlanWorth(s, myoshu)!;
    s.corp.credits = 9;
    const saved = handPlanWorth(s, myoshu)!;
    expect(saved).toBeGreaterThan(poor);
    const agenda = createCardInstance(s, AGENDA);
    agenda.installedTurn = 'earlier';
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote Server 1', isRemote: true, ice: [], root: [agenda] };
    s.corp.credits = 10;
    expect(handPlanWorth(s, myoshu)!).toBeGreaterThan(saved);
  });

  it('Myōshu: the planned turn values keeping the saved 10 credits by more than the old flat -1 (retires myoshuSaving)', async () => {
    const { tuning } = await import('../src/ai/synergy');
    const saved = tuning.plan.handByCard;
    tuning.plan.handByCard = { ...saved, corp: true }; // the turn planner's end-of-turn view
    const s = newGame();
    const agenda = createCardInstance(s, AGENDA);
    agenda.installedTurn = 'earlier';
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote Server 1', isRemote: true, ice: [], root: [agenda] };
    const spendCost = (st: GameState) => {
      st.corp.credits = 10;
      const saved = evaluate(st, 'corp', true);
      st.corp.credits = 7;
      return saved - evaluate(st, 'corp', true);
    };
    const without = spendCost(s);
    inHand(s, 'corp', '36061');
    try {
      expect(spendCost(s) - without).toBeGreaterThan(1);
    } finally {
      tuning.plan.handByCard = saved;
    }
  });

  it('Retribution is worth more once the Runner is tagged', () => {
    const s = newGame();
    s.runner.rig.hardware.push(createCardInstance(s, '36020')); // something to trash
    const retribution = inHand(s, 'corp', '30065');
    const untagged = heldWorth(s, retribution, 'corp');
    s.runner.tags = 1;
    expect(heldWorth(s, retribution, 'corp')).toBeGreaterThan(untagged);
  });

  it('Sell Out and Scrounge are average cards until their setup is in play', () => {
    let s = newGame();
    startRunnerTurn(s);
    const sellOut = inHand(s, 'runner', '36011');
    const scrounge = inHand(s, 'runner', '35004');
    const bareSell = handPlanWorth(s, sellOut)!;
    const bareScrounge = handPlanWorth(s, scrounge)!;
    [s] = runnerInstall(s, '30034'); // Verbal Plasticity
    s.runner.heap.push(createCardInstance(s, '35032')); // Principia
    expect(s.runner.rig.resources).toHaveLength(1);
    expect(handPlanWorth(s, s.runner.grip.find(c => c.cardCode === '36011')!)!).toBeGreaterThan(bareSell);
    expect(handPlanWorth(s, s.runner.grip.find(c => c.cardCode === '35004')!)!).toBeGreaterThan(bareScrounge);
  });

  it('Chain Reaction gets readier with each central run this turn', () => {
    const s = newGame();
    startRunnerTurn(s);
    const chain = inHand(s, 'runner', '36001');
    const plan = CARD_PLANS['36001'].hand!;
    expect(plan.ready(s, chain)).toBeCloseTo(0.25);
    s.runsThisTurn.push({ server: 'hq', successful: true }, { server: 'rd', successful: true });
    expect(plan.ready(s, chain)).toBeCloseTo(2 / 3);
  });

  it('Knickknack O’Brian makes an installed Principia fuel', () => {
    let s = newGame();
    startRunnerTurn(s);
    s.runner.credits = 20;
    [s] = runnerInstall(s, '35032'); // Principia
    expect(boardPlansWorth(s, 'runner')).toBe(0);
    [s] = runnerInstall(s, '35033'); // Knickknack
    expect(boardPlansWorth(s, 'runner')).toBeGreaterThan(2);
  });

  it('switched off, nothing changes', async () => {
    const { tuning } = await import('../src/ai/synergy');
    const s = newGame();
    const myoshu = inHand(s, 'corp', '36061');
    tuning.plan.cardPlans = false;
    try {
      expect(handPlanWorth(s, myoshu)).toBeUndefined();
      expect(boardPlansWorth(s, 'runner')).toBe(0);
    } finally {
      tuning.plan.cardPlans = true;
    }
  });

  it('a plan priced from card values does not price itself again (Chain Reaction with Corp cards out)', () => {
    const s = newGame();
    startRunnerTurn(s);
    for (let i = 0; i < 3; i++) s.runner.stack.unshift(createCardInstance(s, '36001'));
    const chain = inHand(s, 'runner', '36001');
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote Server 1', isRemote: true, ice: [], root: [createCardInstance(s, '30071')] };
    expect(Number.isFinite(heldWorth(s, chain, 'runner'))).toBe(true);
  });

  it('a Corp card priced from the damage clock does not loop through Chain Reaction in the deck average (Phật Gioan Baotixita)', () => {
    const s = newGame();
    for (let i = 0; i < 3; i++) s.runner.stack.unshift(createCardInstance(s, '36001'));
    const gioan = createCardInstance(s, '35051');
    gioan.isRezzed = true;
    gioan.tokens.power = 2; // priced on the damage clock, which needs the Runner's average card
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote Server 1', isRemote: true, ice: [], root: [gioan] };
    expect(Number.isFinite(corpCardValue(gioan, s, 'corp'))).toBe(true); // the loop guard throws in tests
  });
});

