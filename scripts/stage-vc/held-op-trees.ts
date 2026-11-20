/**
 * V-C item 3 (the held economy operation), count step: the trees. Brief:
 * /mnt/project-files/netrunner-ai/stage-vc/item3-held-operation/brief.md.
 * A tree is a copy of this checkout's src/ (beta's src) with text patches, loaded as its own module graph (as
 * scripts/stage-vc/hand-price-trees.ts). Every tree gets the RECORD patches, which only write globals the script reads.
 *
 * RECORD (every tree):
 *  - corp/core.ts: what the deciding Corp's pipeline did (`__hoRec`: Q1 win, Q3 score, Q4/Q5 line step or later turn,
 *    Q6 money, the look-ahead's pick, the final action, the turn-start window), the deciding Corp only (ctx.counted);
 *  - turnPlanner.ts, only while `__hoTraceOn` (the trace asks on the beta tree): the memory step ("still on the last
 *    plan"); each candidate's value, and its playout step by step (was one of `__hoIds` payable with a click left, did the
 *    step play it, the order's line of the step, whether the held two-turn line replaced the pick); at each candidate's
 *    end of turn (the leaf's board, before the Runner's reply) the operation's own terms: the leaf's value with the card
 *    in HQ less without it (P1 or P2/P3 by the board), and whether it is payable there;
 *  - corpAI.ts: the time inside the planner (`__hoPlanMs`);
 *  - valueModel.ts: the fire count of an arm's price (`__hoFire`: the arm's credit value differs from beta's formula).
 *
 * The arms (Corp view only: every change sits behind reachCard / sideCreditValue's `viewer === 'corp'`):
 *  - reachShort: reachCard also takes a money operation the Corp is short of when the shortfall is no more than the
 *    credit clicks it has before the end of its next turn with one click left to play it: shortfall <= clicks this turn
 *    (its own turn only) + maxClicks - 1 (clicks a turn from the engine's `maxClicks`). moneyReach prices it by today's
 *    formula; both hand prices leave it out exactly as they leave out today's reach card (they read reachCard).
 *  - playedPrice: for today's reach card (payable only), sideCreditValue is creditSlide at credits + moneyGain, less one
 *    click at the click owner's price (the Corp's: CLICK, plan.clickByPlay off; a stop if it is on). MONEY_REACH unread.
 *  - playedPriceShort: reachShort's card; at shortfall s, creditSlide at credits + s + moneyGain less s + 1 clicks, never
 *    below the slide's value without the card.
 *  - saveUpMoney: step 8's arm (scripts/stage-d/post-pick-trees.ts) on today's tree, a reference: Q6 moneyPick answers
 *    "gain a credit" when no econ operation is playable now and one becomes playable with this turn's clicks and nets.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ARMS = ['beta', 'control', 'source', 'reachShort', 'playedPrice', 'playedPriceShort', 'saveUpMoney'] as const;
export type Arm = (typeof ARMS)[number];
export const PRICE_ARMS: Arm[] = ['reachShort', 'playedPrice', 'playedPriceShort', 'saveUpMoney'];

type Patch = [file: string, at: string, to: string];

const SAVE_HELPER = `
/**
 * saveUp (count arm, found row 35; step 8's, scripts/stage-d/post-pick-trees.ts): an econ operation in HQ that is not
 * playable now but becomes playable with this turn's clicks (credits + clicks - 1 >= its cost), and nets credits when
 * played (options' own net, read on a copy of the board given the missing credits). Returns the best such net, or 0.
 */
