/**
 * Stage D item 8, count step: the three corrections after the pick (M the money step, T tag first, V the spare-click
 * veto), the plan's replacement arms, row 35 (saveUp) and Jeff's "hold the credits / end the turn" candidates.
 * Brief: /mnt/project-files/netrunner-ai/stage-d/item8-post-pick/brief.md. Scripts only: nothing in src or tests.
 * Trees and arms: post-pick-trees.ts (each a patched copy of this checkout's src, its own module graph).
 *
 * Sources: (a) the 221 deals of the g1 base 44381468776 (post-pick-deals.json; each game's winner, cr and sc checked
 * against that record), played by the `source` tree with a plain GameRunner, Normal v Normal (as the batch); the source
 * tree's RECORD patch only writes a global, read after each Corp call (passive; never asked or cleared mid-game, row
 * 71b). (b) human-Runner files (config.ai 'corp'): at every recorded Corp main-phase board, today's Normal Corp. (c)
 * human-Corp files: today's AI at the person's boards. Human games replay the recorded moves (report-40b/40c from their
 * `state`). Kinds are kept apart everywhere (who: self, humanRunner, humanCorp).
 *
 * Per decision (a Corp main-phase decision with a click to spend, not the turn-start window):
 *  - fire: from the deciding Corp's own record (the source game's Corp in self-play; a fresh beta Corp on the human
 *    boards): M (the money step's answer replaced the look-ahead's pick or the order's first), T (tag first replaced the
 *    pick), V (the veto replaced the pick by a credit); the old "overruled" (the look-ahead returned a pick and the action
 *    played is not it; decision-time/measurement.md number 2).
 *  - asks: a fresh Normal Corp of beta, control and each B/C arm, on a clone, its held line set to the deciding Corp's
 *    (read before the decision), timed, order rotated. A control answer unlike beta's is a stop.
 *  - continuations (GameRunner from the real board, the beta tree's fresh Normal agents both sides after the first move,
 *    the Corp's held line as the deciding Corp's after the decision): (1) each fired correction: its action, and the pick
 *    it replaced; (2) each arm's changed decision: the arm's action, and beta's. Capped at CAP pairs a source per arm
 *    (every k-th inside the source).
 *  - C1: the econ operations in HQ the Corp cannot pay for now and could with this turn's clicks (credits + clicks - 1)
 *    or next turn's (credits + clicks + known income + maxClicks - 1); their fate in the source game.
 * Per deal, A3: noM, noT, noV each play the whole deal (paired with the source game, which is the beta copy), with the
 * batch's alarms (scripts/alarms.ts AlarmTracker) on every game.
 *
 * Hidden information: every arm is asked only through createAgent(...).chooseAction (its own view). The measuring script
 * reads the Corp's HQ (C1) and the deal's real state for continuations; nothing hands an agent the other side's cards.
 *
 *   SHARD=0/64 npx vite-node scripts/stage-d/post-pick.ts
 *   DEALS=1001 HUMAN=none npx vite-node scripts/stage-d/post-pick.ts
 *   PARTS=fire,asks,cont,a3 (default all); CAP=12
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { dealState } from '../stage-a/harness';
import { AlarmTracker } from '../alarms';
import { ARMS, Arm, Tree, loadTree, makeTrees } from './post-pick-trees';

for (const kv of (process.env.ARGS ?? '').split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/post-pick', String(shard));
const PARTS = new Set((process.env.PARTS ?? 'fire,asks,cont,a3').split(','));
const CAP = Number(process.env.CAP ?? 12);
const ASKED: Arm[] = ['beta', 'control', 'moneyBefore', 'vetoList', 'saveUpMoney', 'saveUpList', 'holdCand'];
const B_ARMS: Arm[] = ['moneyBefore', 'vetoList', 'saveUpMoney', 'saveUpList', 'holdCand'];
const A3_ARMS: Arm[] = ['noM', 'noT', 'noV'];
const r1 = (x: number) => Math.round(x * 10) / 10;
const key = (a: unknown) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a as object).sort())) : 'null');
const same = (a: unknown, b: unknown) => key(a) === key(b);
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const G = globalThis as any;

let trees: Record<string, Tree> = {};

/** A short label of an action: its type and, for a card, the card's type and title (the Corp's own cards; public in the rig). */
function label(t: Tree, s: GameState, a: GameAction | null | undefined): string {
  if (!a) return 'none';
  const id = (a as any).cardInstanceId;
  if (!id) return a.type;
  const c = t.core.findCardAnywhere(s, id);
  if (!c) return a.type;
  const d = t.core.cardDef(c);
  const where = a.type === 'INSTALL_CARD' ? ((a as any).asNewRemote ? '>new' : `>${(a as any).targetServerId}`) : '';
  return `${a.type} ${d.type_code}:${d.title}${where}`;
}

