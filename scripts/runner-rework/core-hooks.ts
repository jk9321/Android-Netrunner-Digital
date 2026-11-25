/**
 * R-B B1 (brief netrunner-ai/runner-rework/briefs/b1-core.md rev 1, step 1 (e), red team finding 14): the lockstep's
 * hooks. Each is a text patch that only calls a global the measuring script sets; unset, the patched line does what it
 * did. Every hook sits at a CALL SITE in a file B1 does not change (playout.ts, turnPlanner.ts, runnerReply.ts, and
 * search.ts's playout function, not the Runner's decide), so the same text applies to the base tree and to the branch
 * tree, and every record is labelled by where it was made (the GameRunner's construction site and the call it answers),
 * never by a field of the Runner's context. Applied identically to base, branch and control.
 *
 *   playout.ts     GameRunner.step: the scope of the GameRunner is pushed while it steps (a nested GameRunner, a planner
 *                  rollout inside it, is then labelled with the path, e.g. top>oracle); the agent's rez answer, its
 *                  chooseOffTurn answer and its chooseAction answer are recorded as made; every action applied is
 *                  recorded (every step of every reply sample, Hard playout and oracle playout).
 *   turnPlanner.ts the planner playout's rank list (actions and scores) and its prompt answers, the discard step's
 *                  answers, the Runner's planner only (side === 'runner').
 *   runnerReply.ts the reply sample's GameRunner is labelled 'reply'; the oracle playout's GameRunner 'oracle'.
 *   search.ts      the Hard search playout's GameRunner is labelled 'hardR' (a Runner's search) or 'hardC' (a Corp's).
 *   runner/core.ts R-B B2 (brief b2-run.md rev 1, step 1 (e), red team 2026-11-25 finding 14): the rank list the order
 *                  is handed (`const ranked = ctx.rank(state, legal);`) and the off-turn score list
 *                  (`const best = ctx.offTurnRank(state)[0];`), both lines B2 does not edit, so the same text applies to
 *                  base and branch; the lockstep keeps the top-scope records only (the deciding Runner's own lists).
 */
export type Patch = [file: string, at: string, to: string];

export const HOOKS: Patch[] = [
  // GameRunner.step: the scope is pushed for the whole step (a throw inside it pops it too: the reply catches engine errors)
  [
    'ai/playout.ts',
    `  step(): boolean {\n    const state = this.state;`,
    `  step(): boolean {\n    const __out = (globalThis as any).__lkIn?.(this);\n    try {\n      return this.__step();\n    } finally {\n      __out?.();\n    }\n  }\n\n  private __step(): boolean {\n    const state = this.state;`,
  ],
  [
    'ai/playout.ts',
    `        choice = this.agents.corp.chooseRez?.(state, rezCandidates(state, window.step)) ?? null;`,
    `        choice = this.agents.corp.chooseRez?.(state, rezCandidates(state, window.step)) ?? null;\n        (globalThis as any).__lk?.(this, 'rez', state, choice);`,
  ],
  [
    'ai/playout.ts',
    `        choice = this.agents.runner.chooseOffTurn?.(state) ?? null;`,
    `        choice = this.agents.runner.chooseOffTurn?.(state) ?? null;\n        (globalThis as any).__lk?.(this, 'off', state, choice);`,
  ],
  [
    'ai/playout.ts',
    `    this.apply(this.agents[side].chooseAction(state));`,
    `    const __act = this.agents[side].chooseAction(state);\n    (globalThis as any).__lk?.(this, 'act', state, __act);\n    this.apply(__act);`,
  ],
  ['ai/playout.ts', `    this.last = action;`, `    this.last = action;\n    (globalThis as any).__lk?.(this, 'step', this.state, action);`],
  // The Runner planner's playouts
  [
    'ai/turnPlanner.ts',
    `    const ranked = corpLine ? corpLine.rank(now) : ai.rank(now);`,
    `    const ranked = corpLine ? corpLine.rank(now) : ai.rank(now);\n    if (side === 'runner') (globalThis as any).__lkRank?.(now, ranked);`,
  ],
  ['ai/turnPlanner.ts', `        answer = ai.answer(state);`, `        answer = ai.answer(state);\n        if (side === 'runner') (globalThis as any).__lkAns?.('rollout', state, answer);`],
  [
    'ai/turnPlanner.ts',
    `      next = executeAction(next, ai.answer(next));`,
    `      const __ans = ai.answer(next);\n      if (side === 'runner') (globalThis as any).__lkAns?.('discard', next, __ans);\n      next = executeAction(next, __ans);`,
  ],
  // GameRunner scopes, at their construction sites
  [
    'ai/runnerReply.ts',
    `        runner: new HeuristicRunnerAI({ synergy, planner: false }),\n      });`,
    `        runner: new HeuristicRunnerAI({ synergy, planner: false }),\n      });\n      (gr as any).__lkScope = 'reply';`,
  ],
  [
    'ai/runnerReply.ts',
    `setOraclePlayout(start => new GameRunner(start, { corp: new HeuristicCorpAI({ planner: false }), runner: new HeuristicRunnerAI({}) }));`,
    `setOraclePlayout(start => Object.assign(new GameRunner(start, { corp: new HeuristicCorpAI({ planner: false }), runner: new HeuristicRunnerAI({}) }), { __lkScope: 'oracle' }));`,
  ],
  [
    'ai/search.ts',
    `  const runner = new GameRunner(state, { corp: heuristicFor('corp', synergy), runner: heuristicFor('runner', synergy, memory) });`,
    `  const runner = new GameRunner(state, { corp: heuristicFor('corp', synergy), runner: heuristicFor('runner', synergy, memory) });\n  (runner as any).__lkScope = side === 'runner' ? 'hardR' : 'hardC';`,
  ],
  // R-B B2: the deciding Runner's own rank list and its off-turn score list (runner/core.ts, lines B2 does not edit)
  ['ai/runner/core.ts', `  const ranked = ctx.rank(state, legal);`, `  const ranked = ctx.rank(state, legal);\n  (globalThis as any).__lkDecRank?.(state, ranked);`],
  [
    'ai/runner/core.ts',
    `  const best = ctx.offTurnRank(state)[0];`,
    `  const __offRanked = ctx.offTurnRank(state);\n  (globalThis as any).__lkOffRank?.(state, __offRanked);\n  const best = __offRanked[0];`,
  ],
];

/** Applies `patches` to the src tree under `dir` (each must match exactly once: a stop otherwise). */
export function applyPatches(dir: string, patches: Patch[], what: string, read: (p: string) => string, write: (p: string, t: string) => void) {
  for (const [f, at, to] of patches) {
    const path = `${dir}/src/${f}`;
    const text = read(path);
    if (text.split(at).length !== 2) throw new Error(`${what}: a patch does not match once in ${f}: ${at.slice(0, 90)}`);
    write(
      path,
      text.replace(at, () => to)
    );
  }
}
