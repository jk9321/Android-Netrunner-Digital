/**
 * Owed counts 1 and 3 (brief /mnt/project-files/netrunner-ai/owed-counts/brief.md items 1 and 3, F114 and F110), on beta
 * 9154f02's tree. Counts only. Built on scripts/tag-owner/count.ts (F108's Part B: its legs, its record of what a tag
 * cost, copied here since that script runs on import and its arms' patches name lines F108 deleted).
 *
 * Trees (trees.ts): `source` (this checkout's src: plays the source games, never asked or cleared), `legs` (src with one
 * engine line: getLegalActions offers REMOVE_TAG only while the global `__owBar` is unset; unset, it is src), `base` (src
 * with exports only: addRigCard; it prices every board, caches cleared before each read).
 *
 * MODE=tagn (item 1, F114): a unit is the first Runner main decision of a Runner turn with n >= 1 tags (the source game,
 *   or a person's game replayed). Two legs from that board, SEEDS seeds each (seed 0 the game's rng; seed k >= 1 R&D and
 *   the stack reshuffled, both legs alike): `n` (as is) and `less` (one tag taken off the board). In both REMOVE_TAG is
 *   barred from the unit until the Runner's turn after the HORIZON-th Corp turn begins; the Corp and Runner otherwise play
 *   by GameRunner. What the Corp took with tags (a resource trashed, priced as the clock prices it; a punisher's drop) and
 *   what it spent taking it, cumulative at the end of Corp turns 1..HORIZON; beside it the board at each read. Beside
 *   the unit: the clock's price of the 1st, 2nd and 3rd tag on the board (tagsWorth(k) - tagsWorth(k-1), the board's
 *   own tags set to k), both views; its per-turn loss; clearing's cost; stuck.
 * MODE=could (item 3, F110): F108's Part B legs re-run (clear units: the source took REMOVE_TAG, the keep leg barred
 *   until the Corp's turn begins; mirror units at MIRROR_P: tagged with a click and 2 credits, not cleared, the keep leg
 *   as played), keep legs only. In the keep leg's first Corp turn, the Corp's first main decision with the Runner tagged,
 *   a click, 2 credits and a resource to trash: if the Corp trashes none that turn (the clock's "always trashes" did not
 *   hold), what it did instead, and two sub-legs from that decision: `trash` (the basic trash action on the resource the
 *   clock ranks first, then the Corp plays on) and `chose` (the Corp's own play), read at the start of the Runner's next
 *   turn (R1), at the start of the Runner's turn after the next Corp turn (R2), and at game end on a hashed sample (END_P).
 *
 * Pools (never summed): batch (221 deals of g1 45830886377), nrdb (110 of NRDB=1 g1 45834898534), people (tagn only: the
 * human-games files and issue files tags-once read, replayed; units' legs from fresh agents with the Runner's watcher
 * memory). HIDDEN-READ (the measuring script, never an agent): the reads price the real board; seed k >= 1 reshuffles.
 *
 *   SHARD=0/64 MODE=tagn POOL=batch,nrdb,people SEEDS=2 HORIZON=3 npx vite-node scripts/corp-owed/tags.ts
 *   SHARD=0/64 MODE=could POOL=batch,nrdb SEEDS=2 MIRROR_P=0.35 END_P=0.3 npx vite-node scripts/corp-owed/tags.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardInstance, GameAction, GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Patch, Tree, loadTree, makeTree, rootOf } from './trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const MODE = process.env.MODE ?? 'tagn';
const POOLS = (process.env.POOL ?? (MODE === 'tagn' ? 'batch,nrdb,people' : 'batch,nrdb')).split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity);
const SEEDS = Number(process.env.SEEDS ?? 2);
const HORIZON = Number(process.env.HORIZON ?? 3);
const MIRROR_P = Number(process.env.MIRROR_P ?? 0.35);
const END_P = Number(process.env.END_P ?? 0.3);
/** At most this many units a source (0 = all); a quick look reads 2. */
const UNITS = Number(process.env.UNITS ?? 0);
const root = rootOf('tags', shard);
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r3 = (x: number | null | undefined): number | string | null =>
  x === null || x === undefined ? null : Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x > 0 ? 'Inf' : '-Inf';
