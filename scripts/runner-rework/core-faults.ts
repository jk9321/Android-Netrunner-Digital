/**
 * R-B B1 bar 2 (brief b1-core.md rev 1): the planted faults, each a patch on the BRANCH tree's text (core-lockstep.ts
 * FAULT=<name>), each first shown on a unit state to change its input (tests/runnerCore.test.ts). Written after the build,
 * on the branch's own lines; empty in the hooks commit.
 */
import type { Patch } from './core-hooks';

export const FAULTS: Record<string, Patch[]> = {};
