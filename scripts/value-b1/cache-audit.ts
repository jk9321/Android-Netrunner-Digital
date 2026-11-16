/**
 * V-B B1 (brief rev 2, ruling 1): the wrong-hit rate of each incomplete-key cache. Plays the local deals (Normal v
 * Normal, split by SHARD) with every cache's on-hit audit on: each value served from a map is worked out again on the
 * asking board and compared. A mismatch is a hit the key let through for another board. Caches are cleared before each
 * decision, as the fire count and the log do. Reads only the audit objects, so it runs unchanged on the base.
 *   SHARD=0/64 npx vite-node scripts/value-b1/cache-audit.ts -- [actions per deal, default all]
 * Output: one JSON line per shard: { cache: { checked, mismatches, maxErr } }.
 */
import { GameState, CardInstance } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { valueLoops } from '../../src/ai/valueModel';
import { clickAudit, drawAudit } from '../../src/ai/handValues';
import { threatsAudit } from '../../src/ai/effectValues';
import { threatAudit } from '../../src/ai/threatModel';
import { clearCaches, dealState, deals } from '../stage-a/harness';

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const limit = Number(process.argv.slice(2).find(a => /^\d+$/.test(a)) ?? process.env.ARGS?.trim() ?? 4000) || 4000;
const audits = { click: clickAudit, draw: drawAudit, damageThreat: threatsAudit } as const;
for (const a of Object.values(audits)) Object.assign(a, { on: true, checked: 0, mismatches: 0, errors: [] });
Object.assign(threatAudit, { on: true, checked: 0, mismatches: 0, near: 0, examples: [] });

const watched = (side: 'corp' | 'runner'): Agent => {
  const inner = createAgent(side, 'normal');
  const out: Partial<Agent> & { side: string } = { side, chooseAction: (s: GameState) => (clearCaches(), inner.chooseAction(s)) };
  if (inner.chooseRez) out.chooseRez = (s: GameState, c: CardInstance[]) => (clearCaches(), inner.chooseRez!(s, c));
  if (inner.chooseOffTurn) out.chooseOffTurn = (s: GameState) => (clearCaches(), inner.chooseOffTurn!(s));
  return out as Agent;
};
const t0 = performance.now();
let n = 0;
deals().forEach((seed, k) => {
  if (k % shards !== shard) return;
  valueLoops.clear();
  const game = new GameRunner(dealState(seed), { corp: watched('corp'), runner: watched('runner') });
  for (let i = 0; i < limit && game.step(); i++);
  n++;
});
const out: Record<string, { checked: number; mismatches: number; maxErr: number }> = {};
for (const [name, a] of Object.entries(audits)) out[name] = { checked: a.checked, mismatches: a.mismatches, maxErr: a.errors.reduce((m, e) => Math.max(m, e), 0) };
out.threat = { checked: threatAudit.checked, mismatches: threatAudit.mismatches, maxErr: 0 };
console.log(JSON.stringify({ shard: `${shard}/${shards}`, deals: n, ms: Math.round(performance.now() - t0), ...out }));
if (threatAudit.examples.length) console.error(JSON.stringify(threatAudit.examples).slice(0, 2000));
