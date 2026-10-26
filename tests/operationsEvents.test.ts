import { describe, it, expect } from 'vitest';
import { cardDef, executeAction, getLegalActions, IllegalActionError, GameState } from '../src/core';
import { answer, giveCard, installForTest, installProgramForTest, newGame, play, putInHand, startRunnerTurn } from './helpers';

const SURE_GAMBLE = '30030';
const CREATIVE_COMMISSION = '30020';
const VRCATION = '30021';
const WILDCAT_STRIKE = '30002';
const MUTUAL_FAVOR = '30011';
const HEDGE_FUND = '30075';
const GOVERNMENT_SUBSIDY = '30064';
const HANSEI_REVIEW = '30048';
const SPRINT = '30041';
const PREDICTIVE_PLANOGRAM = '30056';
const SEAMLESS_LAUNCH = '30040';
const PUBLIC_TRAIL = '30057';

const runnerTurn = (credits = 5) => {
  const state = newGame();
  startRunnerTurn(state);
  state.runner.credits = credits;
  return state;
};

describe('Playing operations and events', () => {
  it('spends a click and the cost, and moves the card to the discard pile', () => {
    let state = newGame();
    const id = giveCard(state, 'corp', HEDGE_FUND);
    state = play(state, 'corp', id);
    expect(state.corp.clicks).toBe(2);
    expect(state.corp.credits).toBe(5 - 5 + 9);
    expect(state.corp.archives.faceUp.map(c => c.instanceId)).toEqual([id]);
    expect(state.corp.hq.some(c => c.instanceId === id)).toBe(false);
  });

  it('rejects playing when the cost cannot be paid', () => {
    const state = newGame();
    const id = giveCard(state, 'corp', GOVERNMENT_SUBSIDY);
    expect(() => play(state, 'corp', id)).toThrow(/Need 10 credits/);
  });

  it('rejects playing installable cards', () => {
    const state = newGame();
    const ice = putInHand(state, 'corp', 'ice');
    expect(() => play(state, 'corp', ice)).toThrow(/Only operations/);
  });

  it('only allows playing on your own turn', () => {
    const state = newGame();
    const id = giveCard(state, 'runner', SURE_GAMBLE);
    expect(() => play(state, 'runner', id)).toThrow(IllegalActionError);
  });

  it('lists playable cards in getLegalActions, but not ones whose play condition fails', () => {
    const state = newGame();
    const hedge = giveCard(state, 'corp', HEDGE_FUND);
    const trail = giveCard(state, 'corp', PUBLIC_TRAIL);
    const plays = getLegalActions(state, 'corp').filter(a => a.type === 'PLAY_OPERATION_OR_EVENT');
    expect(plays.map(a => (a as { cardInstanceId: string }).cardInstanceId)).toContain(hedge);
    expect(plays.map(a => (a as { cardInstanceId: string }).cardInstanceId)).not.toContain(trail);
  });
});