const G = globalThis as any;

const EXPORTS: Patch[] = [['ai/evaluate.ts', `function addRigCard(state: GameState, card: CardInstance, value: number): number {`, `export function addRigCard(state: GameState, card: CardInstance, value: number): number {`]];
const BAR: Patch = [
  'core/engine/legalActions.ts',
  `if (side === 'runner' && hasClick && state.runner.tags > 0) candidates.push({ type: 'REMOVE_TAG', player: 'runner' });`,
  `if (side === 'runner' && hasClick && state.runner.tags > 0 && !(globalThis as any).__owBar) candidates.push({ type: 'REMOVE_TAG', player: 'runner' });`,
];
let S: Tree; // plays the source games
let L: Tree; // plays the legs
let B: Tree; // prices

// ------------------------------------------------------------------------------------------------ reads (base tree)
function inCtx<X>(s: GameState, viewer: 'corp' | 'runner', f: (st: GameState) => X): X {
  B.clear();
  const st = structuredClone(s);
  return B.pricing.asSide(viewer, () => {
    B.hv.decisionContext(st, viewer);
    return f(st);
  });
}
const evalIn = (s: GameState, v: 'corp' | 'runner') => inCtx(s, v, st => B.ev.evaluate(st, v) as number);
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
/** The Runner's strength without its tag term (base, the Runner's view): what a punisher takes. */
const standing = (s: GameState) => inCtx(s, 'runner', st => (B.ev.sideStrength(st, 'runner', 'runner') as number) + (B.ev.tagsWorth(st, 'runner') as number));
/** A resource's worth by the clock's owner (evaluate.ts tagLoss: addRigCard plus its share of the board plans), less the HQ cards trashing it costs. */
function resourceWorth(s: GameState, id: string, hq = false): number {
  return inCtx(s, 'runner', st => {
    const owned = st.runner.rig.resources;
    const res = owned.find((c: CardInstance) => c.instanceId === id)!;
    const plans = B.plans.hasBoardPlan(st, 'runner') ? (B.plans.boardPlansWorth(st, 'runner') as number) : undefined;
    const share = plans === undefined ? 0 : plans - B.plans.boardPlansWorth({ ...st, runner: { ...st.runner, rig: { ...st.runner.rig, resources: owned.filter((c: CardInstance) => c !== res) } } }, 'runner');
    return (B.ev.addRigCard(st, res, 0) as number) + share - (hq && B.pricing.plan().hqTrashCost ? (B.ev.hqTrashCardsLoss(st, res) as number) : 0);
  });
}
function spentBy(side: 'corp' | 'runner', before: GameState, after: GameState): number {
  const p = (x: GameState) => (side === 'corp' ? x.corp : x.runner);
  const dk = Math.max(0, p(before).clicks - p(after).clicks);
  const dc = Math.max(0, p(before).credits - p(after).credits);
  return inCtx(before, side, st => {
    const click = B.hv.clickPrice(st, side, side) as number;
    const less = side === 'corp' ? { ...st, corp: { ...st.corp, credits: st.corp.credits - dc } } : { ...st, runner: { ...st.runner, credits: st.runner.credits - dc } };
    return dk * click + (B.vm.sideCreditValue(st, side, side) as number) - (B.vm.sideCreditValue(less, side, side) as number);
  });
}
const clearCost = (s: GameState) => spentBy('runner', s, { ...s, runner: { ...s.runner, clicks: s.runner.clicks - 1, credits: s.runner.credits - 2 } });
const withTags = (s: GameState, n: number): GameState => ({ ...s, runner: { ...s.runner, tags: n } });
/** The clock's price of the k-th tag on board s (the board's tags set to k and to k-1), as viewer. */
const kth = (s: GameState, v: 'corp' | 'runner', k: number) => inCtx(withTags(s, k), v, st => B.ev.tagsWorth(st, v) as number) - (k > 1 ? inCtx(withTags(s, k - 1), v, st => B.ev.tagsWorth(st, v) as number) : 0);
const perTurn = (s: GameState, v: 'corp' | 'runner') => inCtx(withTags(s, Math.max(1, s.runner.tags)), v, st => B.ev.tagLossPerTurn(st, v, 0) as number);
const stuckOn = (s: GameState) => !(s.activePlayer === 'runner' && s.runner.clicks >= 1 && s.runner.credits >= 2);
function punisherView(s: GameState, memory: Map<string, string> | undefined): string {
  if (punisher(s.corp.identity.cardCode)) return 'known';
  if (s.corp.hq.some(c => memory?.get?.(c.instanceId) && punisher(memory.get(c.instanceId)!))) return 'known';
  const all: CardInstance[] = [...s.corp.hq, ...s.corp.rd, ...s.corp.archives.faceUp, ...s.corp.archives.faceDown, ...Object.values(s.corp.servers).flatMap((v: any) => [...v.ice, ...v.root])];
  return all.some(c => punisher(c.cardCode)) ? 'deck' : 'none';
}
const besideOf = (s: GameState) => ({
  clock: { runner: [1, 2, 3].map(k => r3(kth(s, 'runner', k))), corp: [1, 2, 3].map(k => r3(kth(s, 'corp', k))) },
  perTurn: { runner: r3(perTurn(s, 'runner')), corp: r3(perTurn(s, 'corp')) },
  clearCost: r3(clearCost(s)),
  stuck: stuckOn(s),
});

