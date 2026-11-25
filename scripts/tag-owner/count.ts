/**
 * F108 count: what a kept tag costs, and which reader prices it (brief
 * /mnt/project-files/netrunner-ai/tag-owner/brief-count.md rev 0). Counts only: nothing in src or tests changes. Trees in
 * trees.ts. Built on scripts/tags-once/count.ts (its asking of arms and its record of what a tag cost, copied here since
 * that script runs on import).
 *
 * MODE=count (Parts A, C, D): the source tree plays every deal (GameRunner, its agents only watched); at every decision
 *   each arm decides on a structuredClone, a fresh Normal agent of that arm's tree given a copy of the source agent's own
 *   fields, caches cleared; `ctl` is base asked a second time (the time control). Every tag the Runner takes: its price
 *   under each arm (the whole change of evaluate for one more tag, both views) beside what it then cost on the record,
 *   with its outcome and, for a later tag, which branch of the tag clock's min the board took. Every access whose trash
 *   gives a tag: each arm's answer and the tag's part of trash less keep (Part D).
 * MODE=legs (Part B): the source tree plays every deal unwatched; at every Runner decision that took REMOVE_TAG (a
 *   `clear` unit), and on a hashed sample of the tagged main decisions with a click and 2 credits that did not (a
 *   `mirror` unit, rate MIRROR_P), two legs on the `legs` tree from that board, SEEDS seeds each (seed 0 the game's own
 *   rng, seed k >= 1 R&D and the stack reshuffled, both legs alike): `clear` and `keep`. On a clear unit the keep leg has
 *   REMOVE_TAG barred until the Runner's next turn begins (the Runner plays its best other action); on a mirror unit
 *   the clear leg plays REMOVE_TAG, the keep leg the source's own action. Each leg is read at the start of the Runner's
 *   next turn (B.1: what the Corp took with the tag, what it spent, the board) and at the end of the game (B.2).
 *
 * Pools (never summed): batch (221 deals of g1 45553599707), nrdb (110 of NRDB=1 g1 45555227992), people (the 38
 * human-games files and the issue files tags-once read; count mode only), issue58 (the #58 pin's board played on to the
 * end of T6; count mode only), old150 (count mode only: the deals of the 16 declined Plaza accesses of
 * scripts/tags-once/declined-150.json, run 45499791395/45503877309, played by today's source; only those accesses asked).
 *
 * HIDDEN-READ (the measuring script, never an agent): the record prices the real board; the legs copy the source agents'
 * memory and reshuffle R&D and the stack for seed k >= 1. The agents asked see what the source agent saw.
 *
 *   SHARD=0/64 MODE=count POOL=batch,nrdb,people,issue58,old150 npx vite-node scripts/tag-owner/count.ts
 *   SHARD=0/64 MODE=legs POOL=batch,nrdb SEEDS=2 MIRROR_P=0.05 npx vite-node scripts/tag-owner/count.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CardInstance, GameAction, GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { ARMS, Arm, TreeName, makeTrees } from './trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const MODE = process.env.MODE ?? 'count';
const POOLS = (process.env.POOL ?? (MODE === 'legs' ? 'batch,nrdb' : 'batch,nrdb,people,issue58,old150')).split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity);
const SEEDS = Number(process.env.SEEDS ?? 2);
const MIRROR_P = Number(process.env.MIRROR_P ?? 0);
/** Legs: at most this many clear units a deal (0 = all); step 0 reads 10. */
const UNITS = Number(process.env.UNITS ?? 0);
/** Legs: B.2 (play on to the end of the game); off for a quick look. */
const TO_END = process.env.TO_END !== '0';
/** Count: the untagged check (resOnly and owner give base's evaluate on an untagged board) on every k-th decision. */
const CHECK_EVERY = Number(process.env.CHECK_EVERY ?? 10);
/** Legs: write the keep leg's actions through the Corp's next turn (step 0's turn by turn read). */
const TRACE = process.env.TRACE === '1';
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/tag-owner', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r3 = (x: number | null | undefined): number | string | null =>
  x === null || x === undefined ? null : Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x > 0 ? 'Inf' : '-Inf';
const G = globalThis as any;

interface T {
  name: string;
  ai: any;
  po: any;
  core: any;
  decks: any;
  ev: any;
  hv: any;
  vm: any;
  pricing: any;
  plans: any;
  syn: any;
  runs: any;
  ce: any;
  tp: any;
  clear: () => void;
}
async function loadTree(name: string, dir: string): Promise<T> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const files = ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/evaluate.ts', 'ai/handValues.ts', 'ai/valueModel.ts', 'ai/effectValues.ts', 'ai/iceValues.ts', 'ai/threatModel.ts', 'ai/pricing.ts', 'ai/cardPlans.ts', 'ai/synergyTags.ts', 'ai/runs.ts', 'core/engine/cardEffects.ts', 'ai/turnPlanner.ts'];
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of files) mods.push(await m(p));
  const [ai, po, core, decks, ev, hv, vm, fx, iv, tm, pricing, plans, syn, runs, ce, tp] = mods;
  return {
    name,
    ai,
    po,
    core,
    decks,
    ev,
    hv,
    vm,
    pricing,
    plans,
    syn,
    runs,
    ce,
    tp,
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

let S: T; // source: plays
const A = {} as Record<Arm | 'noWait' | 'noPerTurn' | 'legs', T>;

// ------------------------------------------------------------------------------------------------ asking the arms
const classInstance = (v: any) => v && typeof v === 'object' && !(v instanceof Map) && !(v instanceof Set) && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype;
/** The source agent's own fields at this moment, copied into a fresh agent of another tree (class instances field by field). */
function copyFields(from: any, to: any) {
  for (const k of Object.keys(from)) {
    const v = from[k];
    if (typeof v === 'function') continue;
    if (classInstance(v) && to[k] && typeof to[k] === 'object') Object.assign(to[k], structuredClone({ ...v }));
    else to[k] = structuredClone(v);
  }
}
const pickKey = (a: unknown): string => {
  if (a === null || a === undefined) return 'null';
  const sort = (x: any): any => (Array.isArray(x) ? x.map(sort) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])])) : x);
  return JSON.stringify(sort(a));
};
type Method = 'chooseAction' | 'chooseRez' | 'chooseOffTurn';
function ask(t: T, side: 'corp' | 'runner', method: Method, s: GameState, from: any): { a: string; ms: number } {
  t.clear();
  const agent: any = t.ai.createAgent(side, 'normal');
  if (from) copyFields(from, agent);
  const st = structuredClone(s);
  const args = method === 'chooseRez' ? [st, t.po.rezCandidates(st, st.priority?.step)] : [st];
  const t0 = performance.now();
  try {
    const a = agent[method](...args);
    return { a: pickKey(a), ms: performance.now() - t0 };
  } catch (e) {
    return { a: `error: ${(e as Error).message.slice(0, 100)}`, ms: performance.now() - t0 };
  }
}
/** evaluate(state, side) under the side's own context, in one tree, caches cleared. */
function evalIn(t: T, s: GameState, side: 'corp' | 'runner'): number {
  t.clear();
  const st = structuredClone(s);
  return t.pricing.asSide(side, () => {
    t.hv.decisionContext(st, side);
    return t.ev.evaluate(st, side) as number;
  });
}
/** f under viewer's context in tree t, caches cleared, on a copy. */
function inCtx<X>(t: T, s: GameState, viewer: 'corp' | 'runner', f: (st: GameState) => X): X {
  t.clear();
  const st = structuredClone(s);
  return t.pricing.asSide(viewer, () => {
    t.hv.decisionContext(st, viewer);
    return f(st);
  });
}