export function saveUpNet(state: GameState): number {
  if (state.activePlayer !== 'corp' || activePrompt(state) || state.activeRun || state.corp.clicks <= 1) return 0;
  const legal = getLegalActions(state, 'corp');
  const now = new Set(legal.filter(a => a.type === 'PLAY_OPERATION_OR_EVENT').map(a => (a as { cardInstanceId: string }).cardInstanceId));
  const reach = state.corp.clicks - 1;
  let best = 0;
  for (const card of state.corp.hq) {
    if (now.has(card.instanceId) || cardDef(card).type_code !== 'operation' || !((cardSynergy(cardDef(card)).gives?.econ ?? 0) > 0)) continue;
    const cost = cardDef(card).cost ?? 0;
    if (cost <= state.corp.credits || cost > state.corp.credits + reach) continue;
    const rich: GameState = { ...state, corp: { ...state.corp, credits: cost } };
    const op = options(rich, getLegalActions(rich, 'corp')).find(o => (o.action as { cardInstanceId: string }).cardInstanceId === card.instanceId);
    if (op && op.net > best) best = op.net;
  }
  return best;
}
`;

function patches(arm: Arm): Patch[] {
  const SHORT = arm === 'reachShort' || arm === 'playedPriceShort';
  const PP = arm === 'playedPrice';
  const PPS = arm === 'playedPriceShort';
  const list: Patch[] = [
    // ---------------------------------------------------------------- RECORD: the deciding Corp's pipeline
    [
      'ai/corp/core.ts',
      `    const win = winNowAction(view);
    if (win) return { action: win, note: true };`,
      `    const win = winNowAction(view);
    if (win) {
      (globalThis as any).__hoRec = { win: true, final: win };
      return { action: win, note: true };
    }`,
    ],
    [
      'ai/corp/core.ts',
      `    if (!lineFirst && ctx.synergy && plan().tagFirst && ranked[0]?.action.type === 'TRASH_RESOURCE' && ranked[0].tagFirst) chosen = ranked[0].action;
    return chosen;`,
      `    if (!lineFirst && ctx.synergy && plan().tagFirst && ranked[0]?.action.type === 'TRASH_RESOURCE' && ranked[0].tagFirst) chosen = ranked[0].action;
    if (ctx.counted) (globalThis as any).__hoRec = { decided, lineFirst, planned, money, chosen, turnStart, r0: ranked[0]?.action ?? null, lookahead: !!ctx.lookahead && !turnStart && !decided };
    return chosen;`,
    ],
    [
      'ai/corp/core.ts',
      `    return { action: picked, note: true };`,
      `    if (ctx.counted && (globalThis as any).__hoRec) Object.assign((globalThis as any).__hoRec, { score: true, final: picked });
    return { action: picked, note: true };`,
    ],
    [
      'ai/corp/core.ts',
      `  const two = lineAsk(view, ctx.memory.heldLine, (lineFirst, later) => choose(later || !!lineFirst, lineFirst));`,
      `  const two = lineAsk(view, ctx.memory.heldLine, (lineFirst, later) => choose(later || !!lineFirst, lineFirst));
  if (ctx.counted && (globalThis as any).__hoRec) Object.assign((globalThis as any).__hoRec, { later: two.later, lineStep: two.lineFirst, final: two.action });`,
    ],
    // ---------------------------------------------------------------- RECORD: the planner (trace asks only)
    [
      'ai/turnPlanner.ts',
      `    memory.line.shift();
    return next.action;`,
      `    memory.line.shift();
    if (side === 'corp' && (globalThis as any).__hoTraceOn) (globalThis as any).__hoMem = true;
    return next.action;`,
    ],
    [
      'ai/turnPlanner.ts',
      `      const value = playout(root, side, c.action, ai, line, ends);`,
      `      const __G = globalThis as any;
      const __cur = side === 'corp' && __G.__hoTraceOn ? { steps: [] as any[], first: null as any } : null;
      if (__cur) {
        const __ids: string[] = __G.__hoIds ?? [];
        __cur.first = { payable: __payable(root, __ids), plays: c.action.type === 'PLAY_OPERATION_OR_EVENT' && __ids.includes((c.action as any).cardInstanceId), clicks: root.corp.clicks, cr: root.corp.credits };
      }
      const __was = __G.__hoCur;
      __G.__hoCur = __cur;
      let value: number;
      try {
        value = playout(root, side, c.action, ai, line, ends);
      } finally {
        __G.__hoCur = __was;
      }
      if (__cur) {
        const __ids: string[] = __G.__hoIds ?? [];
        const end = ends.state;
        const ops = end
          ? __ids.map(id => {
              const card = end.corp.hq.find(x => x.instanceId === id);
              if (!card) return { id, inHq: false };
              const without = { ...end, corp: { ...end.corp, hq: end.corp.hq.filter(x => x.instanceId !== id) } } as GameState;
              return { id, inHq: true, payable: (cardDef(card).cost ?? 0) <= end.corp.credits, terms: leafValue(end, side) - leafValue(without, side), cr: end.corp.credits, clicks: end.corp.clicks };
            })
          : [];
        (__G.__hoPlan ??= { cands: [] }).cands.push({ action: c.action, value, bonus: ends.bonus ?? 0, first: __cur.first, steps: __cur.steps, ops });
      }`,
    ],
    [
      'ai/turnPlanner.ts',
      `    const played = corpLine && !outOfClicks ? corpLine.step(now, best?.action ?? null) : best?.action;`,
      `    const played = corpLine && !outOfClicks ? corpLine.step(now, best?.action ?? null) : best?.action;
    const __cur = side === 'corp' ? (globalThis as any).__hoCur : null;
    if (__cur && !outOfClicks) {
      const __ids: string[] = (globalThis as any).__hoIds ?? [];
      const r = played ? ranked.find(x => sameAction(x.action, played)) : undefined;
      __cur.steps.push({ payable: __payable(now, __ids), plays: played?.type === 'PLAY_OPERATION_OR_EVENT' && __ids.includes((played as any).cardInstanceId), type: played?.type ?? null, line: (r as any)?.line ?? null, byLine: !!played && played !== best?.action, clicks: clicksOf(now, side), cr: now.corp.credits });
    }`,
    ],
    [
      'ai/turnPlanner.ts',
      `    if (!best || best.value === -Infinity) return null;`,
      `    if (side === 'corp' && (globalThis as any).__hoPlan) (globalThis as any).__hoPlan.best = best?.action ?? null;
    if (!best || best.value === -Infinity) return null;`,
    ],
    [
      'ai/turnPlanner.ts',
      `import { fingerprint } from './valueModel';`,
      `import { fingerprint } from './valueModel';
