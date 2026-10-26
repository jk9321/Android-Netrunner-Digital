import { describe, it, expect } from 'vitest';
import { cardDef, executeAction, IllegalActionError, GameState } from '../src/core';
import { keepGoing, newGame, putInHand, startRunnerTurn, installForTest } from './helpers';

const findInHand = (state: GameState, side: 'corp' | 'runner', id: string) =>
  (side === 'corp' ? state.corp.hq : state.runner.grip).some(c => c.instanceId === id);

describe('Turn enforcement', () => {
  it('rejects Runner click actions during the Corp turn', () => {
    const state = newGame();
    expect(() => executeAction(state, { type: 'GAIN_CREDIT', player: 'runner' })).toThrow(IllegalActionError);
    expect(() => executeAction(state, { type: 'END_TURN', player: 'runner' })).toThrow(IllegalActionError);
  });

  it('rejects Corp click actions during the Runner turn and during runs', () => {
    let state = newGame();
    startRunnerTurn(state);
    expect(() => executeAction(state, { type: 'GAIN_CREDIT', player: 'corp' })).toThrow(IllegalActionError);
    state = executeAction(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'archives' });
    expect(() => executeAction(state, { type: 'GAIN_CREDIT', player: 'runner' })).toThrow(IllegalActionError);
    expect(() => executeAction(state, { type: 'END_TURN', player: 'runner' })).toThrow(IllegalActionError);
  });

  it('only lets the Runner continue or jack out of a run', () => {
    let state = newGame();
    startRunnerTurn(state);
    state = executeAction(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'archives' });
    expect(() => executeAction(state, { type: 'CONTINUE_RUN', player: 'corp' })).toThrow(IllegalActionError);
    expect(() => executeAction(state, { type: 'JACK_OUT', player: 'corp' })).toThrow(IllegalActionError);
  });
});

describe('Installing', () => {
  it('rejects installing events and operations instead of deleting them', () => {
    const state = newGame();
    const op = putInHand(state, 'corp', 'operation');
    expect(() => executeAction(state, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: op, asNewRemote: true })).toThrow(/played/);
    startRunnerTurn(state);
    const ev = putInHand(state, 'runner', 'event');
    expect(() => executeAction(state, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: ev })).toThrow(/played/);
    expect(findInHand(state, 'runner', ev)).toBe(true);
  });

  it('rejects agendas and assets in central server roots', () => {
    const state = newGame();
    const agenda = putInHand(state, 'corp', 'agenda');
    expect(() =>
      executeAction(state, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: agenda, targetServerId: 'hq' })
    ).toThrow(/remote/);
  });

  it('allows upgrades in central roots', () => {
    let state = newGame();
    const upgrade = putInHand(state, 'corp', 'upgrade');
    state = executeAction(state, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: upgrade, targetServerId: 'hq' });
    expect(state.corp.servers.hq.root.map(c => c.instanceId)).toEqual([upgrade]);
  });

  it('trashes the old agenda or asset when installing another in the same remote', () => {
    let state = newGame();
    const first = putInHand(state, 'corp', 'agenda');
    const second = putInHand(state, 'corp', 'asset');
    state = executeAction(state, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: first, asNewRemote: true });
    state = executeAction(state, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: second, targetServerId: 'remote-1' });
    expect(state.corp.servers['remote-1'].root.map(c => c.instanceId)).toEqual([second]);
    expect(state.corp.archives.faceDown.map(c => c.instanceId)).toEqual([first]);
  });

  it('enforces the Runner memory limit', () => {
    const state = newGame();
    startRunnerTurn(state);
    state.runner.credits = 99;
    state.runner.memoryUnitsUsed = state.runner.memoryUnitsTotal;
    const program = putInHand(state, 'runner', 'program');
    expect(() => executeAction(state, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: program })).toThrow(/memory/);
  });
});

describe('Rezzing', () => {
  it('never rezzes agendas', () => {
    const state = newGame();
    const agenda = installForTest(state, 'agenda', 'remote-9');
    expect(() => executeAction(state, { type: 'REZ_CARD', player: 'corp', cardInstanceId: agenda })).toThrow(/Agendas/);
  });

  it('rezzes ice only while the Runner approaches it', () => {
    let state = newGame();
    state.corp.credits = 50;
    const ice = installForTest(state, 'ice', 'hq');
    expect(() => executeAction(state, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice })).toThrow(/approaching/);

    startRunnerTurn(state);
    state = executeAction(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    expect(state.activeRun?.phase).toBe('approach_ice');
    state = executeAction(state, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice });
    expect(state.corp.servers.hq.ice[0].isRezzed).toBe(true);

    state = executeAction(state, { type: 'CONTINUE_RUN', player: 'runner' });
    expect(state.activeRun?.phase).toBe('encounter_ice');
  });

  it('allows rezzing assets outside runs', () => {
    let state = newGame();
    state.corp.credits = 50;
    const asset = installForTest(state, 'asset', 'remote-9');
    state = executeAction(state, { type: 'REZ_CARD', player: 'corp', cardInstanceId: asset });
    expect(state.corp.servers['remote-9'].root[0].isRezzed).toBe(true);
  });
});

