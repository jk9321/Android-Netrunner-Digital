/**
 * The deep fuzz's knowledge failures on beta 3777078 (run 46126785266; brief
 * /mnt/project-files/netrunner-ai/runner-rework/briefs/rd-fuzz-fixes.md), bar 1: one pin per class, each from its seed's
 * board (tests/fixtures/rd-fuzz/seed-<seed>.json: the state before the failing action and that action, written by
 * scripts/runner-rework/rd-fuzz/trace.ts on 3777078). Each pin fails with its fix reverted.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, executeAction } from '../src/core';
import { certainInHand } from '../src/core/engine/helpers';
import { cardsByZone, checkInvariants, knownByCopy, relabelledCopy } from '../scripts/engine-fuzz-check';

function board(seed: number): { prev: GameState; action: GameAction } {
  return JSON.parse(readFileSync(`tests/fixtures/rd-fuzz/seed-${seed}.json`, 'utf8'));
}
const rdChecks = (next: GameState, prev: GameState) =>
  checkInvariants(next, prev, new Set(cardsByZone(prev).map(x => x.card.instanceId))).failures.filter(f => f.check.startsWith('runner-rd'));

describe('class 1: a share is read by code and count, not by its id (check fault; rules 4.2.2, 10.2.2b)', () => {
  it('1128087901: Luana Campos fetched to HQ, the other copy still in R&D: the share stands and the check passes', () => {
    const { prev, action } = board(1128087901);
    const next = executeAction(prev, action);
    // The engine drops one share of 36057 by code; the one left is labelled with the copy now in HQ (a label, B4d (b))
    const shares = (next.corp.rdKnownToRunner ?? []).filter(e => e.n0 && e.code === '36057');
    expect(shares).toHaveLength(1);
    expect(next.corp.rd.filter(c => c.cardCode === '36057')).toHaveLength(1);
    expect(rdChecks(next, prev)).toEqual([]);
  });

  it('control: a share of a code with no copy left in R&D is still flagged', () => {
    const { prev, action } = board(1128087901);
    const next = structuredClone(executeAction(prev, action));
    const copy = next.corp.rd.findIndex(c => c.cardCode === '36057');
    next.corp.rd.splice(copy, 1);
    expect(rdChecks(next, prev).map(f => f.check)).toContain('runner-rd-memory-in-place');
  });
});

describe('class 2: a draw after the Corp acts on the top cards in secret keeps every mark on its card (rules 4.2.3, 8.3.3b)', () => {
  it('1128106730: AU Co. takes the top 3, Mandatory Draw the next: the bottom mark moves up 4', () => {
    const { prev, action } = board(1128106730);
    const next = executeAction(prev, action);
    const mark = next.corp.rdKnownToRunner!.find(e => e.id === 'inst-6')!;
    expect(next.corp.rd.findIndex(c => c.instanceId === 'inst-6')).toBe(24);
    expect([mark.lo, mark.hi]).toEqual([24, 24]);
  });

  it('1128152262: the top 3 arranged, then a draw: a card moved within the 3 is not counted as one added', () => {
    const { prev, action } = board(1128152262);
    const next = executeAction(prev, action);
    const mark = next.corp.rdKnownToRunner!.find(e => e.id === 'inst-24')!;
    expect(next.corp.rd.findIndex(c => c.instanceId === 'inst-24')).toBe(28);
    expect([mark.lo, mark.hi]).toEqual([28, 28]);
  });
});

describe('class 3: a card put on top after a search shuffle pushes the shares down (rules 4.2.2, 8.7.3)', () => {
  it('1128121515: the find goes back on top: the share of Hedge Fund covers places 1 to 21', () => {
    const { prev, action } = board(1128121515);
    const next = executeAction(prev, action);
    const share = next.corp.rdKnownToRunner!.find(e => e.n0 && e.code === '30075')!;
    expect([share.lo, share.hi]).toEqual([1, 21]);
    expect(next.corp.rd.findIndex(c => c.instanceId === 'inst-17')).toBe(21);
    expect(rdChecks(next, prev)).toEqual([]);
  });
});

describe('class 4: which copy the HQ list names does not pick the entry a sighting refreshes or a trash forgets (10.2.2b)', () => {
  for (const seed of [1128098000, 1128125825]) {
    it(`${seed}: the same lists by code and losses either way`, () => {
      const { prev, action } = board(seed);
      const relabelled = relabelledCopy(prev)!;
      expect(relabelled).not.toBeNull();
      expect(knownByCopy(executeAction(relabelled, action))).toBe(knownByCopy(executeAction(prev, action)));
    });
  }
});

describe('class 5: a card that comes into HQ from the open and leaves into the open in one action is not counted there (1.12.3, 10.2.2b)', () => {
  it('1128104718: The Basalt Spire adds Slash and Burn Agriculture from Archives, the breach steals it', () => {
    const { prev, action } = board(1128104718);
    const next = executeAction(prev, action);
    expect(next.runner.scoreArea.some(c => c.cardCode === '34057')).toBe(true);
    expect(certainInHand(next, 'corp').find(([code]) => code === '34057')).toBeUndefined();
    expect((next.corp.knownToRunner ?? []).some(e => e.code === '34057')).toBe(false);
  });
});
