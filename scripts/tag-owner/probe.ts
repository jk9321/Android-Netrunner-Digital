/**
 * F108 count, two local probes the Corp-side coordinator asked after the hand-off (2026-11-25 08:23Z). Counts only.
 *
 * (a) #58's Plaza accesses (the #58 pin's board played on from T3 by the source tree, as count.ts issue58): at each
 *     access_trash prompt whose trash gives a tag, under base and ownerOnce, each answer's scoreOutcome (prompts.ts:44,
 *     the score answerPrompt's fallback maximises) split into its parts: evaluate(after, runner) by term (sideStrength's
 *     lines, both sides; the rig by card; the Corp board by card), the 0.5 keep term, the rest-of-run term; trash less keep.
 * (b) The Corp board's part of one more tag: on a board, each Corp card's worth (corpBoardValue's own terms: iceWorth,
 *     agendaWorth or corpCardValue; Runner view and Corp view) with the Runner's tags as they are and with one more.
 *     On #58's access boards, and (MODE=pool) on every board a tag was taken from in the source games of the pools.
 *
 *   npx vite-node scripts/tag-owner/probe.ts                       (a) and (b) on #58
 *   MODE=pool POOL=batch SHARD=0/4 npx vite-node scripts/tag-owner/probe.ts   (b) on the pool's tag-taking boards
 *   ARM_BASE=<sha> PLAY=base PROBE_ARMS=base,ownerOnce,ownerOnce5,branch npx vite-node scripts/tag-owner/probe.ts
 *     (build brief step 0.2: #58 played on by the base tree, so the boards are the count's, under the four trees)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CardInstance, GameAction, GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { makeTrees } from './trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const MODE = process.env.MODE ?? 'issue58';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/tag-owner-probe', `${MODE}-${shard}`);
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : String(x));
const RUNS: Record<string, string> = { batch: '45553599707', nrdb: '45555227992' };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];

interface T {
  ai: any;
  po: any;
  core: any;
  decks: any;
  ev: any;
  hv: any;
  vm: any;
  pricing: any;
  prompts: any;
  runs: any;
  syn: any;
  iv: any;
  clear: () => void;
}
async function loadTree(dir: string): Promise<T> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const files = ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/evaluate.ts', 'ai/handValues.ts', 'ai/valueModel.ts', 'ai/effectValues.ts', 'ai/iceValues.ts', 'ai/threatModel.ts', 'ai/pricing.ts', 'ai/prompts.ts', 'ai/runs.ts', 'ai/synergy.ts'];
  const mods: any[] = [];
  for (const p of files) mods.push(await m(p));
  const [ai, po, core, decks, ev, hv, vm, fx, iv, tm, pricing, prompts, runs, syn] = mods;
  return {
    ai,
    po,
    core,
    decks,
    ev,
    hv,
    vm,
    pricing,
    prompts,
    runs,
    syn,
    iv,
    clear: () => {
      hv.clearHandCaches();
      fx.clearDamageThreats();
      tm.clearThreatCaches?.();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
// The arms asked (build brief bar 0.2: PROBE_ARMS=base,ownerOnce,ownerOnce5,branch with ARM_BASE set, trees.ts)
const ARMS = (process.env.PROBE_ARMS ?? 'base,ownerOnce').split(',') as Arm[];
type Arm = 'base' | 'ownerOnce' | 'ownerOnce5' | 'branch';
/** The tree that plays #58 on from T3: `source` (this checkout) or `base` (the arms' base src, so the boards are the count's). */
const PLAY = (process.env.PLAY ?? 'source') as 'source' | 'base';
let S: T;
const A = {} as Record<Arm, T>;
const titleOf = (code: string) => {
  try {
    return S.core.getCardDefinition(code).title as string;
  } catch {
    return code;
  }
};
function inCtx<X>(t: T, s: GameState, viewer: 'corp' | 'runner', f: (st: GameState) => X): X {
  t.clear();
  const st = structuredClone(s);
  return t.pricing.asSide(viewer, () => {
    t.hv.decisionContext(st, viewer);
    return f(st);
  });
}