// ------------------------------------------------------------------------------------------------ agents
const classInstance = (v: any) => v && typeof v === 'object' && !(v instanceof Map) && !(v instanceof Set) && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype;
function fieldsOf(agent: any): any {
  const o: any = {};
  for (const k of Object.keys(agent ?? {})) {
    const v = agent[k];
    if (typeof v === 'function') continue;
    o[k] = classInstance(v) ? { ...v } : v;
  }
  return structuredClone(o);
}
function copySnap(from: any, to: any) {
  for (const k of Object.keys(from ?? {})) {
    const v = structuredClone(from[k]);
    if (classInstance(to[k]) && v && typeof v === 'object') Object.assign(to[k], v);
    else to[k] = v;
  }
}
const agentsFrom = (snap: { corp: any; runner: any }) => {
  const corp: any = L.ai.createAgent('corp', 'normal');
  copySnap(snap.corp, corp);
  const runner: any = L.ai.createAgent('runner', 'normal');
  copySnap(snap.runner, runner);
  return { corp, runner };
};
const hash = (x: string) => {
  let h = 2166136261;
  for (let i = 0; i < x.length; i++) h = Math.imul(h ^ x.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};
const seedFor = (k: number, s: number) => (Math.imul(s ^ (k * 0x9e3779b1), 2654435761) >>> 0) || 1;
function reseed(s0: GameState, k: number): GameState {
  const s = structuredClone(s0);
  if (k > 0) {
    // HIDDEN-READ (the measuring script): seed k reshuffles R&D and the stack and reseeds the game's rng, every leg alike
    s.id = `${s.id}~${k}`;
    s.rng = L.core.createRng(seedFor(k, s.rng.seed));
    L.core.shuffleInPlace(s.rng, s.corp.rd);
    L.core.shuffleInPlace(s.rng, s.runner.stack);
  }
  return s;
}
const corpMain = (s: GameState) => !s.winner && s.activePlayer === 'corp' && L.core.actingSide(s) === 'corp' && !s.pendingPrompts.length && !s.activeRun && !(s.priority && s.priority.holder !== s.activePlayer);
const could = (s: GameState) => corpMain(s) && s.runner.tags > 0 && s.corp.clicks >= 1 && s.corp.credits >= 2 && s.runner.rig.resources.length > 0;
const act = (s: GameState, a: any) => `${a.player}:${a.type}${a.targetServerId ? ':' + a.targetServerId : ''}${a.cardInstanceId ? ':' + titleOf(S.core.findCardAnywhere(s, a.cardInstanceId)?.cardCode ?? '?') : ''}`;
const snap = (st: GameState) => ({ T: st.turnNumber, rc: st.runner.credits, rk: st.runner.clicks, grip: st.runner.grip.length, rig: st.runner.rig.programs.length + st.runner.rig.hardware.length + st.runner.rig.resources.length, res: st.runner.rig.resources.length, tags: st.runner.tags, rs: st.runner.score, cs: st.corp.score, cc: st.corp.credits, w: st.winner ?? null, evR: st.winner ? null : r3(evalIn(st, 'runner')), evC: st.winner ? null : r3(evalIn(st, 'corp')) });

/** What the Corp took with tags on one step (a resource trashed, a punisher's drop), and its cost; `pend` carries a punisher whose prompt is open. */
class Took {
  trash = 0;
  punish = 0;
  spent = 0;
  takes: string[] = [];
  pend: { s: GameState; code: string } | null = null;
  step(before: GameState, a: any, after: GameState) {
    if (this.pend && !after.pendingPrompts.length) {
      const drop = standing(this.pend.s) - standing(after);
      this.punish += Math.max(0, drop);
      this.spent += spentBy('corp', this.pend.s, after);
      this.takes.push(`punish:${titleOf(this.pend.code)}:${r3(drop)}`);
      this.pend = null;
    }
    if (!a || a.player !== 'corp' || before.runner.tags <= 0) return;
    if (a.type === 'TRASH_RESOURCE') {
      const r = before.runner.rig.resources.find(c => c.instanceId === a.cardInstanceId);
      if (r) {
        const w = resourceWorth(before, r.instanceId);
        this.trash += w;
        this.spent += spentBy('corp', before, after);
        this.takes.push(`trash:${titleOf(r.cardCode)}:${r3(w)}`);
      }
    } else if ((a.type === 'PLAY_OPERATION_OR_EVENT' || a.type === 'USE_ABILITY') && a.cardInstanceId && !this.pend) {
      const c = S.core.findCardAnywhere(before, a.cardInstanceId) as CardInstance | undefined;
      if (c && punisher(c.cardCode)) {
        if (after.pendingPrompts.length) this.pend = { s: before, code: c.cardCode };
        else {
          const drop = standing(before) - standing(after);
          this.punish += Math.max(0, drop);
          this.spent += spentBy('corp', before, after);
          this.takes.push(`punish:${titleOf(c.cardCode)}:${r3(drop)}`);
        }
      }
    }
  }
  read() {
    return { trash: r3(this.trash), punish: r3(this.punish), spent: r3(this.spent), takes: [...this.takes] };
  }
}

// ------------------------------------------------------------------------------------------------ MODE=tagn
/** One leg from the unit board: REMOVE_TAG barred until the Runner's turn after the HORIZON-th Corp turn begins. */
function tagLeg(s0: GameState, k: number, less: boolean, agents: { corp: any; runner: any }) {
  const t0 = performance.now();
  let s = reseed(s0, k);
  if (less) s = { ...s, runner: { ...s.runner, tags: s.runner.tags - 1 } };
  L.clear();
  const g = new L.po.GameRunner(s, agentsFrom(agents));
  const took = new Took();
  const reads: any[] = [];
  let corpTurns = 0;
  let inCorp = false;
  let steps = 0;
  for (; steps < 8000 && !g.state.winner; steps++) {
    const before: GameState = g.state;
    if (before.activePlayer === 'corp') inCorp = true;
    else if (inCorp) {
      // a Corp turn ended: the read
      inCorp = false;
      corpTurns++;
      reads.push({ ...took.read(), at: snap(before) });
      if (corpTurns >= HORIZON) break;
    }
    G.__owBar = true;
    let more: boolean;
    try {
      more = g.step();
    } finally {
      G.__owBar = false;
    }
    if (!more) break;
    took.step(before, g.last, g.state);
  }
  while (reads.length < HORIZON) reads.push({ ...took.read(), at: snap(g.state), ended: true });
  return { reads, steps, ms: Math.round(performance.now() - t0) };
}
function tagUnit(pool: string, src: string, s0: GameState, agents: { corp: any; runner: any }, memory: any, extra: Record<string, unknown> = {}) {
  const legs: any[] = [];
  for (let k = 0; k < SEEDS; k++) {
    try {
      legs.push({ k, n: tagLeg(s0, k, false, agents), less: tagLeg(s0, k, true, agents) });
    } catch (err) {
      legs.push({ k, error: (err as Error).stack?.slice(0, 3000) });
    }
  }
  out({
    kind: 'u',
    mode: 'tagn',
    pool,
    src,
    T: s0.turnNumber,
    corpDeck: extra.corpDeck,
    runnerDeck: extra.runnerDeck,
    board: { tags: s0.runner.tags, rc: s0.runner.credits, rk: s0.runner.clicks, res: s0.runner.rig.resources.length, cc: s0.corp.credits, hq: s0.corp.hq.length, punisher: punisherView(s0, memory) },
    beside: besideOf(s0),
    legs,
  });
}

// ------------------------------------------------------------------------------------------------ MODE=could
/** The best resource by the clock's own order (tagLoss: worth less the HQ cards trashing it costs). */
function bestResource(s: GameState): string | null {
  let best: string | null = null;
  let bv = -Infinity;
  for (const r of s.runner.rig.resources) {
    const v = resourceWorth(s, r.instanceId, true);
    if (v > bv) {
      bv = v;
      best = r.instanceId;
    }
  }
  return best;
}
/** A sub-leg from the Corp's decision: `trash` plays the basic trash action first, `chose` the Corp's own play. */
function subLeg(s0: GameState, k: number, mode: 'trash' | 'chose', agents: { corp: any; runner: any }, toEnd: boolean) {
  const t0 = performance.now();
  const s = reseed(s0, k);
  L.clear();
  const g = new L.po.GameRunner(s, agentsFrom(agents));
  let first: string | null = null;
  if (mode === 'trash') {
    const id = bestResource(s);
    const a = L.core.getLegalActions(g.state, 'corp').find((x: any) => x.type === 'TRASH_RESOURCE' && x.cardInstanceId === id);
    if (!a) return { error: 'no trash action' };
    first = act(g.state, a);
    g.apply(a);
  }
  const turn: string[] = [];
  let r1: any = null;
  let r2: any = null;
  let seenCorp2 = false;
  let steps = 0;
  for (; steps < 8000 && !g.state.winner; steps++) {
    const before: GameState = g.state;
    if (!r1 && before.activePlayer === 'runner') r1 = snap(before);
    if (r1 && !r2 && before.activePlayer === 'corp') seenCorp2 = true;
    if (seenCorp2 && !r2 && before.activePlayer === 'runner') {
      r2 = snap(before);
      if (!toEnd) break;
    }
    if (!g.step()) break;
    if (!r1 && g.last && (g.last as any).player === 'corp') turn.push(act(before, g.last));
  }
  const end = toEnd ? { w: g.state.winner ?? null, cp: g.state.corp.score, rp: g.state.runner.score, T: g.state.turnNumber } : undefined;
  return { first, turn: turn.slice(0, 12), r1: r1 ?? snap(g.state), r2: r2 ?? snap(g.state), end, steps, ms: Math.round(performance.now() - t0) };
}
/** F108's keep leg; in its first Corp turn, the first decision the Corp could trash at, and whether it trashed that turn. */
function keepLeg(s0: GameState, k: number, srcAction: GameAction | null, agents: { corp: any; runner: any }) {
  const s = reseed(s0, k);
  L.clear();
  const ag = agentsFrom(agents);
  const g = new L.po.GameRunner(s, ag);
  let first: GameAction;
  if (srcAction) first = srcAction;
  else {
    G.__owBar = true;
    try {
      first = ag.runner.chooseAction(g.state);
    } finally {
      G.__owBar = false;
    }
  }
  g.apply(first);
  let seenCorp = false;
  let at: { s: GameState; agents: any } | null = null;
  let trashed = 0;
  let punished = 0;
  const turn: string[] = [];
  for (let steps = 0; steps < 8000 && !g.state.winner; steps++) {
    const before: GameState = g.state;
    if (before.activePlayer === 'corp') seenCorp = true;
    if (seenCorp && before.activePlayer === 'runner') break;
    if (seenCorp && !at && could(before)) at = { s: structuredClone(before), agents: { corp: fieldsOf(ag.corp), runner: fieldsOf(ag.runner) } };
    G.__owBar = !srcAction && !seenCorp;
    let more: boolean;
    try {
      more = g.step();
    } finally {
      G.__owBar = false;
    }
    if (!more) break;
    const a: any = g.last;
    if (at && a?.player === 'corp') {
      turn.push(act(before, a));
      if (a.type === 'TRASH_RESOURCE') trashed++;
      const c = a.cardInstanceId ? S.core.findCardAnywhere(before, a.cardInstanceId) : null;
      if (c && punisher(c.cardCode) && (a.type === 'PLAY_OPERATION_OR_EVENT' || a.type === 'USE_ABILITY')) punished++;
    }
  }
  return { at, trashed, punished, turn: turn.slice(0, 12) };
}
function couldUnit(pool: string, src: string, u: { kind: string; s0: GameState; src: GameAction; agents: any; di: number }, extra: Record<string, unknown>) {
  const rows: any[] = [];
  for (let k = 0; k < SEEDS; k++) {
    try {
      const kl = keepLeg(u.s0, k, u.kind === 'clear' ? null : u.src, u.agents);
      const row: any = { k, could: !!kl.at, trashed: kl.trashed, punished: kl.punished };
      if (kl.at && kl.trashed === 0) {
        const s = kl.at.s;
        const toEnd = hash(`${src}#${u.di}#${k}`) < END_P;
        row.instead = kl.turn;
        row.board = { T: s.turnNumber, cc: s.corp.credits, ck: s.corp.clicks, res: s.runner.rig.resources.map(c => titleOf(c.cardCode)), tags: s.runner.tags, rc: s.runner.credits, hq: s.corp.hq.length, punisherHQ: s.corp.hq.some(c => punisher(c.cardCode)) };
        row.best = (() => {
          const id = bestResource(s);
          const r = s.runner.rig.resources.find(c => c.instanceId === id);
          return r ? { title: titleOf(r.cardCode), worth: r3(resourceWorth(s, r.instanceId, true)) } : null;
        })();
        row.clock = { perTurnCorp: r3(inCtx(s, 'corp', st => B.ev.tagLossPerTurn(st, 'corp', 0) as number)), tagsWorthCorp: r3(inCtx(s, 'corp', st => B.ev.tagsWorth(st, 'corp') as number)) };
        row.trash = subLeg(s, 0, 'trash', kl.at.agents, toEnd);
        row.chose = subLeg(s, 0, 'chose', kl.at.agents, toEnd);
      } else if (kl.at) row.instead = kl.turn;
      rows.push(row);
    } catch (err) {
      rows.push({ k, error: (err as Error).stack?.slice(0, 400) });
    }
  }
  out({ kind: 'u', mode: 'could', pool, src, unit: u.kind, di: u.di, T: u.s0.turnNumber, corpDeck: extra.corpDeck, runnerDeck: extra.runnerDeck, tags: u.s0.runner.tags, rows });
}

// ------------------------------------------------------------------------------------------------ sources
type Rec = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(t: Tree, rec: Rec): GameState {
  const c = DECK_POOL.find(d => d.side === 'corp' && d.name === rec.corpDeck);
  const r = DECK_POOL.find(d => d.side === 'runner' && d.name === rec.runnerDeck);
  if (!c || !r) throw new Error(`deal ${rec.seed}: deck not found (${rec.corpDeck} v ${rec.runnerDeck})`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(rec.seed, c, r));
}
const key = (a: unknown) => JSON.stringify(a ?? null);
const RUNS: Record<string, string> = { batch: '45830886377', nrdb: '45834898534' };
const mainRunner = (s: GameState) => !s.winner && S.core.actingSide(s) === 'runner' && s.activePlayer === 'runner' && !s.pendingPrompts.length && !s.activeRun && !(s.priority && s.priority.holder !== s.activePlayer);

function deal(pool: string, rec: Rec) {
  const t0 = performance.now();
  S.clear();
  const src = `${pool}:${rec.seed}`;
  const ag = { corp: S.ai.createAgent('corp', 'normal'), runner: S.ai.createAgent('runner', 'normal') };
  const run = new S.po.GameRunner(dealStateOf(S, rec), ag);
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  let lastRunnerTurn = -1;
  let di = 0;
  const todo: any[] = [];
  let units = 0;
  for (let n = 0; n < 4000; n++) {
    const s: GameState = run.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const mr = mainRunner(s) && s.runner.tags > 0;
    const snapAgents = mr ? { corp: fieldsOf(ag.corp), runner: fieldsOf(ag.runner) } : null;
    const turnStart = mr && s.turnNumber !== lastRunnerTurn;
    if (mainRunner(s)) lastRunnerTurn = s.turnNumber;
    if (!run.step()) break;
    if (!snapAgents) continue;
    const a = run.last as GameAction;
    di++;
    if (UNITS && units >= UNITS) continue;
    if (MODE === 'tagn' && turnStart) {
      todo.push({ s0: s, agents: snapAgents, memory: ag.runner.memory });
      units++;
    } else if (MODE === 'could') {
      if (a.type === 'REMOVE_TAG') {
        todo.push({ kind: 'clear', s0: s, src: a, agents: snapAgents, di });
        units++;
      } else if (s.runner.clicks >= 1 && s.runner.credits >= 2 && hash(`${src}#${di}`) < MIRROR_P) {
        todo.push({ kind: 'mirror', s0: s, src: a, agents: snapAgents, di });
        units++;
      }
    }
  }
  const matches = (run.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
  const gameMs = Math.round(performance.now() - t0);
  const extra = { corpDeck: rec.corpDeck, runnerDeck: rec.runnerDeck };
  for (const u of todo) {
    if (MODE === 'tagn') tagUnit(pool, src, u.s0, u.agents, u.memory, extra);
    else couldUnit(pool, src, u, extra);
  }
  out({ kind: 'g', pool, src, units: todo.length, tagged: di, matchesBatch: matches, gameMs, ms: Math.round(performance.now() - t0) });
}

const PEOPLE_DIRS = ['tests/fixtures/human-games', 'tests/fixtures/runner-facts/issues', 'tests/fixtures/runner-issues'];
const peopleFiles = (): string[] => [
  ...readdirSync(PEOPLE_DIRS[0])
    .filter(f => f.endsWith('.json'))
    .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')))
    .map(f => join(PEOPLE_DIRS[0], f)),
  ...PEOPLE_DIRS.slice(1).flatMap(dir => readdirSync(dir).filter(x => /^issue-(58|59|64|66|67)\.json$/.test(x)).sort().map(f => join(dir, f))),
];
/** A person's game replayed; at each Runner turn's first main decision with tags, a unit (fresh agents; the Runner's watcher memory). */
function person(file: string) {
  const t0 = performance.now();
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const name = file.split('/').pop()!.replace('.json', '');
  const src = `people:${file.includes('human-games') ? 'human' : 'issue'}:${name}`;
  if (!r.moves?.length) return out({ kind: 'skip', pool: 'people', src, why: 'no moves' });
  let s: GameState = S.core.createInitialGameState(S.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  if (r.startsAt === 'state') s = structuredClone(r.state);
  const watcher: any = S.ai.createAgent('runner', 'normal');
  const corpW: any = S.ai.createAgent('corp', 'normal');
  let lastRunnerTurn = -1;
  let replayed = 0;
  let err: string | null = null;
  const todo: any[] = [];
  for (const move of r.moves as GameAction[]) {
    watcher.observe?.(s);
    corpW.observe?.(s);
    if (mainRunner(s) && s.runner.tags > 0 && s.turnNumber !== lastRunnerTurn && move.player === 'runner' && (!UNITS || todo.length < UNITS)) todo.push({ s0: s, agents: { corp: fieldsOf(corpW), runner: fieldsOf(watcher) }, memory: watcher.memory });
    if (mainRunner(s)) lastRunnerTurn = s.turnNumber;
    try {
      s = S.core.executeAction(s, move);
    } catch (e) {
      err = (e as Error).message.slice(0, 120);
      break;
    }
    replayed++;
  }
  const extra = { corpDeck: r.config?.corpDeck?.name ?? null, runnerDeck: r.config?.runnerDeck?.name ?? null };
  for (const u of todo) tagUnit('people', src, u.s0, u.agents, u.memory, extra);
  out({ kind: 'g', pool: 'people', src, units: todo.length, moves: r.moves.length, replayed, err, ms: Math.round(performance.now() - t0) });
}

/**
 * FIXTURE=<state json> (item 1's "that board", report-48 move 42): played on by GameRunner (fresh agents) to the Runner's
 * first main decision, then the Runner set to TAGS tags and RC credits (default 2 and 2, the F114 leaf's reply Runner), one
 * tagn unit per TAGS value.
 */
function fixture(file: string) {
  const s0: GameState = JSON.parse(readFileSync(file, 'utf8'));
  const ag = { corp: S.ai.createAgent('corp', 'normal'), runner: S.ai.createAgent('runner', 'normal') };
  const run = new S.po.GameRunner(structuredClone(s0), ag);
  for (let i = 0; i < 4000 && !mainRunner(run.state); i++) if (!run.step()) break;
  const agents = { corp: fieldsOf(ag.corp), runner: fieldsOf(ag.runner) };
  for (const tags of (process.env.TAGS ?? '2').split(',').map(Number)) {
    const b: GameState = { ...structuredClone(run.state), runner: { ...structuredClone(run.state.runner), tags, credits: Number(process.env.RC ?? 2) } };
    tagUnit('fixture', `${file}:tags${tags}`, b, agents, (ag.runner as any).memory);
  }
}

async function main() {
  S = await loadTree('source', makeTree(join(root, 'source'), {}));
  L = await loadTree('legs', makeTree(join(root, 'legs'), { patches: [BAR] }));
  B = await loadTree('base', makeTree(join(root, 'base'), { patches: EXPORTS }));
  const started = Date.now();
  const sources: { pool: string; id: any }[] = [];
  for (const pool of POOLS) {
    if (pool === 'batch' || pool === 'nrdb') {
      const recs: Rec[] = JSON.parse(readFileSync(`scripts/corp-owed/deals-${RUNS[pool]}.json`, 'utf8'));
      for (const r of recs) if (!DEALS.length || DEALS.includes(String(r.seed))) sources.push({ pool, id: r });
    } else if (pool === 'people') for (const f of peopleFiles()) sources.push({ pool, id: f });
    else if (pool === 'fixture') sources.push({ pool, id: process.env.FIXTURE });
    else throw new Error(`unknown pool ${pool}`);
  }
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    if (Date.now() - started > MAX_MS) break;
    try {
      if (src.pool === 'people') person(src.id);
      else if (src.pool === 'fixture') fixture(src.id);
      else deal(src.pool, src.id);
    } catch (err) {
      out({ kind: 'err', pool: src.pool, src: typeof src.id === 'string' ? src.id : src.id?.seed, error: (err as Error).stack?.slice(0, 500) });
    }
  }
  out({ kind: 's', shard, mode: MODE, ms: Date.now() - started, rss: Math.round(process.memoryUsage().rss / 1e6) });
  if (process.env.OUT_DIR) writeFileSync(join(process.env.OUT_DIR, `done-${shard}.txt`), 'ok');
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
