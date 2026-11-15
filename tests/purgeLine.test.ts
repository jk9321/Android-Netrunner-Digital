/**
 * Line 5 of the order (a purge, stage-c/order.md; Step 4 Stage C7 leave-one-out, AI Coordinator 18:26Z): the pin for
 * the line, on a recorded decision where the purge is the better play for a reason the board shows.
 *
 * Rules (Comprehensive Rules v26.03): 5.2.6h the Corp's basic action "click, click, click: Purge virus counters";
 * 10.1.2 a purge removes every virus counter hosted on cards. Card text: Botulus, installed on a piece of ice, "Hosted
 * virus counter: Break 1 subroutine on host ice", and gains a counter when the Runner's turn begins.
 *
 * Position (tests/fixtures/purge-botulus-1041-t21.json, deal 1041 replayed by the ranking's Corp on 20d4af2, the state
 * of leave-one-out's line-5 example): turn 21, the Corp with 3 clicks and 27 credits, 6 points to the Runner's 5. One
 * Botulus with 6 counters sits on R&D's rezzed Tithe, another with 8 on Whitespace, the only ice on remote-1. Each
 * counter is one subroutine broken for free: three free passes of Tithe and four of Whitespace, one more each turn, with
 * the Runner 2 points from winning. Money is not short (27 credits), so the three clicks are the whole price, and the
 * alternative with the line left out (Stage C7 leave-one-out) was an econ asset, Nico Campaign, in remote-3 (Regolith Mining License already pays from remote-2).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { createAgent } from '../src/ai';

const t21 = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/purge-botulus-1041-t21.json', import.meta.url), 'utf8'));

describe('line 5: a purge when the virus counters are worth more than three clicks', () => {
  it('deal 1041 T21: the Normal Corp purges 14 Botulus counters rather than install another econ asset', () => {
    expect(createAgent('corp', 'normal').chooseAction(t21()).type).toBe('PURGE_VIRUS');
  }, 120000);
});