const kindOf = (a: GameAction | null | undefined) => (a ? a.type : 'none');

// ------------------------------------------------------------------------------------------------ asks
interface Ask {
  a: GameAction | null;
  k: string;
  ms: number;
  rec: any;
  plan: any;
  held: any;
  err?: string;
}

function ask(t: Tree, s: GameState, heldBefore: unknown): Ask {
  t.clear();
  const agent = t.createAgent('corp', 'normal');
  if (agent.memory) agent.memory.heldLine = structuredClone(heldBefore ?? null);
  const copy = structuredClone(s);
  G.__ppRec = null;
  G.__ppPlan = null;
  const at = performance.now();
  try {
    const a = agent.chooseAction(copy);
    const ms = performance.now() - at;
    return { a, k: key(a), ms, rec: G.__ppRec, plan: G.__ppPlan, held: structuredClone(agent.memory?.heldLine ?? null) };
  } catch (e) {
    return { a: null, k: `error: ${(e as Error).message.slice(0, 80)}`, ms: 0, rec: null, plan: null, held: null, err: (e as Error).message.slice(0, 160) };
  } finally {
    G.__ppRec = null;
    G.__ppPlan = null;
  }
}

// ------------------------------------------------------------------------------------------------ continuations
interface ContOut {
  winner: string | null;
  T: number;
  cs: number;
  rs: number;
  cr1: number | null;
  cr2: number | null;
  err?: string;
}

/** Plays on from `s0` after `first` (beta's Normal agents both sides; the Corp holds `held`). */
function cont(s0: GameState, first: GameAction, held: unknown): ContOut {
  const t = trees.beta;
  t.clear();
  let s: GameState;
  try {
    if (!t.core.isLegalAction(s0, first)) return { winner: null, T: 0, cs: 0, rs: 0, cr1: null, cr2: null, err: 'not legal' };
    s = t.core.executeAction(structuredClone(s0), first);
  } catch (e) {
    return { winner: null, T: 0, cs: 0, rs: 0, cr1: null, cr2: null, err: (e as Error).message.slice(0, 100) };
  }
  const corp = t.createAgent('corp', 'normal');
  if (corp.memory) corp.memory.heldLine = structuredClone(held ?? null);
  const g = new t.GameRunner(s, { corp, runner: t.createAgent('runner', 'normal') });
  const ends: number[] = [];
  let prev: GameState = g.state;
  if (prev.activePlayer === 'runner') ends.push(prev.corp.credits);
  try {
    for (let n = 0; n < 4000 && ends.length < 2; n++) {
      if (!g.step()) break;
      if (prev.activePlayer === 'corp' && g.state.activePlayer === 'runner') ends.push(g.state.corp.credits);
      prev = g.state;
    }
    for (let n = 0; n < 4000; n++) if (!g.step()) break;
  } catch (e) {
    return { winner: null, T: g.state.turnNumber, cs: g.state.corp.score, rs: g.state.runner.score, cr1: ends[0] ?? null, cr2: ends[1] ?? null, err: (e as Error).message.slice(0, 100) };
  }
  return { winner: g.state.winner ?? null, T: g.state.turnNumber, cs: g.state.corp.score, rs: g.state.runner.score, cr1: ends[0] ?? null, cr2: ends[1] ?? null };
}

function pair(src: string, who: string, i: number, what: string, s: GameState, a: GameAction, b: GameAction, heldA: unknown, heldB: unknown, extra: Record<string, unknown> = {}) {
  const t = trees.beta;
  const ca = cont(s, a, heldA);
  const cb = cont(s, b, heldB);
  out({ kind: 'c', src, who, i, T: s.turnNumber, what, a: label(t, s, a), b: label(t, s, b), rs0: s.runner.score, cs0: s.corp.score, ca, cb, ...extra });
}

