import { describe, it, expect } from 'vitest';
import { cardDef, executeAction, getLegalActions, IllegalActionError, GameState } from '../src/core';
import { answer, installForTest, keepGoing, newGame, newGameAtSetup, putInHand, startRunnerTurn } from './helpers';

const runOn = (state: GameState, serverId: string) => {
  startRunnerTurn(state);
  let s = executeAction(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: serverId });
  while (s.activeRun && s.pendingPrompts.length === 0) s = keepGoing(executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' }));
  return s;
};

describe('Mulligan', () => {
  it('asks the Corp, then the Runner, before the first turn', () => {
    const state = newGameAtSetup(4);
    expect(state.pendingPrompts.map(p => [p.kind, p.side])).toEqual([
      ['mulligan', 'corp'],
      ['mulligan', 'runner'],
    ]);
    expect(state.corp.hq).toHaveLength(5);
    expect(state.corp.clicks).toBe(0);
  });

  it('blocks every other action until both players decide', () => {
    const state = newGameAtSetup(4);
    expect(() => executeAction(state, { type: 'GAIN_CREDIT', player: 'corp' })).toThrow(/Waiting on a decision/);
    expect(getLegalActions(state, 'runner')).toEqual([]);
    expect(getLegalActions(state, 'corp').map(a => a.type)).toEqual(['RESOLVE_PROMPT', 'RESOLVE_PROMPT']);
  });

  it('rejects answers from the wrong side', () => {
    const state = newGameAtSetup(4);
    expect(() =>
      executeAction(state, {
        type: 'RESOLVE_PROMPT',
        player: 'runner',
        promptId: state.pendingPrompts[0].id,
        choice: { kind: 'mulligan', mulligan: false },
      })
    ).toThrow(IllegalActionError);
  });

  it('redraws 5 cards on a mulligan, then starts the Corp turn with the mandatory draw', () => {
    let state = newGameAtSetup(4);
    const before = state.corp.hq.map(c => c.instanceId);
    state = answer(state, { kind: 'mulligan', mulligan: true });
    expect(state.corp.hq).toHaveLength(5);
    expect(state.corp.hq.map(c => c.instanceId)).not.toEqual(before);
    expect(state.corp.hq.length + state.corp.rd.length).toBe(30);

    state = answer(state, { kind: 'mulligan', mulligan: false });
    expect(state.pendingPrompts).toHaveLength(0);
    expect(state.corp.hq).toHaveLength(6);
    expect(state.corp.clicks).toBe(3);
    expect(state.activePlayer).toBe('corp');
  });
});

describe('End of turn', () => {
  it('requires all clicks to be spent', () => {
    const state = newGame();
    expect(() => executeAction(state, { type: 'END_TURN', player: 'corp' })).toThrow(/spend all clicks/);
  });

  it('makes the Runner discard to hand size into the heap', () => {
    let state = newGame();
    startRunnerTurn(state);
    state.runner.clicks = 0;
    putInHand(state, 'runner', 'event');
    putInHand(state, 'runner', 'program');
    state = executeAction(state, { type: 'END_TURN', player: 'runner' });
    const prompt = state.pendingPrompts[0];
    expect(prompt).toMatchObject({ kind: 'discard', side: 'runner', count: 2 });

    const two = state.runner.grip.slice(0, 2).map(c => c.instanceId);
    expect(() => answer(state, { kind: 'discard', cardInstanceIds: two.slice(0, 1) })).toThrow(/exactly 2/);

    state = answer(state, { kind: 'discard', cardInstanceIds: two });
    expect(state.runner.grip).toHaveLength(5);
    expect(state.runner.heap.map(c => c.instanceId)).toEqual(two);
    expect(state.activePlayer).toBe('corp');
    expect(state.turnNumber).toBe(2);
  });

  it('lists each possible discard as a legal answer', () => {
    let state = newGame(); // Corp has 6 cards
    state.corp.clicks = 0;
    state = executeAction(state, { type: 'END_TURN', player: 'corp' });
    expect(getLegalActions(state, 'corp')).toHaveLength(6); // choose 1 of 6
  });
});

describe('Trashing accessed cards', () => {
  const setupAsset = (state: GameState) => {
    const id = installForTest(state, 'asset', 'remote-9');
    return { id, cost: cardDef(state.corp.servers['remote-9'].root[0]).trash_cost! };
  };

  it('offers the Runner the choice and trashes to Archives face up when paid', () => {
    let state = newGame();
    const { id, cost } = setupAsset(state);
    state = runOn(state, 'remote-9');
    expect(state.pendingPrompts[0]).toMatchObject({ kind: 'access_trash', side: 'runner', cardInstanceId: id, trashCost: cost });
    expect(state.activeRun?.phase).toBe('access');
    expect(() => executeAction(state, { type: 'CONTINUE_RUN', player: 'runner' })).toThrow(/Waiting/);

    const credits = state.runner.credits;
    state = answer(state, { kind: 'access_trash', trash: true });
    expect(state.runner.credits).toBe(credits - cost);
    expect(state.corp.servers['remote-9'].root).toHaveLength(0);
    expect(state.corp.archives.faceUp.map(c => c.instanceId)).toEqual([id]);
    expect(state.activeRun).toBeNull();
  });

  it('leaves the card installed when the Runner declines', () => {
    let state = newGame();
    const { id } = setupAsset(state);
    state = answer(runOn(state, 'remote-9'), { kind: 'access_trash', trash: false });
    expect(state.corp.servers['remote-9'].root.map(c => c.instanceId)).toEqual([id]);
    expect(state.activeRun).toBeNull();
  });

  it('does not ask when the Runner cannot afford the trash cost', () => {
    let state = newGame();
    setupAsset(state);
    state.runner.credits = 0;
    state = runOn(state, 'remote-9');
    expect(state.pendingPrompts).toHaveLength(0);
    expect(state.activeRun).toBeNull();
  });

  it('resumes accessing the rest of the server after the decision', () => {
    let state = newGame();
    const upgrade = installForTest(state, 'upgrade', 'remote-9');
    const agenda = installForTest(state, 'agenda', 'remote-9');
    state.runner.credits = 20;
    state = runOn(state, 'remote-9');
    expect(state.pendingPrompts[0]).toMatchObject({ kind: 'access_trash', cardInstanceId: upgrade });
    state = answer(state, { kind: 'access_trash', trash: false });
    expect(state.runner.scoreArea.map(c => c.instanceId)).toEqual([agenda]);
    expect(state.activeRun).toBeNull();
  });

  it('never asks about cards already in Archives', () => {
    let state = newGame();
    const assetId = putInHand(state, 'corp', 'asset');
    const i = state.corp.hq.findIndex(c => c.instanceId === assetId);
    state.corp.archives.faceDown.push(...state.corp.hq.splice(i, 1));
    state = runOn(state, 'archives');
    expect(state.pendingPrompts).toHaveLength(0);
    expect(state.activeRun).toBeNull();
  });
});