// ------------------------------------------------------------------------------------------------ cards
const synOf = (code: string) => {
  try {
    return S.syn.cardSynergy(S.core.getCardDefinition(code)) ?? {};
  } catch {
    return {};
  }
};
const punisher = (code: string) => (synOf(code).when ?? []).includes('ifTagged');
const titleOf = (code: string) => {
  try {
    return S.core.getCardDefinition(code).title as string;
  } catch {
    return code;
  }
};
/** A punisher as the Runner sees it: 'known' (one seen in HQ by its memory, or the identity punishes), 'deck' (none seen; the Corp's decklist holds one), 'none'. */
function punisherView(s: GameState, memory: Map<string, string> | undefined): string {
  if (punisher(s.corp.identity.cardCode)) return 'known';
  if (s.corp.hq.some(c => memory?.get(c.instanceId) && punisher(memory.get(c.instanceId)!))) return 'known';
  const all: CardInstance[] = [...s.corp.hq, ...s.corp.rd, ...s.corp.archives.faceUp, ...s.corp.archives.faceDown, ...Object.values(s.corp.servers).flatMap((v: any) => [...v.ice, ...v.root])];
  return all.some(c => punisher(c.cardCode)) ? 'deck' : 'none';
}

// ------------------------------------------------------------------------------------------------ prices (base unless named)
/** base's tagsWorth on board `s`, as viewer, of n tags given (n = 0 is 0). */
function worth(s: GameState, v: 'corp' | 'runner', n: number): number {
  if (n <= 0) return 0;
  return inCtx(A.base, s, v, st => A.base.ev.tagsWorth(st, v, n) as number);
}
/** The Runner's strength without its tag term (base, the Runner's view): what a punisher takes. */
function standing(s: GameState): number {
  return inCtx(A.base, s, 'runner', st => (A.base.ev.sideStrength(st, 'runner', 'runner') as number) + (A.base.ev.tagsWorth(st, 'runner') as number));
}
/** A resource's worth by tagLoss's owner (evaluate.ts tagLoss: addRigCard plus its share of the board plans). */
function resourceWorth(s: GameState, r: CardInstance): number {
  const t = A.base;
  return inCtx(t, s, 'runner', st => {
    const res = st.runner.rig.resources.find((c: CardInstance) => c.instanceId === r.instanceId)!;
    const owned = st.runner.rig.resources;
    const plans = t.plans.hasBoardPlan(st, 'runner') ? (t.plans.boardPlansWorth(st, 'runner') as number) : undefined;
    const share = plans === undefined ? 0 : plans - t.plans.boardPlansWorth({ ...st, runner: { ...st.runner, rig: { ...st.runner.rig, resources: owned.filter((c: CardInstance) => c !== res) } } }, 'runner');
    return (t.ev.addRigCard(st, res, 0) as number) + share;
  });
}
/** Clicks and credits a side spent between two boards, at base's rates on the first (its own view). */
function spentBy(side: 'corp' | 'runner', before: GameState, after: GameState): number {
  const p = (x: GameState) => (side === 'corp' ? x.corp : x.runner);
  const dk = Math.max(0, p(before).clicks - p(after).clicks);
  const dc = Math.max(0, p(before).credits - p(after).credits);
  return inCtx(A.base, before, side, st => {
    const click = A.base.hv.clickPrice(st, side, side) as number;
    const less = side === 'corp' ? { ...st, corp: { ...st.corp, credits: st.corp.credits - dc } } : { ...st, runner: { ...st.runner, credits: st.runner.credits - dc } };
    const cr = (A.base.vm.sideCreditValue(st, side, side) as number) - (A.base.vm.sideCreditValue(less, side, side) as number);
    return dk * click + cr;
  });
}
/** What clearing one tag costs on this board at its rates: a click and 2 credits (rule 10.5.4), the Runner's view. */
function clearCost(s: GameState): number {
  return spentBy('runner', s, { ...s, runner: { ...s.runner, clicks: s.runner.clicks - 1, credits: s.runner.credits - 2 } });
}
/** The tag clock's per-turn loss (tagLossPerTurn, skip 0 as the clock outside the Corp's turn reads it), both views. */
function lossPerTurn(s: GameState) {
  return { runner: inCtx(A.base, s, 'runner', st => A.base.ev.tagLossPerTurn(st, 'runner', 0) as number), corp: inCtx(A.base, s, 'corp', st => A.base.ev.tagLossPerTurn(st, 'corp', 0) as number) };
}
/**
 * Which branch of the tag clock's min a board with `tags` tags takes (evaluate.ts tagClock, read here from its inputs:
 * perTurn = tagLossPerTurn, clear = CLICK + 2, stuck): 'clearAll' (the clearing side) or 'keep' (1.5 a turn's loss +
 * 0.1 a later tag; on the Corp's turn 0.5). The identity's own clearing (tagClear) is named when it is lower.
 */