// ------------------------------------------------------------------------------------------------ C1
/** The econ operations in HQ the Corp cannot pay for now, and whether this turn's or next turn's clicks reach them. */
function saveClass(t: Tree, s: GameState) {
  const legal: GameAction[] = t.core.getLegalActions(s, 'corp');
  const playable = new Set(legal.filter(a => a.type === 'PLAY_OPERATION_OR_EVENT').map(a => (a as any).cardInstanceId));
  const cr = s.corp.credits;
  const clicks = s.corp.clicks;
  let income: number;
  try {
    income = t.lines.knownIncome(s);
  } catch {
    income = 0;
  }
  const outL: { id: string; title: string; cost: number; reach: 'now' | 'next' | 'far' }[] = [];
  for (const c of s.corp.hq) {
    const d = t.core.cardDef(c);
    if (d.type_code !== 'operation' || playable.has(c.instanceId) || !((t.syn.cardSynergy(d).gives?.econ ?? 0) > 0)) continue;
    const cost = d.cost ?? 0;
    if (cost <= cr) continue; // payable now but not legal for another reason
    const reach = cr + clicks - 1 >= cost ? 'now' : cr + clicks + income + (s.corp.maxClicks ?? 3) - 1 >= cost ? 'next' : 'far';
    outL.push({ id: c.instanceId, title: d.title, cost, reach });
  }
  return outL;
}

// ------------------------------------------------------------------------------------------------ one decision
interface Dec {
  src: string;
  who: 'self' | 'humanRunner' | 'humanCorp';
  i: number;
  s: GameState;
  heldBefore: unknown;
  heldAfter: unknown;
  rec: any;
  action: GameAction | null;
}

let rot = 0;
const fireOf = (rec: any, action: GameAction | null) => {
  const base = rec.planned ?? rec.r0;
  const M = !!rec.money && !rec.lineFirst && !same(rec.money, base);
  const T = !!rec.tFires && !same(rec.r0, rec.beforeT);
  const V = !rec.lineStep && !rec.later && !rec.score && action?.type === 'GAIN_CREDIT' && rec.chosen?.type !== 'GAIN_CREDIT';
  return { base, M, T, V };
};