describe('Corp operations', () => {
  it('Government Subsidy gains 15', () => {
    let state = newGame();
    state.corp.credits = 10;
    state = play(state, 'corp', giveCard(state, 'corp', GOVERNMENT_SUBSIDY));
    expect(state.corp.credits).toBe(15);
  });

  it('Hansei Review gains 10 and trashes a chosen card from HQ', () => {
    let state = newGame();
    const id = giveCard(state, 'corp', HANSEI_REVIEW);
    const victim = state.corp.hq[0].instanceId;
    state = play(state, 'corp', id);
    expect(state.corp.credits).toBe(5 - 5 + 10);
    expect(state.pendingPrompts[0]).toMatchObject({ kind: 'effect_cards', side: 'corp', min: 1, max: 1 });
    state = answer(state, { kind: 'effect_cards', cardInstanceIds: [victim] });
    expect(state.corp.hq.some(c => c.instanceId === victim)).toBe(false);
    expect(state.corp.archives.faceDown.map(c => c.instanceId)).toContain(victim);
  });

  it('Hansei Review skips the trash when HQ is empty', () => {
    let state = newGame();
    const id = giveCard(state, 'corp', HANSEI_REVIEW);
    state.corp.hq = state.corp.hq.filter(c => c.instanceId === id);
    state = play(state, 'corp', id);
    expect(state.pendingPrompts).toHaveLength(0);
  });

  it('Sprint draws 3 then shuffles 2 chosen cards from HQ into R&D', () => {
    let state = newGame();
    const id = giveCard(state, 'corp', SPRINT);
    const hqBefore = state.corp.hq.length - 1;
    const rdBefore = state.corp.rd.length;
    state = play(state, 'corp', id);
    expect(state.corp.hq).toHaveLength(hqBefore + 3);
    const two = state.corp.hq.slice(0, 2).map(c => c.instanceId);
    expect(() => answer(state, { kind: 'effect_cards', cardInstanceIds: two.slice(0, 1) })).toThrow(/exactly 2/);
    state = answer(state, { kind: 'effect_cards', cardInstanceIds: two });
    expect(state.corp.hq).toHaveLength(hqBefore + 1);
    expect(state.corp.rd).toHaveLength(rdBefore - 3 + 2);
    expect(state.corp.rd.map(c => c.instanceId)).toEqual(expect.arrayContaining(two));
  });

  it('Predictive Planogram lets the Corp pick one, or both if the Runner is tagged', () => {
    let state = newGame();
    state = play(state, 'corp', giveCard(state, 'corp', PREDICTIVE_PLANOGRAM));
    const prompt = state.pendingPrompts[0];
    expect(prompt.kind === 'effect_choice' && prompt.options.map(o => o.id)).toEqual(['credits', 'cards']);
    state = answer(state, { kind: 'effect_choice', optionId: 'credits' });
    expect(state.corp.credits).toBe(5 + 3);

    let tagged = newGame();
    tagged.runner.tags = 1;
    const hq = tagged.corp.hq.length;
    tagged = play(tagged, 'corp', giveCard(tagged, 'corp', PREDICTIVE_PLANOGRAM));
    tagged = answer(tagged, { kind: 'effect_choice', optionId: 'both' });
    expect(tagged.corp.credits).toBe(8);
    expect(tagged.corp.hq).toHaveLength(hq + 3);
  });

  it('Seamless Launch adds 2 counters to a card not installed this turn', () => {
    let state = newGame();
    state.corp.clicks = 3;
    const old = installForTest(state, 'agenda', 'remote-9'); // no installedTurn: counts as an earlier turn
    const fresh = putInHand(state, 'corp', 'asset');
    state = executeAction(state, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: fresh, asNewRemote: true });
    state = play(state, 'corp', giveCard(state, 'corp', SEAMLESS_LAUNCH));
    const prompt = state.pendingPrompts[0];
    expect(prompt.kind === 'effect_cards' && prompt.candidateIds).toEqual([old]);
    state = answer(state, { kind: 'effect_cards', cardInstanceIds: [old] });
    expect(state.corp.servers['remote-9'].root[0].advancementCounters).toBe(2);
  });

  it('Seamless Launch cannot be played without a valid target', () => {
    const state = newGame();
    const id = giveCard(state, 'corp', SEAMLESS_LAUNCH);
    expect(() => play(state, 'corp', id)).toThrow(/No installed card/);
  });
});

