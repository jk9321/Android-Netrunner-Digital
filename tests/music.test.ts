import { describe, expect, it, vi } from 'vitest';
import { musicEnabled, musicVolume, setMusicEnabled, setMusicVolume, startMusic, stopMusic, updateMusic } from '../src/ui/music';
import { newGame } from './helpers';

describe('music settings and lifecycle', () => {
  it('toggles music enabled state in localStorage', () => {
    setMusicEnabled(true);
    expect(musicEnabled()).toBe(true);

    setMusicEnabled(false);
    expect(musicEnabled()).toBe(false);

    setMusicEnabled(true);
    expect(musicEnabled()).toBe(true);
  });

  it('starts muted for players who had muted sound before music existed', () => {
    const store = new Map<string, string>([['netrunner.sound', 'off']]);
    vi.stubGlobal('window', {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    });
    try {
      expect(musicEnabled()).toBe(false);
      store.set('netrunner.sound', 'on');
      expect(musicEnabled()).toBe(true);
      // An explicit music choice wins over the sound setting
      store.set('netrunner.sound', 'off');
      store.set('netrunner.music', 'on');
      expect(musicEnabled()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('clamps and persists volume between 0 and 1', () => {
    setMusicVolume(0.75);
    expect(musicVolume()).toBeCloseTo(0.75);

    setMusicVolume(-0.5);
    expect(musicVolume()).toBe(0);

    setMusicVolume(1.5);
    expect(musicVolume()).toBe(1);

    setMusicVolume(0.5);
    expect(musicVolume()).toBeCloseTo(0.5);
  });

  it('runs updateMusic and stopMusic safely without throwing in headless test runner', () => {
    const state = newGame();
    expect(() => updateMusic(state, 'runner')).not.toThrow();
    expect(() => updateMusic(state, 'corp')).not.toThrow();
    expect(() => startMusic('runner')).not.toThrow();
    expect(() => stopMusic()).not.toThrow();
  });

  it('handles asymmetric score updates and game-over transitions safely', () => {
    const state = newGame();

    // Opening
    updateMusic(state, 'runner');

    // Runner dominance (5-0)
    const domState = { ...state, runner: { ...state.runner, score: 5 }, corp: { ...state.corp, score: 0 } };
    expect(() => updateMusic(domState, 'runner')).not.toThrow();

    // Corp infiltration (Runner 1, Corp 5)
    const infilState = { ...state, runner: { ...state.runner, score: 1 }, corp: { ...state.corp, score: 5 } };
    expect(() => updateMusic(infilState, 'runner')).not.toThrow();

    // 6-6 Climax Clash
    const clashState = { ...state, runner: { ...state.runner, score: 6 }, corp: { ...state.corp, score: 6 } };
    expect(() => updateMusic(clashState, 'runner')).not.toThrow();

    // Corp perspective duel
    expect(() => updateMusic(clashState, 'corp')).not.toThrow();

    // Game over handoff
    const overState = { ...clashState, winner: 'corp' as const, winReason: 'Corp scored 7 agenda points!' };
    expect(() => updateMusic(overState, 'corp')).not.toThrow();
  });

  it('handles tab visibility transitions safely', () => {
    if (typeof document !== 'undefined') {
      const event = new Event('visibilitychange');
      expect(() => document.dispatchEvent(event)).not.toThrow();
    }
  });
});