function clockBranch(s: GameState, viewer: 'corp' | 'runner', tags: number): { branch: string; clearAll: number; keep: number; perTurn: number } {
  return inCtx(A.base, s, viewer, st => {
    const plan = A.base.pricing.plan();
    const corp = st.corp;
    const trashNow = plan.tagTrashNow && st.activePlayer === 'corp' && !st.activeRun && st.runner.tags > 0 && corp.clicks >= 1 && corp.credits >= 2;
    const perTurn = A.base.ev.tagLossPerTurn(st, viewer, trashNow ? 1 : 0) as number;
    const clear = A.base.vm.CLICK + 2;
    const stuck = !(st.activePlayer === 'runner' && st.runner.clicks >= 1 && st.runner.credits >= 2);
    const corpTurn = plan.tagTrashNow && st.activePlayer === 'corp' && !st.activeRun;
    const clearAll = corpTurn ? tags * clear : (stuck ? perTurn : 0) + tags * clear;
    const keep = corpTurn ? 0.5 * perTurn + 0.1 * (tags - 1) : 1.5 * perTurn + 0.1 * (tags - 1);
    return { branch: clearAll <= keep ? 'clearAll' : 'keep', clearAll: r3(clearAll) as number, keep: r3(keep) as number, perTurn: r3(perTurn) as number };
  });
}
/** One more tag on board b under each arm: the whole change of evaluate, both views. */
function armPrices(b: GameState) {
  const plus = structuredClone(b);
  plus.runner.tags += 1;
  const res: Record<string, { runner: number | string | null; corp: number | string | null }> = {};
  for (const arm of ARMS) res[arm] = { runner: r3(evalIn(A[arm], plus, 'runner') - evalIn(A[arm], b, 'runner')), corp: r3(evalIn(A[arm], plus, 'corp') - evalIn(A[arm], b, 'corp')) };
  return res;
}
/** tagCost (runs.ts:424, the run's price of one more tag) on board s under tree t, the Runner's context. */
const tagCostIn = (t: T, s: GameState): number => inCtx(t, s, 'runner', st => t.runs.tagCost(st) as number);
const tagCosts = (s: GameState) => Object.fromEntries(ARMS.map(a => [a, r3(tagCostIn(A[a], s))]));
/** The Runner could not clear when the tag arrived: not its turn, or under a click and 2 credits (the clock's `stuck`, evaluate.ts:393). */
const stuckOn = (s: GameState) => !(s.activePlayer === 'runner' && s.runner.clicks >= 1 && s.runner.credits >= 2);
/** On a trash board (the tag given): each arm's change of evaluate (Runner view) between that board without the tag and with it. */
function trashTagChange(after: GameState, given: number) {
  const less = structuredClone(after);
  less.runner.tags -= given;
  return Object.fromEntries(ARMS.map(a => [a, r3(evalIn(A[a], after, 'runner') - evalIn(A[a], less, 'runner'))]));
}
/** The board with the engine's trash cost taken off the Runner's pool (the board the run's price reads the tag on). */
const lessCredits = (s: GameState, n: number) => ({ ...structuredClone(s), runner: { ...structuredClone(s.runner), credits: s.runner.credits - n } });
/** The rig's tagged-risk part on board s (Runner view): base's runnerRigValue less owner's (both outside readers at the untagged rate). */
function rigRisk(s: GameState): number {
  return inCtx(A.base, s, 'runner', st => A.base.ev.runnerRigValue(st) as number) - inCtx(A.owner, s, 'runner', st => A.owner.ev.runnerRigValue(st) as number);
}

/**
 * Part D: the tag's part of trash less keep, under tree t, viewer's context: the two tagsWorth lines, the rig (and by
 * card), the Corp's board, credits and hand; `total` is evaluate's change. With `split`, each rig card's change named by
 * reader (payoutWait: less its change in noWait; perTurn: less its change in noPerTurn), base only.
 */
function trashLessKeep(t: T, trash: GameState, keep: GameState, viewer: 'corp' | 'runner', split: boolean, once: boolean) {
  const sgn = viewer === 'runner' ? 1 : -1;
  const terms = (tree: T, st0: GameState) =>
    inCtx(tree, st0, viewer, st => {
      const rig = [...st.runner.rig.programs, ...st.runner.rig.hardware, ...st.runner.rig.resources];
      return {
        evaluate: tree.ev.evaluate(st, viewer) as number,
        tag: tree.ev.tagsWorth(st, viewer) as number,
        rig: tree.ev.runnerRigValue(st) as number,
        cards: new Map(rig.map((c: CardInstance) => [c.instanceId, tree.ev.addRigCard(st, c, 0) as number])),
        cBoard: tree.ev.corpBoardValue(st, viewer) as number,
        rCredits: tree.vm.sideCreditValue(st, 'runner', viewer) as number,
        rHand: tree.ev.handAndClicks(st, 'runner', viewer) as number,
      };
    });
  const a = terms(t, trash);
  const b = terms(t, keep);
  const byCard: Record<string, any> = {};
  let n0: any, n1: any, m0: any, m1: any;
  if (split) {
    n0 = terms(A.noWait, keep);
    n1 = terms(A.noWait, trash);
    m0 = terms(A.noPerTurn, keep);
    m1 = terms(A.noPerTurn, trash);
  }
  for (const [id, v1] of a.cards) {
    const d = v1 - (b.cards.get(id) ?? 0);
    if (Math.abs(d) < 1e-9) continue;
    const c = S.core.findCardAnywhere(trash, id);
    const name = `${c ? titleOf(c.cardCode) : '?'} ${id}`;
    if (!split) byCard[name] = r3(sgn * d);
    else {
      const dn = (n1.cards.get(id) ?? 0) - (n0.cards.get(id) ?? 0);
      const dm = (m1.cards.get(id) ?? 0) - (m0.cards.get(id) ?? 0);
      byCard[name] = { all: r3(sgn * d), payoutWait: r3(sgn * (d - dn)), perTurn: r3(sgn * (d - dm)), other: r3(sgn * (dn + dm - d)) };
    }
  }
  const dTag = a.tag - b.tag;
  return {
    total: r3(a.evaluate - b.evaluate),
    tagsRunner: r3(-sgn * dTag),
    tagsCorp: once ? 0 : r3(-sgn * dTag),
    rig: r3(sgn * (a.rig - b.rig)),
    corpBoard: r3(-sgn * (a.cBoard - b.cBoard)),
    runnerCredits: r3(sgn * (a.rCredits - b.rCredits)),
    runnerHand: r3(sgn * (a.rHand - b.rHand)),
    byCard,
  };
}

// ------------------------------------------------------------------------------------------------ count mode: a game
type Tally = Record<string, number>;
const inc = (t: Tally, k: string, n = 1) => void (t[k] = (t[k] ?? 0) + n);
const PICKS: (Arm | 'ctl')[] = [...ARMS, 'ctl'];
const treeOf = (a: Arm | 'ctl'): T => (a === 'ctl' ? A.base : A[a]);
const ONCE: Record<Arm, boolean> = { base: false, once: true, resOnly: false, resOnlyOnce: true, owner: false, ownerOnce: true };

function kindOf(s: GameState, method: Method): string {
  if (method === 'chooseRez') return 'rez';
  if (method === 'chooseOffTurn') return 'offTurn';
  if (s.pendingPrompts.length) return 'prompt';
  if (s.activeRun) return 'run';
  return 'main';
}
const isClear = (k: string) => k.includes('"type":"REMOVE_TAG"');

