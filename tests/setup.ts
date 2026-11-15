import { afterEach } from 'vitest';

/**
 * Lets the worker read messages between tests. The AI tests run for minutes
 * without awaiting anything, so vitest's progress messages sit unanswered
 * and its 60 s RPC timeout fires ("Timeout calling onTaskUpdate") on slow CI
 * runners, failing the run though every test passed. setImmediate runs after
 * pending I/O; it is captured here because some tests fake timers.
 */
const realSetImmediate = globalThis.setImmediate;
afterEach(() => new Promise<void>(resolve => realSetImmediate(() => resolve())));

/**
 * TEMPORARY (Step 4 Stage C3 and C7, deleted with plan.corpCore): TEST_PLAN changes the plan's defaults for a whole run
 * (`+corpCore,+rolloutLines`: every test under the new core), LOO_OFF leaves carried-over rules out
 * (corp/candidates.ts leaveOut). Unset, nothing is imported here.
 */
if (process.env.TEST_PLAN || process.env.LOO_OFF) {
  const { applyPlanOff } = await import('../src/ai/synergy');
  const { leaveOut } = await import('../src/ai/corp/candidates');
  applyPlanOff(process.env.TEST_PLAN ?? '');
  for (const r of (process.env.LOO_OFF ?? '').split(',').filter(Boolean)) leaveOut.off.add(r);
}