/** The Corp board by card, as corpBoardValue sums it (evaluate.ts:332-354), on st as viewer sees it. */
function corpBoardByCard(t: T, st: GameState, viewer: 'corp' | 'runner'): Record<string, number> {
  const outv: Record<string, number> = {};
  for (const server of Object.values(st.corp.servers) as any[]) {
    for (const ice of server.ice) outv[`ice ${titleOf(ice.cardCode)} ${ice.instanceId}`] = t.iv.iceWorth(st, ice, viewer);
    for (const card of server.root as CardInstance[]) {
      const hidden = viewer === 'runner' && !card.isRezzed && !card.faceUp && !(card as any).runnerKnows;
      const name = `${hidden ? 'hidden' : titleOf(card.cardCode)} ${card.instanceId}@${server.id}`;
      if (hidden) outv[name] = NaN; // priced inside corpBoardValue only (hidden odds); left in "rest of the board"
      else if (S.core.getCardDefinition(card.cardCode).type_code === 'agenda') outv[name] = NaN;
      else outv[name] = t.ev.corpCardValue(card, st, viewer);
    }
  }
  return outv;
}

/** evaluate(st, runner) by sideStrength's lines (evaluate.ts:479-500), plus the rig and the Corp board by card. */
function evalParts(t: T, s: GameState, ctxBoard: GameState = s) {
  // Priced in the decision board's context (scoreOutcome runs in the context of the board the prompt is on)
  return inCtx(t, ctxBoard, 'runner', () => {
    const st = s;
    const v = 'runner';
    const rig = [...st.runner.rig.programs, ...st.runner.rig.hardware, ...st.runner.rig.resources];
    const rigCards: Record<string, number> = {};
    for (const c of rig) rigCards[`${titleOf(c.cardCode)} ${c.instanceId}`] = t.ev.addRigCard(st, c, 0);
    const R = {
      credits: t.vm.sideCreditValue(st, 'runner', v),
      handClicks: t.ev.handAndClicks(st, 'runner', v),
      points: t.vm.pointValue(st.runner.score),
      tagsRunnerLine: -t.ev.tagsWorth(st, v),
      rig: t.ev.runnerRigValue(st),
    };
    const C = {
      credits: t.vm.sideCreditValue(st, 'corp', v),
      handClicks: t.ev.handAndClicks(st, 'corp', v),
      board: t.ev.corpBoardValue(st, v),
    };
    const rs = t.ev.sideStrength(st, 'runner', v);
    const cs = t.ev.sideStrength(st, 'corp', v);
    const evaluate = t.ev.evaluate(st, v);
    const board = corpBoardByCard(t, st, v);
    return {
      evaluate,
      runner: { ...R, rest: rs - Object.values(R).reduce((n, x) => n + x, 0) },
      // The Corp's side enters evaluate with a minus: reported as its effect on the Runner's evaluate
      corp: { credits: -C.credits, handClicks: -C.handClicks, board: -C.board, rest: -(cs - C.credits - C.handClicks - C.board) },
      rigCards,
      boardCards: Object.fromEntries(Object.entries(board).map(([k, x]) => [k, -x])),
    };
  });
}

