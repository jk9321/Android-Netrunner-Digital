/**
 * Stage D, "the Corp does not rez the set its agenda counted on" (count step; brief:
 * /mnt/project-files/netrunner-ai/stage-d/rez-follow/brief.md). Shared by rez-follow.ts and rez-follow-trace.ts.
 *
 * A tree is one copy of src/ (runner-money-trees.ts makeTrees: beta, control, an arm), loaded as its own module graph.
 * Found row 71b: the tree that plays a source game is never asked or cleared; every question here goes to a copy.
 *
 * windowFacts: at an approach-ice rez window, everything the counted rez reads, asked of one tree on the deciding Corp's
 * own view (corpDecisionView, as chooseRez does; rule 10.2.2a), under its decision context: which rule of countedRez
 * answers (derived step by step from the same exported owners, and checked against countedRez itself), rezStops with and
 * without `further`, the 'thisRun' hold with the ice (further in too), without it, and for it alone, the priced rez
 * (modelRezGain, read only when the counted rez gives no opinion), and the keep (rezMoney). Nothing here reads the grip,
 * the stack's order or a facedown Runner card: the view hides them.
 */
import { join } from 'node:path';
import type { CardInstance, GameAction, GameState } from '../../src/core';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Fn = (...a: any[]) => any;
export interface Tree {
  name: string;
  createAgent: Fn;
  GameRunner: any;
  rezCandidates: Fn;
  countedRez: Fn;
  rezStops: Fn;
  matchPointRez: Fn;
  archivesWantsIce: Fn;
  spendsKept: Fn;
  serverHold: Fn;
  rezMoney: Fn;
  modelRezGain: Fn;
  runBypassed: Fn;
  iceCreditNeed: Fn;
  rezEffectOf: Fn;
  agendasUnseen: Fn;
  corpDecisionView: Fn;
  decisionContext: Fn;
  asSide: Fn;
  plan: Fn;
  cardDef: Fn;
  rezCost: Fn;
  holdCacheStats: { asked: number; searched: number };
  clear: () => void;
}

export async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  // One at a time: vite-node's runner never settles concurrent imports of one circular graph (the process just exits)
  const mods: any[] = [];
  for (const p of ['ai/index.ts', 'ai/playout.ts', 'ai/corp/rez.ts', 'ai/corp/hold.ts', 'ai/corp/rezMoney.ts', 'ai/rezModel.ts', 'ai/runs.ts', 'ai/cards/index.ts', 'ai/corp/pools.ts', 'ai/turnPlanner.ts', 'ai/handValues.ts', 'ai/pricing.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts', 'core/index.ts', 'core/engine/cardEffects.ts']) mods.push(await m(p));
  const [ai, po, rez, hold, money, model, runs, cards, pools, tp, hv, pr, ev, vm, iv, core, ce] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    rezCandidates: po.rezCandidates,
    countedRez: rez.countedRez,
    rezStops: rez.rezStops,
    matchPointRez: rez.matchPointRez,
    archivesWantsIce: rez.archivesWantsIce,
    spendsKept: rez.spendsKept,
    serverHold: hold.serverHold,
    rezMoney: money.rezMoney,
    modelRezGain: model.modelRezGain,
    runBypassed: model.runBypassed,
    iceCreditNeed: runs.iceCreditNeed,
    rezEffectOf: cards.rezEffectOf,
    agendasUnseen: pools.agendasUnseen,
    corpDecisionView: tp.corpDecisionView,
    decisionContext: hv.decisionContext,
    asSide: pr.asSide,
    plan: pr.plan,
    cardDef: core.cardDef,
    rezCost: ce.rezCost,
    holdCacheStats: hold.holdCacheStats,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets();
      iv.clearDeckShares();
      vm.valueLoops?.clear();
    },
  };
}

export const key = (a: GameAction | null | undefined) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).sort())) : 'null');
export const r2 = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x === Infinity ? 'inf' : x);

/** What the run threatens (public to the Corp: its own cards): an agenda in the root; HQ with agendas; R&D; other. */
export function serverKind(t: Tree, s: GameState, server: string): string {
  const isAgenda = (c: CardInstance) => t.cardDef(c).type_code === 'agenda';
  if (server === 'hq') return s.corp.hq.some(isAgenda) ? 'hq-agenda' : 'hq';
  if (server === 'rd') return 'rd';
  if (server === 'archives') return 'archives';
  return s.corp.servers[server]?.root.some(isAgenda) ? 'root-agenda' : 'remote-other';
}

const holdOut = (h: { holds: boolean; rez: string[] | null; rezCost: number; need: number; budget: number }) => ({ holds: h.holds, rez: h.rez, cost: r2(h.rezCost), need: r2(h.need), budget: r2(h.budget) });

/**
 * countedRez's answer and the step that gave it, step by step as corp/rez.ts countedRez reads (on beta dbefb94): match
 * point, R5, the run's bypass, a free ice, the rezzed ice further in already holding, R2 (stops by rezStops(false), an
 * agenda in the root), R3 and R4 (stop, toll, or a toll passed by spendsKept), else no opinion.
 */
