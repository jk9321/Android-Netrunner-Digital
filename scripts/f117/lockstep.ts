/**
 * F117: runner-rework/core-lockstep.ts on trees that carry F117 D1's line frame. D1 wraps the Runner planner's rollout
 * prompt answer (turnPlanner.ts: `answer = withKnownCards(side, seen, () => ai.answer(asked))`), so core-hooks.ts's rollout
 * hook no longer matches once. This swaps that one hook for the same record on the new line, then runs core-lockstep
 * unchanged (same args). Use only when BASE and the branch both carry D1 (e.g. the time levers: 828ada5 vs 7de6b2e).
 * On core-hooks.ts from beta c8eee20 on, the rollout hook already matches both, and this runs core-lockstep as it is.
 *
 *   SHARD=0/64 npx vite-node scripts/f117/lockstep.ts -- POOL=batch,nrdb BASE=<full sha>
 */
import { HOOKS } from '../runner-rework/core-hooks';

const OLD = `        answer = ai.answer(state);`;
const NEW = `        answer = withKnownCards(side, seen, () => ai.answer(asked));`;
// Since beta c8eee20 core-hooks.ts anchors the rollout hook on `if (!answer) break;`, a line both before and after F117:
// then there is nothing to swap and core-lockstep runs as it is
const KEPT = `      if (!answer) break;`;
const i = HOOKS.findIndex(([f, at]) => f === 'ai/turnPlanner.ts' && at === OLD);
const kept = HOOKS.some(([f, at]) => f === 'ai/turnPlanner.ts' && at === KEPT);
if (i >= 0) HOOKS[i] = ['ai/turnPlanner.ts', NEW, `${NEW}\n        if (side === 'runner') (globalThis as any).__lkAns?.('rollout', asked, answer);`];
else if (!kept) throw new Error('f117/lockstep: the rollout hook is not in core-hooks.ts');
await import('../runner-rework/core-lockstep');
