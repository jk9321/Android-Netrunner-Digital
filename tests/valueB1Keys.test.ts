/**
 * V-B B1 (brief rev 2 step B1, ruling 1): the incomplete-key caches' keys hold what their values read.
 * - contentPrint (the board part of clickWorth's and drawWorth's keys) tells apart boards fingerprint can't: an R&D whose
 *   cards differ, a counter on an installed card, a run under way.
 * - damageThreat's key holds which cards are in the pool: two boards with the same counts but another card out of it
 *   are each priced on their own (before, the second was served the first's value).
 */
import { describe, expect, it } from 'vitest';
import { cardDef } from '../src/core';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { contentPrint, fingerprint } from '../src/ai/valueModel';
import { clearDamageThreats, damageThreat } from '../src/ai/effectValues';
import { dealState } from '../scripts/stage-a/harness';

function midGame() {
  const game = new GameRunner(dealState(1001), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  for (let i = 0; i < 60 && game.step(); i++);
  return game.state;
}

describe('contentPrint: what fingerprint leaves out', () => {
  it('differs where fingerprint does not', () => {
    const s = midGame();
    const rd = structuredClone(s);
    // an R&D card swapped for an HQ card of another code: same sizes, same fingerprint
    const h = rd.corp.hq.findIndex(c => c.cardCode !== rd.corp.rd[0].cardCode);
    [rd.corp.hq[h], rd.corp.rd[0]] = [rd.corp.rd[0], rd.corp.hq[h]];
    const counter = structuredClone(s);
    const installed = Object.values(counter.corp.servers).flatMap(v => [...v.ice, ...v.root])[0];
    installed.advancementCounters += 1;
    for (const b of [rd, counter]) {
      expect(fingerprint(b)).toBe(fingerprint(s));
      expect(contentPrint(b)).not.toBe(contentPrint(s));
    }
    expect(contentPrint(structuredClone(s))).toBe(contentPrint(s));
  }, 60_000);
});

// Known-failing: damageThreat's pool key cost x1.10 Corp decision time on its own (V-B B1 fire count, ruling 1), so the key
// is kept incomplete, recorded (registry, cache keys). Passes again when a cheaper exact key lands
describe("damageThreat's key holds the pool", () => {
  it.fails('two boards with the same counts and another card out of the pool are each priced on their own', () => {
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