/** (a): each answer of the access_trash prompt on s, scoreOutcome split, under tree t with the agent's memory. */
function answerParts(t: T, s: GameState, agent: any) {
  const legal: GameAction[] = t.core.getLegalActions(s, 'runner').filter((a: GameAction) => a.type === 'RESOLVE_PROMPT');
  const res: any = {};
  for (const action of legal) {
    const ch = (action as any).choice;
    const key = ch?.kind === 'access_trash' ? (ch.trash ? 'trash' : 'keep') : JSON.stringify(ch).slice(0, 40);
    const after = t.prompts.simulate(s, action);
    if (!after) continue;
    const score = inCtx(t, s, 'runner', st => t.prompts.scoreOutcome(st, after, 'runner', agent.memory, agent.synergy));
    const rest = s.activeRun ? inCtx(t, s, 'runner', () => (s.activeRun!.phase === 'access' ? 1 : 0.8) * t.runs.runRestWorth(after, agent.memory, agent.synergy && t.syn.tuning.wary)) : 0;
    const parts = evalParts(t, after, s);
    // The keep term's cards (prompts.ts:48): 0.5 x each grip card's keep (keepValue + the deck nudge) on the answer's board
    const hand = inCtx(t, s, 'runner', () => Object.fromEntries(after.runner.grip.map((c: CardInstance) => [`${titleOf(c.cardCode)} ${c.instanceId}`, 0.5 * (t.ev.keepValue(after, c) + (agent.synergy ? t.syn.keepBonus(after, c) : 0))])));
    const keepTerm = Object.values(hand).reduce((n: number, x) => n + (x as number), 0) - inCtx(t, s, 'runner', st => st.runner.grip.reduce((n: number, c: CardInstance) => n + 0.5 * (t.ev.keepValue(st, c) + (agent.synergy ? t.syn.keepBonus(st, c) : 0)), 0));
    res[key] = { score, rest, keepTerm, left: score - parts.evaluate - rest - keepTerm, hand, parts, tags: after.runner.tags, credits: after.runner.credits };
  }
  const pick = inCtx(t, s, 'runner', st => t.prompts.answerPrompt(st, 'runner', agent.memory, agent.synergy));
  return { res, pick: (pick as any).choice };
}
const minus = (a: Record<string, number>, b: Record<string, number>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return Object.fromEntries([...keys].map(k => [k, r3((a[k] ?? 0) - (b[k] ?? 0))]).filter(([, x]) => x !== 0 && x !== '0'));
};
function lessKeep(r: any) {
  const T = r.trash;
  const K = r.keep;
  if (!T || !K) return null;
  return {
    score: r3(T.score - K.score),
    evaluate: r3(T.parts.evaluate - K.parts.evaluate),
    keepTerm: r3(T.keepTerm - K.keepTerm),
    left: r3(T.left - K.left),
    handCards: minus(T.hand, K.hand),
    rest: r3(T.rest - K.rest),
    runner: minus(T.parts.runner, K.parts.runner),
    corp: minus(T.parts.corp, K.parts.corp),
    rigCards: minus(T.parts.rigCards, K.parts.rigCards),
    boardCards: minus(T.parts.boardCards, K.parts.boardCards),
  };
}

/** (b): each Corp card's worth with one more tag less as is, both views, under t (and the board's whole change). */
function boardTag(t: T, s: GameState) {
  const more = structuredClone(s);
  more.runner.tags += 1;
  const o: any = {};
  for (const v of ['runner', 'corp'] as const) {
    const a = inCtx(t, s, v, st => ({ cards: corpBoardByCard(t, st, v), board: t.ev.corpBoardValue(st, v) as number }));
    const b = inCtx(t, more, v, st => ({ cards: corpBoardByCard(t, st, v), board: t.ev.corpBoardValue(st, v) as number }));
    o[v] = { board: r3(b.board - a.board), cards: minus(b.cards, a.cards) };
  }
  return o;
}

