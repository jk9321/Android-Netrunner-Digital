/**
 * Count of "a tag priced twice" (brief /mnt/project-files/netrunner-ai/tags-once/brief.md rev 0, tracker F104 c). Counts
 * only: nothing in src or tests changes. Trees in trees.ts (source plays, base / once / onceR / onceNoWait are asked).
 *
 * The lead: evaluate(state, side) = sideStrength(side) - sideStrength(other); the Corp's strength adds tagsWorth
 * (src/ai/evaluate.ts:487) and the Runner's subtracts it (:498), so the difference holds a tag at twice tagsWorth.
 *
 * (1)(2) At every decision the source game asks of an agent (GameRunner.step: chooseAction, chooseRez, chooseOffTurn),
 *        each arm decides on a structuredClone: a fresh Normal agent of that arm's tree, given a copy of the source
 *        agent's own fields at that moment (memory, held line, plan memory, free-action guard), every cache of that tree
 *        cleared first. Its pick is compared with base's. Base against the source's own pick is the self-check (the
 *        source keeps its caches over the game; base starts clean each time). onceR: evaluate on every decision board,
 *        both sides, against once (the same arm if equal), and its pick on every 10th decision.
 * (3)    The record as the oracle: every tag the Runner takes in the source game, what it then cost (FIFO over open tags):
 *        cleared (the clicks and credits the clearing action spent, at base's clickPrice and sideCreditValue on that
 *        board); kept while the Corp trashed a resource (TRASH_RESOURCE: the resource's worth by tagLoss's own owner,
 *        addRigCard plus its share of the board plans) or used a tag punisher (a Corp action on a card whose synergy has
 *        `ifTagged`: the drop of the Runner's strength without its tag term, from the action until no prompt is left);
 *        a loss is split over the tags open then. Beside it, on the board the tag was taken from: tagsWorth's price of
 *        that tag (tagsWorth(before, v, n + 1) - tagsWorth(before, v, n), as runs.ts tagCost prices taking one), both views.
 * (4)    ms per ask, per arm.
 *
 * Pools (never summed): batch (the 221 g1 base deals of 45499791395), nrdb (the 110 of 45503877309), people (the
 * recorded games in tests/fixtures/human-games and the issue files decided-twice.ts reads, replayed move by move, each
 * side's recorded decision boards asked), issue58 (the #58 pin's board, tests/runnerDecidedTwice.test.ts: the saved game
 * at the Runner's first run of T3, played on by GameRunner to the end of T6 with the Runner that watched it).
 * The 150 declined trashes of the decided-twice count (run 45527869250, T4 declined, batch and nrdb) are marked on the
 * access_trash decisions they are (declined-150.json: src, turn, card).
 *
 * HIDDEN-READ (the measuring script, never an agent): count 3 prices the real board (the record). The agents asked see
 * what the source agent saw (its own fields) and decide on their own views, as the source does.
 *
 *   SHARD=0/64 POOL=batch,nrdb,people,issue58 npx vite-node scripts/tags-once/count.ts
 *   ARGS="POOL=batch DEALS=1001,1011,1021" (the fire count)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CardInstance, GameAction, GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { ARMS, Arm, makeTrees } from './trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const POOLS = (process.env.POOL ?? 'batch,nrdb,people,issue58').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity);
/** onceR's pick on every k-th decision (its evaluate on every one). */
const R_EVERY = Number(process.env.R_EVERY ?? 10);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/tags-once', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r3 = (x: number | null | undefined): number | string | null =>
  x === null || x === undefined ? null : Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x > 0 ? 'Inf' : '-Inf';
