import { afterEach, beforeEach } from 'vitest';
import { tuning } from '../src/ai/synergy';

/**
 * Tests of the Corp's old ranking (installScore, advanceScore, the reserve penalties, the override layer) run with
 * plan.oneCurrency off: they pin the switched-off code until it is deleted (structural review item 1). Each named test
 * is listed in the oneCurrency hand-off with what the one-currency Corp does in its position instead.
 */
export function legacyRanking(names: string[]): void {
  const pinned = new Set(process.env.UNPIN ? [] : names);
  let saved: boolean | undefined;
  beforeEach(ctx => {
    if (!pinned.has(ctx.task.name)) return;
    saved = tuning.plan.oneCurrency;
    tuning.plan.oneCurrency = false;
  });
  afterEach(ctx => {
    if (pinned.has(ctx.task.name) && saved !== undefined) tuning.plan.oneCurrency = saved;
    saved = undefined;
  });
}
