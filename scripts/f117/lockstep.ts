/**
 * F117: runner-rework/core-lockstep.ts on trees that carry F117 D1's line frame. D1 wraps the Runner planner's rollout
 * prompt answer (turnPlanner.ts: `answer = withKnownCards(side, seen, () => ai.answer(asked))`), so core-hooks.ts's rollout
 * hook no longer matches once. This swaps that one hook for the same record on the new line, then runs core-lockstep
 * unchanged (same args). Use only when BASE and the branch both carry D1 (e.g. the time levers: 828ada5 vs 7de6b2e).
 *
 *   SHARD=0/64 npx vite-node scripts/f117/lockstep.ts -- POOL=batch,nrdb BASE=<full sha>
 */
import { HOOKS } from '../runner-rework/core-hooks';

const OLD = `        answer = ai.answer(state);`;
const NEW = `        answer = withKnownCards(side, seen, () => ai.answer(asked));`;
const i = HOOKS.findIndex(([f, at]) => f === 'ai/turnPlanner.ts' && at === OLD);
if (i < 0) throw new Error('f117/lockstep: the rollout hook is not in core-hooks.ts');
HOOKS[i] = ['ai/turnPlanner.ts', NEW, `${NEW}\n        if (side === 'runner') (globalThis as any).__lkAns?.('rollout', asked, answer);`];
await import('../runner-rework/core-lockstep');
