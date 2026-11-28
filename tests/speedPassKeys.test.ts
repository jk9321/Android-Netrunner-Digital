/**
 * Speed pass (tracker L-24; ruling-rev0.md, red team section 3 and 4): a rekeyed memo gets one built test where two
 * frames differ only in a field its value reads. F128: ownHandBefore (prompts.ts) is keyed with frameKeys().context; the
 * known hands alone (its old key) served a value made outside `frozen` to a frozen frame. The red team's P3 board: a Corp
 * root with the top of R&D drawn unseen and 3 credits spent, where ownHandValue differs frozen and not. F129: freeOrder
 * (corp/candidates.ts freeInstallTarget) keyed with the same context; the board is G0's one difference (deal 2691, step
 * 202, the Corp's Synapse Global free install), where the order puts inst-13 first in a new remote outside
 * `frozen` and in remote-2 inside it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import '../src/ai';
import { withPricing } from '../src/ai/pricing';
import { ownHandValue } from '../src/ai/handValues';
import { ownHandBefore } from '../src/ai/prompts';
import { freeInstallOrder, freeInstallTarget } from '../src/ai/corp/candidates';
import { inDecision } from './helpers/pricing';

const root = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/broke-hedge-fund.json', import.meta.url), 'utf8'));

describe('F128: ownHandBefore keys the whole frame context', () => {
  it('a frozen frame with the same known hands is not served the value made outside it', () => {
    const s = root();
    inDecision(s, 'corp', () => {
      const board: GameState = { ...s, corp: { ...s.corp, hq: [...s.corp.hq, s.corp.rd[0]], rd: s.corp.rd.slice(1), credits: Math.max(0, s.corp.credits - 3) } };
      const open = ownHandValue(board, 'corp');
      const frozen = withPricing({ frozen: true }, () => ownHandValue(board, 'corp'));
      // The board this test is for: the two frames price the hand apart (7.1966 and 7.6553 on ecf29d1)
      expect(frozen).not.toBe(open);
      expect(ownHandBefore(board, 'corp')).toBe(open);
      expect(withPricing({ frozen: true }, () => ownHandBefore(board, 'corp'))).toBe(frozen);
      expect(ownHandBefore(board, 'corp')).toBe(open);
    });
  });
});

describe('F129: freeOrder keys the whole frame context', () => {
  it('a frozen frame is not served the free install order made outside it', () => {
    const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/speed-pass/free-order-2691.json', import.meta.url), 'utf8'));
    const options = ['hq', 'rd', 'archives', 'remote-2', 'new'];
    inDecision(s, 'corp', () => {
      const card = s.corp.hq.find(c => c.instanceId === 'inst-13')!;
      const first = (o: ReturnType<typeof freeInstallOrder>) => `${o[0].card}:${(o[0].action as { targetServerId?: string }).targetServerId ?? 'new'}`;
      // The board this test is for: the two frames order the free install apart
      expect(first(freeInstallOrder(s, options))).toBe('inst-13:new');
      expect(first(withPricing({ frozen: true }, () => freeInstallOrder(s, options)))).toBe('inst-13:remote-2');
      expect(freeInstallTarget(s, card, options)?.server).toBe('new');
      expect(withPricing({ frozen: true }, () => freeInstallTarget(s, card, options))?.server).toBe('remote-2');
      expect(freeInstallTarget(s, card, options)?.server).toBe('new');
    });
  });
});
