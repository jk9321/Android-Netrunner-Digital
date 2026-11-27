import { afterEach, expect } from 'vitest';
import { askedFreeze } from '../src/ai/valueModel';
import { frameChecks } from '../src/ai/pricing';
import { chainStats, runTermStats } from '../src/ai/diagnostics';
import { handUpkeepCheck } from '../src/core/engine/helpers';
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

/** F3 (brief-build rev 1): an asked state is read only; every state with a by-position value entry is frozen in the tests. */
askedFreeze.on = true;

/** B1b (brief rev 1 item 3): a pricing frame is never written; in the tests a write to a frame, its known record, leaves, anchor or a Set it holds throws. R-109: the Runner's deal keeps its tripwire too (a slot with no code throws, no fallback). */
frameChecks.on = true;

/** Speed pass lever A: the chain and run term counts are diagnostics, off in play; the tests read them, so they count here. */
chainStats.on = true;
runTermStats.on = true;

/** R-105 (brief rev 1 rulings 1, 2 and 4): every upkeep skip is checked against the walk in the tests; a difference is recorded and throws. */
handUpkeepCheck.on = true;
