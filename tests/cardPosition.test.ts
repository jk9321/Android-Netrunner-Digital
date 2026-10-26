import { describe, expect, it } from 'vitest';
import { findCardAnywhere } from '../src/core';
import { cardPositionLabel } from '../src/ui/cardLabels';
import { installCorpForTest, installIceForTest, newGame } from './helpers';

describe('cardPositionLabel', () => {
  it('counts ice out from the server and names the ends', () => {
    const s = newGame();
    const inner = installIceForTest(s, '35063', 'hq', false);
    const middle = installIceForTest(s, '35054', 'hq', false);
    const outer = installIceForTest(s, '35075', 'hq', false);
    const label = (id: string) => cardPositionLabel(s, findCardAnywhere(s, id)!);
    expect(label(inner)).toBe('HQ, ice 1 of 3 (innermost)');
    expect(label(middle)).toBe('HQ, ice 2 of 3');
    expect(label(outer)).toBe('HQ, ice 3 of 3 (outermost)');
  });

  it('names a lone ice and a card in a remote server', () => {
    const s = newGame();
    const ice = installIceForTest(s, '35063', 'rd', false);
    const asset = installCorpForTest(s, '30067', 'remote-1');
    expect(cardPositionLabel(s, findCardAnywhere(s, ice)!)).toBe('R&D, ice 1 of 1 (only ice)');
    expect(cardPositionLabel(s, findCardAnywhere(s, asset)!)).toBe('remote-1, in the server');
  });
});