const PICK_ARMS: Arm[] = ['base', 'once', 'onceNoWait', 'onceNoRisk'];

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
  clear: () => void;
}
async function loadTree(name: string, dir: string): Promise<T> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const files = ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/evaluate.ts', 'ai/handValues.ts', 'ai/valueModel.ts', 'ai/effectValues.ts', 'ai/iceValues.ts', 'ai/threatModel.ts', 'ai/pricing.ts', 'ai/cardPlans.ts', 'ai/synergyTags.ts'];
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of files) mods.push(await m(p));
  const [ai, po, core, decks, ev, hv, vm, fx, iv, tm, pricing, plans, syn] = mods;
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
const A = {} as Record<Arm, T>;

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
function ask(arm: Arm, side: 'corp' | 'runner', method: Method, s: GameState, from: any): { a: string; ms: number } {
  const t = A[arm];
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

// ------------------------------------------------------------------------------------------------ decision boards
function kindOf(s: GameState, side: 'corp' | 'runner', method: Method): string {
  if (method === 'chooseRez') return 'rez';
  if (method === 'chooseOffTurn') return 'offTurn';
  if (s.pendingPrompts.length) return 'prompt';
  if (s.activeRun) return 'run';
  return 'main';
}
const synOf = (t: T, code: string) => {
  try {
    return t.syn.cardSynergy(t.core.getCardDefinition(code)) ?? {};
  } catch {
    return {};
  }
};
const tagGiving = (code: string) => {
  const y = synOf(A.base, code);
  return (y.gives?.tags ?? 0) > 0 || (y.when ?? []).includes('ifTagged');
};
const punisher = (code: string) => (synOf(A.base, code).when ?? []).includes('ifTagged');
/** A board "with a tag": a tag in play, or a tag-giving card (gives tags, or pays off a tagged Runner) in HQ or on the Corp's board. */
function tagBoard(s: GameState): boolean {
  if (s.runner.tags > 0) return true;
  const cards: CardInstance[] = [...s.corp.hq, ...Object.values(s.corp.servers).flatMap((v: any) => [...v.ice, ...v.root])];
  return cards.some(c => tagGiving(c.cardCode));
}


// ------------------------------------------------------------------------------------------------ rev 1: one more tag, in parts
/**
 * Brief rev 1: the change of evaluate(·, viewer) for one more tag on board `b` (b with runner.tags + 1, nothing else),
 * in parts, each signed as it enters evaluate(·, viewer): the Runner's tag term (evaluate.ts:498), the Corp's
 * (evaluate.ts:487), the rig (runnerRigValue) split by rig card (addRigCard from 0, as tagLoss and the rework's
 * trash-readers.ts read a card's own term) with each card's part named by its reader (payoutWait's tagged risk: the card's
 * change less the same card's change in the onceNoWait tree, where that risk is off; perTurn's tagged risk, effectValues.ts:115:
 * the same in the noPerTurn tree; the rest of the card's change: "other"), the rig's rest (coverage, board plans), and the other sideStrength terms. The remainder ("unsplit") is the
 * Runner's damage clock, points and core damage, and the Corp's points and counters. Base tree, viewer's context.
 */
function tagSplit(b: GameState, viewer: 'corp' | 'runner') {
  const t = A.base;
  const w = A.onceNoWait;
  const q = A.noPerTurn;
  const plus = structuredClone(b);
  plus.runner.tags += 1;
  const sgn = viewer === 'runner' ? 1 : -1; // a Runner-strength term enters the Runner's evaluate with +, the Corp's with -
  const inCtx = <X>(tree: T, st: GameState, f: () => X): X =>
    tree.pricing.asSide(viewer, () => {
      tree.hv.decisionContext(st, viewer);
      return f();
    });
  const terms = (tree: T, st0: GameState) => {
    tree.clear();
    const st = structuredClone(st0);
    return inCtx(tree, st, () => {
      const rig = [...st.runner.rig.programs, ...st.runner.rig.hardware, ...st.runner.rig.resources];
      return {
        evaluate: tree.ev.evaluate(st, viewer) as number,
        tag: tree.ev.tagsWorth(st, viewer) as number,
        rig: tree.ev.runnerRigValue(st) as number,
        cards: new Map(rig.map((c: CardInstance) => [c.instanceId, tree.ev.addRigCard(st, c, 0) as number])),
        rCredits: tree.vm.sideCreditValue(st, 'runner', viewer) as number,
        rHand: tree.ev.handAndClicks(st, 'runner', viewer) as number,
        cCredits: tree.vm.sideCreditValue(st, 'corp', viewer) as number,
        cHand: tree.ev.handAndClicks(st, 'corp', viewer) as number,
        cBoard: tree.ev.corpBoardValue(st, viewer) as number,
      };
    });
  };
  const a0 = terms(t, b);
  const a1 = terms(t, plus);
  const n0 = terms(w, b);
  const n1 = terms(w, plus);
  const m0 = terms(q, b);
  const m1 = terms(q, plus);
  const total = a1.evaluate - a0.evaluate;
  const dTag = a1.tag - a0.tag;
  const byCard: Record<string, { all: number; payoutWait: number; perTurn: number; other: number }> = {};
  let cardsSum = 0;
  for (const [id, v0] of a0.cards) {
    const d = (a1.cards.get(id) ?? 0) - v0;
    const dn = (n1.cards.get(id) ?? 0) - (n0.cards.get(id) ?? 0);
    const dm = (m1.cards.get(id) ?? 0) - (m0.cards.get(id) ?? 0);
    cardsSum += d;
    if (Math.abs(d) > 1e-9) {
      const c = S.core.findCardAnywhere(b, id);
      byCard[`${c ? S.core.getCardDefinition(c.cardCode).title : '?'} ${id}`] = { all: r3(sgn * d) as number, payoutWait: r3(sgn * (d - dn)) as number, perTurn: r3(sgn * (d - dm)) as number, other: r3(sgn * (dn + dm - d)) as number };
    }
  }
  const dRig = a1.rig - a0.rig;
  const p = {
    tagsRunner: -sgn * dTag,
    tagsCorp: -sgn * dTag,
    rig: sgn * dRig,
    rigRest: sgn * (dRig - cardsSum),
    runnerCredits: sgn * (a1.rCredits - a0.rCredits),
    runnerHand: sgn * (a1.rHand - a0.rHand),
    corpCredits: -sgn * (a1.cCredits - a0.cCredits),
    corpHand: -sgn * (a1.cHand - a0.cHand),
    corpBoard: -sgn * (a1.cBoard - a0.cBoard),
  };
  const unsplit = total - (p.tagsRunner + p.tagsCorp + p.rig + p.runnerCredits + p.runnerHand + p.corpCredits + p.corpHand + p.corpBoard);
  return { viewer, total: r3(total), ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, r3(v)])), unsplit: r3(unsplit), payoutWait: r3(Object.values(byCard).reduce((n, c) => n + c.payoutWait, 0)), perTurn: r3(Object.values(byCard).reduce((n, c) => n + c.perTurn, 0)), byCard, game: b.winner ? 'over' : undefined };
}

