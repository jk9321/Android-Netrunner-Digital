/**
 * Stage C measurement scripts written to compare the ranking with the new core (plan.corpCore) or to read a rule
 * that C7 deleted. On a tree without plan.corpCore (C7 onwards) they would run without an error and measure the
 * new core alone, so they stop here instead. Run them on 5b326b9 or earlier (or ai-corp-core-c-g1base).
 */
import { tuning } from '../../src/ai/synergy';

export function needsOldTree(script: string): void {
  if (!('corpCore' in tuning.plan)) throw new Error(`${script} compares the ranking with plan.corpCore, which this tree no longer has: run it on 5b326b9 or earlier`);
}
