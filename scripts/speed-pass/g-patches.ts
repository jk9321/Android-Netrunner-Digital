/**
 * Speed pass G0 (addendum-g.md rev 2; ruling-rev0.md "Lever G red team, ruled"): lever G as text patches on a scratch
 * tree copy (never on src), shared by g0.ts (the lockstep's branch tree) and g0-heap.ts (one tree, G on or off). The
 * patches apply after core-hooks.ts's HOOKS (two of them match hooked lines). With `off`, builtBoard builds every board
 * and stores none (the off arm of g0-heap.ts), so both arms run the same code but for the cache.
 */
import type { Patch } from '../runner-rework/core-hooks';

export function gPatches(off = false): Patch[] {
  const AUDIT_EVERY = Number(process.env.AUDIT_EVERY ?? 64);
  const OFF = off ? 'true' : 'false';
  const CACHE = `
  const __gCache = new WeakMap<GameState, Map<string, GameState>>();
  const __gMade = new WeakMap<GameState, string>();
  // G boards still alive (red team finding 4d: 0 after a move and a gc)
  const __gReg = new FinalizationRegistry<number>(() => (globalThis as any).__g0.alive--);
  let __gCalls = 0;
  // G_SKIP=<caller,...>: those callers build their own board (a local bisect of a difference)
  const __gSkip = new Set((process.env.G_SKIP ?? '').split(',').filter(Boolean));
  const __gCanon = (x: unknown): string =>
    x === null || typeof x !== 'object'
      ? (JSON.stringify(x) ?? 'u')
      : Array.isArray(x)
        ? '[' + x.map(__gCanon).join(',') + ']'
        : '{' + Object.keys(x).filter(k => (x as any)[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + __gCanon((x as any)[k])).join(',') + '}';
  /** G0 (scripts/speed-pass/g0.ts): the board for (state, action), built once and served again. */
  export function builtBoard(state: GameState, action: GameAction, caller: string): GameState {
    const g = ((globalThis as any).__g0 ??= { hits: {}, miss: {}, held: 0, heldPeak: 0, heldTotal: 0, heldHist: {}, tops: 0, audited: 0, auditBad: 0, auditFirst: null, noAnchor: 0, dealPeak: 0 });
    // Red team finding 5: an ask outside any decision (tests, scripts) is counted
    if (!pricing().anchor) g.noAnchor++;
    // g0-heap.ts's real peak: heapUsed polled every 32 asks (both arms)
    if (++__gCalls % 32 === 0) (globalThis as any).__g0heap?.();
    if (__gSkip.has(caller)) return executeAction(state, structuredClone(action));
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
    // Red team finding 2: the miss runs on G's own copy of the action, so no served board holds a caller's action object
    const next = executeAction(state, structuredClone(action));
    g.miss[caller] = (g.miss[caller] ?? 0) + 1;
    if (${OFF}) return next;
    if (!m) __gCache.set(state, (m = new Map()));
    m.set(key, next);
    __gMade.set(next, caller);
    __gReg.register(next, 1);
    g.alive = (g.alive ?? 0) + 1;
    g.held++;
    return next;
  }
  /** G0: a top-level (non-rollout) GameRunner step starts: the boards held since the last one are counted. */
  export function builtTop(): void {
    const g = (globalThis as any).__g0;
    if (!g) return;
    g.tops++;
    g.heldPeak = Math.max(g.heldPeak, g.held);
    g.dealPeak = Math.max(g.dealPeak, g.held);
    g.heldTotal += g.held;
    // The held count per top-level step, in powers of two (red team finding 4b: the cap is set from this)
    const b = g.held === 0 ? 0 : 2 ** Math.ceil(Math.log2(g.held + 1));
    g.heldHist[b] = (g.heldHist[b] ?? 0) + 1;
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
  return G;
}