type Tally = Record<string, number>;
const inc = (t: Tally, k: string, n = 1) => void (t[k] = (t[k] ?? 0) + n);

let declined150 = new Set<string>();

class Game {
  i = 0;
  counts: Tally = {};
  ms: Tally = {};
  evMax = 0;
  constructor(
    public pool: string,
    public src: string
  ) {}
  /** One decision: every pick arm on a copy; onceR's evaluate (and every R_EVERY-th its pick). */
  decide(side: 'corp' | 'runner', method: Method, s: GameState, from: any, own?: () => unknown): unknown {
    const i = this.i++;
    const kind = kindOf(s, side, method);
    const tb = tagBoard(s);
    const p = s.pendingPrompts.length ? (S.core.activePrompt(s) as any) : undefined;
    const r: Partial<Record<Arm, { a: string; ms: number }>> = {};
    for (const arm of PICK_ARMS) r[arm] = ask(arm, side, method, s, from);
    if (i % R_EVERY === 0) r.onceR = ask('onceR', side, method, s, from);
    // onceR is the same arm as once if evaluate agrees on the board, both sides
    for (const v of ['corp', 'runner'] as const) this.evMax = Math.max(this.evMax, Math.abs(evalIn(A.once, s, v) - evalIn(A.onceR, s, v)));
    const k = `${side}:${kind}`;
    inc(this.counts, `n ${k}`);
    if (tb) inc(this.counts, `n ${k} tagBoard`);
    for (const arm of Object.keys(r) as Arm[]) inc(this.ms, arm, r[arm]!.ms);
    if (r.onceR) {
      inc(this.counts, 'onceR asked');
      if (r.onceR.a !== r.once!.a) inc(this.counts, 'onceR differs from once');
    }
    const changed = PICK_ARMS.filter(a => a !== 'base' && r[a]!.a !== r.base!.a);
    for (const arm of changed) {
      inc(this.counts, `ch ${arm} ${k}`);
      if (tb) inc(this.counts, `ch ${arm} ${k} tagBoard`);
    }
    const at = p?.kind === 'access_trash' ? { card: p.cardInstanceId, code: S.core.findCardAnywhere(s, p.cardInstanceId)?.cardCode ?? null, trashCost: p.trashCost } : null;
    const d150 = at ? declined150.has(`${this.src}|${s.turnNumber}|${at.card}`) : false;
    const answer = (x: string | undefined) => (x && at ? (x.includes('"trash":true') ? 'trash' : x.includes('"trash":false') ? 'keep' : 'alt') : null);
    // Rev 1: an access whose trash gives a tag (the engine applies the trash on a copy), and the split for one more tag there
    let tagTrash: any = undefined;
    if (at && at.trashCost != null) {
      const t2 = S.core.executeAction(structuredClone(s), { type: 'RESOLVE_PROMPT', player: 'runner', promptId: p.id, choice: { kind: 'access_trash', trash: true } } as GameAction);
      if (t2.runner.tags > s.runner.tags) tagTrash = { tags: t2.runner.tags - s.runner.tags, runner: tagSplit(s, 'runner'), corp: tagSplit(s, 'corp') };
    }
    if (at) {
      inc(this.counts, 'access_trash');
      if (d150) inc(this.counts, 'access_trash d150');
    }
    let ownKey: string | undefined;
    let result: unknown;
    if (own) {
      result = own();
      ownKey = pickKey(result);
      if (ownKey !== r.base!.a) inc(this.counts, `baseDiffers ${side}`);
    }
    if (changed.length || at || (ownKey !== undefined && ownKey !== r.base!.a))
      out({
        kind: 'd',
        pool: this.pool,
        src: this.src,
        i,
        T: s.turnNumber,
        side,
        dk: kind,
        prompt: p?.kind ?? null,
        tagBoard: tb,
        tags: s.runner.tags,
        changed,
        picks: Object.fromEntries(Object.entries(r).map(([a, x]) => [a, x!.a])),
        own: ownKey !== undefined && ownKey !== r.base!.a ? ownKey : undefined,
        access: at ? { ...at, title: at.code ? S.core.getCardDefinition(at.code).title : null, d150, tagTrash, answers: Object.fromEntries(Object.entries(r).map(([a, x]) => [a, answer(x!.a)])) } : undefined,
      });
    return result;
  }
  end(extra: Record<string, unknown>) {
    out({ kind: 'g', pool: this.pool, src: this.src, decisions: this.i, counts: this.counts, ms: Object.fromEntries(Object.entries(this.ms).map(([k, v]) => [k, Math.round(v)])), evMax: this.evMax, ...extra });
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

// ------------------------------------------------------------------------------------------------ (3) the record
interface OpenTag {
  T: number;
  by: string;
  priced: { runner: number; corp: number; one: { runner: number; corp: number } };
  lost: number;
  net: number;
  cleared: number;
  how: string[];
  split?: { runner: any; corp: any };
}
class Record3 {
  open: OpenTag[] = [];
  closed: (OpenTag & { end?: string })[] = [];
  /** A punisher's window: the board before its action, and the tags open then (they share its loss, even if it removes them). */
  punish: { s: GameState; code: string; on: OpenTag[] } | null = null;
  constructor(
    public pool: string,
    public src: string
  ) {}
  /** base's tagsWorth on board `s`, as viewer, of n tags given (n = 0 is 0). */
  private worth(s: GameState, v: 'corp' | 'runner', n: number): number {
    if (n <= 0) return 0;
    const t = A.base;
    t.clear();
    const st = structuredClone(s);
    return t.pricing.asSide(v, () => {
      t.hv.decisionContext(st, v);
      return t.ev.tagsWorth(st, v, n) as number;
    });
  }
  /** The Runner's strength without its tag term (base, the Runner's view): what a punisher takes. */
  private standing(s: GameState): number {
    const t = A.base;
    t.clear();
    const st = structuredClone(s);
    return t.pricing.asSide('runner', () => {
      t.hv.decisionContext(st, 'runner');
      return (t.ev.sideStrength(st, 'runner', 'runner') as number) + (t.ev.tagsWorth(st, 'runner') as number);
    });
  }
  /** A resource's worth by tagLoss's owner (evaluate.ts tagLoss: addRigCard plus its share of the board plans). */
  private resourceWorth(s: GameState, r: CardInstance): number {
    const t = A.base;
    t.clear();
    const st = structuredClone(s);
    const res = st.runner.rig.resources.find((c: CardInstance) => c.instanceId === r.instanceId)!;
    return t.pricing.asSide('runner', () => {
      t.hv.decisionContext(st, 'runner');
      const owned = st.runner.rig.resources;
      const plans = t.plans.hasBoardPlan(st, 'runner') ? (t.plans.boardPlansWorth(st, 'runner') as number) : undefined;
      const share = plans === undefined ? 0 : plans - t.plans.boardPlansWorth({ ...st, runner: { ...st.runner, rig: { ...st.runner.rig, resources: owned.filter((c: CardInstance) => c !== res) } } }, 'runner');
      return (t.ev.addRigCard(st, res, 0) as number) + share;
    });
  }
  /** What a Runner action spent in clicks and credits, at base's rates on the board before it. */
  private spent(before: GameState, after: GameState): number {
    const dk = Math.max(0, before.runner.clicks - after.runner.clicks);
    const dc = Math.max(0, before.runner.credits - after.runner.credits);
    const t = A.base;
    t.clear();
    const st = structuredClone(before);
    return t.pricing.asSide('runner', () => {
      t.hv.decisionContext(st, 'runner');
      const click = t.hv.clickPrice(st, 'runner', 'runner') as number;
      const cr = (t.vm.sideCreditValue(st, 'runner', 'runner') as number) - (t.vm.sideCreditValue({ ...st, runner: { ...st.runner, credits: st.runner.credits - dc } }, 'runner', 'runner') as number);
      return dk * click + cr;
    });
  }
  private loss(x: number, net: number, how: string, on: OpenTag[] = this.open) {
    for (const o of on) {
      o.lost += x / on.length;
      o.net += net / on.length;
      o.how.push(how);
    }
  }
  step(before: GameState, a: GameAction | null, after: GameState) {
    // A punisher's window closes when no prompt is left
    if (this.punish && !after.pendingPrompts.length) {
      const drop = this.standing(this.punish.s) - this.standing(after);
      const paid = Math.max(0, this.punish.s.corp.credits - after.corp.credits);
      this.loss(Math.max(0, drop), Math.max(0, drop) - paid, `punish:${this.punish.code}:${r3(drop)}`, this.punish.on);
      this.punish = null;
    }
    if (a && a.player === 'corp' && before.runner.tags > 0 && this.open.length) {
      if (a.type === 'TRASH_RESOURCE') {
        const r = before.runner.rig.resources.find(c => c.instanceId === (a as any).cardInstanceId);
        if (r) {
          const w = this.resourceWorth(before, r);
          this.loss(w, w - this.spentCorp(before), `trash:${r.cardCode}:${r3(w)}`);
        }
      } else if ((a.type === 'PLAY_OPERATION_OR_EVENT' || a.type === 'USE_ABILITY') && (a as any).cardInstanceId && !this.punish) {
        const c = S.core.findCardAnywhere(before, (a as any).cardInstanceId) as CardInstance | undefined;
        if (c && punisher(c.cardCode)) {
          if (after.pendingPrompts.length) this.punish = { s: before, code: c.cardCode, on: [...this.open] };
          else {
            const drop = this.standing(before) - this.standing(after);
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
        const priced = {
          runner: this.worth(before, 'runner', n + j) - this.worth(before, 'runner', n + j - 1),
          corp: this.worth(before, 'corp', n + j) - this.worth(before, 'corp', n + j - 1),
          one: { runner: this.worth(before, 'runner', 1), corp: this.worth(before, 'corp', 1) },
        };
        // Rev 1: the whole change of evaluate for one more tag on the same board, in parts (the j-th tag of a step: the board with its n + j - 1 tags)
        const bj = j === 1 ? before : { ...structuredClone(before), runner: { ...structuredClone(before.runner), tags: n + j - 1 } };
        const split = { runner: tagSplit(bj, 'runner'), corp: tagSplit(bj, 'corp') };
        this.open.push({ T: before.turnNumber, by: `${a?.player ?? '?'}:${a?.type ?? '?'}`, priced, lost: 0, net: 0, cleared: 0, how: [], split });
      }
    } else if (d < 0) {
      const k = -d;
      const byRunner = a?.player === 'runner';
      const cost = byRunner ? this.spent(before, after) : 0;
      for (const o of this.open.splice(0, k)) {
        o.cleared = cost / k;
        // The same object: a punisher's window that removed it still adds its loss to it
        this.closed.push(Object.assign(o, { end: byRunner ? (a?.type === 'REMOVE_TAG' ? 'cleared' : `removed:${a?.type}`) : `removedBy:${a?.player}:${a?.type}` }));
      }
    }
  }
  /** The Corp's click and credits on the basic trash (its click at base's rate, 2 credits): the net column only. */
  private spentCorp(before: GameState): number {
    const t = A.base;
    t.clear();
    const st = structuredClone(before);
    return t.pricing.asSide('corp', () => {
      t.hv.decisionContext(st, 'corp');
      const click = t.hv.clickPrice(st, 'corp', 'corp') as number;
      const cr = (t.vm.sideCreditValue(st, 'corp', 'corp') as number) - (t.vm.sideCreditValue({ ...st, corp: { ...st.corp, credits: st.corp.credits - 2 } }, 'corp', 'corp') as number);
      return click + cr;
    });
  }
  end(final: GameState) {
    for (const o of this.open.splice(0)) this.closed.push(Object.assign(o, { end: final.winner ? 'keptToEnd' : 'keptToStop' }));
    for (const o of this.closed)
      out({
        kind: 'tag',
        pool: this.pool,
        src: this.src,
        T: o.T,
        by: o.by,
        end: o.end,
        lost: r3(o.lost),
        net: r3(o.net),
        cleared: r3(o.cleared),
        cost: r3(o.lost + o.cleared),
        how: o.how,
        priced: { runner: r3(o.priced.runner), corp: r3(o.priced.corp), oneRunner: r3(o.priced.one.runner), oneCorp: r3(o.priced.one.corp) },
        split: o.split,
      });
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

/** Plays from `start` with the source tree's agents watched, until `stop`; the record follows every step. */
function play(g: Game, rec3: Record3, start: GameState, agents: { corp: any; runner: any }, stop: (s: GameState) => boolean, before?: (s: GameState) => void) {
  const run = new S.po.GameRunner(start, { corp: watched(g, 'corp', agents.corp), runner: watched(g, 'runner', agents.runner) });
  let steps = 0;
  for (let n = 0; n < 4000 && !stop(run.state); n++) {
    const s: GameState = run.state;
    before?.(s);
    if (!run.step()) break;
    steps++;
    rec3.step(s, run.last ?? null, run.state);
  }
  rec3.end(run.state);
  return { state: run.state as GameState, steps };
}

function deal(pool: string, rec: Rec) {
  const t0 = performance.now();
  S.clear();
  const src = `${pool}:${rec.seed}`;
  const g = new Game(pool, src);
  const rec3 = new Record3(pool, src);
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  const { state, steps } = play(g, rec3, dealStateOf(S, rec), { corp: S.ai.createAgent('corp', 'normal'), runner: S.ai.createAgent('runner', 'normal') }, () => false, s => {
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
  });
  const matches = (state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
  g.end({ steps, matchesBatch: matches, winner: state.winner ?? null, gameMs: Math.round(performance.now() - t0) });
}

const PEOPLE_DIRS = ['tests/fixtures/human-games', 'tests/fixtures/runner-facts/issues', 'tests/fixtures/runner-issues'];
const peopleFiles = (): string[] => [
  ...readdirSync(PEOPLE_DIRS[0])
    .filter(f => f.endsWith('.json'))
    .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')))
    .map(f => join(PEOPLE_DIRS[0], f)),
  ...PEOPLE_DIRS.slice(1).flatMap(dir => readdirSync(dir).filter(x => /^issue-(58|59|64|66|67)\.json$/.test(x)).sort().map(f => join(dir, f))),
];

/** A recorded game replayed move by move; at each decision board GameRunner would ask of an agent, the arms decide. */
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
  // A part of a split game (report-40b, 40c) starts from its recorded state (as scripts/stage-a/harness.ts replayHuman)
  if (r.startsAt === 'state') s = structuredClone(r.state);
  // The Runner's own memory, as a Normal Runner watching the game keeps it (observe: no hidden information)
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
        // GameRunner's own stops (both computer players stop where the computer always has), as replayHuman asks them
        const asked = S.core.wantsStop({ ...s, stops: { corp: 'ai', runner: 'ai' } }, side, w);
        method = asked && side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server') ? 'chooseRez' : asked && side === 'runner' && w.step === 'corp_action' ? 'chooseOffTurn' : null;
      }
      if (method) g.decide(side, method, s, side === 'runner' ? watcher : null);
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

/** The #58 pin's board (tests/runnerDecidedTwice.test.ts boardAt(58, 3)): played on to the end of T6. */
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
  const { state, steps } = play(g, rec3, structuredClone(s), { corp: S.ai.createAgent('corp', 'normal'), runner }, x => x.turnNumber > 6 || !!x.winner);
  g.end({ steps, T: state.turnNumber, gameMs: Math.round(performance.now() - t0) });
}

async function main() {
  const dirs = makeTrees(root);
  S = await loadTree('source', dirs.source);
  for (const arm of ARMS) A[arm] = await loadTree(arm, dirs[arm]);
  declined150 = new Set((JSON.parse(readFileSync('scripts/tags-once/declined-150.json', 'utf8')) as { src: string; T: number; card: string }[]).map(x => `${x.src}|${x.T}|${x.card}`));
  const started = Date.now();
  const sources: { pool: string; id: any }[] = [];
  for (const pool of POOLS) {
    if (pool === 'batch' || pool === 'nrdb') {
      const run = pool === 'batch' ? '45499791395' : '45503877309';
      const recs: Rec[] = JSON.parse(readFileSync(`scripts/runner-rework/decided-twice-deals-${run}.json`, 'utf8'));
      for (const r of recs) if (!DEALS.length || DEALS.includes(String(r.seed))) sources.push({ pool, id: r });
    } else if (pool === 'people') for (const f of peopleFiles()) sources.push({ pool, id: f });
    else if (pool === 'issue58') sources.push({ pool, id: null });
    else throw new Error(`unknown pool ${pool}`);
  }
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    if (Date.now() - started > MAX_MS) break;
    try {
      if (src.pool === 'people') person(src.id);
      else if (src.pool === 'issue58') issue58();
      else deal(src.pool, src.id);
    } catch (err) {
      out({ kind: 'err', pool: src.pool, src: src.pool === 'people' ? src.id : (src.id?.seed ?? src.pool), error: (err as Error).stack?.slice(0, 500) });
    }
  }
  out({ kind: 's', shard, ms: Date.now() - started });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
