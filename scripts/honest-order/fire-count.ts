/**
 * ai-corp-honest-order (brief rev 2, "Bar"): the fire count, split by cause. At each recorded Corp main-phase decision
 * (the 56 local deals and the human games, scripts/stage-a/harness.ts; split by SHARD), a fresh Normal Corp decides on a
 * copy of the state twice: `real` builds its order on the real state (as beta decad444 does), `view` on its own view
 * (turnPlanner.ts corpDecisionView). The planner's playouts start from the same view in both, as on beta. Where the
 * picks differ, the order is built again on the real state with one thing re-dealt from the view: R&D only, the
 * Runner's grip and stack only, the rng only. A cause reproduces the change when its pick is the view's pick. A changed
 * decision none of the three reproduces is a stop (something else reads the view).
 * One JSON line per decision. Sum with fire-count-sum.mjs.
 *   SHARD=0/64 npx vite-node scripts/honest-order/fire-count.ts > fc-0.txt
 */
import { GameAction, GameState } from '../../src/core';
import { createAgent } from '../../src/ai';
import { isCorpMain } from '../../src/ai/corp/lines';
import { corpDecisionView } from '../../src/ai/turnPlanner';
import { clearThreatCaches } from '../../src/ai/threatModel';
import { clearCaches, forEachRecorded } from '../stage-a/harness';

type Arm = 'real' | 'view' | 'rd' | 'grip' | 'rng';
const partial = (s: GameState, arm: Arm): GameState => {
  if (arm === 'real') return s;
  const v = corpDecisionView(s);
  if (arm === 'view') return v;
  if (arm === 'rd') return { ...s, corp: { ...s.corp, rd: v.corp.rd } };
  if (arm === 'grip') return { ...s, runner: { ...s.runner, grip: v.runner.grip, stack: v.runner.stack } };
  return { ...s, rng: v.rng };
};
const key = (a: GameAction) => JSON.stringify(Object.fromEntries(Object.entries(a).sort()));
const decide = (s: GameState, arm: Arm) => {
  const agent = createAgent('corp', 'normal');
  // The order's input only: the agent's ownView (corpAI.ts) gives `arm`'s state; the playouts' root is the view in every arm
  (agent as unknown as { ownView: (st: GameState) => GameState }).ownView = st => partial(st, arm);
  clearCaches();
  clearThreatCaches();
  const copy = structuredClone(s);
  const t = performance.now();
  const a = agent.chooseAction(copy);
  return { a: key(a), ms: Math.round(performance.now() - t) };
};
let k = 0;
forEachRecorded({
  decision: d => {
    if (d.kind !== 'action' || !isCorpMain(d.state)) return;
    const s = d.state;
    const first = k++ % 2 ? (['real', 'view'] as const) : (['view', 'real'] as const);
    const r: Record<string, { a: string; ms: number }> = {};
    for (const arm of first) r[arm] = decide(s, arm);
    const changed = r.real.a !== r.view.a;
    const causes: string[] = [];
    if (changed) for (const arm of ['rd', 'grip', 'rng'] as const) if (decide(s, arm).a === r.view.a) causes.push(arm);
    console.log(JSON.stringify({ src: d.src, i: d.i, T: s.turnNumber, clicks: s.corp.clicks, changed, causes, real: changed ? r.real.a : undefined, view: changed ? r.view.a : undefined, msReal: r.real.ms, msView: r.view.ms }));
  },
});
