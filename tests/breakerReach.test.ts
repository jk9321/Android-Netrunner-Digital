import { describe, expect, it } from 'vitest';
import { breakerReach } from '../src/ai/corpAI';
import { createCardInstance } from '../src/core';
import { newGame } from './helpers';

/**
 * Code audit (2026-11-06, Jeff: the flat 8 credits for ice the Runner can't break was a band-aid): the Corp prices
 * that ice by the breaker the Runner would find for it, and as a wall when its deck has none. plan.breakerReach.
 */
describe('ice the Runner can\'t break yet (plan.breakerReach)', () => {
  const position = (grip: string[], stack: string[]) => {
    const s = structuredClone(newGame());
    s.runner.rig.programs = [];
    s.runner.grip = grip.map(code => createCardInstance(s, code));
    s.runner.stack = stack.map(code => createCardInstance(s, code));
    const ice = createCardInstance(s, '30072'); // Palisade, a barrier
    ice.isRezzed = true;
    return { s, ice };
  };
  const filler = (n: number) => Array.from({ length: n }, () => '30034'); // Creative Commission

  it('costs the fracter in the grip: install, a click, and the break', () => {
    const { s, ice } = position(['30006'], filler(20)); // Cleaver
    const reach = breakerReach(s, ice);
    expect(reach).toBeGreaterThan(3);
    expect(reach).toBeLessThan(8);
  });

  it('costs more when the fracter is still in the stack, and more the deeper the stack', () => {
    const grip = breakerReach(position(['30006'], filler(20)).s, position(['30006'], filler(20)).ice);
    const shallow = position([], [...filler(5), '30006']);
    const deep = position([], [...filler(25), '30006']);
    expect(breakerReach(shallow.s, shallow.ice)).toBeGreaterThan(grip);
    expect(breakerReach(deep.s, deep.ice)).toBeGreaterThan(breakerReach(shallow.s, shallow.ice));
  });

  it('is a wall when nothing in the Runner\'s deck can break it', () => {
    const { s, ice } = position(['30015'], ['30026', ...filler(10)]); // Carmen (killer), Unity (decoder)
    expect(breakerReach(s, ice)).toBe(Infinity);
  });
});
