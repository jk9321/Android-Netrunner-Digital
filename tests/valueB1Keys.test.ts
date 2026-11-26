/**
 * V-B B1 (brief rev 2 step B1, ruling 1; review M1): the incomplete-key caches, pinned known-failing until the exact keys
 * were affordable; since F3 (netrunner-ai/cache-keys/brief-build.md) both maps are by position and both pins pass:
 * - clickWorth's key: a board whose stack differs (fingerprint has zone sizes only) is served the other board's value.
 * - damageThreat's key: two boards with the same counts but another card out of the pool share a value.
 */
import { describe, expect, it } from 'vitest';
import { cardDef } from '../src/core';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { clearHandCaches, clickWorth } from '../src/ai/handValues';
import { clearDamageThreats, damageThreat } from '../src/ai/effectValues';
import { dealState } from '../scripts/stage-a/harness';

function midGame() {
  const game = new GameRunner(dealState(1001), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  for (let i = 0; i < 60 && game.step(); i++);
  return game.state;
}

// clickWorth's map is by position since F3 (valueModel stateEntries): a board with another stack is priced on its own
describe("clickWorth's key holds the stack", () => {
  it('a Runner board with a stack card swapped for a heap card is priced on its own', () => {
    const s = midGame();
    const b = structuredClone(s);
    const i = b.runner.stack.findIndex(c => c.cardCode !== b.runner.heap[0]?.cardCode);
    expect(b.runner.heap.length).toBeGreaterThan(0);
    [b.runner.stack[i], b.runner.heap[0]] = [b.runner.heap[0], b.runner.stack[i]];
    clearHandCaches();
    const alone = clickWorth(b, 'runner');
    clearHandCaches();
    expect(clickWorth(s, 'runner')).not.toBe(alone);
    expect(clickWorth(b, 'runner')).toBe(alone);
  }, 60_000);
});

// damageThreat's map is by position since F3 (valueModel stateEntries): each board is priced on its own
describe("damageThreat's key holds the pool", () => {
  it('two boards with the same counts and another card out of the pool are each priced on their own', () => {
    const s = midGame();
    // move a damage card from R&D to Archives face up on one board, a card that deals none on the other
    const damaging = s.corp.rd.findIndex(c => /do \d+ (net|meat|core) damage/i.test(cardDef(c).stripped_text ?? ''));
    const quiet = s.corp.rd.findIndex(c => !/damage/i.test(cardDef(c).stripped_text ?? ''));
    expect(damaging).toBeGreaterThanOrEqual(0);
    expect(quiet).toBeGreaterThanOrEqual(0);
    const out = (at: number) => {
      const b = structuredClone(s);
      b.corp.archives.faceUp.push(...b.corp.rd.splice(at, 1));
      return b;
    };
    const a = out(damaging);
    const b = out(quiet);
    clearDamageThreats();
    const alone = damageThreat(b).share;
    clearDamageThreats();
    damageThreat(a);
    expect(damageThreat(b).share).toBe(alone);
  }, 60_000);
});