function decision(d: Dec, perSrc: Record<string, number>) {
  const t = trees.beta;
  const s = d.s;
  const rec = d.rec;
  const f = fireOf(rec, d.action);
  const row: Record<string, unknown> = {
    kind: 'd',
    src: d.src,
    who: d.who,
    i: d.i,
    T: s.turnNumber,
    clicks: s.corp.clicks,
    cr: s.corp.credits,
    tags: s.runner.tags,
    planned: rec.planned ? label(t, s, rec.planned) : null,
    r0: label(t, s, rec.r0),
    money: rec.money ? label(t, s, rec.money) : null,
    final: label(t, s, d.action),
    finalKind: kindOf(d.action),
    M: f.M,
    T_: f.T,
    V: f.V,
    baseFrom: rec.planned ? 'lookahead' : 'order',
    score: !!rec.score,
    later: !!rec.later,
    lineStep: !!rec.lineStep,
    lineKind: rec.lineKind ?? null,
    lookahead: !!rec.planned,
    overruled: !!rec.planned && !same(rec.planned, d.action),
  };
  if (f.T) {
    row.tReplaced = label(t, s, rec.beforeT);
    row.tPlayed = label(t, s, rec.r0);
  }
  if (f.V) row.vReplaced = label(t, s, rec.chosen);
  const cls = saveClass(t, s);
  if (cls.length) row.save = cls.map(c => `${c.title}:${c.reach}:${c.cost}`);

  // The fired corrections' continuations (self-play: the source's own decision; human: beta's fresh one)
  const fires: [string, GameAction, GameAction][] = [];
  if (f.M) fires.push(['M', rec.money, f.base]);
  if (f.T) fires.push(['T', rec.r0, rec.beforeT]);
  if (f.V) fires.push(['V', d.action!, rec.chosen]);

  let asks: Record<string, Ask> = {};
  if (PARTS.has('asks')) {
    const order = [...ASKED.slice(rot % ASKED.length), ...ASKED.slice(0, rot % ASKED.length)];
    rot++;
    for (const arm of order) asks[arm] = ask(trees[arm], s, d.heldBefore);
    const b = asks.beta;
    row.ms = Object.fromEntries(ASKED.map(a => [a, r1(asks[a].ms)]));
    if (asks.control.k !== b.k) row.controlDiffers = true;
    row.betaFresh = label(t, s, b.a);
    row.freshSame = same(b.a, d.action);
    row.changed = Object.fromEntries(B_ARMS.filter(a => asks[a].k !== b.k).map(a => [a, label(t, s, asks[a].a)]));
    for (const a of ASKED) if (asks[a].err) (row.errors ??= {} as any)[a] = asks[a].err;
    // "Ask before": the money step's answer with the order's first (moneyBefore's ask) against beta's (asked on its pick)
    const mb = asks.moneyBefore.rec;
    if (b.rec && mb) row.mBefore = { beta: b.rec.money ? label(t, s, b.rec.money) : null, before: mb.money ? label(t, s, mb.money) : null, differs: !same(b.rec.money, mb.money) };
    if (asks.vetoList.rec?.filtered) row.vetoCut = asks.vetoList.rec.filtered;
    // C2: the candidates beta's look-ahead compared; holdCand's values for the added ones
    if (b.plan) {
      const types = b.plan.cands.map((a: GameAction) => a.type);
      row.cands = { n: types.length, credit: types.includes('GAIN_CREDIT'), end: types.includes('END_TURN') };
    } else row.cands = null;
    const hp = asks.holdCand.plan;
    if (hp) {
      const vals = hp.values as number[];
      const bestV = Math.max(...vals.filter(Number.isFinite));
      const idx = (t: string) => hp.cands.findIndex((a: GameAction) => a.type === t);
      row.hold = {
        added: hp.added,
        best: label(t, s, hp.best),
        bestV: r1(bestV),
        credit: idx('GAIN_CREDIT') >= 0 ? r1(vals[idx('GAIN_CREDIT')]) : null,
        end: idx('END_TURN') >= 0 ? r1(vals[idx('END_TURN')]) : null,
        // the value of the move beta chose, among holdCand's compared
        others: hp.cands.map((a: GameAction, j: number) => [a.type, r1(vals[j])]),
      };
    }
    // Row 35's trace on class boards: was the credit compared, and did its playout reach the operation
    if (cls.length && b.plan) {
      const j = b.plan.cands.findIndex((a: GameAction) => a.type === 'GAIN_CREDIT');
      const ids = new Set(cls.map(c => c.id));
      row.saveTrace = {
        creditInK: j >= 0,
        creditV: j >= 0 ? r1(b.plan.values[j]) : null,
        bestV: r1(Math.max(...(b.plan.values as number[]).filter(Number.isFinite))),
        creditLinePlays: j >= 0 ? (b.plan.lines[j] as GameAction[]).some(a => a.type === 'PLAY_OPERATION_OR_EVENT' && ids.has((a as any).cardInstanceId)) : null,
        anyLinePlays: (b.plan.lines as GameAction[][]).some(l => l.some(a => a.type === 'PLAY_OPERATION_OR_EVENT' && ids.has((a as any).cardInstanceId))),
        creditAt: b.rec?.creditAt ?? null,
        creditLine: b.rec?.creditLine ?? null,
      };
    }
  }
  out(row);

  if (PARTS.has('cont')) {
    for (const [what, a, b] of fires) {
      const n = (perSrc[what] = (perSrc[what] ?? 0) + 1);
      if (n > CAP) continue;
      pair(d.src, d.who, d.i, what, s, a, b, d.heldAfter, d.heldAfter);
    }
    if (PARTS.has('asks'))
      for (const arm of B_ARMS) {
        const x = asks[arm];
        const b = asks.beta;
        if (x.k === b.k || !x.a || !b.a) continue;
        const n = (perSrc[arm] = (perSrc[arm] ?? 0) + 1);
        if (n > CAP) continue;
        pair(d.src, d.who, d.i, arm, s, x.a, b.a, x.held, b.held);
      }
  }
  asks = {};
}