import { getLegalActions as __legal } from '../core';
/** HELD-OP (count step): one of \`ids\` can be played now (a legal play) with a click to play it. */
function __payable(state: GameState, ids: string[]): boolean {
  if (!ids.length || state.activePlayer !== 'corp' || state.corp.clicks <= 0) return false;
  try {
    return __legal(state, 'corp').some(a => a.type === 'PLAY_OPERATION_OR_EVENT' && ids.includes((a as any).cardInstanceId));
  } catch {
    return false;
  }
}`,
    ],
    // ---------------------------------------------------------------- RECORD: the time inside the planner
    [
      'ai/corpAI.ts',
      `  private plan(state: GameState, ranked: ScoredAction[]): GameAction | null {`,
      `  private plan(state: GameState, ranked: ScoredAction[]): GameAction | null {
    const __at = performance.now();
    try {
      return this.__plan(state, ranked);
    } finally {
      const G = globalThis as any;
      if (G.__hoArm) G.__hoPlanMs = (G.__hoPlanMs ?? 0) + performance.now() - __at;
    }
  }

  private __plan(state: GameState, ranked: ScoredAction[]): GameAction | null {`,
    ],
    // ---------------------------------------------------------------- the arms: reachCard (reachShort, playedPriceShort)
    [
      'ai/valueModel.ts',
      `export function reachCard(state: GameState): CardInstance | undefined {
  const credits = state.corp.credits;
  let best: CardInstance | undefined;
  for (const card of state.corp.hq) {
    const def = cardDef(card);
    if (def.type_code !== 'operation' || (def.cost ?? 0) > credits) continue;`,
      `export function reachCard(state: GameState): CardInstance | undefined {
  const credits = state.corp.credits;
  const __window = ${SHORT} ? __reachWindow(state) : 0;
  let best: CardInstance | undefined;
  for (const card of state.corp.hq) {
    const def = cardDef(card);
    if (def.type_code !== 'operation' || (def.cost ?? 0) - credits > __window) continue;`,
    ],
    // ---------------------------------------------------------------- the arms: sideCreditValue (fires; playedPrice, playedPriceShort)
    [
      'ai/valueModel.ts',
      `  return logValue('credit', 'sideCreditValue', state, reach ? creditSlide(credits + reach, need, broke) + Math.min(credits, 0) : creditSlide(credits, need, broke), side, viewer);`,
      `  let __v = reach ? creditSlide(credits + reach, need, broke) + Math.min(credits, 0) : creditSlide(credits, need, broke);
  const __G = globalThis as any;
  if (side === 'corp' && viewer === 'corp') {
    const card = reachCard(state);
    if (card && (${PP} || ${PPS})) {
      if (plan().clickByPlay?.corp) throw new Error('held-op arm: plan.clickByPlay.corp is on; the click owner is not CLICK');
      const s = Math.max(0, (cardDef(card).cost ?? 0) - credits);
      if (${PP} && s > 0) throw new Error('held-op arm playedPrice: a reach card the Corp cannot pay for');
      const played = creditSlide(credits + s + moneyGain(card), need, broke) - (s + 1) * CLICK;
      __v = (${PPS} ? Math.max(creditSlide(credits, need, broke), played) : played) + Math.min(credits, 0);
    }
    // the fire: this tree's credit value against beta's formula on this board
    if (__G.__hoFire && ${SHORT || PP || PPS}) {
      const old = __betaReach(state);
      const betaV = old ? creditSlide(credits + MONEY_REACH * Math.max(0, moneyGain(old) - 1), need, broke) + Math.min(credits, 0) : creditSlide(credits, need, broke);
      if (Math.abs(betaV - __v) > 1e-9) __G.__hoFire.n = (__G.__hoFire.n ?? 0) + 1;
    }
  }
  return logValue('credit', 'sideCreditValue', state, __v, side, viewer);`,
    ],
    [
      'ai/valueModel.ts',
      `/** plan.brokeSlope: the Corp's first credit worth this much more (1.8 + 1 = 2.8), sliding to nothing at BROKE_CREDITS. */`,
      `/** HELD-OP (count step): the credit clicks the Corp has before the end of its next turn, one kept to play the card. */
function __reachWindow(state: GameState): number {
  const now = state.activePlayer === 'corp' ? Math.max(0, state.corp.clicks) : 0;
  return now + (state.corp.maxClicks ?? 3) - 1;
}

/** HELD-OP (count step): beta's reach card (payable only), for the fire count. */
function __betaReach(state: GameState): CardInstance | undefined {
  let best: CardInstance | undefined;
  for (const card of state.corp.hq) {
    const def = cardDef(card);
    if (def.type_code !== 'operation' || (def.cost ?? 0) > state.corp.credits) continue;
    if (moneyGain(card) > (best ? moneyGain(best) : 0)) best = card;
  }
  return best;
}

/** plan.brokeSlope: the Corp's first credit worth this much more (1.8 + 1 = 2.8), sliding to nothing at BROKE_CREDITS. */`,
    ],
  ];
  if (arm === 'saveUpMoney')
    list.push(
      ['ai/incomeLine.ts', `/** The action installs an agenda`, `${SAVE_HELPER}\n/** The action installs an agenda`],
      [
        'ai/incomeLine.ts',
        `  const ops = options(state, getLegalActions(state, 'corp'));
  if (!ops.length) return null;`,
        `  const ops = options(state, getLegalActions(state, 'corp'));
  if (!ops.length) {
    const credit = getLegalActions(state, 'corp').find(a => a.type === 'GAIN_CREDIT');
    if (credit && saveUpNet(state) > 0) {
      const G = globalThis as any;
      if (G.__hoFire) G.__hoFire.n = (G.__hoFire.n ?? 0) + 1;
      return credit;
    }
    return null;
  }`,
      ],
    );
  return list;
}

/** Copies this checkout's src into root/<arm>/src with the arm's patches; each patch must match exactly once. */
export function makeTrees(root: string, arms: readonly Arm[], from = 'src'): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  for (const arm of arms) {
    const dir = join(root, arm);
    mkdirSync(dir, { recursive: true });
    cpSync(from, join(dir, 'src'), { recursive: true });
    for (const [f, at, to] of patches(arm)) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length !== 2) throw new Error(`tree ${arm}: a patch does not match once in ${f}: ${at.slice(0, 80)}`);
      writeFileSync(
        path,
        text.replace(at, () => to),
      );
    }
    dirs[arm] = dir;
  }
  return dirs;
}

export interface Tree {
  name: string;
  createAgent: (side: string, level: string) => any;
  GameRunner: any;
  core: any;
  decks: any;
  hv: any;
  ev: any;
  vm: any;
  pricing: any;
  tp: any;
  plans: any;
  clear: () => void;
}

export async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts', 'ai/evaluate.ts', 'ai/pricing.ts', 'ai/turnPlanner.ts', 'ai/cardPlans.ts']) mods.push(await m(p));
  const [ai, po, core, decks, hv, ev, vm, iv, evl, pricing, tp, plans] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    core,
    decks,
    hv,
    ev: evl,
    vm,
    pricing,
    tp,
    plans,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
