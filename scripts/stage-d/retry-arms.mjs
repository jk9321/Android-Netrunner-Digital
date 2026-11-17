// The fire count's arms for ai-hold-retry (brief rev 2 section 7; design answer 2): text patches that put each change's
// beta text back in src/ai/corp/hold.ts, written to retry-arms.json for scripts/value-b1/fire-count.ts. With every arm
// back the tree plays as beta 85c2955 (R1 is comments, R6 tests; R4's Botulus fact names the same card the constant did).
//   node scripts/stage-d/retry-arms.mjs   (checks each patch matches exactly once, writes the JSON)
//   ARGS=scripts/stage-d/retry-arms.json SHARD=0/64 npx vite-node scripts/value-b1/fire-count.ts
import { readFileSync, writeFileSync } from 'node:fs';

const F = 'ai/corp/hold.ts';
const arms = {
  // The failed run: the retry walk is never asked (the gate's second walk, and solveTurn's)
  retry: [
    [F, 'return turnNeed(input, targets, memos.one) + price <= budget || turnNeed(input, targets, memos.turn, true) + price <= budget;', 'return turnNeed(input, targets, memos.one) + price <= budget;'],
    [F, 'if (need > q.budget && turnNeed(q, target, memos.turn, true) + q.sets[k].price > q.budget) return', 'if (need > q.budget) return'],
  ],
  // R2: the encounter under way's broken subroutines read on every question again
  r2: [[F, 'const encounter = start.runnerTurn ? undefined : state.activeRun?.encounter;', 'const encounter = state.activeRun?.encounter;']],
  // R3: break plans kept on the state object again (a module WeakMap), not on valueModel's memo
  r3: [
    [F, "/** The server's ice as the walk meets it, innermost first;", "const planCache = new WeakMap();\n/** The server's ice as the walk meets it, innermost first;"],
    [F, 'const cache = memo(state, `walkPlans:${start.runnerTurn ? 1 : 0}`, () => new Map<string, WalkPlan[]>());', 'let cache = planCache.get(state);\n  if (!cache) planCache.set(state, (cache = new Map()));'],
  ],
  // R4: Audrey v2 by its code again, not by a plan that spends grip cards
  r4: [
    [F, 'return { trojan: /\\btrojan\\b/i.test(keywords),', "return { audrey: c.cardCode === '34004', trojan: /\\btrojan\\b/i.test(keywords),"],
    [F, 'Object.values(board.plans).some(list => list.some(p => p.grip > 0))', 'board.rig.some(r => r.audrey)'],
  ],
  // Valentão and Piranhas: the liability rez inert again
  liability: [[F, 'if (!ice.liability) return then(ws);', 'return then(ws);']],
  // (Found-list row 21's trash was a sixth arm until the 18:56Z ruling took it off this branch, measurements section 7)
};

const src = readFileSync(`src/${F}`, 'utf8');
for (const [arm, list] of Object.entries(arms))
  for (const [, from] of list) {
    const n = src.split(from).length - 1;
    if (n !== 1) throw new Error(`${arm}: ${n} matches for ${from.slice(0, 60)}`);
  }
// fire-count applies a patch with String.replace, which reads `$` patterns in the replacement
const out = Object.fromEntries(Object.entries(arms).map(([a, list]) => [a, list.map(([f, from, to]) => [f, from, to.replace(/\$/g, '$$$$')])]));
writeFileSync('scripts/stage-d/retry-arms.json', JSON.stringify(out, null, 1) + '\n');
console.log(`ok: ${Object.keys(arms).length} arms`);
