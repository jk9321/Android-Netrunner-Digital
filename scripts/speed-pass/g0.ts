/**
 * Speed pass G0 (addendum-g.md rev 2, section 7; scripts only): lever G, one board per (board object, action), patched
 * into the lockstep's BRANCH tree copy only (core-faults.ts mechanism, FAULT=leverG), never into src. The lockstep then
 * gives, against BASE (the same src without G) and its control arm: first differences (G must make none), time by caller
 * kind with TIMES=1 (scripts/speed-pass/time-sum.mjs), and at the end of each shard the branch tree's G counts: hits by
 * the caller that made the board and the one it was served to, misses by caller, the boards held at a top-level
 * decision's end (peak and total), and a sampled re-execute audit (AUDIT_EVERY, default 64: every 64th hit executed again
 * on its parent and compared with the served board as JSON; bar 2's full-rate whole-state audit comes with the build).
 *
 * The callers that share (addendum section 2): simulate (prompts.ts), the planner's step (turnPlanner.ts), iceFallback and
 * spareAfter (corp/placement.ts), and GameRunner.apply only on a rollout GameRunner (runnerReply's samples and oracle,
 * search.ts), marked `share`. The lockstep's own GameRunners (the real games) never share.
 *
 *   SHARD=0/64 npx vite-node scripts/speed-pass/g0.ts -- POOL=batch,nrdb CORP=1 VALUES=0 TIMES=1 BASE=<full sha of this src>
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { FAULTS } from '../runner-rework/core-faults';
import type { Patch } from '../runner-rework/core-hooks';

const AUDIT_EVERY = Number(process.env.AUDIT_EVERY ?? 64);
const CACHE = `
const __gCache = new WeakMap<GameState, Map<string, GameState>>();
const __gMade = new WeakMap<GameState, string>();
const __gCanon = (x: unknown): string =>
  x === null || typeof x !== 'object'
    ? (JSON.stringify(x) ?? 'u')
    : Array.isArray(x)
      ? '[' + x.map(__gCanon).join(',') + ']'
      : '{' + Object.keys(x).filter(k => (x as any)[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + __gCanon((x as any)[k])).join(',') + '}';
/** G0 (scripts/speed-pass/g0.ts): the board for (state, action), built once and served again. */
export function builtBoard(state: GameState, action: GameAction, caller: string): GameState {
  const g = ((globalThis as any).__g0 ??= { hits: {}, miss: {}, held: 0, heldPeak: 0, heldTotal: 0, tops: 0, audited: 0, auditBad: 0, auditFirst: null });
  const key = __gCanon(action);
  let m = __gCache.get(state);
  const hit = m?.get(key);
  if (hit) {
    const pair = (__gMade.get(hit) ?? '?') + '>' + caller;
    const n = (g.hits[pair] = (g.hits[pair] ?? 0) + 1);
    if (${AUDIT_EVERY} > 0 && n % ${AUDIT_EVERY} === 1) {
      g.audited++;
      const again = executeAction(state, action);
      if (JSON.stringify(again) !== JSON.stringify(hit)) {
        g.auditBad++;
        g.auditFirst ??= pair + ' ' + key.slice(0, 200);
      }
    }
    return hit;
  }
  const next = executeAction(state, action);
  g.miss[caller] = (g.miss[caller] ?? 0) + 1;
  if (!m) __gCache.set(state, (m = new Map()));
  m.set(key, next);
  __gMade.set(next, caller);
  g.held++;
  return next;
}
/** G0: a top-level (non-rollout) GameRunner step starts: the boards held since the last one are counted. */
export function builtTop(): void {
  const g = (globalThis as any).__g0;
  if (!g) return;
  g.tops++;
  g.heldPeak = Math.max(g.heldPeak, g.held);
  g.heldTotal += g.held;
  g.held = 0;
}
`;
const G: Patch[] = [
  ['ai/diagnostics.ts', "import { installTop, pricing, withPricing } from './pricing';", "import { installTop, pricing, withPricing } from './pricing';\nimport { executeAction } from '../core';"],
  ['ai/diagnostics.ts', 'export const runnerOtherKinds = new Map<string, number>();', `export const runnerOtherKinds = new Map<string, number>();\n${CACHE}`],
  // simulate (prompts.ts)
  ['ai/prompts.ts', "import { encounteredIce } from '../core/engine/ice';", "import { encounteredIce } from '../core/engine/ice';\nimport { builtBoard } from './diagnostics';"],
  ['ai/prompts.ts', '  try {\n    return executeAction(state, action);\n  } catch {\n    return null;\n  }', "  try {\n    return builtBoard(state, action, 'simulate');\n  } catch {\n    return null;\n  }"],
  // the planner's step
  ['ai/turnPlanner.ts', "import { arrivalHow, seenArrivals } from './prompts';", "import { arrivalHow, seenArrivals } from './prompts';\nimport { builtBoard } from './diagnostics';"],
  ['ai/turnPlanner.ts', '      const after = executeAction(state, action);', "      const after = builtBoard(state, action, 'step');"],
  ['ai/turnPlanner.ts', "    let next = executeAction(state, { type: 'END_TURN', player: side } as GameAction);", "    let next = builtBoard(state, { type: 'END_TURN', player: side } as GameAction, 'step');"],
  // (after core-hooks.ts's discard hook, which names the answer __ans)
  ['ai/turnPlanner.ts', '      next = executeAction(next, __ans);', "      next = builtBoard(next, __ans, 'step');"],
  // iceFallback and spareAfter
  ['ai/corp/placement.ts', "import { CardInstance, GameAction, GameState, cardDef, executeAction, isLegalAction, rezCostOf } from '../../core';", "import { CardInstance, GameAction, GameState, cardDef, executeAction, isLegalAction, rezCostOf } from '../../core';\nimport { builtBoard } from '../diagnostics';"],
  ['ai/corp/placement.ts', '    const after = free ? free(from) : executeAction(state, from);', "    const after = free ? free(from) : builtBoard(state, from, 'iceFallback');"],
  ['ai/corp/placement.ts', '  return executeAction(state, pick);', "  return builtBoard(state, pick, 'spareAfter');"],
  // GameRunner.apply: a rollout shares, a real game builds its own (and marks a top-level step)
  ['ai/playout.ts', "import { CardInstance, GameAction, GameState, SideCode, actingSide, executeAction, isLegalAction, wantsStop } from '../core';", "import { CardInstance, GameAction, GameState, SideCode, actingSide, executeAction, isLegalAction, wantsStop } from '../core';\nimport { builtBoard, builtTop } from './diagnostics';"],
  ['ai/playout.ts', '  last: GameAction | null = null;\n', "  last: GameAction | null = null;\n  /** G0: a rollout's runner (its applied boards shared). */\n  share = false;\n"],
  ['ai/playout.ts', '    this.state = executeAction(this.state, action);', "    if (!this.share) builtTop();\n    this.state = this.share ? builtBoard(this.state, action, 'apply') : executeAction(this.state, action);"],
  ['ai/runnerReply.ts', '      let runnerTurn = false;', '      gr.share = true;\n      let runnerTurn = false;'],
  // (after core-hooks.ts's scope label on the oracle playout)
  ['ai/runnerReply.ts', "{ __lkScope: 'oracle' }", "{ __lkScope: 'oracle', share: true }"],
  ['ai/search.ts', "  const runner = new GameRunner(state, { corp: heuristicFor('corp', synergy), runner: heuristicFor('runner', synergy, memory) });", "  const runner = new GameRunner(state, { corp: heuristicFor('corp', synergy), runner: heuristicFor('runner', synergy, memory) });\n  runner.share = true;"],
];
FAULTS.leverG = G;
process.env.FAULT ||= 'leverG';
process.on('exit', () => {
  const g = (globalThis as any).__g0;
  if (g) {
    g.heldPeak = Math.max(g.heldPeak, g.held);
    console.log(JSON.stringify({ kind: 'g0', ...g }));
  }
});
// The f117 trees carry D1's rollout line (scripts/f117/lockstep.ts swaps that one hook, then runs core-lockstep)
await import('../f117/lockstep');
