/**
 * B4 reader hooks for lockstep.ts READS=<name>: patches on the branch tree only (core-hooks.ts Patch: each must match
 * once). Each reports through `globalThis.__b4Fire(name)` the calls where the reader's new reading differs from today's,
 * so a reader commit's first difference can be traced to its own reader. Filled in with each reader commit.
 */
import type { Patch } from '../core-hooks';

export const READ_HOOKS: Record<string, Patch[]> = {};
