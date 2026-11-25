/**
 * R-B O1a (brief netrunner-ai/runner-rework/briefs/o1a-trash-floor.md rev 1, step 0 and bar 2; tracker R-14b): the hooks and
 * the planted faults of the trash-floor scripts. Text patches on scratch copies of src, never on the repo's src; each must
 * match exactly once (a stop otherwise). Every hook only CALLS a global the measuring script sets, with values the
 * patched code already computes in the same order; unset, the patched line does what it did.
 *
 * FLOOR (base and control trees only: the line is gone on the branch)
 *   runs.ts serverWorth's rezzed root line: `__tfFloor(raw, code)` with the formula's own value before the 0.5 floor. A
 *   FIRE is a call with raw < 0.5 (the floor took 0.5 where the formula said less; with raw >= 0.5 the floor did nothing).
 *
 * CARRY (every tree: the lines are the same on base and branch, so the cost is the same): the places a value made under
 * a fire can be read back by a later call or a later decision without a new serverWorth call (brief step 0.1, the Corp
 * side's clause; red team finding 3).
 *   valueModel.ts memo   a value worked out while a fire happened is marked; every later hit of a marked value is a fire
 *                        of the reading call (so a memo made from it is marked too). The per-game Maps (scopeToGame and
 *                        the rest) hold no value that reads serverValue/runScore (red team finding 3: none imports them).
 *   turnPlanner.ts planTurn  the line a planner keeps (its plan memory) is marked when the decision that chose it had a
 *                        fire; a later decision that plays the line's next step from the memory reads it (a carried fire).
 *   runnerAI.ts rankMainActions  savingFor and digForBreakers (written at the ranking from saveUpTarget's serverValue and
 *                        runScore) are marked when a fire happened while they were worked out; chooseOffTurn's
 *                        offTurnRank reads them through scoreMain at a later decision (a carried fire; since B2 on beta,
 *                        246b7b2, a first difference whose only fire is such a read is listed apart by the sum).
 *   oracle.ts playedOut  is filled only with plan.oracle.safestRemote on (off in the batch and NRDB pools): not hooked, named.
 *
 * LOOK (every tree): the Runner planner's playouts (turnPlanner planTurn's `playout` call) are counted as look-ahead, so a
 * fire can be told apart as the deciding agent's own scored options (bar 2's tight form) or its look-ahead.
 */
import type { Patch } from './core-hooks';

const G = '(globalThis as any)';

export const FLOOR: Patch[] = [
  [
    'ai/runs.ts',
    `      if (trash != null && trash <= state.runner.credits) value += Math.max(0.5, corpCardValue(card, state, 'runner', true) - creditCost(state, trash));`,
    `      if (trash != null && trash <= state.runner.credits) {\n        const __raw = corpCardValue(card, state, 'runner', true) - creditCost(state, trash);\n        ${G}.__tfFloor?.(__raw, card.cardCode);\n        value += Math.max(0.5, __raw);\n      }`,
  ],
];

export const CARRY: Patch[] = [
  [
    'ai/valueModel.ts',
    `  if (entry.values.has(key)) return entry.values.get(key) as T;\n  const value = work();\n  entry.values.set(key, value);\n  return value;`,
    `  if (entry.values.has(key)) {\n    ${G}.__tfMemoHit?.(entry.values, key);\n    return entry.values.get(key) as T;\n  }\n  const __m = ${G}.__tfCount?.();\n  const value = work();\n  entry.values.set(key, value);\n  ${G}.__tfMemoEnd?.(__m, entry.values, key);\n  return value;`,
  ],
  [
    'ai/turnPlanner.ts',
    `  if (next && next.key === key && ranked.some(r => r.score > -Infinity && sameAction(r.action, next.action))) {\n    memory.line.shift();\n    return next.action;\n  }\n  memory.line = [];`,
    `  if (next && next.key === key && ranked.some(r => r.score > -Infinity && sameAction(r.action, next.action))) {\n    memory.line.shift();\n    ${G}.__tfPlanHit?.(memory);\n    return next.action;\n  }\n  memory.line = [];\n  ${G}.__tfPlanSet?.(memory, false);`,
  ],
  ['ai/turnPlanner.ts', `    memory.line = best.line;\n    return best.action;`, `    memory.line = best.line;\n    ${G}.__tfPlanSet?.(memory, true);\n    return best.action;`],
  ['ai/runnerAI.ts', `    // Nowhere worth running and breakers missing: dig for them\n`, `    const __tf0 = ${G}.__tfCount?.();\n    // Nowhere worth running and breakers missing: dig for them\n`],
  ['ai/runnerAI.ts', `    this.savingFor = this.synergy ? saveUpTarget(state, this.memory) : null;`, `    this.savingFor = this.synergy ? saveUpTarget(state, this.memory) : null;\n    ${G}.__tfHeld?.(this, __tf0);`],
  ['ai/runnerAI.ts', `  private offTurnRank(state: GameState): ScoredAction[] {\n`, `  private offTurnRank(state: GameState): ScoredAction[] {\n    ${G}.__tfHeldRead?.(this);\n`],
];

export const LOOK: Patch[] = [
  [
    'ai/turnPlanner.ts',
    `      const value = playout(root, side, c.action, ai, line, ends);`,
    `      ${G}.__tfLook?.(side, 1);\n      let value: number;\n      try {\n        value = playout(root, side, c.action, ai, line, ends);\n      } finally {\n        ${G}.__tfLook?.(side, -1);\n      }`,
  ],
];

/**
 * Step 0.3 (rev 1, red team finding 3): two planted faults that do not touch the floor, each applied to a copy of the BASE
 * tree (so every difference it makes is its own), and run through bar 2's check: each must come out as a stop.
 *   seen001  0.01 added to the seen, unrezzed root card's trash line (runs.ts:1161 at beta 69f2ab7) when it adds anything
 *   hq001    0.01 added to HQ's term
 */
export const FAULTS: Record<string, Patch[]> = {
  seen001: [
    [
      'ai/runs.ts',
      `      if (trash != null && trash <= state.runner.credits) value += Math.max(0, corpCardValue(card, state, 'runner', true) - creditCost(state, trash));`,
      `      if (trash != null && trash <= state.runner.credits) value += Math.max(0, corpCardValue(card, state, 'runner', true) - creditCost(state, trash)) + 0.01;`,
    ],
  ],
  hq001: [
    [
      'ai/runs.ts',
      `    value = unchosen === 0 ? 0 : Math.min(accesses, unchosen) * hqAgendaOdds(state, odds) * central * 0.5 ** repeat;`,
      `    value = unchosen === 0 ? 0 : Math.min(accesses, unchosen) * hqAgendaOdds(state, odds) * central * 0.5 ** repeat + 0.01;`,
    ],
  ],
};
