import { describe, expect, it, vi } from 'vitest';
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

  // R-B B1, tracker R-28 (the Corp side's conditions for parking the cycle {corpAI, runnerAI, runnerReply, turnPlanner}):
  // no new load-time read inside it. Today's: runnerReply registers the oracle's play-out (a closure, read later) and
  // corpAI registers the Corp ports; each reads a module outside the cycle. May only shrink.
  it('no new load-time read in the files of the cycle that holds runnerAI.ts', () => {
    const CYCLE = ['corpAI', 'runnerAI', 'runnerReply', 'turnPlanner'].map(f => `src/ai/${f}.ts`);
    const reads = (loadReads() as Read[]).filter(r => CYCLE.some(f => r.at.startsWith(`${f}:`))).map(r => `${r.at.replace(/:\d+$/, '')} ${r.name} from ${r.provider}`);
    expect(reads.sort()).toEqual([
      'src/ai/corpAI.ts freeInstallTarget from src/ai/corp/candidates.ts',
      'src/ai/corpAI.ts holdingRezIds from src/ai/corp/rezMoney.ts',
      'src/ai/corpAI.ts perfectRecallTarget from src/ai/corp/rez.ts',
      'src/ai/corpAI.ts registerCorpPorts from src/ai/corpPorts.ts',
      'src/ai/corpAI.ts runLoss from src/ai/corp/pools.ts',
      'src/ai/corpAI.ts runStands from src/ai/corp/hold.ts',
      'src/ai/runnerReply.ts setOraclePlayout from src/ai/oracle.ts',
    ]);
  });
});

/**
 * Stage B review R1 and R8: the valuation layer and prompts.ts read the Corp owners through src/ai/corpPorts.ts, which
 * corpAI.ts fills as it loads (corp/ is in no import cycle). Under each AI entry all four ports are set before the first
 * decision, so the Corp's prices never depend on load order; unset, a port throws rather than falling back.
 */
describe('Corp ports (src/ai/corpPorts.ts)', () => {
  const position = async () => {
    const { createInitialGameState } = await import('../src/core');
    const { deckGameSetup } = await import('../src/data/decks');
    const { ALL_DECKS } = await import('../scripts/nsg-sample-decks');
    return createInitialGameState(deckGameSetup(1001, ALL_DECKS.find(d => d.side === 'corp')!, ALL_DECKS.find(d => d.side === 'runner')!));
  };
  for (const entry of ['../src/ai/index', '../src/ai/turnPlanner', '../src/ai/corpAI', '../src/ai/search']) {
    it(`are all set when ${entry.replace('../', '')} is the entry`, async () => {
      vi.resetModules();
      await import(/* @vite-ignore */ entry);
      const { corpPorts } = await import('../src/ai/corpPorts');
      const { boardNeed } = await import('../src/ai/valueModel');
      const { asSide } = await import('../src/ai/pricing');
      const s = await position();
      asSide('corp', () => {
        expect(boardNeed(s, 'corp')).toBeGreaterThanOrEqual(0);
        expect(corpPorts.keep(s)).toBeGreaterThanOrEqual(0);
        expect(typeof corpPorts.holdingRezIds(s)).toBe('object');
        expect(corpPorts.perfectRecallTarget(s)).toBeUndefined();
        const card = s.corp.hq[0];
        expect(() => corpPorts.freeInstallTarget(s, card, ['new'])).not.toThrow();
      });
    });
  }

  it('throw, naming the port, when no entry has loaded corpAI.ts', async () => {
    vi.resetModules();
    const { corpPorts } = await import('../src/ai/corpPorts');
    const s = await position();
    expect(() => corpPorts.keep(s)).toThrow(/corpPorts\.keep is not registered/);
    expect(() => corpPorts.freeInstallTarget(s, s.corp.hq[0], ['new'])).toThrow(/corpPorts\.freeInstallTarget/);
  });
});