function countedWhy(t: Tree, state: GameState, ice: CardInstance): { rule: string; answer: 'rez' | 'pass' | null } {
  const run = state.activeRun;
  if (!run || run.icePosition === null) return { rule: 'no-run', answer: null };
  const server = state.corp.servers[run.server];
  if (!server) return { rule: 'no-server', answer: null };
  const atMatch = t.matchPointRez(state, ice);
  if (atMatch) return { rule: `match-${atMatch}`, answer: atMatch };
  if (run.server === 'archives' && !t.archivesWantsIce(state)) return { rule: 'R5', answer: 'pass' };
  const up = { ...ice, isRezzed: true };
  const view: GameState = { ...state, corp: { ...state.corp, servers: { ...state.corp.servers, [server.id]: { ...server, ice: server.ice.map(c => (c.instanceId === ice.instanceId ? up : c)) } } } };
  if (t.runBypassed(view, up)) return t.rezEffectOf(t.cardDef(ice).code) ? { rule: 'bypassed-effect', answer: null } : { rule: 'bypassed', answer: 'pass' };
  if (t.iceCreditNeed(view, up) === 0) return { rule: 'free', answer: null };
  if (t.serverHold(state, run.server, { when: 'thisRun', mustRez: [], further: false }).holds) return { rule: 'inner-holds', answer: null };
  const stops = t.rezStops(state, ice, false);
  const isAgenda = (c: CardInstance) => t.cardDef(c).type_code === 'agenda';
  if (stops && server.root.some(isAgenda)) return { rule: 'R2', answer: 'rez' };
  const hqAgendas = state.corp.hq.filter(isAgenda).length;
  if (run.server === 'hq' && hqAgendas > 0) return stops ? { rule: 'R3s', answer: 'rez' } : t.spendsKept(state, ice) ? { rule: 'R3t-kept', answer: 'pass' } : { rule: 'R3t', answer: 'rez' };
  if (run.server === 'rd' && hqAgendas === 0 && t.agendasUnseen(state) > 0) return stops ? { rule: 'R4s', answer: 'rez' } : t.spendsKept(state, ice) ? { rule: 'R4t-kept', answer: 'pass' } : { rule: 'R4t', answer: 'rez' };
  return { rule: 'none', answer: null };
}

export interface WindowFacts {
  rule: string;
  counted: 'rez' | 'pass' | null;
  derivedOk: boolean;
  stopsT: boolean;
  stopsF: boolean;
  withIt: ReturnType<typeof holdOut>;
  without: ReturnType<typeof holdOut>;
  alone: ReturnType<typeof holdOut>;
  gain: number | string | null;
  keep: number | string;
  keepHere: number | null;
  cost: number;
}

/** The facts of one approach-ice window, asked of tree `t` on the deciding Corp's view (see the file comment). */
export function windowFacts(t: Tree, real: GameState, ice: CardInstance, withGain = true): WindowFacts {
  t.clear();
  return t.asSide('corp', () => {
    const state = t.corpDecisionView(structuredClone(real)) as GameState;
    t.decisionContext(state, 'corp');
    const run = state.activeRun!;
    const c = state.corp.servers[run.server].ice.find(x => x.instanceId === ice.instanceId) ?? ice;
    const why = countedWhy(t, state, c);
    const counted = t.countedRez(state, c);
    const h = (mustRez: string[], further: boolean) => holdOut(t.serverHold(state, run.server, { when: 'thisRun', mustRez, further }));
    let gain: number | string | null = null;
    if (counted === null && withGain && t.plan().modelRez)
      try {
        gain = r2(t.modelRezGain(state, c, true)) as number;
      } catch (e) {
        gain = `error ${(e as Error).message.slice(0, 60)}`;
      }
    let keep: number | string;
    let keepHere: number | null = null;
    try {
      const k = t.rezMoney(state);
      keep = k.keep;
      keepHere = k.byServer[run.server] ?? null;
    } catch (e) {
      keep = `error ${(e as Error).message.slice(0, 60)}`;
    }
    return {
      rule: why.rule,
      counted,
      derivedOk: why.answer === counted,
      stopsT: t.rezStops(state, c, true),
      stopsF: t.rezStops(state, c, false),
      withIt: h([c.instanceId], true),
      without: h([], true),
      alone: h([c.instanceId], false),
      gain,
      keep,
      keepHere,
      cost: t.rezCost(state, c),
    };
  });
}

/** A fresh Normal Corp of tree `t` asked at a rez window (or a main/prompt decision), on a copy of the state. */
export function askRez(t: Tree, s: GameState): { a: string; ms: number } {
  t.clear();
  const agent = t.createAgent('corp', 'normal');
  const copy = structuredClone(s);
  const step = copy.priority?.step as 'approach_ice' | 'approach_server';
  const at = performance.now();
  try {
    const a = agent.chooseRez(copy, t.rezCandidates(copy, step));
    return { a: key(a), ms: performance.now() - at };
  } catch (e) {
    return { a: `error: ${(e as Error).message.slice(0, 80)}`, ms: 0 };
  }
}
export function askAction(t: Tree, s: GameState): { a: string; ms: number } {
  t.clear();
  const agent = t.createAgent('corp', 'normal');
  const at = performance.now();
  try {
    const a = agent.chooseAction(structuredClone(s));
    return { a: key(a), ms: performance.now() - at };
  } catch (e) {
    return { a: `error: ${(e as Error).message.slice(0, 80)}`, ms: 0 };
  }
}

/** Is the Corp asked at this state's rez window (as GameRunner.step asks: the AI's stops). */
export function isRezWindow(s: GameState, wantsStop: Fn): boolean {
  const w = s.priority;
  return !!w && s.pendingPrompts.length === 0 && w.holder === 'corp' && s.activePlayer === 'runner' && (w.step === 'approach_ice' || w.step === 'approach_server') && wantsStop({ ...s, stops: { corp: 'ai', runner: 'ai' } }, 'corp', w);
}
