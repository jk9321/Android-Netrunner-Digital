import { describe, expect, it } from 'vitest';
import { findCardAnywhere } from '../src/core';
import { cardPositionLabel, isInstalledCard } from '../src/ui/cardLabels';
import { giveCard, installCorpForTest, installIceForTest, installProgramForTest, newGame } from './helpers';

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

  // Rules 8.1.1: only installed cards are rezzed or unrezzed, so prompts that pick from
  // Archives, HQ or the heap (Ansel 1.0, Retrieval Run) must not tag those cards "Unrezzed".
  it('counts only cards in a server or the rig as installed', () => {
    const s = newGame();
    const ice = installIceForTest(s, '35063', 'hq', false);
    const program = installProgramForTest(s, '30010');
    const inHq = giveCard(s, 'corp', '30067');
    const inGrip = giveCard(s, 'runner', '30011');
    const archived = s.corp.hq.splice(s.corp.hq.findIndex(c => c.instanceId === inHq), 1)[0];
    s.corp.archives.faceUp.push(archived);
    const heaped = s.runner.grip.splice(s.runner.grip.findIndex(c => c.instanceId === inGrip), 1)[0];
    s.runner.heap.push(heaped);
    const installed = (id: string) => isInstalledCard(s, findCardAnywhere(s, id)!);
    expect(installed(ice)).toBe(true);
    expect(installed(program)).toBe(true);
    expect(installed(inHq)).toBe(false);
    expect(installed(inGrip)).toBe(false);
  });
});
