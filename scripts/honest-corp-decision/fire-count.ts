/**
 * ai-honest-corp-decision (brief rev 2, "Bar"; red team 2026-11-16 rulings 2, 7, 8, 9): the fire count, split by
 * question and by cause. At each recorded Corp decision (the 56 local deals and the human games, scripts/stage-a/harness.ts;
 * split by SHARD): main-phase actions, prompts and the rez windows of runs, a fresh Normal Corp decides on a copy of the
 * state twice: `base` as beta 8fbc771 does (every question but the order on the real state: corpDecide with no view;
 * the rez on the real state with no decisionContext), `branch` as the agent does now (everything on its view,
 * turnPlanner.ts corpDecisionView). Where the two differ, the decision is taken again with one thing of the view only:
 * R&D ('rd'), the Runner's grip and stack ('grip'), the rng ('rng'), or a copy of the real state (a new object, the
 * same content: the decision context's root alone, 'ctx'). A cause reproduces the change when its pick is the branch's.
 * A change none reproduces is a stop.
 *
 * Question of a changed decision: a prompt (by kind, card and step; Synapse Global's are the free install), a rez in a
 * run (by window), else for a main-phase action the first counted question whose answer differs on the view and the
 * real state (Q1 win now, Q3 score now, Q6 money with the base's pick), else 'order/look/line' (the order is on the
 * view in both; Q4/Q5, the look-ahead's memory or the context line).
 *
 * Also per decision: the real-state fallbacks (corp/core.ts honestCorpCounts) and, with CLICK_AUDIT=1, the click-cache
 * audit (handValues clickAudit: a value served from the cache worked out again on the asking board; ruling 9).
 * One JSON line per decision. Sum with fire-count-sum.mjs.
 *   SHARD=0/64 npx vite-node scripts/honest-corp-decision/fire-count.ts > fc-0.txt
 */
import { writeFileSync } from 'node:fs';
import { CardInstance, GameAction, GameState, activePrompt, getLegalActions } from '../../src/core';
import { HeuristicCorpAI } from '../../src/ai';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { clickAudit, decisionContext, drawAudit } from '../../src/ai/handValues';
import { corpDecide, honestCorpCounts } from '../../src/ai/corp/core';
import { decideRez } from '../../src/ai/corp/rez';
import { corpDecisionView, plannerOn, promptNamedIds } from '../../src/ai/turnPlanner';
import { winNowAction, scoreNowPlan } from '../../src/ai/winNow';
import { moneyPick } from '../../src/ai/incomeLine';
import { clearThreatCaches } from '../../src/ai/threatModel';
import { clearCaches, forEachRecorded } from '../stage-a/harness';

type Arm = 'base' | 'branch' | 'rd' | 'grip' | 'rng' | 'ctx' | 'rdgrip' | 'all' | 'view';
const key = (a: GameAction | null | undefined) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).sort())) : 'null');
const partial = (s: GameState, arm: Arm): GameState => {
  const v = corpDecisionView(s);
  if (arm === 'rd') return { ...s, corp: { ...s.corp, rd: v.corp.rd } };
  if (arm === 'grip') return { ...s, runner: { ...s.runner, grip: v.runner.grip, stack: v.runner.stack } };
  if (arm === 'rng') return { ...s, rng: v.rng };
  if (arm === 'rdgrip') return { ...s, corp: { ...s.corp, rd: v.corp.rd }, runner: { ...s.runner, grip: v.runner.grip, stack: v.runner.stack } };
  if (arm === 'all') return { ...v };
  if (arm === 'view') return v;
  return { ...s };
};
type Agentish = { memory: unknown; planMemory: { line: unknown[] }; synergy: boolean; rankMainActions: HeuristicCorpAI['rankMainActions']; notePlayed(a: GameAction): void; plan(s: GameState, r: unknown): GameAction | null };
/** The agent's decide (corpAI.ts) with `view` as the view; no view: beta's corpDecide on the real state. */
const decideWith = (agent: HeuristicCorpAI, s: GameState, view?: GameState): GameAction => {
  const a = agent as unknown as Agentish;
  // As chooseAction: the deciding Corp's run record (plan.runRecord) in the context
  const record = plan().runRecord ? { runRecord: agent.noteRuns(s) } : {};
  return asSide('corp', () => withPricing(record, () =>
    corpDecide(
      s,
      {
        synergy: a.synergy,
        counted: a.synergy,
        memory: a.memory as never,
        rank: (st, legal) => a.rankMainActions(st, legal),
        lookahead: (st, ranked) => (plannerOn('corp') ? a.plan(st, ranked) : null),
        note: x => a.notePlayed(x),
        snapshot: () => {
          const line = [...a.planMemory.line];
          return () => void (a.planMemory.line = line);
        },
      },
      view,
    )),
  );
};
const rezWith = (s: GameState, cards: CardInstance[], view?: GameState) =>
  asSide('corp', () => {
    if (view) decisionContext(view, 'corp');
    return decideRez(view ?? s, cards, true);
  });
