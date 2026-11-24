/**
 * R-B B1 bar 2 (brief b1-core.md rev 1, red team 2026-11-24 finding 7): the planted faults, each a patch on the BRANCH
 * tree's text after the hooks (core-lockstep.ts FAULT=<name>), each first shown on a unit state to change its input
 * (tests/runnerCore.test.ts, "bar 2"). Never applied outside a lockstep's scratch tree.
 */
import type { Patch } from './core-hooks';

export const FAULTS: Record<string, Patch[]> = {
  // The planner's rollout handed the deciding Runner's loop guard (its rankings start, so reset, the decider's count)
  rolloutGuard: [['ai/runnerAI.ts', `    rollout.memory = new Map(this.memory);`, `    rollout.memory = new Map(this.memory);\n    (rollout as any).freeActions = this.freeActions;`]],
  // The reply's Runner given one memory across the samples of a reply
  replyMemory: [
    ['ai/runnerReply.ts', `  const undoReply = inReply();`, `  const undoReply = inReply();\n  const __shared = new Map();`],
    ['ai/runnerReply.ts', `      (gr as any).__lkScope = 'reply';`, `      (gr as any).__lkScope = 'reply';\n      (gr as any).agents.runner.memory = __shared;`],
  ],
  // The Hard search's playout Runner given no memory (search.ts heuristicFor)
  playoutMemory: [['ai/search.ts', `  memory?.forEach((code, id) => runner.knownCards().set(id, code));`, `  void memory;`]],
  // The Normal Runner's chooseOffTurn reading a fresh off-turn holder (savingFor null, digForBreakers false)
  offTurnHolder: [
    [
      'ai/runnerAI.ts',
      `      offTurnRank: s => this.offTurnRank(s),`,
      `      offTurnRank: s => {\n        const kept = [this.savingFor, this.digForBreakers] as const;\n        if (this.planner) [this.savingFor, this.digForBreakers] = [null, false];\n        try {\n          return this.offTurnRank(s);\n        } finally {\n          [this.savingFor, this.digForBreakers] = kept;\n        }\n      },`,
    ],
  ],
  // The oracle playout's Runner with its planner off
  oraclePlanner: [['ai/runnerReply.ts', `runner: new HeuristicRunnerAI({}) })`, `runner: new HeuristicRunnerAI({ planner: false }) })`]],
};