class Game {
  i = 0;
  counts: Tally = {};
  ms: Tally = {};
  untagged = { n: 0, max: 0 };
  /** old150: only the accesses listed are asked. */
  only: Set<string> | null = null;
  constructor(
    public pool: string,
    public src: string
  ) {}
  decide(side: 'corp' | 'runner', method: Method, s: GameState, from: any, own?: () => unknown): unknown {
    const p = s.pendingPrompts.length ? (S.core.activePrompt(s) as any) : undefined;
    if (this.only) {
      const hit = p?.kind === 'access_trash' && this.only.has(`${s.turnNumber}|${p.cardInstanceId}`);
      if (!hit) return own?.();
    }
    const i = this.i++;
    const kind = kindOf(s, method);
    const r: Partial<Record<Arm | 'ctl', { a: string; ms: number }>> = {};
    for (const arm of PICKS) r[arm] = ask(treeOf(arm), side, method, s, from);
    const k = `${side}:${kind}`;
    inc(this.counts, `n ${k}`);
    if (s.runner.tags > 0) inc(this.counts, `n ${k} tagged`);
    for (const arm of PICKS) inc(this.ms, arm, r[arm]!.ms);
    const changed = ARMS.filter(a => a !== 'base' && r[a]!.a !== r.base!.a);
    for (const arm of changed) {
      inc(this.counts, `ch ${arm} ${k}`);
      if (s.runner.tags > 0) inc(this.counts, `ch ${arm} ${k} tagged`);
    }
    if (r.ctl!.a !== r.base!.a) inc(this.counts, `ctl differs ${k}`);
    // The untagged check: on an untagged board resOnly and owner are base, number for number
    if (s.runner.tags === 0 && i % CHECK_EVERY === 0) {
      for (const v of ['corp', 'runner'] as const) {
        const e = evalIn(A.base, s, v);
        for (const arm of ['resOnly', 'owner'] as const) this.untagged.max = Math.max(this.untagged.max, Math.abs(evalIn(A[arm], s, v) - e));
      }
      this.untagged.n++;
    }
    let ownKey: string | undefined;
    let result: unknown;
    if (own) {
      G.__toUnknown = 0;
      result = own();
      ownKey = pickKey(result);
      if (ownKey !== r.base!.a) inc(this.counts, `baseDiffers ${side}`);
    }
    // Part C: clear decisions (a Runner main decision, tagged, a click and 2 credits)
    const clearable = side === 'runner' && kind === 'main' && s.runner.tags > 0 && s.runner.clicks >= 1 && s.runner.credits >= 2;
    let clear: any = undefined;
    if (clearable) {
      inc(this.counts, 'clearable');
      clear = { src: ownKey !== undefined ? isClear(ownKey) : null, ...Object.fromEntries(ARMS.map(a => [a, isClear(r[a]!.a)])) };
      if (clear.src) inc(this.counts, 'clear src');
      for (const a of ARMS) {
        if (clear[a]) inc(this.counts, `clear ${a}`);
        if (clear.src && !clear[a]) inc(this.counts, `clear srcNot ${a}`);
        if (a !== 'base' && clear[a] && !clear.base) inc(this.counts, `clear new ${a}`);
        if (a !== 'base' && !clear[a] && clear.base) inc(this.counts, `clear drop ${a}`);
      }
    }
    // Part D: an access whose trash gives a tag
    const at = p?.kind === 'access_trash' ? { card: p.cardInstanceId, code: S.core.findCardAnywhere(s, p.cardInstanceId)?.cardCode ?? null, trashCost: p.trashCost } : null;
    const answer = (x: string | undefined) => (x && at ? (x.includes('"trash":true') ? 'trash' : x.includes('"trash":false') ? 'keep' : 'alt') : null);
    let tagTrash: any = undefined;
    if (at && at.trashCost != null) {
      inc(this.counts, 'access_trash');
      const t2 = S.core.executeAction(structuredClone(s), { type: 'RESOLVE_PROMPT', player: 'runner', promptId: p.id, choice: { kind: 'access_trash', trash: true } } as GameAction);
      if (t2.runner.tags > s.runner.tags) {
        const t3 = S.core.executeAction(structuredClone(s), { type: 'RESOLVE_PROMPT', player: 'runner', promptId: p.id, choice: { kind: 'access_trash', trash: false } } as GameAction);
        const given = t2.runner.tags - s.runner.tags;
        const card = S.core.findCardAnywhere(s, at.card) as CardInstance;
        tagTrash = {
          tags: given,
          stuck: stuckOn(t2),
          tagCost: { access: tagCosts(s), afterTrash: tagCosts(lessCredits(s, at.trashCost)) },
          oneNumber: trashTagChange(t2, given),
          worthLessTrash: Object.fromEntries(ARMS.map(a => [a, r3(inCtx(A[a], s, 'runner', st => (A[a].ev.corpCardValue(S.core.findCardAnywhere(st, card.instanceId), st, 'runner', true) as number) - (A[a].runs.creditCost(st, at.trashCost) as number)))])),
          parts: Object.fromEntries(ARMS.map(a => [a, { runner: trashLessKeep(A[a], t2, t3, 'runner', a === 'base', ONCE[a]), corp: trashLessKeep(A[a], t2, t3, 'corp', false, ONCE[a]) }])),
        };
      }
    }
    if (changed.length || tagTrash || clear || (ownKey !== undefined && ownKey !== r.base!.a))
      out({
        kind: 'd',
        pool: this.pool,
        src: this.src,
        i,
        T: s.turnNumber,
        side,
        dk: kind,
        prompt: p?.kind ?? null,
        tags: s.runner.tags,
        changed,
        picks: changed.length || tagTrash ? Object.fromEntries(Object.entries(r).map(([a, x]) => [a, x!.a])) : undefined,
        own: ownKey !== undefined && ownKey !== r.base!.a ? ownKey : undefined,
        clear,
        access: tagTrash ? { ...at, title: at!.code ? titleOf(at!.code) : null, tagTrash, answers: Object.fromEntries(Object.entries(r).map(([a, x]) => [a, answer(x!.a)])) } : undefined,
      });
    return result;
  }
  end(extra: Record<string, unknown>) {
    out({ kind: 'g', pool: this.pool, src: this.src, decisions: this.i, counts: this.counts, ms: Object.fromEntries(Object.entries(this.ms).map(([k, v]) => [k, Math.round(v)])), untagged: { n: this.untagged.n, max: this.untagged.max }, toUnknown: G.__toUnknown ?? 0, toUnknownWait: G.__toUnknownWait ?? 0, ...extra });
  }
}

/** The source agents, watched: before each call every arm decides on a copy with the agent's own fields as they are. */
function watched(g: Game, side: 'corp' | 'runner', agent: any): any {
  return new Proxy(agent, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (prop !== 'chooseAction' && prop !== 'chooseRez' && prop !== 'chooseOffTurn') return v;
      return (s: GameState, ...rest: unknown[]) => g.decide(side, prop as Method, s, target, () => v.apply(target, [s, ...rest]));
    },
  });
}