const decide = (s: GameState, arm: Arm, kind: 'action' | 'rez', cards?: CardInstance[]) => {
  clearCaches();
  clearThreatCaches();
  const copy = structuredClone(s);
  const agent = new HeuristicCorpAI({ synergy: true, planner: true });
  const before = { ...honestCorpCounts };
  const t = performance.now();
  let a: GameAction | null;
  if (arm === 'branch') a = kind === 'rez' ? agent.chooseRez(copy, cards!) : agent.chooseAction(copy);
  else if (arm === 'base') a = kind === 'rez' ? rezWith(copy, cards!) : decideWith(agent, copy);
  else a = kind === 'rez' ? rezWith(copy, cards!, partial(copy, arm)) : decideWith(agent, copy, partial(copy, arm));
  const ms = Math.round(performance.now() - t);
  const fell = Object.entries(honestCorpCounts).filter(([k, n]) => n !== (before[k] ?? 0)).map(([k]) => k);
  return { a: key(a), ms, fell };
};
const question = (s: GameState, kind: 'action' | 'rez', basePick: string): string => {
  if (kind === 'rez') return `rez:${s.priority?.step ?? s.activeRun?.phase}`;
  const p = activePrompt(s);
  if (p) return 'source' in p ? (p.source.cardCode === '35058' ? 'freeInstall:' : 'prompt:') + `${p.kind}:${p.source.cardCode}:${p.source.step}` : `prompt:${p.kind}`;
  if (s.turnStep?.kind === 'corp_turn_start') return 'turnStart';
  return asSide('corp', () => {
    const v = corpDecisionView(s);
    if (key(winNowAction(s)) !== key(winNowAction(v))) return 'Q1';
    if (key(scoreNowPlan(s)?.first) !== key(scoreNowPlan(v)?.first)) return 'Q3';
    const own = basePick === 'null' ? null : (JSON.parse(basePick) as GameAction);
    if (key(moneyPick(s, own)) !== key(moneyPick(v, own))) return 'Q6';
    return 'order/look/line';
  });
};
if (process.env.CLICK_AUDIT || (process.env.ARGS ?? '').includes('audit')) {
  clickAudit.on = true;
  drawAudit.on = true;
}
let k = 0;
forEachRecorded({
  decision: d => {
    if (d.state.winner) return;
    const s = d.state;
    const kind = d.kind;
    if (kind === 'action' && !(getLegalActions(s, 'corp').length > 0)) return;
    const audit0 = { c: clickAudit.mismatches, d: drawAudit.mismatches };
    const order = k++ % 2 ? (['base', 'branch'] as const) : (['branch', 'base'] as const);
    const r: Record<string, { a: string; ms: number; fell: string[] }> = {};
    for (const arm of order) r[arm] = decide(s, arm, kind, d.cards);
    const changed = r.base.a !== r.branch.a;
    const causes: string[] = [];
    if (changed) for (const arm of ['rd', 'grip', 'rng', 'ctx'] as const) if (decide(s, arm, kind, d.cards).a === r.branch.a) causes.push(arm);
    // No single cause: R&D and the grip together, the view's content on a new object, the view itself through decideWith
    if (changed && !causes.length) for (const arm of ['rdgrip', 'all', 'view'] as const) if (decide(s, arm, kind, d.cards).a === r.branch.a) causes.push(arm);
    if (changed && process.env.DUMP_CHANGED) writeFileSync(`${process.env.DUMP_CHANGED}/${d.src.replace(/[:/]/g, '_')}-${d.i}.json`, JSON.stringify({ kind, cards: d.cards, state: s }));
    const q = changed ? question(s, kind, r.base.a) : undefined;
    const p = activePrompt(s);
    // A prompt's kind and the hidden cards it names (held in place in the view: R&D, grip, stack)
    const ids = p ? promptNamedIds(s) : new Set<string>();
    const zone = (cards: { instanceId: string }[]) => cards.filter(c => ids.has(c.instanceId)).length;
    const prompt = p ? { kind: 'source' in p ? `${p.kind}:${p.source.cardCode}:${p.source.step}` : p.kind, rd: zone(s.corp.rd), grip: zone(s.runner.grip), stack: zone(s.runner.stack) } : undefined;
    console.log(
      JSON.stringify({
        src: d.src,
        i: d.i,
        T: s.turnNumber,
        kind: kind === 'rez' ? 'rez' : p ? 'prompt' : 'main',
        changed,
        q,
        prompt,
        causes,
        fell: r.branch.fell,
        auditMismatch: { click: clickAudit.mismatches - audit0.c, draw: drawAudit.mismatches - audit0.d },
        base: changed ? r.base.a : undefined,
        branch: changed ? r.branch.a : undefined,
        msBase: r.base.ms,
        msBranch: r.branch.ms,
      }),
    );
  },
});
