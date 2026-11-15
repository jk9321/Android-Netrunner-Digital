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

// Step S (branch ai-search-first, measurement only): TEST_ABLATE=corp:x,runner:y runs the tests with those valuation
// families ablated (scripts/step-s/pins.ts). Imported only when set, so the module load order is unchanged otherwise.
if (process.env.TEST_ABLATE) (await import('../src/ai/pricing')).applyAblate(process.env.TEST_ABLATE);
