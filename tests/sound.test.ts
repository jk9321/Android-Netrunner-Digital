import { describe, expect, it } from 'vitest';
import { soundFor } from '../src/ui/sound';
import { newGame } from './helpers';
import { executeAction } from '../src/core';

describe('soundFor endgame outcomes', () => {
  it('plays runner_win on Runner point victory for Runner listener, lose for Corp listener', () => {
    const prev = newGame();
    const next = {
      ...prev,
      winner: 'runner' as const,
      winReason: 'Runner scored 7 agenda points!',
      runner: { ...prev.runner, score: 7 },
    };

    expect(soundFor(prev, next, 'runner')).toBe('runner_win');
    expect(soundFor(prev, next, 'corp')).toBe('lose');
    expect(soundFor(prev, next, null)).toBe('runner_win');
  });

  it('plays corp_win on Corp point victory for Corp listener, lose for Runner listener', () => {
    const prev = newGame();
    const next = {
      ...prev,
      winner: 'corp' as const,
      winReason: 'Corp scored 7 agenda points!',
      corp: { ...prev.corp, score: 7 },
    };

    expect(soundFor(prev, next, 'corp')).toBe('corp_win');
    expect(soundFor(prev, next, 'runner')).toBe('lose');
    expect(soundFor(prev, next, null)).toBe('corp_win');
  });

  it('plays default lose sound for Runner listener on flatline, and win for Corp listener', () => {
    const prev = newGame();
    const next = {
      ...prev,
      winner: 'corp' as const,
      winReason: 'Runner flatlined',
    };

    expect(soundFor(prev, next, 'runner')).toBe('lose');
    expect(soundFor(prev, next, 'corp')).toBe('win');
    expect(soundFor(prev, next, null)).toBe('win');
  });

  it('plays deckout when Corp R&D is depleted', () => {
    const prev = newGame();
    const next = {
      ...prev,
      winner: 'runner' as const,
      winReason: 'Corp decked out (R&D is empty)',
    };

    expect(soundFor(prev, next, 'runner')).toBe('deckout');
    expect(soundFor(prev, next, 'corp')).toBe('deckout');
    expect(soundFor(prev, next, null)).toBe('deckout');
  });

  it('plays concede on player concession', () => {
    const state = newGame();
    const next = executeAction(state, { type: 'CONCEDE', player: 'corp' });

    expect(soundFor(state, next, 'corp')).toBe('concede');
    expect(soundFor(state, next, 'runner')).toBe('concede');
    expect(soundFor(state, next, null)).toBe('concede');
  });
});
