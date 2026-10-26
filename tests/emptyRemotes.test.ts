import { describe, it, expect } from 'vitest';
import { executeAction } from '../src/core';
import { removeEmptyRemotes } from '../src/core/engine/checkpoint';
import { installForTest, newGame, putInHand, runIntoFirstIce, startRunnerTurn } from './helpers';

// Rules 4.6.8e / 8.5.8: a remote with nothing in its root and no ice ceases to exist.
describe('Empty remote servers', () => {
  it('removes an emptied remote, and new remotes never reuse its id or name', () => {
    let state = newGame();
    const asset = putInHand(state, 'corp', 'asset');
    state = executeAction(state, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: asset, asNewRemote: true });
    expect(state.corp.servers['remote-1']).toBeDefined();
    state.corp.archives.faceUp.push(state.corp.servers['remote-1'].root.pop()!);
    state = executeAction(state, { type: 'GAIN_CREDIT', player: 'corp' });
    expect(state.corp.servers['remote-1']).toBeUndefined();
    expect(state.log.some(l => /Remote Server 1 no longer exists/.test(l.message))).toBe(true);

    const next = putInHand(state, 'corp', 'asset');
    state = executeAction(state, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: next, asNewRemote: true });
    expect(state.corp.servers['remote-2']?.name).toBe('Remote Server 2');
  });

  it('keeps central servers and remotes with only ice or only root cards', () => {
    const state = newGame();
    installForTest(state, 'ice', 'remote-8');
    installForTest(state, 'asset', 'remote-9');
    removeEmptyRemotes(state);
    expect(Object.keys(state.corp.servers).sort()).toEqual(['archives', 'hq', 'rd', 'remote-8', 'remote-9']);
  });

  it('waits while a decision is pending', () => {
    const state = newGame();
    state.corp.servers['remote-9'] = { id: 'remote-9', name: 'Remote Server 9', isRemote: true, ice: [], root: [] };
    state.pendingPrompts.push({ id: 'p', kind: 'effect_choice', side: 'corp', message: 'm', options: [] } as never);
    removeEmptyRemotes(state);
    expect(state.corp.servers['remote-9']).toBeDefined();
    state.pendingPrompts = [];
    removeEmptyRemotes(state);
    expect(state.corp.servers['remote-9']).toBeUndefined();
  });

  it('ends a run on the server, neither successful nor unsuccessful, when its last ice goes', () => {
    const state = newGame();
    installForTest(state, 'ice', 'remote-9');
    state.corp.servers['remote-9'].ice[0].isRezzed = true;
    const s = runIntoFirstIce(state, 'remote-9');
    expect(s.activeRun?.server).toBe('remote-9');
    s.corp.archives.faceUp.push(s.corp.servers['remote-9'].ice.pop()!);
    removeEmptyRemotes(s);
    expect(s.activeRun).toBeNull();
    expect(s.corp.servers['remote-9']).toBeUndefined();
    expect(s.runsThisTurn.at(-1)?.successful).toBe(false);
  });

  it('lets a successful run finish its breach before the server goes', () => {
    let state = newGame();
    installForTest(state, 'asset', 'remote-9');
    startRunnerTurn(state);
    state = executeAction(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote-9' });
    state.activeRun!.isSuccessful = true;
    state.corp.archives.faceUp.push(state.corp.servers['remote-9'].root.pop()!);
    removeEmptyRemotes(state);
    expect(state.activeRun).not.toBeNull();
    expect(state.corp.servers['remote-9']).toBeDefined();
  });
});
