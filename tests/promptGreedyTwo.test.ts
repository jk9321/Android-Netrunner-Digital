import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { createAgent } from '../src/ai';

/**
 * ai-prompt-time (AI Coordinator 2026-11-15 14:50Z): a card prompt with two or more cards allowed beyond the minimum
 * and more than four candidates is answered one card at a time (greedyCards), as "any number" prompts already were.
 * Spin Doctor's "shuffle up to 2 cards from Archives into R&D" with 12 cards in Archives (deal 2041 turn 17, played on
 * ai-corp-core-c) took every subset before: 79 answers, each scored with a full evaluate, 5-9 s a resolution, and the
 * Corp's look-ahead resolved it at many playout steps (a 271 s decision on beta's Corp). Spin Doctor itself is now answered
 * by the Archives-shuffle family (tests/archivesShuffle.test.ts); this keeps the prompt's answer legal on either route.
 */
const fixture = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/spin-doctor-archives-2041.json', import.meta.url), 'utf8'));

describe('card prompts with two more cards allowed than required', () => {
  it("answers Spin Doctor's up-to-2 shuffle of a 12-card Archives with at most 2 of its candidates", () => {
    const s = fixture();
    const p = s.pendingPrompts[0] as unknown as { kind: string; source: { cardCode: string }; candidateIds: string[]; min: number; max: number };
    expect([p.kind, p.source.cardCode, p.candidateIds.length, p.min, p.max]).toEqual(['effect_cards', '30053', 12, 0, 2]);
    const a = createAgent('corp', 'normal').chooseAction(s) as { type: string; choice?: { kind: string; cardInstanceIds: string[] } };
    expect(a.type).toBe('RESOLVE_PROMPT');
    expect(a.choice?.kind).toBe('effect_cards');
    expect(a.choice!.cardInstanceIds.length).toBeLessThanOrEqual(2);
    for (const id of a.choice!.cardInstanceIds) expect(p.candidateIds).toContain(id);
  }, 120_000);
});
