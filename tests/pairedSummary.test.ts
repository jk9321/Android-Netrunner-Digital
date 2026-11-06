import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs batch script, no types
import { pairBatches, splitArgs } from '../scripts/paired-summary.mjs';

const game = (seed: number, winner: string, alarms: string[] = [], extra = {}) => ({ seed, corpDeck: 'C', runnerDeck: 'R', winner, alarms: alarms.map(kind => ({ kind })), ...extra });

describe('paired batch summary', () => {
  it('pairs deals by seed and decks, and leaves out deals only one batch played or that crashed', () => {
    const on = [game(1, 'corp'), game(2, 'corp'), game(3, 'runner'), game(4, 'runner'), game(5, 'corp'), game(6, 'corp', [], { crashed: 'x' })];
    const off = [game(1, 'corp'), game(2, 'runner'), game(3, 'runner'), game(4, 'corp'), game(6, 'runner'), game(7, 'corp')];
    const p = pairBatches(on, off);
    expect(p.n).toBe(4);
    expect(p.on).toBeCloseTo(50);
    expect(p.off).toBeCloseTo(50);
    expect(p.toCorp).toBe(1);
    expect(p.toRunner).toBe(1);
    // diffs 0, +1, 0, -1: mean 0, sample sd sqrt(2/3), SE sqrt(2/3)/2
    expect(p.diff).toBeCloseTo(0);
    expect(p.se).toBeCloseTo((100 * Math.sqrt(2 / 3)) / 2);
  });

  it('gives a much smaller SE than two independent rates when most deals agree', () => {
    const on = Array.from({ length: 200 }, (_, i) => game(i, i % 2 === 0 || i === 1 ? 'corp' : 'runner'));
    const off = Array.from({ length: 200 }, (_, i) => game(i, i % 2 === 0 ? 'corp' : 'runner'));
    const p = pairBatches(on, off);
    expect(p.diff).toBeCloseTo(0.5);
    expect(p.se).toBeLessThan(p.unpairedSE / 5);
  });

  it('pairs alarm counts per 100 games', () => {
    const p = pairBatches([game(1, 'corp', ['corp-broke', 'corp-broke']), game(2, 'corp')], [game(1, 'corp', ['corp-broke']), game(2, 'corp', ['hoard'])]);
    const broke = p.alarms.find((a: { kind: string }) => a.kind === 'corp-broke');
    expect(broke).toMatchObject({ on: 100, off: 50, diff: 50 });
    expect(p.alarms.find((a: { kind: string }) => a.kind === 'hoard')).toMatchObject({ on: 0, off: 50, diff: -50 });
  });

  it('splits the --base files off the arguments', () => {
    expect(splitArgs(['a.json', 'b.json', '--base', 'c.json'])).toEqual({ files: ['a.json', 'b.json'], base: ['c.json'] });
    expect(splitArgs(['a.json'])).toEqual({ files: ['a.json'], base: [] });
  });
});
