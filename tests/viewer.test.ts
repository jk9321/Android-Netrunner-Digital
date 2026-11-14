import { describe, expect, it } from 'vitest';
import { executeAction } from '../src/core';
import { actingSide, corpRezWindow } from '../src/ui/viewer';
import { seatOf } from './seatHelpers';
import { soundFor } from '../src/ui/sound';
import { zoneContents } from '../src/ui/components/ZoneViewer';
import { installCorpForTest, installIceForTest, keepGoing, newGame, newGameAtSetup, run, step, toCorp } from './helpers';

const PALISADE = '30072';
const URTICA = '30045'; // Urtica Cipher: asset, rez 0

describe('who acts (pass and play)', () => {
  it('follows prompts, then the player with priority', () => {
    const atSetup = newGameAtSetup();
    expect(actingSide(atSetup)).toBe(atSetup.pendingPrompts[0].side);
    const state = newGame();
    expect(actingSide(state)).toBe('corp');
    state.winner = 'corp';
    expect(actingSide(state)).toBeNull();
  });

  it('gives the Corp a rez window on approached unrezzed ice once the Runner passes (rules 6.9.2b)', () => {
    let state = newGame();
    installIceForTest(state, PALISADE, 'hq', false);
    state = run(state, 'hq');
    // The Runner, as active player, has priority first (rules 9.2.7a)
    expect(state.activeRun?.phase).toBe('approach_ice');
    expect(actingSide(state)).toBe('runner');
    expect(corpRezWindow(seatOf(state, 'corp'))).toBeNull();
    state = toCorp(state);
    expect(actingSide(state)).toBe('corp');
    expect(corpRezWindow(seatOf(state, 'corp'))?.cards.map(c => c.cardCode)).toEqual([PALISADE]);
    // The Corp passes without rezzing: the window closes and the unrezzed ice is passed (rules 6.9.2c)
    state = executeAction(state, { type: 'PASS', player: 'corp' });
    expect(state.activeRun?.phase).toBe('movement');
    expect(actingSide(state)).toBe('runner');
  });

  it('skips the Corp at rezzed ice unless it asked for full control', () => {
    const state = newGame();
    installIceForTest(state, PALISADE, 'hq', true);
    const passed = toCorp(run(state, 'hq'));
    expect(corpRezWindow(seatOf(passed, 'corp'))).toBeNull();
    expect(passed.activeRun?.phase).toBe('encounter_ice');
  });

  it('still stops when the Corp cannot pay, so a stop tells the Runner nothing (rules 4.6.3)', () => {
    const state = newGame();
    installIceForTest(state, PALISADE, 'hq', false);
    state.corp.credits = 0;
    const window = corpRezWindow(seatOf(toCorp(run(state, 'hq')), 'corp'));
    expect(window).not.toBeNull();
    expect(window?.cards).toEqual([]);
  });

  it('offers unrezzed root cards before the Runner approaches the server (rules 6.9.4e)', () => {
    let state = newGame();
    installCorpForTest(state, URTICA, 'hq');
    state = run(state, 'hq');
    while (state.activeRun && !corpRezWindow(seatOf(state, 'corp'))) state = toCorp(state);
    expect(state.priority?.step).toBe('approach_server');
    expect(corpRezWindow(seatOf(state, 'corp'))?.cards.map(c => c.cardCode)).toEqual([URTICA]);
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
    const corpWindow = toCorp(running);
    expect(soundFor(corpWindow, executeAction(corpWindow, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice.instanceId }))).toBe('rez');

    const won = structuredClone(state);
    won.winner = 'corp';
    won.corp.score = 7;
    expect(soundFor(state, won)).toBe('corp_win');
    const conceded = executeAction(state, { type: 'CONCEDE', player: 'runner' });
    expect(soundFor(state, conceded)).toBe('concede');
    // The side that lost hears the lose sound, the winner the fanfare
    expect(soundFor(state, won, 'corp')).toBe('corp_win');
    expect(soundFor(state, won, 'runner')).toBe('lose');
    expect(soundFor(state, conceded, 'runner')).toBe('concede');
    expect(soundFor(state, conceded, 'corp')).toBe('concede');
  });

  it('marks accessed cards in the log so the UI can list them', () => {
    let state = newGame();
    installCorpForTest(state, URTICA, 'hq');
    state = run(state, 'hq');
    while (state.activeRun && state.activeRun.phase !== 'access') {
      state = keepGoing(step(state));
    }
    expect(state.log.filter(e => e.event === 'access').length).toBeGreaterThan(0);
  });
});

describe('browsing decks after the game', () => {
  it('lists R&D and the Stack top card first, face down', () => {
    const state = newGame();
    // During play R&D shows only what the Runner remembers (rules 1.7.1)
    expect(zoneContents('rd', state).groups.map(g => g.label)).toEqual(['Seen by the Runner']);
    // Corp viewer cannot see what the Runner saw in R&D during play
    expect(zoneContents('rd', state, 'corp').groups).toHaveLength(0);
    expect(zoneContents('rd', state, 'runner').groups.map(g => g.label)).toEqual(['Seen by the Runner']);
    expect(zoneContents('rd', state, 'both').groups.map(g => g.label)).toEqual(['Seen by the Runner']);
    state.winner = 'corp';
    const rd = zoneContents('rd', state);
    expect(rd.groups[0].cards[0].instanceId).toBe(state.corp.rd[0].instanceId);
    expect(rd.groups[0].cards).toHaveLength(state.corp.rd.length);
    expect(rd.groups[0].faceDown).toBe(true);
    const stack = zoneContents('stack', state);
    expect(stack.groups[0].cards[0].instanceId).toBe(state.runner.stack[0].instanceId);
    expect(stack.groups[0].faceDown).toBe(true);
  });
});
