/**
 * ai-playout-lines (A1, brief-playout-lines.md rev 2, "Bar"): fire count, decision time and the two corpDecide checks,
 * on the recorded states (the 56 local deals and the human games, scripts/stage-a/harness.ts; split by SHARD). At each
 * recorded Corp main-phase decision, with the deciding Corp's held line as it was (the harness's `before`):
 *  - 'off': a fresh Normal Corp whose planner gets no playout line (corpAI.ts plan as on beta b7c4917: playouts read the
 *    rollout's null held line and never ask Q4/Q5), and 'on': the agent as built. Pick, time, and the planner's slot
 *    tallies; for 'on' the playoutLine counters (Q4/Q5 asks and takes inside playouts).
 *  - check (a): the Corp with the planner OFF (HeuristicCorpAI planner: false) picks the same with corpDecide as built
 *    and with OLD_CORP_DECIDE below (beta b7c4917's corpDecide, copied verbatim).
 *  - check (b): planner ON, the Q4/Q5 part alone: for the pick before Q4/Q5 (the 'on' arm's pick, and the order's first),
 *    the old inline sequence and lineAsk return the same action and the same held line.
 * One JSON line per decision. Sum with fire-count-sum.mjs.
 *   SHARD=0/64 npx vite-node scripts/playout-lines/fire-count.ts > fc-0.txt
 */
import { GameAction, GameState, activePrompt, cardDef, getLegalActions } from '../../src/core';
import { HeuristicCorpAI } from '../../src/ai/corpAI';
import { CorpContext, lineAsk } from '../../src/ai/corp/core';
import { HeldLine, heldLaterStep, isCorpMain } from '../../src/ai/corp/lines';
import { lineStep, scoreInTwoPick } from '../../src/ai/corp/placement';
import { keepsScore, scoreNowPlan, winNowAction } from '../../src/ai/winNow';
import { answerPrompt } from '../../src/ai/prompts';
import { decisionContext } from '../../src/ai/handValues';
import { moneyPick } from '../../src/ai/incomeLine';
import { plan } from '../../src/ai/pricing';
import { newDiagnostics, tally, Diagnostics } from '../../src/ai/diagnostics';
import { holdPricing } from '../../src/ai/pricing';
import { planTurn } from '../../src/ai/turnPlanner';
import { runnerReply } from '../../src/ai/runnerReply';
import { plannerIntake } from '../../src/ai/corp/candidates';
import { clearThreatCaches } from '../../src/ai/threatModel';
import { clearCaches, forEachRecorded } from '../stage-a/harness';

/** beta b7c4917 corp/core.ts corpDecide, verbatim but for comments (check (a)). */
function OLD_CORP_DECIDE(state: GameState, ctx: CorpContext): GameAction {
  decisionContext(state, 'corp');
  if (ctx.counted) {
    const win = winNowAction(state);
    if (win) {
      ctx.note(win);
      return win;
    }
  }
  const score = ctx.counted ? scoreNowPlan(state) : null;
  if (score && activePrompt(state)) {
    ctx.note(score.first);
    return score.first;
  }
  if (activePrompt(state)) return answerPrompt(state, 'corp', undefined, ctx.synergy);
  const legal = getLegalActions(state, 'corp');
  const ranked = ctx.rank(state, legal);
  const later = !!heldLaterStep(state, ctx.memory.heldLine);
  const lineFirst = !score && !later ? lineStep(state, ctx.memory.heldLine ? structuredClone(ctx.memory.heldLine) : null) : null;
  const decided = !!score || later || !!lineFirst;
  const turnStart = state.turnStep?.kind === 'corp_turn_start';
  const planned = ctx.lookahead && !turnStart && !decided ? ctx.lookahead(state, ranked) : null;
  const money = !decided && ctx.counted && !turnStart ? moneyPick(state, planned ?? ranked[0]?.action) : null;
  let chosen = lineFirst ?? money ?? planned ?? (ranked[0]?.score > -Infinity ? ranked[0].action : legal.find(a => a.type === 'END_TURN') ?? legal[0]);
  if (!lineFirst && ctx.synergy && plan().tagFirst && ranked[0]?.action.type === 'TRASH_RESOURCE' && ranked[0].tagFirst) chosen = ranked[0].action;
  let picked = chosen;
  if (score && !keepsScore(state, picked, score)) picked = score.first;
  if (!score) {
    const two = scoreInTwoPick(state, picked, ctx.memory.heldLine);
    ctx.memory.heldLine = two.held;
    if (!ctx.counted) {
      tally('scoreInTwo', 'rolloutDecisions');
      if (lineFirst || two.action !== chosen) tally('scoreInTwo', 'rolloutTaken');
    }
    picked = two.action;
  }
  ctx.note(picked);
  return picked;
}

/** beta b7c4917's inline Q4/Q5 sequence (corpDecide with no score), for check (b). */
function oldInline(state: GameState, held: HeldLine | null, pick: GameAction) {
  const later = !!heldLaterStep(state, held);
  const lineFirst = !later ? lineStep(state, held ? structuredClone(held) : null) : null;
  const chosen = lineFirst ?? pick;
  const two = scoreInTwoPick(state, chosen, held);
  return { action: two.action, held: two.held };
}

type Agentish = {
  memory: { heldLine: HeldLine | null };
  synergy: boolean;
  planMemory: unknown;
  plan: (s: GameState, ranked: unknown) => GameAction | null;
  decide: (s: GameState) => GameAction;
  rankMainActions: (s: GameState, legal?: GameAction[], held?: HeldLine | null) => never;
  notePlayed: (a: GameAction) => void;
};
const key = (a: GameAction | null) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).sort())) : 'null');

