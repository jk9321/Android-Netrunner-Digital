import { describe, expect, it } from 'vitest';
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
});