function issue58() {
  const r = JSON.parse(readFileSync('tests/fixtures/runner-facts/issues/issue-58.json', 'utf8'));
  let s: GameState = S.core.createInitialGameState(S.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  const runner: any = S.ai.createAgent('runner', 'normal');
  for (const move of r.moves as GameAction[]) {
    if (s.turnNumber === 3 && s.activePlayer === 'runner' && move.type === 'INITIATE_RUN') break;
    runner.observe?.(s);
    s = S.core.executeAction(s, move);
  }
  S.clear();
  const run = new S.po.GameRunner(structuredClone(s), { corp: S.ai.createAgent('corp', 'normal'), runner });
  for (let n = 0; n < 4000 && run.state.turnNumber <= 6 && !run.state.winner; n++) {
    const b: GameState = run.state;
    const p = b.pendingPrompts[0];
    if (p && (p as any).kind === 'access_trash' && (p as any).side === 'runner') {
      const t2 = S.core.executeAction(structuredClone(b), { type: 'RESOLVE_PROMPT', player: 'runner', promptId: p.id, choice: { kind: 'access_trash', trash: true } } as GameAction);
      if (t2.runner.tags > b.runner.tags) {
        const card = S.core.findCardAnywhere(b, (p as any).cardInstanceId);
        const snap = structuredClone(Object.fromEntries(Object.entries(runner).filter(([, v]) => typeof v !== 'function')));
        const fresh = (t: T) => {
          const ag: any = t.ai.createAgent('runner', 'normal');
          for (const [k, v] of Object.entries(snap)) {
            const cur = ag[k];
            if (cur && typeof cur === 'object' && !(cur instanceof Map) && !(cur instanceof Set) && !Array.isArray(cur) && Object.getPrototypeOf(cur) !== Object.prototype && v && typeof v === 'object') Object.assign(cur, structuredClone(v));
            else ag[k] = structuredClone(v);
          }
          return ag;
        };
        const arms: any = {};
        for (const a of ARMS) {
          const x = answerParts(A[a], b, fresh(A[a]));
          arms[a] = { pick: x.pick, lessKeep: lessKeep(x.res), trash: { score: r3(x.res.trash?.score), evaluate: r3(x.res.trash?.parts.evaluate), keepTerm: r3(x.res.trash?.keepTerm), rest: r3(x.res.trash?.rest) }, keep: { score: r3(x.res.keep?.score), evaluate: r3(x.res.keep?.parts.evaluate), keepTerm: r3(x.res.keep?.keepTerm), rest: r3(x.res.keep?.rest) }, boardTag: boardTag(A[a], b) };
        }
        out({ kind: 'a58', T: b.turnNumber, card: titleOf(card.cardCode), trashCost: (p as any).trashCost, runner: { credits: b.runner.credits, clicks: b.runner.clicks, tags: b.runner.tags }, phase: b.activeRun?.phase, server: b.activeRun?.server, arms });
      }
    }
    if (!run.step()) break;
  }
}

/** MODE=pool: the source game; on each board a tag was taken from (tags rise across a step), (b) under base. */
function poolDeal(pool: string, rec: any) {
  S.clear();
  const src = `${pool}:${rec.seed}`;
  const c = DECK_POOL.find(d => d.side === 'corp' && d.name === rec.corpDeck)!;
  const r = DECK_POOL.find(d => d.side === 'runner' && d.name === rec.runnerDeck)!;
  const ag = { corp: S.ai.createAgent('corp', 'normal'), runner: S.ai.createAgent('runner', 'normal') };
  const run = new S.po.GameRunner(S.core.createInitialGameState(S.decks.deckGameSetup(rec.seed, c, r)), ag);
  let n = 0;
  for (let i = 0; i < 4000; i++) {
    const s: GameState = run.state;
    const board = structuredClone(s);
    if (!run.step()) break;
    if (run.state.runner.tags > s.runner.tags) {
      n++;
      out({ kind: 'b', pool, src, T: board.turnNumber, active: board.activePlayer, tags: board.runner.tags, ...boardTag(A.base, board) });
    }
  }
  out({ kind: 'g', pool, src, tagBoards: n, winner: run.state.winner ?? null, matches: (run.state.winner ?? null) === rec.winner });
}

async function main() {
  const dirs = makeTrees(root, [...new Set(['source', 'base', ...ARMS] as const)], shard);
  for (const a of ARMS) A[a] = await loadTree(dirs[a]);
  // The playing tree is its own copy (its caches are never cleared by an arm's asking)
  if (PLAY === 'base') cpSync(dirs.base, join(root, 'play'), { recursive: true });
  S = await loadTree(PLAY === 'base' ? join(root, 'play') : dirs.source);
  if (MODE === 'issue58') return issue58();
  const sources: { pool: string; rec: any }[] = [];
  for (const pool of POOLS) for (const r of JSON.parse(readFileSync(`scripts/tag-owner/deals-${RUNS[pool]}.json`, 'utf8'))) if (!DEALS.length || DEALS.includes(String(r.seed))) sources.push({ pool, rec: r });
  for (const [k, x] of sources.entries()) {
    if (k % shards !== shard) continue;
    try {
      poolDeal(x.pool, x.rec);
    } catch (e) {
      out({ kind: 'err', pool: x.pool, src: x.rec.seed, error: (e as Error).stack?.slice(0, 400) });
    }
  }
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
