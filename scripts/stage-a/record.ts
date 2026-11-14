/**
 * Step 4 Stage A, table 8 (decisions identical): every Corp decision on the recorded states (scripts/stage-a/harness.ts),
 * one line each: source, index, kind, turn, the action as JSON, and the decision's milliseconds (tab-separated, the
 * time last so `cut -f1-5` compares decisions only). Run on the base and on the branch, then compare:
 *
 *   SHARD=0/4 npx vite-node scripts/stage-a/record.ts > base-0.tsv   (in a checkout of beta 92f5c96)
 *   SHARD=0/4 npx vite-node scripts/stage-a/record.ts > head-0.tsv   (on ai-corp-core)
 *   node scripts/stage-a/compare.mjs base-*.tsv -- head-*.tsv
 *
 * Module load order: compare `node scripts/load-order.mjs scripts/stage-a/record.ts` on both trees too (the AI modules'
 * relative order must match, so a difference cannot come from a load-order change).
 */
import { forEachRecorded } from './harness';
import { applyPlanOff } from '../../src/ai/synergy';

// Stage B fire counts: PLAN_OFF as the batch scripts take it (a temporary step switch off on one side of the compare)
applyPlanOff(process.env.PLAN_OFF ?? '');

forEachRecorded({
  decision: d => {
    process.stdout.write(`${d.src}\t${d.i}\t${d.kind}\t${d.turn}\t${JSON.stringify(d.action)}\t${d.ms.toFixed(1)}\n`);
  },
});