// ------------------------------------------------------------------------------------------------ Part A: the record
interface OpenTag {
  T: number;
  at: number; // the step it was taken at
  first: boolean;
  by: string;
  priced: any;
  lost: number;
  net: number;
  cleared: number;
  how: string[];
  clock?: any;
  trash?: any;
  stuck: boolean;
  board: { tags: number; resources: number; clicks: number; credits: number; active: string };
}
// A turn is one side's turn: the Corp's turn and the Runner's after it share a turnNumber (the round), so a turn is the pair (turnNumber, activePlayer)
class Record3 {
  open: OpenTag[] = [];
  closed: (OpenTag & { end?: string; endT?: number; endActive?: string })[] = [];
  punish: { s: GameState; code: string; on: OpenTag[] } | null = null;
  steps = 0;
  constructor(
    public pool: string,
    public src: string
  ) {}
  private loss(x: number, net: number, how: string, on: OpenTag[] = this.open) {
    for (const o of on) {
      o.lost += x / on.length;
      o.net += net / on.length;
      o.how.push(how);
    }
  }
  step(before: GameState, a: GameAction | null, after: GameState) {
    this.steps++;
    if (this.punish && !after.pendingPrompts.length) {
      const drop = standing(this.punish.s) - standing(after);
      const paid = Math.max(0, this.punish.s.corp.credits - after.corp.credits);
      this.loss(Math.max(0, drop), Math.max(0, drop) - paid, `punish:${this.punish.code}:${r3(drop)}`, this.punish.on);
      this.punish = null;
    }
    if (a && a.player === 'corp' && before.runner.tags > 0 && this.open.length) {
      if (a.type === 'TRASH_RESOURCE') {
        const r = before.runner.rig.resources.find(c => c.instanceId === (a as any).cardInstanceId);
        if (r) {
          const w = resourceWorth(before, r);
          this.loss(w, w - spentBy('corp', before, after), `trash:${r.cardCode}:${r3(w)}`);
        }
      } else if ((a.type === 'PLAY_OPERATION_OR_EVENT' || a.type === 'USE_ABILITY') && (a as any).cardInstanceId && !this.punish) {
        const c = S.core.findCardAnywhere(before, (a as any).cardInstanceId) as CardInstance | undefined;
        if (c && punisher(c.cardCode)) {
          if (after.pendingPrompts.length) this.punish = { s: before, code: c.cardCode, on: [...this.open] };
          else {
            const drop = standing(before) - standing(after);
            const paid = Math.max(0, before.corp.credits - after.corp.credits);
            this.loss(Math.max(0, drop), Math.max(0, drop) - paid, `punish:${c.cardCode}:${r3(drop)}`);
          }
        }
      }
    }
    const d = after.runner.tags - before.runner.tags;
    if (d > 0) {
      const n = before.runner.tags;
      for (let j = 1; j <= d; j++) {
        const bj = j === 1 ? before : { ...structuredClone(before), runner: { ...structuredClone(before.runner), tags: n + j - 1 } };
        const first = n + j - 1 === 0;
        const priced = {
          tagsWorth: { runner: r3(worth(before, 'runner', n + j) - worth(before, 'runner', n + j - 1)), corp: r3(worth(before, 'corp', n + j) - worth(before, 'corp', n + j - 1)) },
          arms: armPrices(bj),
          rigRisk: r3(rigRisk({ ...structuredClone(bj), runner: { ...structuredClone(bj.runner), tags: n + j } }) - (n + j - 1 > 0 ? rigRisk(bj) : 0)),
          tagCost: tagCosts(bj),
        };
        // A tag from a trash (an access_trash answered "trash"): tagCost after the trash is paid, and each arm's change
        // of evaluate between the trash board without this tag and with it (brief, Part A addition 06:41Z)
        const pa: any = a && a.type === 'RESOLVE_PROMPT' && (a as any).choice?.kind === 'access_trash' && (a as any).choice?.trash ? S.core.activePrompt(before) : null;
        const trash = pa && j === 1 ? { trashCost: pa.trashCost, tagCostAfter: tagCosts(lessCredits(before, pa.trashCost ?? 0)), oneNumber: trashTagChange(after, d), card: titleOf(S.core.findCardAnywhere(before, pa.cardInstanceId)?.cardCode ?? '?') } : undefined;
        // A later tag: which branch of the clock's min the board with this many tags takes, each view
        const clock = first ? undefined : { runner: clockBranch({ ...structuredClone(bj), runner: { ...structuredClone(bj.runner), tags: n + j } }, 'runner', n + j), corp: clockBranch({ ...structuredClone(bj), runner: { ...structuredClone(bj.runner), tags: n + j } }, 'corp', n + j) };
        this.open.push({ T: before.turnNumber, at: this.steps, first, by: `${a?.player ?? '?'}:${a?.type ?? '?'}`, priced, lost: 0, net: 0, cleared: 0, how: [], clock, trash, stuck: stuckOn(after), board: { tags: n + j, resources: before.runner.rig.resources.length, clicks: before.runner.clicks, credits: before.runner.credits, active: before.activePlayer } });
      }
    } else if (d < 0) {
      const k = -d;
      const byRunner = a?.player === 'runner';
      const cost = byRunner ? spentBy('runner', before, after) : 0;
      for (const o of this.open.splice(0, k)) {
        o.cleared = cost / k;
        this.closed.push(Object.assign(o, { end: byRunner ? (a?.type === 'REMOVE_TAG' ? 'cleared' : `removed:${a?.type}`) : `removedBy:${a?.player}:${a?.type}`, endT: before.turnNumber, endActive: before.activePlayer }));
      }
    }
  }
  end(final: GameState) {
    for (const o of this.open.splice(0)) this.closed.push(Object.assign(o, { end: final.winner ? 'keptToEnd' : 'keptToStop', endT: final.turnNumber }));
    for (const o of this.closed) {
      // Outcome: cleared the turn it was taken (same turnNumber), cleared later, kept to the end, removed otherwise
      const outcome = o.end === 'cleared' ? (o.endT === o.T && o.endActive === o.board.active ? 'clearedSameTurn' : 'clearedLater') : o.end === 'keptToEnd' || o.end === 'keptToStop' ? 'keptToEnd' : 'removedOtherwise';
      out({ kind: 'tag', pool: this.pool, src: this.src, T: o.T, endT: o.endT, first: o.first, by: o.by, end: o.end, outcome, lost: r3(o.lost), net: r3(o.net), cleared: r3(o.cleared), cost: r3(o.lost + o.cleared), how: o.how, priced: o.priced, clock: o.clock, trash: o.trash, stuck: o.stuck, board: o.board });
    }
  }
}

// ------------------------------------------------------------------------------------------------ sources
type Rec = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(t: T, rec: Rec): GameState {
  const c = DECK_POOL.find(d => d.side === 'corp' && d.name === rec.corpDeck);
  const r = DECK_POOL.find(d => d.side === 'runner' && d.name === rec.runnerDeck);
  if (!c || !r) throw new Error(`deal ${rec.seed}: deck not found (${rec.corpDeck} v ${rec.runnerDeck})`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(rec.seed, c, r));
}
const key = (a: unknown) => JSON.stringify(a ?? null);
const RUNS: Record<string, string> = { batch: '45553599707', nrdb: '45555227992' };