type Arm = 'off' | 'on' | 'pOffNew' | 'pOffOld';
function agentFor(arm: Arm, held: HeldLine | null): Agentish {
  const a = new HeuristicCorpAI({ planner: arm === 'off' || arm === 'on' }) as unknown as Agentish;
  a.memory.heldLine = held ? structuredClone(held) : null;
  if (arm === 'off') {
    // corpAI.ts plan as on beta b7c4917: no `line`, so a playout's order reads the rollout's null held line
    a.plan = function (state, ranked) {
      const rollout = new HeuristicCorpAI({ synergy: a.synergy, planner: false }) as unknown as Agentish & { chooseAction(s: GameState): GameAction };
      const reply = plan().runnerReply ? (s: GameState, leaf: (s: GameState) => number) => runnerReply(s, a.synergy, leaf) : undefined;
      return planTurn(state, 'corp', ranked as never, { rank: s => rollout.rankMainActions(s), answer: s => rollout.chooseAction(s), reply, memory: a.planMemory as never, intake: plannerIntake }, a.synergy);
    };
  }
  if (arm === 'pOffOld') {
    a.decide = function (state) {
      return OLD_CORP_DECIDE(state, { synergy: a.synergy, counted: false, memory: a.memory, rank: (s, legal) => a.rankMainActions(s, legal), note: x => a.notePlayed(x) });
    };
  }
  return a;
}

function decide(s: GameState, arm: Arm, held: HeldLine | null) {
  const d = newDiagnostics();
  const undo = holdPricing({ diagnostics: d });
  try {
    const agent = agentFor(arm, held) as unknown as { chooseAction(s: GameState): GameAction; memory: { heldLine: HeldLine | null } };
    clearCaches();
    clearThreatCaches();
    const copy = structuredClone(s);
    const t = performance.now();
    const a = agent.chooseAction(copy);
    return { a: key(a), action: a, ms: Math.round(performance.now() - t), d, held: agent.memory.heldLine };
  } finally {
    undo();
  }
}

const pl = (d: Diagnostics) => d.playoutLine;
let k = 0;
forEachRecorded({
  decision: dec => {
    if (dec.kind !== 'action' || !isCorpMain(dec.state)) return;
    const s = dec.state;
    const held = (dec.before?.heldLine ?? null) as HeldLine | null;
    const order = k++ % 2 ? (['off', 'on'] as const) : (['on', 'off'] as const);
    const r = {} as Record<'off' | 'on', ReturnType<typeof decide>>;
    for (const arm of order) r[arm] = decide(s, arm, held);
    const pNew = decide(s, 'pOffNew', held);
    const pOld = decide(s, 'pOffOld', held);
    // Check (b): the Q4/Q5 part alone, on two picks before it
    const firstOfOrder = (() => {
      const a = agentFor('on', held);
      clearCaches();
      const ranked = a.rankMainActions(structuredClone(s)) as unknown as { action: GameAction; score: number }[];
      return ranked.find(x => x.score > -Infinity)?.action ?? null;
    })();
    // For a changed pick: each pick's line in the order (corp/candidates.ts; behind: the behind group), and its card's type
    const where = (a: GameAction) => {
      const agent = agentFor('on', held);
      clearCaches();
      const st = structuredClone(s);
      const r = (agent.rankMainActions(st) as unknown as { action: GameAction; line: number; behind: boolean; score: number }[]).find(x => key(x.action) === key(a));
      const id = 'cardInstanceId' in a ? (a as { cardInstanceId: string }).cardInstanceId : undefined;
      const card = id ? [...s.corp.hq, ...Object.values(s.corp.servers).flatMap(v => [...v.ice, ...v.root])].find(c => c.instanceId === id) : undefined;
      return { line: r ? (r.behind ? 'behind' : r.line) : 'none', card: card ? cardDef(card).type_code : undefined };
    };
    const lines = r.off.a !== r.on.a ? { offAt: where(r.off.action), onAt: where(r.on.action) } : {};
    let bSame = 0;
    let bAll = 0;
    for (const pick of [r.on.action, firstOfOrder]) {
      if (!pick) continue;
      clearCaches();
      const o = oldInline(structuredClone(s), held ? structuredClone(held) : null, pick);
      clearCaches();
      const n = lineAsk(structuredClone(s), held ? structuredClone(held) : null, lineFirst => lineFirst ?? pick);
      bAll++;
      if (key(o.action) === key(n.action) && JSON.stringify(o.held) === JSON.stringify(n.held)) bSame++;
    }
    console.log(
      JSON.stringify({
        src: dec.src,
        i: dec.i,
        T: s.turnNumber,
        clicks: s.corp.clicks,
        held: !!held,
        changed: r.off.a !== r.on.a,
        off: r.off.a !== r.on.a ? r.off.a : undefined,
        on: r.off.a !== r.on.a ? r.on.a : undefined,
        ...lines,
        msOff: r.off.ms,
        msOn: r.on.ms,
        pl: pl(r.on.d),
        plOff: pl(r.off.d),
        slotsOff: r.off.d.planner,
        slotsOn: r.on.d.planner,
        s2Off: r.off.d.scoreInTwo,
        s2On: r.on.d.scoreInTwo,
        aSame: pNew.a === pOld.a && JSON.stringify(pNew.held) === JSON.stringify(pOld.held),
        bSame,
        bAll,
      })
    );
  },
});
