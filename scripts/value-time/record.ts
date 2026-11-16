/**
 * ai-value-time (brief-value-time.md, "Proof, per step"): every decision of BOTH sides on the local deals
 * (scripts/stage-a/harness.ts deals, Normal v Normal), one tab-separated line each: source, side, index, kind, turn,
 * the action as JSON, milliseconds (time last, so `cut -f1-6` compares decisions only). The three incomplete-key
 * hand caches are cleared before every decision, as the Stage A harness does, so a deal's decisions do not depend on
 * call order across decisions; the g1 batch is the identity test that keeps the caches (brief, "Cache order").
 *   SHARD=0/4 npx vite-node scripts/value-time/record.ts > base-0.tsv   (base checkout)
 *   SHARD=0/4 npx vite-node scripts/value-time/record.ts > head-0.tsv   (branch)
 *   node scripts/value-time/compare.mjs base-*.tsv -- head-*.tsv
 * Reads only APIs present on beta b7c4917, so it runs unchanged in a checkout of the base.
 */
import { CardInstance, GameState } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { valueLoops } from '../../src/ai/valueModel';
import { clearCaches, dealState, deals } from '../stage-a/harness';

function watched(src: string, side: 'corp' | 'runner'): Agent {
  const inner = createAgent(side, 'normal');
  let i = 0;
  const time = <T>(kind: string, turn: number, f: () => T): T => {
    clearCaches();
    const t = performance.now();
    const a = f();
    const ms = performance.now() - t;
    process.stdout.write(`${src}\t${side}\t${i++}\t${kind}\t${turn}\t${JSON.stringify(a ?? null)}\t${ms.toFixed(1)}\n`);
    return a;
  };
  const out: Partial<Agent> & { side: string } = {
    side,
    chooseAction: (s: GameState) => time('action', s.turnNumber, () => inner.chooseAction(s)),
  };
  if (inner.chooseRez) out.chooseRez = (s: GameState, cards: CardInstance[]) => time('rez', s.turnNumber, () => inner.chooseRez!(s, cards));
  if (inner.chooseOffTurn) out.chooseOffTurn = (s: GameState) => time('off', s.turnNumber, () => inner.chooseOffTurn!(s));
  return out as Agent;
}

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
deals().forEach((seed, k) => {
  if (k % shards !== shard) return;
  valueLoops.clear();
  const src = `deal:${seed}`;
  const game = new GameRunner(dealState(seed), { corp: watched(src, 'corp'), runner: watched(src, 'runner') });
  for (let n = 0; n < 4000 && game.step(); n++);
});