function countDeal(pool: string, rec: Rec, only?: Set<string>) {
  const t0 = performance.now();
  S.clear();
  const src = `${pool}:${rec.seed}`;
  const g = new Game(pool, src);
  if (only) g.only = only;
  const rec3 = only ? null : new Record3(pool, src);
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  const run = new S.po.GameRunner(dealStateOf(S, rec), { corp: watched(g, 'corp', S.ai.createAgent('corp', 'normal')), runner: watched(g, 'runner', S.ai.createAgent('runner', 'normal')) });
  let steps = 0;
  for (let n = 0; n < 4000; n++) {
    const s: GameState = run.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    if (!run.step()) break;
    steps++;
    rec3?.step(s, run.last ?? null, run.state);
  }
  rec3?.end(run.state);
  const matches = (run.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
  g.end({ steps, matchesBatch: only ? undefined : matches, winner: run.state.winner ?? null, gameMs: Math.round(performance.now() - t0) });
}

const PEOPLE_DIRS = ['tests/fixtures/human-games', 'tests/fixtures/runner-facts/issues', 'tests/fixtures/runner-issues'];
const peopleFiles = (): string[] => [
  ...readdirSync(PEOPLE_DIRS[0])
    .filter(f => f.endsWith('.json'))
    .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')))
    .map(f => join(PEOPLE_DIRS[0], f)),
  ...PEOPLE_DIRS.slice(1).flatMap(dir => readdirSync(dir).filter(x => /^issue-(58|59|64|66|67)\.json$/.test(x)).sort().map(f => join(dir, f))),
];

/** A recorded game replayed move by move; at each decision board GameRunner would ask of an agent, the arms decide (as tags-once). */
function person(file: string) {
  const t0 = performance.now();
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const name = file.split('/').pop()!.replace('.json', '');
  const src = `people:${file.includes('human-games') ? 'human' : 'issue'}:${name}`;
  if (!r.moves?.length) return out({ kind: 'skip', pool: 'people', src, why: 'no moves' });
  const g = new Game('people', src);
  const rec3 = new Record3('people', src);
  let s: GameState = S.core.createInitialGameState(S.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  if (r.startsAt === 'state') s = structuredClone(r.state);
  const watcher: any = S.ai.createAgent('runner', 'normal');
  let replayed = 0;
  let err: string | null = null;
  for (const move of r.moves as GameAction[]) {
    watcher.observe?.(s);
    const side = S.core.actingSide(s) as 'corp' | 'runner' | null;
    const w = s.priority;
    if (side && side === move.player && !s.winner) {
      let method: Method | null = 'chooseAction';
      if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
        const asked = S.core.wantsStop({ ...s, stops: { corp: 'ai', runner: 'ai' } }, side, w);
        method = asked && side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server') ? 'chooseRez' : asked && side === 'runner' && w.step === 'corp_action' ? 'chooseOffTurn' : null;
      }
      if (method) g.decide(side, method, s, side === 'runner' ? watcher : null, () => move);
    }
    let next: GameState;
    try {
      next = S.core.executeAction(s, move);
    } catch (e) {
      err = (e as Error).message.slice(0, 120);
      break;
    }
    rec3.step(s, move, next);
    s = next;
    replayed++;
  }
  rec3.end(s);
  g.end({ moves: r.moves.length, replayed, err, gameMs: Math.round(performance.now() - t0) });
}

/** The #58 pin's board (tests/runnerDecidedTwice.test.ts boardAt(58, 3)): played on to the end of T6 (as tags-once). */
function issue58() {
  const t0 = performance.now();
  const r = JSON.parse(readFileSync('tests/fixtures/runner-facts/issues/issue-58.json', 'utf8'));
  let s: GameState = S.core.createInitialGameState(S.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  const runner: any = S.ai.createAgent('runner', 'normal');
  let found = false;
  for (const move of r.moves as GameAction[]) {
    if (s.turnNumber === 3 && s.activePlayer === 'runner' && move.type === 'INITIATE_RUN') {
      found = true;
      break;
    }
    runner.observe?.(s);
    s = S.core.executeAction(s, move);
  }
  if (!found) return out({ kind: 'err', pool: 'issue58', src: 'issue58', error: 'no Runner run in T3' });
  S.clear();
  const g = new Game('issue58', 'issue58:T3-T6');
  const rec3 = new Record3('issue58', 'issue58:T3-T6');
  const run = new S.po.GameRunner(structuredClone(s), { corp: watched(g, 'corp', S.ai.createAgent('corp', 'normal')), runner: watched(g, 'runner', runner) });
  let steps = 0;
  for (let n = 0; n < 4000 && run.state.turnNumber <= 6 && !run.state.winner; n++) {
    const b: GameState = run.state;
    if (!run.step()) break;
    steps++;
    rec3.step(b, run.last ?? null, run.state);
  }
  rec3.end(run.state);
  g.end({ steps, T: run.state.turnNumber, gameMs: Math.round(performance.now() - t0) });
}

/**
 * #58's recorded boards (as the rework's probe-plaza58.ts reads them: each Runner run start of T3 to T6 in the recorded
 * game, on runnerDecisionView): for every Public Access Plaza in a root, under each arm, the Plaza's worth less its trash
 * (corpCardValue(card, view, 'runner', true) - creditCost(trash)), tagCost on the board and after the trash is paid, and
 * the whole change of evaluate for one more tag (Runner view).
 */
function issue58rec() {
  const r = JSON.parse(readFileSync('tests/fixtures/runner-facts/issues/issue-58.json', 'utf8'));
  let s: GameState = S.core.createInitialGameState(S.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  for (const move of r.moves as GameAction[]) {
    if (s.turnNumber > 6) break;
    if (s.activePlayer === 'runner' && move.type === 'INITIATE_RUN' && s.turnNumber >= 3 && !s.activeRun) {
      const view: GameState = A.base.tp.runnerDecisionView(structuredClone(s));
      for (const sv of Object.values(view.corp.servers) as any[])
        for (const c of sv.root as CardInstance[]) {
          if (c.cardCode !== '35062') continue;
          const cost = S.ce.trashCost(view, c) ?? 0;
          const arms = Object.fromEntries(
            ARMS.map(a => {
              const t = A[a];
              const worthLess = inCtx(t, view, 'runner', st => (t.ev.corpCardValue(S.core.findCardAnywhere(st, c.instanceId), st, 'runner', true) as number) - (t.runs.creditCost(st, cost) as number));
              const plus = structuredClone(view);
              plus.runner.tags += 1;
              return [a, { worthLessTrash: r3(worthLess), tagCost: r3(tagCostIn(t, view)), tagCostAfterTrash: r3(tagCostIn(t, lessCredits(view, cost))), evalTag: r3(evalIn(t, view, 'runner') - evalIn(t, plus, 'runner')) }];
            })
          );
          out({ kind: 'p58', T: view.turnNumber, clicks: view.runner.clicks, credits: view.runner.credits, tags: view.runner.tags, server: sv.id, cost, target: (move as any).targetServerId, arms });
        }
    }
    s = S.core.executeAction(s, move);
  }
}

// ------------------------------------------------------------------------------------------------ legs mode (Part B)
const hash = (x: string) => {
  let h = 2166136261;
  for (let i = 0; i < x.length; i++) h = Math.imul(h ^ x.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};
const seedFor = (k: number, s: number) => (Math.imul(s ^ (k * 0x9e3779b1), 2654435761) >>> 0) || 1;

interface LegRead {
  first: string; // the Runner's action at the unit board
  took: { trash: number; punish: number; other: string[] }; // what the Corp took with a tag through its next turn
  takes: string[];
  corpSpent: number;
  corpCould: boolean; // the Corp had a click, 2 credits and a resource to trash while the Runner was tagged
  corpTrashed: number;
  at: any; // the board at the start of the Runner's next turn
  end?: any;
  steps: number;
  ms: number;
  trace?: string[];
}
/** One leg from board s0: `clear` plays REMOVE_TAG first; `keep` plays the source action given, or with `bar` the Runner's own pick with REMOVE_TAG barred until its next turn begins. */
function leg(s0: GameState, k: number, mode: 'clear' | 'keepBar' | 'keepAs', srcAction: GameAction | null, agents: { corp: any; runner: any }): LegRead {
  const t0 = performance.now();
  const L = A.legs;
  const s = structuredClone(s0);
  if (k > 0) {
    // HIDDEN-READ (the measuring script): seed k reshuffles R&D and the stack and reseeds the game's rng, both legs alike
    s.id = `${s.id}~${k}`;
    s.rng = L.core.createRng(seedFor(k, s.rng.seed));
    L.core.shuffleInPlace(s.rng, s.corp.rd);
    L.core.shuffleInPlace(s.rng, s.runner.stack);
  }
  L.clear();
  const runner: any = L.ai.createAgent('runner', 'normal');
  copySnap(agents.runner, runner);
  const corp: any = L.ai.createAgent('corp', 'normal');
  copySnap(agents.corp, corp);
  const g = new L.po.GameRunner(s, { runner, corp });
  const T = s0.turnNumber;
  const trace: string[] = [];
  // The first action
  let first: GameAction;
  if (mode === 'clear') first = { type: 'REMOVE_TAG', player: 'runner' } as GameAction;
  else if (mode === 'keepAs') first = srcAction!;
  else {
    G.__tagOwnerBar = true;
    try {
      first = runner.chooseAction(g.state);
    } finally {
      G.__tagOwnerBar = false;
    }
  }
  g.apply(first);
  const firstKey = `${first.type}${(first as any).targetServerId ? ':' + (first as any).targetServerId : ''}${(first as any).cardInstanceId ? ':' + (S.core.findCardAnywhere(s, (first as any).cardInstanceId)?.cardCode ?? '') : ''}`;
  if (TRACE) trace.push(`T${T} runner ${firstKey} | tags ${g.state.runner.tags} clicks ${g.state.runner.clicks} cr ${g.state.runner.credits}`);
  const took = { trash: 0, punish: 0, other: [] as string[] };
  const takes: string[] = [];
  let corpSpent = 0;
  let corpCould = false;
  let corpTrashed = 0;
  let punishWin: { s: GameState; code: string } | null = null;
  let seenCorp = false;
  let at: any = null;
  let fate: { T: number; active: string; by: string } | null = null;
  let steps = 1;
  const snap = (st: GameState) => ({ T: st.turnNumber, rc: st.runner.credits, rk: st.runner.clicks, grip: st.runner.grip.length, rig: st.runner.rig.programs.length + st.runner.rig.hardware.length + st.runner.rig.resources.length, res: st.runner.rig.resources.length, tags: st.runner.tags, rs: st.runner.score, cs: st.corp.score, cc: st.corp.credits, w: st.winner ?? null, ev: st.winner ? null : r3(evalIn(A.base, st, 'runner')) });
  const barOn = () => mode === 'keepBar' && !seenCorp;
  for (; steps < 8000 && !g.state.winner; steps++) {
    const before: GameState = g.state;
    if (before.activePlayer === 'corp') seenCorp = true;
    // The Runner's next turn begins: B.1's read
    if (!at && seenCorp && before.activePlayer === 'runner') {
      at = snap(before);
      if (!TO_END) break;
    }
    if (!at && before.activePlayer === 'corp' && before.runner.tags > 0 && before.corp.clicks >= 1 && before.corp.credits >= 2 && before.runner.rig.resources.length > 0 && !before.activeRun) corpCould = true;
    G.__tagOwnerBar = barOn();
    let more: boolean;
    try {
      more = g.step();
    } finally {
      G.__tagOwnerBar = false;
    }
    if (!more) break;
    const a: any = g.last;
    const after: GameState = g.state;
    // What became of the tag after B.1's read (coordinator 08:23Z): the first step that leaves the Runner untagged
    if (at && !fate && after.runner.tags === 0 && before.runner.tags > 0) fate = { T: before.turnNumber, active: before.activePlayer, by: `${a.player}:${a.type}` };
    if (!at) {
      if (TRACE && (a.player === 'corp' || a.type !== 'PASS')) trace.push(`T${before.turnNumber} ${a.player} ${a.type}${a.targetServerId ? ':' + a.targetServerId : ''}${a.cardInstanceId ? ':' + titleOf(S.core.findCardAnywhere(before, a.cardInstanceId)?.cardCode ?? '?') : ''}${a.choice ? ' ' + JSON.stringify(a.choice).slice(0, 60) : ''} | tags ${after.runner.tags} res ${after.runner.rig.resources.length} cc ${after.corp.credits} ck ${after.corp.clicks}`);
      if (punishWin && !after.pendingPrompts.length) {
        const drop = standing(punishWin.s) - standing(after);
        took.punish += Math.max(0, drop);
        corpSpent += spentBy('corp', punishWin.s, after);
        takes.push(`punish:${titleOf(punishWin.code)}:${r3(drop)}`);
        punishWin = null;
      }
      if (a.player === 'corp' && before.runner.tags > 0) {
        if (a.type === 'TRASH_RESOURCE') {
          const r = before.runner.rig.resources.find(c => c.instanceId === a.cardInstanceId);
          if (r) {
            const w = resourceWorth(before, r);
            took.trash += w;
            corpTrashed++;
            corpSpent += spentBy('corp', before, after);
            takes.push(`trash:${titleOf(r.cardCode)}:${r3(w)}`);
          }
        } else if ((a.type === 'PLAY_OPERATION_OR_EVENT' || a.type === 'USE_ABILITY') && a.cardInstanceId && !punishWin) {
          const c = S.core.findCardAnywhere(before, a.cardInstanceId) as CardInstance | undefined;
          if (c && punisher(c.cardCode)) {
            if (after.pendingPrompts.length) punishWin = { s: before, code: c.cardCode };
            else {
              const drop = standing(before) - standing(after);
              took.punish += Math.max(0, drop);
              corpSpent += spentBy('corp', before, after);
              takes.push(`punish:${titleOf(c.cardCode)}:${r3(drop)}`);
            }
          }
        }
      }
    }
  }
  if (!at) at = snap(g.state);
  const end = TO_END ? { w: g.state.winner ?? null, rp: g.state.runner.score, cp: g.state.corp.score, T: g.state.turnNumber, tags: g.state.runner.tags, fate } : undefined;
  return { first: firstKey, took: { trash: r3(took.trash) as number, punish: r3(took.punish) as number, other: took.other }, takes, corpSpent: r3(corpSpent) as number, corpCould, corpTrashed, at, end, steps, ms: Math.round(performance.now() - t0), trace: TRACE ? trace : undefined };
}

function legsDeal(pool: string, rec: Rec) {
  const t0 = performance.now();
  S.clear();
  const src = `${pool}:${rec.seed}`;
  const ag = { corp: S.ai.createAgent('corp', 'normal'), runner: S.ai.createAgent('runner', 'normal') };
  const run = new S.po.GameRunner(dealStateOf(S, rec), ag);
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  let steps = 0;
  let units = 0;
  let mirrors = 0;
  let mirrorCands = 0;
  let di = 0;
  // The units of this deal are played after the source game ends (the source's agents and caches are never touched by a
  // leg: each leg copies their fields at the unit board into fresh agents of the legs tree)
  const todo: { kind: 'clear' | 'mirror'; s0: GameState; src: GameAction; agents: { corp: any; runner: any }; di: number; stuck: boolean | null }[] = [];
  // The open tags' `stuck` at arrival, oldest first (FIFO, as the record): a unit's tag is the oldest open one
  const arrived: boolean[] = [];
  for (let n = 0; n < 4000; n++) {
    const s: GameState = run.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const mainRunner = S.core.actingSide(s) === 'runner' && s.activePlayer === 'runner' && !s.pendingPrompts.length && !s.activeRun && !(s.priority && s.priority.holder !== s.activePlayer);
    const snapAgents = mainRunner && s.runner.tags > 0 ? { corp: structuredClone(fieldsOf(ag.corp)), runner: structuredClone(fieldsOf(ag.runner)) } : null;
    if (!run.step()) break;
    steps++;
    const dt = run.state.runner.tags - s.runner.tags;
    const unitStuck = arrived.length ? arrived[0] : null;
    if (dt > 0) for (let j = 0; j < dt; j++) arrived.push(stuckOn(run.state));
    else if (dt < 0) arrived.splice(0, -dt);
    if (snapAgents) {
      const a = run.last as GameAction;
      di++;
      if (a.type === 'REMOVE_TAG') {
        if (!UNITS || units < UNITS) todo.push({ kind: 'clear', s0: s, src: a, agents: snapAgents, di, stuck: unitStuck });
        units++;
      } else if (s.runner.clicks >= 1 && s.runner.credits >= 2) {
        mirrorCands++;
        if (MIRROR_P > 0 && hash(`${src}#${di}`) < MIRROR_P) {
          todo.push({ kind: 'mirror', s0: s, src: a, agents: snapAgents, di, stuck: unitStuck });
          mirrors++;
        }
      }
    }
  }
  const matches = (run.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
  const gameMs = Math.round(performance.now() - t0);
  for (const u of todo) {
    const s0 = u.s0;
    const base = {
      kind: 'u',
      unit: u.kind,
      pool,
      src,
      di: u.di,
      T: s0.turnNumber,
      split: { resource: s0.runner.rig.resources.length > 0, punisher: punisherView(s0, u.agents.runner.memory), first: s0.runner.tags === 1, lastClick: s0.runner.clicks === 1, stuck: u.stuck, tags: s0.runner.tags, clicks: s0.runner.clicks, credits: s0.runner.credits },
      srcAction: u.src.type,
      beside: { lossPerTurn: mapR3(lossPerTurn(s0)), rigRisk: r3(rigRisk(s0)), clearCost: r3(clearCost(s0)), tagsWorth: { runner: r3(worth(s0, 'runner', s0.runner.tags)), corp: r3(worth(s0, 'corp', s0.runner.tags)) } },
    };
    const legs: any[] = [];
    for (let k = 0; k < SEEDS; k++) {
      try {
        const keep = u.kind === 'clear' ? leg(s0, k, 'keepBar', null, u.agents) : leg(s0, k, 'keepAs', u.src, u.agents);
        const clear = leg(s0, k, 'clear', null, u.agents);
        legs.push({ k, keep, clear });
      } catch (err) {
        legs.push({ k, error: (err as Error).stack?.slice(0, 400) });
      }
    }
    out({ ...base, legs });
  }
  out({ kind: 'g', pool, src, steps, units, mirrors, mirrorCands, tagged: di, matchesBatch: matches, gameMs, ms: Math.round(performance.now() - t0) });
}
const mapR3 = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r3(v)]));
/** A snapshot from fieldsOf into a fresh agent: a field that is a class instance in the fresh agent gets the snapshot's fields. */
function copySnap(from: any, to: any) {
  for (const k of Object.keys(from)) {
    const v = structuredClone(from[k]);
    if (classInstance(to[k]) && v && typeof v === 'object') Object.assign(to[k], v);
    else to[k] = v;
  }
}
/** An agent's own (non-function) fields, for copying into a leg's fresh agents. */
function fieldsOf(agent: any): any {
  const o: any = {};
  for (const k of Object.keys(agent)) {
    const v = agent[k];
    if (typeof v === 'function') continue;
    o[k] = classInstance(v) ? { ...v } : v;
  }
  return o;
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const names: TreeName[] = MODE === 'legs' ? ['source', 'legs', 'base', 'owner'] : ['source', ...ARMS, 'noWait', 'noPerTurn'];
  const dirs = makeTrees(root, names);
  S = await loadTree('source', dirs.source);
  for (const n of names.slice(1)) (A as any)[n] = await loadTree(n, dirs[n]);
  const started = Date.now();
  const sources: { pool: string; id: any; only?: Set<string> }[] = [];
  for (const pool of POOLS) {
    if (pool === 'batch' || pool === 'nrdb') {
      const recs: Rec[] = JSON.parse(readFileSync(`scripts/tag-owner/deals-${RUNS[pool]}.json`, 'utf8'));
      for (const r of recs) if (!DEALS.length || DEALS.includes(String(r.seed))) sources.push({ pool, id: r });
    } else if (pool === 'people') for (const f of peopleFiles()) sources.push({ pool, id: f });
    else if (pool === 'issue58') sources.push({ pool, id: null });
    else if (pool === 'old150') {
      // The 16 declined Plaza accesses (18 entries, 16 units) of the decided-twice count, on their old deals
      const list: { src: string; T: number; card: string; title: string }[] = JSON.parse(readFileSync('scripts/tags-once/declined-150.json', 'utf8'));
      const plaza = list.filter(x => x.title === 'Public Access Plaza');
      const old: Record<string, string> = { batch: '45499791395', nrdb: '45503877309' };
      for (const [p, run] of Object.entries(old)) {
        const recs: Rec[] = JSON.parse(readFileSync(`scripts/runner-rework/decided-twice-deals-${run}.json`, 'utf8'));
        for (const r of recs) {
          const hits = plaza.filter(x => x.src === `${p}:${r.seed}`);
          if (hits.length) sources.push({ pool: 'old150', id: { ...r, oldPool: p }, only: new Set(hits.map(x => `${x.T}|${x.card}`)) });
        }
      }
    } else throw new Error(`unknown pool ${pool}`);
  }
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    if (Date.now() - started > MAX_MS) break;
    try {
      if (MODE === 'legs') legsDeal(src.pool, src.id);
      else if (src.pool === 'people') person(src.id);
      else if (src.pool === 'issue58') {
        issue58rec();
        issue58();
      }
      else if (src.pool === 'old150') countDeal(`old150:${src.id.oldPool}`, src.id, src.only);
      else countDeal(src.pool, src.id);
    } catch (err) {
      out({ kind: 'err', pool: src.pool, src: typeof src.id === 'string' ? src.id : (src.id?.seed ?? src.pool), error: (err as Error).stack?.slice(0, 500) });
    }
  }
  out({ kind: 's', shard, mode: MODE, ms: Date.now() - started, rss: Math.round(process.memoryUsage().rss / 1e6) });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
