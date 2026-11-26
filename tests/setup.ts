import { afterEach, expect } from 'vitest';
import { appendFileSync } from 'node:fs';

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
 * Quiet mode (scripts/quiet.mjs test) lists the passed tests that made no expect() call, so a
 * check that silently stopped checking shows up. Off unless QUIET_NO_ASSERT_FILE is set.
 */
const noAssertFile = process.env.QUIET_NO_ASSERT_FILE;
if (noAssertFile) {
  afterEach(ctx => {
    if (ctx.task.result?.state === 'fail' || expect.getState().assertionCalls > 0) return;
    appendFileSync(noAssertFile, `${ctx.task.file?.name ?? '?'} > ${ctx.task.name}\n`);
  });
}
