import { describe, expect, it } from 'vitest';
import { dockedHandOverlap, handOverlap, spreadOverlap } from '../src/ui/components/HandRow';
import { iceOverlap } from '../src/ui/components/ServerColumn';
import { autoFitFloor } from '../src/ui/useAutoFit';

describe('board space savers', () => {
  it('hands overlap more as they grow, and the opponent hand is always tightest', () => {
    expect(handOverlap(1, false)).toBe(0.5);
    expect(handOverlap(5, false)).toBeGreaterThan(handOverlap(4, false));
    expect(handOverlap(12, false)).toBe(0.72);
    expect(handOverlap(2, true)).toBe(0.75);
    expect(handOverlap(12, true)).toBeGreaterThan(handOverlap(12, false));
  });

  it('a docked hand stays flat (0 overlap) while cards fit, and compresses smoothly once cramped', () => {
    expect(dockedHandOverlap(5, 60, 500)).toBe(0);
    expect(dockedHandOverlap(8, 60, 480)).toBe(0);
    const o = dockedHandOverlap(12, 60, 500);
    expect(o).toBeGreaterThan(0);
    expect(60 + 11 * 60 * (1 - o)).toBeLessThanOrEqual(500 + 0.001);
    expect(dockedHandOverlap(30, 60, 200)).toBe(0.72);
  });

  it('a spread hand is loose when there is room and tightened to fit when there is not', () => {
    expect(spreadOverlap(5, 90, 2000)).toBe(0.04);
    const o = spreadOverlap(9, 90, 600);
    expect(o).toBeGreaterThan(0.04);
    expect(90 + 8 * 90 * (1 - o)).toBeLessThanOrEqual(600 + 0.001);
  });

  it('ice overlaps only in stacks of three or more', () => {
    expect(iceOverlap(2)).toBe(0);
    expect(iceOverlap(3)).toBeGreaterThan(0);
    expect(iceOverlap(5)).toBeGreaterThan(iceOverlap(3));
  });

  it('auto fit never goes below half the normal size or 44px', () => {
    expect(autoFitFloor(100)).toBe(50);
    expect(autoFitFloor(60)).toBe(44);
    expect(autoFitFloor(30)).toBe(30);
  });
});
