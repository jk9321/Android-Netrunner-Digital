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

/** F3 (brief-build rev 1): an asked state is read only; every state with a by-position value entry is frozen in the tests. */
import { askedFreeze } from '../src/ai/valueModel';
askedFreeze.on = true;