describe('Runner events', () => {
  it('Sure Gamble gains 9', () => {
    let state = runnerTurn(5);
    state = play(state, 'runner', giveCard(state, 'runner', SURE_GAMBLE));
    expect(state.runner.credits).toBe(9);
    expect(state.runner.heap).toHaveLength(1);
  });

  it('Creative Commission gains 5 and loses a remaining click', () => {
    let state = runnerTurn(5);
    state = play(state, 'runner', giveCard(state, 'runner', CREATIVE_COMMISSION));
    expect(state.runner.credits).toBe(5 - 1 + 5);
    expect(state.runner.clicks).toBe(2); // 4 - 1 to play - 1 lost
  });

  it('Creative Commission played with the last click does not go negative', () => {
    let state = runnerTurn(5);
    state.runner.clicks = 1;
    state = play(state, 'runner', giveCard(state, 'runner', CREATIVE_COMMISSION));
    expect(state.runner.clicks).toBe(0);
  });

  it('VRcation draws 4 and loses a remaining click', () => {
    let state = runnerTurn(5);
    const grip = state.runner.grip.length;
    state = play(state, 'runner', giveCard(state, 'runner', VRCATION));
    expect(state.runner.grip).toHaveLength(grip + 4);
    expect(state.runner.clicks).toBe(2);
  });

  it('Wildcat Strike lets the Corp choose during the Runner turn', () => {
    let state = runnerTurn(5);
    state = play(state, 'runner', giveCard(state, 'runner', WILDCAT_STRIKE));
    expect(state.pendingPrompts[0]).toMatchObject({ kind: 'effect_choice', side: 'corp' });
    expect(getLegalActions(state, 'runner')).toEqual([]);
    expect(() =>
      executeAction(state, {
        type: 'RESOLVE_PROMPT',
        player: 'runner',
        promptId: state.pendingPrompts[0].id,
        choice: { kind: 'effect_choice', optionId: 'credits' },
      })
    ).toThrow(/Waiting on the Corp/);
    state = answer(state, { kind: 'effect_choice', optionId: 'credits' });
    expect(state.runner.credits).toBe(5 - 2 + 6);
  });

  describe('Mutual Favor', () => {
    const breakersIn = (state: GameState) =>
      state.runner.stack.filter(c => /icebreaker/i.test(cardDef(c).keywords ?? '')).map(c => c.instanceId);

    it('adds the chosen icebreaker to the grip without a successful run', () => {
      let state = runnerTurn(5);
      state = play(state, 'runner', giveCard(state, 'runner', MUTUAL_FAVOR));
      const options = breakersIn(state);
      expect(options.length).toBeGreaterThan(0);
      state = answer(state, { kind: 'effect_cards', cardInstanceIds: [options[0]] });
      expect(state.runner.grip.map(c => c.instanceId)).toContain(options[0]);
      expect(state.pendingPrompts).toHaveLength(0);
    });

    it('offers to install it after a successful run this turn', () => {
      let state = runnerTurn(20);
      state = executeAction(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'archives' });
      state = executeAction(state, { type: 'CONTINUE_RUN', player: 'runner' });
      state = executeAction(state, { type: 'CONTINUE_RUN', player: 'runner' });
      state = play(state, 'runner', giveCard(state, 'runner', MUTUAL_FAVOR));
      const breaker = breakersIn(state)[0];
      state = answer(state, { kind: 'effect_cards', cardInstanceIds: [breaker] });
      expect(state.pendingPrompts[0]).toMatchObject({ kind: 'effect_choice', side: 'runner' });
      state = answer(state, { kind: 'effect_choice', optionId: 'install' });
      expect(state.runner.rig.programs.map(c => c.instanceId)).toEqual([breaker]);
      expect(state.runner.stack.some(c => c.instanceId === breaker)).toBe(false);
    });

    it('can trash programs to make room, and goes to the grip if it still does not fit (rules 8.5.6c)', () => {
      let state = runnerTurn(20);
      state = executeAction(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'archives' });
      state = executeAction(state, { type: 'CONTINUE_RUN', player: 'runner' });
      state = executeAction(state, { type: 'CONTINUE_RUN', player: 'runner' });
      const old = installProgramForTest(state, '30006');
      state = play(state, 'runner', giveCard(state, 'runner', MUTUAL_FAVOR));
      const breaker = breakersIn(state)[0];
      // Full by 1 MU: Cleaver's 1 MU makes the room
      const mu = cardDef(state.runner.stack.find(c => c.instanceId === breaker)!).memory_cost ?? 0;
      state.runner.memoryUnitsUsed = state.runner.memoryUnitsTotal - mu + 1;
      state = answer(state, { kind: 'effect_cards', cardInstanceIds: [breaker] });
      expect(state.pendingPrompts[0]).toMatchObject({ kind: 'effect_choice', source: { data: { install: true } } });
      const plain = answer(state, { kind: 'effect_choice', optionId: 'install' });
      expect(plain.runner.grip.map(c => c.instanceId)).toContain(breaker);
      state = answer(state, { kind: 'effect_choice', optionId: 'install', trashFirst: [old] });
      expect(state.runner.rig.programs.map(c => c.instanceId)).toEqual([breaker]);
    });

    it('does nothing but shuffle when the Stack has no icebreakers', () => {
      let state = runnerTurn(5);
      state.runner.stack = state.runner.stack.filter(c => !/icebreaker/i.test(cardDef(c).keywords ?? ''));
      state = play(state, 'runner', giveCard(state, 'runner', MUTUAL_FAVOR));
      expect(state.pendingPrompts).toHaveLength(0);
    });
  });
});