// ------------------------------------------------------------------------------------------------ games
function playWhole(t: Tree, seed: number, watch?: (s: GameState, a: GameAction | null) => void) {
  t.clear();
  const g = new t.GameRunner(dealState(seed), { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') });
  const alarms = new AlarmTracker();
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  for (let n = 0; n < 4000; n++) {
    const s: GameState = g.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    if (!g.step()) break;
    alarms.step(s, g.state, g.last ?? undefined);
    watch?.(g.state, g.last ?? null);
  }
  (alarms as any).done?.(g.state);
  const counts: Record<string, number> = {};
  for (const al of alarms.alarms) counts[al.kind] = (counts[al.kind] ?? 0) + 1;
  return { winner: g.state.winner ?? null, T: g.state.turnNumber, cs: g.state.corp.score, rs: g.state.runner.score, cr, sc, alarms: counts };
}

async function main() {
  const dirs = makeTrees(root, ARMS);
  trees = {};
  for (const arm of ARMS) trees[arm] = await loadTree(arm, dirs[arm]);
  const record: { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] }[] = JSON.parse(readFileSync('scripts/stage-d/post-pick-deals.json', 'utf8'));
  const want = (process.env.DEALS ?? '').split(',').filter(Boolean);
  const dealList = want.includes('none') ? [] : record.filter(r => !want.length || want.includes(String(r.seed)));
  const hdir = 'tests/fixtures/human-games';
  const hwant = (process.env.HUMAN ?? '').split(',').filter(Boolean);
  const humans = hwant.includes('none')
    ? []
    : readdirSync(hdir)
        .filter(f => f.endsWith('.json') && (!hwant.length || hwant.some(w => f.startsWith(w))))
        .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b));
  // Human files first in the shard order, spread over the shards (they are few and long)
  const sources: { kind: 'deal' | 'human'; id: any }[] = [...humans.map(f => ({ kind: 'human' as const, id: f })), ...dealList.map(r => ({ kind: 'deal' as const, id: r }))];

  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    const t0 = performance.now();
    const perSrc: Record<string, number> = {};
    if (src.kind === 'deal') {
      const rec = src.id as (typeof record)[number];
      const name = `deal:${rec.seed}`;
      const t = trees.source;
      t.clear();
      const decs: Dec[] = [];
      const inner = t.createAgent('corp', 'normal');
      let i = 0;
      const corp = new Proxy(inner, {
        get(target, prop, recv) {
          const v = Reflect.get(target, prop, recv);
          if (prop !== 'chooseAction' || typeof v !== 'function') return v;
          return (s: GameState) => {
            const copy = structuredClone(s);
            const heldBefore = structuredClone(inner.memory?.heldLine ?? null);
            G.__ppRec = null;
            const a = v.call(target, s);
            const r = G.__ppRec;
            G.__ppRec = null;
            if (r && !r.turnStart && r.clicks > 0) decs.push({ src: name, who: 'self', i: i++, s: copy, heldBefore, heldAfter: structuredClone(inner.memory?.heldLine ?? null), rec: r, action: a });
            return a;
          };
        },
      });
      const g = new t.GameRunner(dealState(rec.seed), { corp, runner: t.createAgent('runner', 'normal') });
      const alarms = new AlarmTracker();
      const cr: number[] = [];
      const sc: number[] = [];
      let lastTurn = -1;
      // C1 fates: each class card's first sighting and when it left HQ (played by the Corp, or otherwise)
      const fate = new Map<string, { title: string; first: number; reach: string; left?: number; how?: string; boards: number }>();
      let at = 0;
      for (let n = 0; n < 4000; n++) {
        const s: GameState = g.state;
        if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
          cr.push(s.corp.credits);
          sc.push(s.corp.score);
          lastTurn = s.turnNumber;
        }
        if (!g.step()) break;
        alarms.step(s, g.state, g.last ?? undefined);
        for (; at < decs.length; at++) {
          for (const c of saveClass(trees.beta, decs[at].s)) {
            const f = fate.get(c.id) ?? fate.set(c.id, { title: c.title, first: decs[at].s.turnNumber, reach: c.reach, boards: 0 }).get(c.id)!;
            f.boards++;
            if (c.reach === 'now') f.reach = 'now';
          }
        }
        for (const [id, f] of fate) {
          if (f.left !== undefined || g.state.corp.hq.some(c => c.instanceId === id)) continue;
          f.left = g.state.turnNumber;
          const last = g.last as any;
          f.how = last?.type === 'PLAY_OPERATION_OR_EVENT' && last.cardInstanceId === id ? 'played' : `left (${last?.type ?? '?'})`;
        }
      }
      (alarms as any).done?.(g.state);
      const counts: Record<string, number> = {};
      for (const al of alarms.alarms) counts[al.kind] = (counts[al.kind] ?? 0) + 1;
      const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
      const fires = decs.map(d => fireOf(d.rec, d.action));
      out({
        kind: 'g',
        src: name,
        decks: `${rec.corpDeck} v ${rec.runnerDeck}`,
        winner: g.state.winner ?? null,
        T: g.state.turnNumber,
        cs: g.state.corp.score,
        rs: g.state.runner.score,
        matchesBatch: matches,
        ...(matches ? {} : { cr, sc, recCr: rec.cr, recSc: rec.sc, recWinner: rec.winner }),
        decisions: decs.length,
        M: fires.filter(f => f.M).length,
        T_: fires.filter(f => f.T).length,
        V: fires.filter(f => f.V).length,
        alarms: counts,
      });
      for (const [id, f] of fate) out({ kind: 'cls', src: name, who: 'self', id, ...f, unplayedTurns: (f.left ?? g.state.turnNumber) - f.first, endT: g.state.turnNumber });
      if (PARTS.has('fire')) for (const d of decs) decision(d, perSrc);
      if (PARTS.has('a3'))
        for (const arm of A3_ARMS) {
          const r = playWhole(trees[arm], rec.seed);
          out({ kind: 'a3', src: name, arm, ...r, base: { winner: g.state.winner ?? null, T: g.state.turnNumber, cs: g.state.corp.score, rs: g.state.runner.score, alarms: counts }, differs: r.winner !== (g.state.winner ?? null) || key(r.cr) !== key(cr) || key(r.sc) !== key(sc) });
        }
    } else {
      const file = join(hdir, src.id as string);
      const r = JSON.parse(readFileSync(file, 'utf8'));
      const who = r.config.ai === 'corp' ? 'humanRunner' : 'humanCorp';
      const name = `human:${src.id}`;
      if (!r.moves?.length) continue;
      const core = trees.beta.core;
      let s: GameState;
      if (r.startsAt === 'state') s = structuredClone(r.state);
      else {
        s = core.createInitialGameState(trees.beta.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
        if (r.startStops) s = { ...s, stops: r.startStops };
      }
      let stopped: string | null = null;
      let n = 0;
      for (const [j, move] of (r.moves as GameAction[]).entries()) {
        // C3: the order pin D3 #50 #252 (the Top-Down Solutions install prompt): every tree's answer
        if (src.id === 'report-50.json' && j === 252) {
          const ans = Object.fromEntries(ASKED.map(arm => [arm, ask(trees[arm], s, null).k.slice(0, 200)]));
          out({ kind: 'pin', src: name, move: j, prompt: core.activePrompt(s)?.kind ?? null, recorded: key(move).slice(0, 200), answers: ans });
        }
        if (PARTS.has('fire') && !s.winner && core.actingSide(s) === 'corp' && s.activePlayer === 'corp' && !core.activePrompt(s) && !s.activeRun && s.corp.clicks > 0) {
          const b = ask(trees.beta, s, null);
          if (b.rec && !b.rec.turnStart && b.rec.clicks > 0 && b.a) decision({ src: `${name}#${j}`, who, i: n++, s: structuredClone(s), heldBefore: null, heldAfter: b.held, rec: b.rec, action: b.a }, perSrc);
        }
        try {
          s = core.executeAction(s, move);
        } catch (e) {
          stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
          break;
        }
      }
      out({ kind: 'h', src: name, who, moves: r.moves.length, decisions: n, stopped });
    }
    out({ kind: 's', src: src.kind === 'deal' ? `deal:${src.id.seed}` : `human:${src.id}`, ms: Math.round(performance.now() - t0) });
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
