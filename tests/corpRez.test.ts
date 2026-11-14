import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef, isLegalAction } from '../src/core';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { serverHold } from '../src/ai/corp/hold';
import { rezCost } from '../src/core/engine/cardEffects';

const read = (name: string): GameState => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const inCorp = <T>(s: GameState, f: () => T): T => asSide('corp', () => (decisionContext(s, 'corp'), f()));

/**
 * Stage B2, the hold owner's afford test (corp/hold.ts holdThisRun): a rez the engine allows though the ice's cost is
 * more than the Corp's credit pool (Biawak's agenda forfeit, credits a card holds for rezzing, a rez discount) is paid
 * another way, so the owner prices the hold instead of "the Corp cannot pay". Recorded by scripts/stage-b/fixtures.ts;
 * the second stop test (rezModel.ts modelRezParts) already counted these rezzes.
 */
describe('serverHold: a legal rez paid another way', () => {
  for (const [file, title] of [['stage-b-rez-scatter-r23-31.json', 'Scatter Field'], ['stage-b-rez-biawak-r20-42.json', 'Biawak']] as const) {
    it(`${title} (${file})`, () => {
      const s = read(file);
      const run = s.activeRun!;
      const ice = s.corp.servers[run.server].ice[run.icePosition!];
      expect(cardDef(ice).title).toBe(title);
      expect(rezCost(s, ice)).toBeGreaterThan(s.corp.credits);
      expect(isLegalAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice.instanceId })).toBe(true);
      const h = inCorp(s, () => serverHold(s, run.server, { when: 'thisRun', mustRez: [ice.instanceId], further: false }));
      expect(h.rezCost).toBeLessThan(Infinity);
      expect(h.rez).toContain(ice.instanceId);
    });
  }
});
