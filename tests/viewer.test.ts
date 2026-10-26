import { describe, expect, it } from 'vitest';
import { executeAction } from '../src/core';
import { actingSide, corpRezWindow } from '../src/ui/viewer';
import { soundFor } from '../src/ui/sound';
import { installCorpForTest, installIceForTest, keepGoing, newGame, newGameAtSetup, run } from './helpers';

const PALISADE = '30072';
const MANEGARM = '30045';

describe('who acts (pass and play)', () => {
  it('follows prompts, then the active player', () => {
    const atSetup = newGameAtSetup();
    expect(actingSide(atSetup, false)).toBe(atSetup.pendingPrompts[0].side);
    const state = newGame();
    expect(actingSide(state, false)).toBe('corp');
    state.winner = 'corp';
    expect(actingSide(state, false)).toBeNull();
  });

  it('opens a Corp rez window on approached unrezzed ice, and the Runner acts once it is passed', () => {
    let state = newGame();
    installIceForTest(state, PALISADE, 'hq', false);
    state = run(state, 'hq');
    const window = corpRezWindow(state, 1);
    expect(window?.cards.map(c => c.cardCode)).toEqual([PALISADE]);
    expect(actingSide(state, true)).toBe('corp');
    expect(actingSide(state, false)).toBe('runner');
    // A different run gets a different key, so a "no rez" answer is not reused
    expect(corpRezWindow(state, 2)?.key).not.toBe(window?.key);
  });

  it('has no rez window for rezzed ice', () => {
    const state = newGame();
    installIceForTest(state, PALISADE, 'hq', true);
    expect(corpRezWindow(run(state, 'hq'), 1)).toBeNull();
  });

  it('still opens the window when the Corp cannot pay, so its absence tells the Runner nothing', () => {
    const state = newGame();
    installIceForTest(state, PALISADE, 'hq', false);
    state.corp.credits = 0;
    const window = corpRezWindow(run(state, 'hq'), 1);
    expect(window).not.toBeNull();
    expect(window?.cards).toEqual([]);
  });

  it('opens a window before the Runner approaches a server holding only an agenda', () => {
    const state = newGame();
    installCorpForTest(state, '30067', 'remote-1'); // Offworld Office: can't be rezzed
    const window = corpRezWindow(run(state, 'remote-1'), 1);
    expect(window).not.toBeNull();
    expect(window?.cards).toEqual([]);
  });

  it('offers unrezzed root cards when the Runner approaches the server', () => {
    let state = newGame();
    installCorpForTest(state, MANEGARM, 'hq');
    state = run(state, 'hq');
    while (state.activeRun && state.activeRun.phase !== 'approach_server') {
      state = executeAction(state, { type: 'CONTINUE_RUN', player: 'runner' });
    }
    expect(corpRezWindow(state, 1)?.cards.map(c => c.cardCode)).toEqual([MANEGARM]);
  });
});

describe('sound effects', () => {
  it('picks the most important sound from what an action changed', () => {
    const state = newGame();
    expect(soundFor(state, state)).toBeNull();
    expect(soundFor(state, executeAction(state, { type: 'GAIN_CREDIT', player: 'corp' }))).toBe('credit');
    expect(soundFor(state, executeAction(state, { type: 'DRAW_CARD', player: 'corp' }))).toBe('draw');

    const withIce = newGame();
    installIceForTest(withIce, PALISADE, 'hq', false);
    const running = run(withIce, 'hq');
    expect(soundFor(withIce, running)).toBe('run');
    const ice = running.corp.servers.hq.ice[0];
    expect(soundFor(running, executeAction(running, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice.instanceId }))).toBe('rez');

    const won = structuredClone(state);
    won.winner = 'corp';
    won.corp.score = 7;
    expect(soundFor(state, won)).toBe('win');
    const conceded = executeAction(state, { type: 'CONCEDE', player: 'runner' });
    expect(soundFor(state, conceded)).toBe('win');
    // The side that lost hears the lose sound, the winner the fanfare
    expect(soundFor(state, won, 'corp')).toBe('win');
    expect(soundFor(state, won, 'runner')).toBe('lose');
    expect(soundFor(state, conceded, 'runner')).toBe('lose');
    expect(soundFor(state, conceded, 'corp')).toBe('win');
  });

  it('marks accessed cards in the log so the UI can list them', () => {
    let state = newGame();
    installCorpForTest(state, MANEGARM, 'hq');
    state = run(state, 'hq');
    while (state.activeRun && state.activeRun.phase !== 'access') {
      state = keepGoing(executeAction(state, { type: 'CONTINUE_RUN', player: 'runner' }));
    }
    expect(state.log.filter(e => e.event === 'access').length).toBeGreaterThan(0);
  });
});