describe('Advancing and scoring', () => {
  it('does not auto-score, allows over-advancing, and scores on request', () => {
    let state = newGame();
    state.corp.credits = 50;
    state.corp.clicks = 99;
    const agenda = installForTest(state, 'agenda', 'remote-9');
    const req = cardDef(state.corp.servers['remote-9'].root[0]).advancement_cost!;

    expect(() => executeAction(state, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: agenda })).toThrow(/advancement/);
    for (let i = 0; i < req + 1; i++) {
      state = executeAction(state, { type: 'ADVANCE_CARD', player: 'corp', cardInstanceId: agenda, serverId: 'remote-9' });
    }
    expect(state.corp.scoreArea).toHaveLength(0);
    expect(state.corp.servers['remote-9'].root[0].advancementCounters).toBe(req + 1);

    state = executeAction(state, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: agenda });
    expect(state.corp.scoreArea.map(c => c.instanceId)).toEqual([agenda]);
    expect(state.corp.score).toBeGreaterThan(0);
  });

  it('rejects advancing cards that cannot be advanced', () => {
    const state = newGame();
    const upgrade = installForTest(state, 'upgrade', 'hq');
    expect(() =>
      executeAction(state, { type: 'ADVANCE_CARD', player: 'corp', cardInstanceId: upgrade, serverId: 'hq' })
    ).toThrow(/cannot be advanced/);
  });
});

describe('Accessing', () => {
  const runOn = (state: GameState, serverId: string) => {
    startRunnerTurn(state);
    let s = executeAction(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: serverId });
    while (s.activeRun) s = keepGoing(executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' }));
    return s;
  };

  it('steals every agenda in a server root (no skipped cards)', () => {
    const state = newGame();
    const a = installForTest(state, 'agenda', 'remote-9');
    const b = installForTest(state, 'agenda', 'remote-9');
    const after = runOn(state, 'remote-9');
    expect(after.runner.scoreArea.map(c => c.instanceId).sort()).toEqual([a, b].sort());
    expect(after.corp.servers['remote-9']).toBeUndefined(); // emptied, so it ceased to exist
  });

  it('accesses the top card of R&D', () => {
    const state = newGame();
    const idx = state.corp.rd.findIndex(c => cardDef(c).type_code === 'agenda');
    const [agenda] = state.corp.rd.splice(idx, 1);
    state.corp.rd.unshift(agenda);
    const after = runOn(state, 'rd');
    expect(after.runner.scoreArea.map(c => c.instanceId)).toEqual([agenda.instanceId]);
  });

  it('accesses a card from HQ', () => {
    const state = newGame();
    const agenda = putInHand(state, 'corp', 'agenda');
    state.corp.hq = state.corp.hq.filter(c => c.instanceId === agenda);
    const after = runOn(state, 'hq');
    expect(after.runner.scoreArea.map(c => c.instanceId)).toEqual([agenda]);
    expect(after.corp.hq).toHaveLength(0);
  });

  it('accesses all of Archives and turns it face up', () => {
    const state = newGame();
    const agenda = putInHand(state, 'corp', 'agenda');
    const other = putInHand(state, 'corp', 'ice');
    const take = (id: string) => {
      const i = state.corp.hq.findIndex(c => c.instanceId === id);
      return state.corp.hq.splice(i, 1)[0];
    };
    state.corp.archives.faceDown.push(take(agenda), take(other));
    const after = runOn(state, 'archives');
    expect(after.runner.scoreArea.map(c => c.instanceId)).toEqual([agenda]);
    expect(after.corp.archives.faceDown).toHaveLength(0);
    expect(after.corp.archives.faceUp.map(c => c.instanceId)).toEqual([other]);
  });

  it('picks the HQ card with the seeded RNG (same seed, same access)', () => {
    const run = () => runOn(newGame(77), 'hq').log.map(l => l.message);
    expect(run()).toEqual(run());
  });
});
