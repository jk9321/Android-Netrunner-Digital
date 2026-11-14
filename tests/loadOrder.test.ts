import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain .mjs script with no type declarations (scripts/load-order.mjs)
import { loadReads } from '../scripts/load-order.mjs';

type Read = { at: string; name: string; provider: string; unsafe: boolean };

/**
 * ai-trojans-load: play must not depend on module load order. A value read while a module loads from a module in the
 * same import cycle can be unset under some entry order (vite-node then reads undefined: runnerAI's trojan list was
 * [undefined, undefined] in every batch). scripts/load-order.mjs --reads lists every load-time read of an import in
 * src/ai under the batch entry, the browser worker and the app; none may be unsafe except the one listed here.
 */
const ALLOWED: Record<string, string> = {
  // The card tables joined at load (cards/index.ts join). Under every entry the set files load first; under an order
  // that reached a set file before the index, join's Object.entries(undefined) throws at load: loud, never a silent
  // change in play. Listed rather than restructured (src/ai/cards is the Step 4 owner's to change).
  'src/ai/cards/index.ts:19': 'card table join',
};

describe('module load order', () => {
  it('no load-time read of an import from the same import cycle, outside the listed card join', () => {
    const unsafe = (loadReads() as Read[]).filter(r => r.unsafe && !ALLOWED[r.at]);
    expect(unsafe.map(r => `${r.at} ${r.name} from ${r.provider}`)).toEqual([]);
  });
});
