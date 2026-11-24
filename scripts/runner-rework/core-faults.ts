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
  // Not a fault: bar 2's count arm (the coordinator's ruling of 23:03Z, (a)), on the branch tree only. It changes no answer
  // (the lockstep must show 0 differences with it) and writes one stderr line per event:
  //   GUARD6 <planner|off>   a Runner's loop guard reaches 6 free actions at one click count (FREE_ACTION_LIMIT): the only
  //                          way rolloutGuard can change a rank list or a pick
  //   OFF <live> <list> <answer>   each off-turn question: whether the holder is not fresh (savingFor or digForBreakers set),
  //                          whether the scores differ from a fresh holder's, whether the answer does (offTurnHolder)
  //   REPLY <size> <kept> <read>   each reply sample after the first: the previous sample's Runner map, its entries for
  //                          cards in no server root at this sample's start (remember, runnerAI.ts, sets or deletes every
  //                          root card's entry before any read, so only these could survive into a shared map), and those
  //                          of them in HQ, R&D or facedown Archives (on the planner-off path, the one lookup of a card
  //                          outside the roots is runs.ts unseenTraps, which reads these) (replyMemory)
  count: [
    [
      'ai/runnerAI.ts',
      `      offTurnRank: s => this.offTurnRank(s),\n      note: a => this.notePlayed(a),`,
      `      offTurnRank: s => {\n        const real = this.offTurnRank(s);\n        const kept = [this.savingFor, this.digForBreakers] as const;\n        const live = kept[0] !== null || kept[1];\n        let fresh = real;\n        if (live) {\n          [this.savingFor, this.digForBreakers] = [null, false];\n          try {\n            fresh = this.offTurnRank(s);\n          } finally {\n            [this.savingFor, this.digForBreakers] = kept;\n          }\n        }\n        const top = (l: typeof real) => (l[0] && l[0].score > -Infinity ? JSON.stringify(l[0].action) : 'null');\n        const list = JSON.stringify(real.map(x => [x.action, x.score])) !== JSON.stringify(fresh.map(x => [x.action, x.score]));\n        process.stderr.write(\`OFF \${+live} \${+list} \${+(top(real) !== top(fresh))}\\n\`);\n        return real;\n      },\n      note: a => {\n        this.notePlayed(a);\n        if ((this.freeActions as any).count === 6) process.stderr.write(\`GUARD6 \${this.planner ? 'planner' : 'off'}\\n\`);\n      },`,
    ],
    ['ai/runnerReply.ts', `  const undoReply = inReply();`, `  const undoReply = inReply();\n  let __prev: Map<string, string> | null = null;`],
    [
      'ai/runnerReply.ts',
      `      (gr as any).__lkScope = 'reply';`,
      `      (gr as any).__lkScope = 'reply';\n      if (__prev) {\n        const st = gr.state;\n        const root = new Set(Object.values(st.corp.servers).flatMap(v => v.root.map(c => c.instanceId)));\n        const unseen = new Set([...st.corp.hq, ...st.corp.rd, ...st.corp.archives.faceDown].map(c => c.instanceId));\n        const kept = [...__prev.keys()].filter(id => !root.has(id));\n        process.stderr.write(\`REPLY \${__prev.size} \${kept.length} \${kept.filter(id => unseen.has(id)).length}\\n\`);\n      }\n      __prev = (gr as any).agents.runner.memory;`,
    ],
  ],
};
