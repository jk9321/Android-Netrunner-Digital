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
 * TEMPORARY (Step 4 Stage C7, deleted with corp/leaveOut.ts before the hand-off): LOO_OFF leaves carried-over rules out
 * (corp/candidates.ts leaveOut). Unset, nothing is imported here.
 */
if (process.env.LOO_OFF) {
  const { leaveOut } = await import('../src/ai/corp/candidates');
  for (const r of process.env.LOO_OFF.split(',').filter(Boolean)) leaveOut.off.add(r);
}
