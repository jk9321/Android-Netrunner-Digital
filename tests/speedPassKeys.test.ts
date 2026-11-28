/**
 * Speed pass (tracker L-24; ruling-rev0.md, red team section 3 and 4): a rekeyed memo gets one built test where two
 * frames differ only in a field its value reads. F128: ownHandBefore (prompts.ts) is keyed with frameKeys().context; the
 * known hands alone (its old key) served a value made outside `frozen` to a frozen frame. The red team's P3 board: a Corp
 * root with the top of R&D drawn unseen and 3 credits spent, where ownHandValue differs frozen and not.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import '../src/ai';
import { withPricing } from '../src/ai/pricing';
import { ownHandValue } from '../src/ai/handValues';
import { ownHandBefore } from '../src/ai/prompts';
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
