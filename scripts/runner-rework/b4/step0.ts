/**
 * B4 step 0 (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/b4-hidden-zones.md rev 0), parts 2 to 4, on the
 * g1 base 45794820047 (221 deals) and the NRDB g1 base 45800011213 (110 deals) at beta 85a89eb, and on Jeff's saved
 * games (tests/fixtures/human-games, tests/fixtures/runner-issues). Measurement only: no src change, nothing decided.
 * Notes: runner-rework/b4/step0.md.
 *
 * Trees (trees.ts): `source` plays each deal by a plain GameRunner, Normal v Normal (or replays a saved game's moves), and
 * is never asked or cleared mid-game. `shadowW` replays the same actions in lockstep with the W engine patch (a shuffle
 * widens the Runner's R&D marks instead of emptying them), so its state is the source state with the widened marks. Every
 * question is asked after the game, of `probe` (control and arms H, Ra, Rad, Rb) or `probeW` (arm W, on the shadow's
 * state), on a structuredClone, by a one-step GameRunner with fresh agents restored from the source agents' fields
 * (HIDDEN-READ: the script reads them; no agent reads another's). A saved game's asks use fresh agents with the
 * script-kept Runner map (runnerAI.ts `remember`, written out here) and only the AI side is asked.
 *
 * The rule shadow (HIDDEN-READ for bookkeeping only; what widens uses only what the Runner sees): an entry per card the
 * Runner can name in HQ, R&D or facedown Archives (seen going in, or marked by the engine there), with the zones it can be
 * in. An unidentified departure from zone Z to D (the Runner sees a card leave Z for D, not which: rules 10.2.2a, 1.12.3)
 * adds D to every entry that holds Z (the rules thread, 2026-11-19 19:13Z: "that zone or where the card went"); a seen
 * departure moves the entry; a card that turns public ends it. A whole zone that leaves for one place is seen.
 * Shuffles change no entry (4.2.2, 8.7.3).
 *
 * Arms (all asked on the same board as the control; a change = the arm's answer differs from the control's):
 *  W    the widened R&D marks (probeW on the shadow's state): every decision where the shadow's rdKnownToRunner differs
 *  H    the Runner's map without its hidden-zone entries (entries whose card is in HQ, R&D or facedown Archives): what
 *       readers of the state's marks alone answer before an Archives mark exists (arm H of the memory fix, plan.md:311)
 *  Ra   #66b: a facedown root card proved not an agenda by open information (class A: an agenda scored or stolen from its
 *       root while it stayed; class C: it shares its root with an agenda or asset the Runner knows; rules 4.6.6e, 8.5.6a)
 *       is priced at agenda odds 0 by `remoteAgendaOdds` (both its readers: serverWorth and boardNeed's remoteAgendaChance)
 *  Rad  Ra and the deal: those slots are dealt an upgrade (the second reader of the same fact)
 *  Rb   class B, two or more facedown cards in one remote root (at most one agenda or asset): each card's odds is the
 *       pool's A / (U + k (A + S)) (A, S, U the agendas, assets, upgrades of the pool remoteAgendaOdds counts; k cards),
 *       raised by the ice as `iceBump` does. A sizing arm only: its formula is the script's.
 *
 * Lines (JSON; sums in step0-sum.mjs):
 *  'g'    per game: whether the source game matches the batch record (winner, cr, sc), decisions, shuffles, ms
 *  'site' per game: every hidden-zone gain or loss seen, counted by zone | in/out | other place | identified | label
 *  'mk'   per game: the marks gap at the Runner's decisions (part 2)
 *  'ask'  per game: asks and changes by arm | side | kind, and ms (parts 2 to 4)
 *  'ch'   a changed decision
 *  'r13'  per Runner main decision with a class A, C or B card: odds and serverValue today and read as the arm (part 3)
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/b4/step0.ts
 *   ARGS="POOL=batch DEALS=1001 LIMIT=1" npx vite-node scripts/runner-rework/b4/step0.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CardInstance, GameAction, GameState } from '../../../src/core';
import { ALL_DECKS } from '../../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../../nrdb-test-decks';
import { Tree, loadTree } from '../facts-trees';
import { TREES, TreeName, makeB4Trees } from './trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const POOLS = (process.env.POOL ?? 'batch,nrdb,jeff').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const LIMIT = Number(process.env.LIMIT ?? 0);
const CORP_CAP = Number(process.env.CORP_CAP ?? 30);
const RUNNER_CAP = Number(process.env.RUNNER_CAP ?? 400);
const WIDEN = process.env.WIDEN ?? 'kind';
const ARMS = (process.env.ARMS ?? 'W,H,Ra,Rad,Rb').split(',');
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/b4-step0', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const key = (a: unknown) => JSON.stringify(a ?? null);
const r4 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : x > 0 ? 'Inf' : '-Inf');

interface T4 {
  T: Tree;
  H: any; // core/engine/helpers.ts
  RR: any; // ai/runnerReply.ts
  TP: any; // ai/turnPlanner.ts
}
let X: Record<TreeName, T4>;
const S = () => X.source.T;
const def = (code: string) => S().core.getCardDefinition(code);
const typeOf = (code: string) => def(code)?.type_code as string;
const title = (code: string) => def(code)?.title ?? code;

// ------------------------------------------------------------------------------------------------ agents
type Snap = Record<string, unknown>;
function snapAgent(agent: any): Snap {
  const s: Snap = {};
  for (const [k, v] of Object.entries(agent)) {
    if (typeof v === 'function') continue;
    try {
      s[k] = structuredClone(v);
    } catch {
      /* not cloneable: left as the fresh agent has it */
    }
  }
  return s;
}
function restore(fresh: any, snap: Snap | undefined) {
  if (!snap) return fresh;
  for (const [k, v] of Object.entries(snap)) {
    const cur = fresh[k];
    if (cur && typeof cur === 'object' && !Array.isArray(cur) && !(cur instanceof Map) && !(cur instanceof Set) && Object.getPrototypeOf(cur) !== Object.prototype) Object.assign(cur, structuredClone(v));
    else fresh[k] = structuredClone(v);
  }
  return fresh;
}

type Hook = { odds?: (s: GameState, server: any, card: CardInstance, trap: number) => number | undefined; deal?: (card: CardInstance) => boolean };
/** One decision asked of `tree` on a copy: a one-step GameRunner with fresh agents restored from the snaps. */
function ask(tree: 'probe' | 'probeW', s: GameState, snaps: { runner?: Snap; corp?: Snap }, memory: Map<string, string> | undefined, hook?: Hook): { a: string; ms: number } {
  const t = X[tree].T;
  t.clear();
  const runner = restore(t.createAgent('runner', 'normal'), snaps.runner);
  if (memory) runner.memory = new Map(memory);
  const corp = restore(t.createAgent('corp', 'normal'), snaps.corp);
  const g = new t.GameRunner(structuredClone(s), { corp, runner });
  const t0 = performance.now();
  (globalThis as any)[`__B4_${tree}`] = hook;
  try {
    g.step();
    return { a: key(g.last), ms: performance.now() - t0 };
  } catch (e) {
    return { a: `error: ${(e as Error).message.slice(0, 100)}`, ms: performance.now() - t0 };
  } finally {
    delete (globalThis as any)[`__B4_${tree}`];
  }
}

type Kind = 'main' | 'run' | 'prompt' | 'rez' | 'off';
function decisionOf(core: any, s: GameState): { side: 'corp' | 'runner'; kind: Kind } | null {
  const side = core.actingSide(s);
  if (!side || s.winner) return null;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
    if (!core.wantsStop(s, side, w)) return null;
    if (side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server')) return { side, kind: 'rez' };
    if (side === 'runner' && w.step === 'corp_action') return { side, kind: 'off' };
    return null;
  }
  return { side, kind: core.activePrompt(s) ? 'prompt' : s.activeRun ? 'run' : 'main' };
}

// ------------------------------------------------------------------------------------------------ where a card is
type Zone = 'hq' | 'rd' | 'arch';
const HIDDEN: Zone[] = ['hq', 'rd', 'arch'];
const zoneCards = (s: GameState, z: Zone): CardInstance[] => (z === 'hq' ? s.corp.hq : z === 'rd' ? s.corp.rd : s.corp.archives.faceDown);
function place(s: GameState, id: string): string {
  for (const z of HIDDEN) if (zoneCards(s, z).some(c => c.instanceId === id)) return z;
  for (const sv of Object.values(s.corp.servers)) {
    if (sv.root.some(c => c.instanceId === id)) return 'root';
    if (sv.ice.some(c => c.instanceId === id)) return 'ice';
  }
  if (s.corp.archives.faceUp.some(c => c.instanceId === id)) return 'archUp';
  if (s.corp.scoreArea.some(c => c.instanceId === id) || s.runner.scoreArea.some(c => c.instanceId === id)) return 'score';
  return 'other';
}
const isHiddenRoot = (c: CardInstance) => !c.isRezzed && !c.faceUp && !c.runnerKnows;
const knownHqIds = (s: GameState) => new Set<string>(X.source.H.knownInHand(s, 'corp').map((k: any) => k.id));
const rdExactIds = (s: GameState) => new Set<string>((s.corp.rdKnownToRunner ?? []).filter(e => e.lo === e.hi && !e.left && s.corp.rd[e.lo]?.instanceId === e.id).map(e => e.id));
const rdIds = (s: GameState) => new Set<string>((s.corp.rdKnownToRunner ?? []).map(e => e.id));

/** The rule shadow: per card the Runner can name in a hidden zone, the places it can be. */
interface Entry {
  code: string;
  zones: Set<string>;
  origin: string; // how it was learnt: in:<from place> (seen going in), mark:hq, mark:rd
}

function labelOf(prev: GameState, a: GameAction): string {
  const p: any = S().core.activePrompt(prev);
  if (a.type === 'RESOLVE_PROMPT' && p?.source?.cardCode) return `prompt:${title(p.source.cardCode)}:${p.source.step ?? ''}`;
  const id = (a as any).cardInstanceId;
  if (id) {
    const all = [...prev.corp.hq, ...prev.runner.grip, ...Object.values(prev.corp.servers).flatMap(v => [...v.root, ...v.ice]), ...prev.runner.rig.programs, ...prev.runner.rig.hardware, ...prev.runner.rig.resources];
    const c = all.find(x => x.instanceId === id);
    if (c) return `${a.type}:${title(c.cardCode)}`;
  }
  return a.type;
}

interface GameAcc {
  sites: Map<string, number>;
  mk: Map<string, number>;
  asks: Map<string, number>;
  ms: Map<string, number>;
}
const inc = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

/** After one action: the gains and losses of the hidden zones, the shadow's entries updated (HIDDEN-READ bookkeeping). */
function afterAction(prev: GameState, next: GameState, a: GameAction, shadow: Map<string, Entry>, acc: GameAcc) {
  const H = X.source.H;
  const pubPrev: Map<string, string> = H.publicCards(prev);
  const pubNext: Map<string, string> = H.publicCards(next);
  const hqPrev = knownHqIds(prev);
  const hqNext = knownHqIds(next);
  const exactNext = rdExactIds(next);
  const label = labelOf(prev, a);
  const before = new Set(shadow.keys());
  const widen: { from: Zone; to: string }[] = [];
  for (const z of HIDDEN) {
    const was = zoneCards(prev, z);
    const now = zoneCards(next, z);
    const nowIds = new Set(now.map(c => c.instanceId));
    const wasIds = new Set(was.map(c => c.instanceId));
    const left = was.filter(c => !nowIds.has(c.instanceId));
    const dests = left.map(c => place(next, c.instanceId));
    const wholeZone = now.length === 0 && left.length > 0 && new Set(dests).size === 1;
    left.forEach((c, i) => {
      const id = c.instanceId;
      const to = dests[i];
      const seen = pubNext.has(id) || (to === 'hq' && hqNext.has(id) && !hqPrev.has(id)) || (to === 'rd' && exactNext.has(id)) || wholeZone;
      inc(acc.sites, `${z}|out|${to}|${seen ? 'seen' : 'unseen'}|${label}`);
      const e = shadow.get(id);
      if (seen) {
        if (pubNext.has(id)) shadow.delete(id);
        else if (e) e.zones = new Set([to]);
        else if (HIDDEN.includes(to as Zone)) shadow.set(id, { code: c.cardCode, zones: new Set([to]), origin: `in:${z}` });
      } else widen.push({ from: z, to });
    });
    for (const c of now) {
      if (wasIds.has(c.instanceId)) continue;
      const id = c.instanceId;
      const from = place(prev, id);
      const seen = pubPrev.has(id) || (z === 'hq' && hqNext.has(id)) || (z === 'rd' && rdIds(next).has(id)) || (shadow.get(id)?.zones.size === 1 && shadow.get(id)!.zones.has(from));
      inc(acc.sites, `${z}|in|${from}|${seen ? 'seen' : 'unseen'}|${label}`);
      if (seen && !shadow.has(id)) shadow.set(id, { code: c.cardCode, zones: new Set([z]), origin: `in:${from}` });
      else if (seen) shadow.get(id)!.zones = new Set([z]);
    }
  }
  // An unidentified departure widens every entry that was there before this action ("that zone or where the card went")
  // A card installed as ice is an ice, one installed in a root an agenda, asset or upgrade (rules 2.3, 8.5.6): only an
  // entry whose card could be that kind widens to the installed place (WIDEN=any: every entry widens)
  const fits = (code: string, to: string) => WIDEN === 'any' || (to === 'ice' ? typeOf(code) === 'ice' : to === 'root' ? ['agenda', 'asset', 'upgrade'].includes(typeOf(code)) : true);
  for (const { from, to } of widen)
    for (const id of before) {
      const e = shadow.get(id);
      if (e?.zones.has(from) && fits(e.code, to)) e.zones.add(to);
    }
  // The engine's own marks name cards too (an access in HQ or R&D, a reveal)
  for (const id of hqNext) if (!hqPrev.has(id) && next.corp.hq.some(c => c.instanceId === id)) shadow.set(id, { code: next.corp.hq.find(c => c.instanceId === id)!.cardCode, zones: new Set(['hq']), origin: shadow.get(id)?.origin ?? 'mark:hq' });
  for (const e of next.corp.rdKnownToRunner ?? []) if (!shadow.has(e.id) && next.corp.rd.some(c => c.instanceId === e.id)) shadow.set(e.id, { code: e.code, zones: new Set(['rd']), origin: 'mark:rd' });
  // A card that turned public, or that is no longer in any hidden zone or root it could be in, is not followed
  for (const [id, e] of shadow) {
    const p = place(next, id);
    if (pubNext.has(id) || !(HIDDEN.includes(p as Zone) || p === 'root' || p === 'ice')) shadow.delete(id);
    else if (!e.zones.has(p)) inc(acc.mk, `shadowMiss:${p}`); // HIDDEN-READ check: the card is where the shadow says it can't be
  }
}

// ------------------------------------------------------------------------------------------------ #66b classes
/** Per hidden root card proved not an agenda (A: beside an agenda scored or stolen from its root; C: beside a known agenda or asset). */
function updateProved(prev: GameState, next: GameState, proved: Map<string, 'A' | 'C'>) {
  for (const [sid, sv] of Object.entries(next.corp.servers)) {
    if (!sv.isRemote) continue;
    const known = sv.root.filter(c => !isHiddenRoot(c) && ['agenda', 'asset'].includes(typeOf(c.cardCode)));
    if (known.length) for (const c of sv.root) if (isHiddenRoot(c) && !proved.has(c.instanceId)) proved.set(c.instanceId, 'C');
    const was = prev.corp.servers[sid];
    if (!was) continue;
    const scored = was.root.filter(c => typeOf(c.cardCode) === 'agenda' && place(next, c.instanceId) === 'score');
    if (scored.length) for (const c of sv.root) if (isHiddenRoot(c) && was.root.some(x => x.instanceId === c.instanceId) && !proved.has(c.instanceId)) proved.set(c.instanceId, 'A');
  }
  // A proved card is followed while it stays installed facedown in a root
  const roots = new Map(Object.values(next.corp.servers).flatMap(v => v.root.map(c => [c.instanceId, c] as const)));
  for (const id of [...proved.keys()]) {
    const c = roots.get(id);
    if (!c || !isHiddenRoot(c)) proved.delete(id);
  }
}
/** Remotes with two or more hidden root cards, none proved, no known agenda or asset (class B). */
function classB(s: GameState, proved: Map<string, 'A' | 'C'>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [sid, sv] of Object.entries(s.corp.servers)) {
    if (!sv.isRemote) continue;
    const hidden = sv.root.filter(isHiddenRoot);
    if (hidden.length >= 2 && !hidden.some(c => proved.has(c.instanceId))) out.set(sid, hidden.map(c => c.instanceId));
  }
  return out;
}
const iceBump = (base: number, server: { ice: unknown[] }) => Math.min(0.9, base + (1 - base) * Math.min(0.45, 0.15 * server.ice.length));
/** Rb's odds for a card of a class B root (the pool remoteAgendaOdds counts, read on the state it is handed). */
function rbOdds(s: GameState, card: CardInstance): number | undefined {
  if (card.advancementCounters > 0 || !isHiddenRoot(card)) return undefined;
  const sv = Object.values(s.corp.servers).find(v => v.isRemote && v.root.some(c => c.instanceId === card.instanceId));
  if (!sv) return undefined;
  const k = sv.root.filter(isHiddenRoot).length;
  if (k < 2 || sv.root.some(c => !isHiddenRoot(c) && ['agenda', 'asset'].includes(typeOf(c.cardCode)))) return undefined;
  const corp = [...s.corp.hq, ...s.corp.rd, ...s.corp.archives.faceDown, ...Object.values(s.corp.servers).flatMap(v => v.root.filter(c => !c.isRezzed && !c.faceUp && !c.runnerKnows))];
  const kinds = corp.map(c => typeOf(c.cardCode));
  const A = kinds.filter(t => t === 'agenda').length;
  const As = kinds.filter(t => t === 'asset').length;
  const U = kinds.filter(t => t === 'upgrade').length;
  const d = U + k * (A + As);
  return iceBump(d > 0 ? A / d : 0, sv);
}

// ------------------------------------------------------------------------------------------------ one game
interface Board {
  n: number;
  T: number;
  side: 'corp' | 'runner';
  kind: Kind;
  s: GameState;
  sw?: GameState;
  snaps: { runner?: Snap; corp?: Snap };
  memory: Map<string, string>;
  played: string;
  arms: string[];
  proved: [string, 'A' | 'C'][];
  rb: [string, string[]][];
}

type Driver = { kind: 'deal'; pool: string; rec: Rec } | { kind: 'saved'; pool: 'jeff'; file: string };
type Rec = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];

/** The Runner's map as runnerAI.ts `remember` keeps it (saved games: no source agent). */
function rememberInto(memory: Map<string, string>, s: GameState) {
  for (const server of Object.values(s.corp.servers))
    for (const card of server.root) {
      if (card.isRezzed || card.faceUp || card.runnerKnows) memory.set(card.instanceId, card.cardCode);
      else memory.delete(card.instanceId);
    }
}

function playGame(d: Driver) {
  const t0 = performance.now();
  const src = d.kind === 'deal' ? `${d.pool}:${d.rec.seed}` : `jeff:${d.file.split('/').pop()}`;
  for (const n of TREES) X[n].T.clear();
  const acc: GameAcc = { sites: new Map(), mk: new Map(), asks: new Map(), ms: new Map() };
  const sc = S();
  let s: GameState;
  let sw: GameState;
  let moves: GameAction[] | null = null;
  let aiSide: 'corp' | 'runner' | 'both' = 'both';
  let g: any = null;
  let ag: any = null;
  if (d.kind === 'deal') {
    const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.rec.corpDeck);
    const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.rec.runnerDeck);
    if (!c || !r) throw new Error(`deal ${d.rec.seed}: deck not found`);
    ag = { corp: sc.createAgent('corp', 'normal'), runner: sc.createAgent('runner', 'normal') };
    g = new sc.GameRunner(sc.core.createInitialGameState(sc.decks.deckGameSetup(d.rec.seed, c, r)), ag);
    s = g.state;
    const w0 = X.shadowW.T.core.createInitialGameState(X.shadowW.T.decks.deckGameSetup(d.rec.seed, c, r));
    sw = { ...w0, stops: { corp: 'ai', runner: 'ai' } };
  } else {
    const r = JSON.parse(readFileSync(d.file, 'utf8'));
    if (!r.moves?.length) return;
    moves = r.moves;
    aiSide = r.config.ai === 'corp' ? 'corp' : 'runner';
    const mk = (t: Tree): GameState => {
      if (r.startsAt === 'state') return structuredClone(r.state);
      const st = t.core.createInitialGameState(t.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
      return r.startStops ? { ...st, stops: r.startStops } : st;
    };
    s = mk(sc);
    sw = mk(X.shadowW.T);
  }
  const shadow = new Map<string, Entry>();
  const proved = new Map<string, 'A' | 'C'>();
  const memory = new Map<string, string>();
  const boards: Board[] = [];
  const cr: number[] = [];
  const scs: number[] = [];
  let lastTurn = -1;
  let wOk = true;
  let shuffles = 0;
  let decisions = 0;
  const corpCount = new Map<string, number>();
  const runnerCount = new Map<string, number>();
  const prices: R13Board[] = [];
  for (let n = 0; n < (moves ? moves.length : 4000); n++) {
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      scs.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    // ---- the board before this step: what the shadow, the proofs and the map hold now
    const dec = decisionOf(sc.core, moves ? ({ ...s, stops: { corp: 'ai', runner: 'ai' } } as GameState) : s);
    let board: Board | null = null;
    if (dec) {
      decisions++;
      if (g) {
        memory.clear();
        for (const [k, v] of (ag.runner as any).memory ?? []) memory.set(k, v); // HIDDEN-READ: the source Runner's map, read only
      } else if (dec.side === 'runner') rememberInto(memory, s);
      const snaps = g ? { runner: snapAgent(ag.runner), corp: snapAgent(ag.corp) } : {};
      const ac = [...proved];
      const rb = [...classB(s, proved)];
      const wDiff = wOk && key(s.corp.rdKnownToRunner ?? []) !== key(sw.corp.rdKnownToRunner ?? []);
      if (dec.side === 'runner') markGap(s, wOk ? sw : undefined, memory, shadow, acc);
      if (wDiff) inc(acc.mk, `wDiff:${dec.side}`);
      if (ac.length) inc(acc.mk, `classAC:${dec.side}:${dec.kind}`);
      if (ac.some(([, c]) => c === 'A')) inc(acc.mk, `classA:${dec.side}:${dec.kind}`);
      if (rb.length) inc(acc.mk, `classB:${dec.side}:${dec.kind}`);
      const arms: string[] = [];
      const want = (arm: string) => ARMS.includes(arm) && arms.push(arm);
      if (aiSide === 'both' || aiSide === dec.side) {
        if (wDiff) want('W');
        if (dec.side === 'runner' && [...memory.keys()].some(id => HIDDEN.includes(place(s, id) as Zone))) want('H');
        if (ac.length) {
          want('Ra');
          want('Rad');
        }
        if (rb.length) want('Rb');
      }
      const counter = dec.side === 'corp' ? corpCount : runnerCount;
      const cap = dec.side === 'corp' ? CORP_CAP : RUNNER_CAP;
      const kept = arms.filter(arm => {
        const c = counter.get(arm) ?? 0;
        if (c >= cap) {
          inc(acc.asks, `capped|${arm}|${dec.side}|${dec.kind}`);
          return false;
        }
        counter.set(arm, c + 1);
        return true;
      });
      if (dec.side === 'runner' && dec.kind === 'main' && (ac.length || rb.length) && (aiSide === 'both' || aiSide === 'runner')) prices.push({ T: s.turnNumber, s: structuredClone(s), memory: new Map(memory), ac, rb, played: '' });
      if (kept.length) board = { n, T: s.turnNumber, side: dec.side, kind: dec.kind, s: structuredClone(s), sw: kept.includes('W') ? structuredClone(sw) : undefined, snaps, memory: new Map(memory), played: '', arms: kept, proved: ac, rb };
    }
    // ---- the step
    const sBefore = s;
    let a: GameAction;
    if (g) {
      if (!g.step()) break;
      a = g.last;
      s = g.state;
    } else {
      a = moves![n];
      try {
        s = sc.core.executeAction(s, a);
      } catch {
        break;
      }
    }
    if (board) {
      board.played = key(a);
      boards.push(board);
    }
    if (dec?.side === 'runner' && prices.length && prices[prices.length - 1].played === '') prices[prices.length - 1].played = key(a);
    if (wOk) {
      try {
        sw = X.shadowW.T.core.executeAction(sw, a);
      } catch (e) {
        wOk = false;
        out({ kind: 'err', src, n, what: 'shadowW', e: (e as Error).message.slice(0, 120) });
      }
      const fp = (x: GameState) => key([x.turnNumber, x.corp.credits, x.runner.credits, x.corp.hq.map(c => c.instanceId), x.corp.rd.map(c => c.instanceId), x.corp.archives.faceDown.length]);
      if (wOk && fp(sw) !== fp(s)) {
        wOk = false;
        out({ kind: 'err', src, n, what: 'shadowW diverged' });
      }
    }
    // A shuffle that emptied marks the rule keeps (the source's list emptied, the shadow's widened)
    if (wOk && (sBefore.corp.rdKnownToRunner ?? []).length > 0 && (s.corp.rdKnownToRunner ?? []).length === 0 && (sw.corp.rdKnownToRunner ?? []).length > 0) {
      shuffles++;
      inc(acc.mk, 'shuffleLoss:events');
      inc(acc.mk, 'shuffleLoss:entries', (sBefore.corp.rdKnownToRunner ?? []).length);
      inc(acc.mk, 'shuffleLoss:widenedKept', (sw.corp.rdKnownToRunner ?? []).length);
      inc(acc.sites, `rd|shuffle|rd|marks emptied|${labelOf(sBefore, a)}`);
    }
    afterAction(sBefore, s, a, shadow, acc);
    updateProved(sBefore, s, proved);
  }
  const matches = d.kind === 'deal' ? (s.winner ?? null) === d.rec.winner && key(cr) === key(d.rec.cr) && key(scs) === key(d.rec.sc) : null;
  // ---- the asks, after the game (the source tree is never interleaved with the probe's asks)
  for (const b of boards) askBoard(src, b, acc);
  for (const b of prices) r13Prices(src, b);
  const pool = d.kind === 'deal' ? d.pool : 'jeff';
  out({ kind: 'g', src, pool, matchesBatch: matches, decisions, shuffles, wOk, boards: boards.length, T: s.turnNumber, winner: s.winner ?? null, ms: Math.round(performance.now() - t0) });
  out({ kind: 'site', src, pool, sites: Object.fromEntries(acc.sites) });
  out({ kind: 'mk', src, pool, mk: Object.fromEntries(acc.mk) });
  out({ kind: 'ask', src, pool, asks: Object.fromEntries(acc.asks), ms: Object.fromEntries([...acc.ms].map(([k, v]) => [k, Math.round(v)])) });
}

// ------------------------------------------------------------------------------------------------ part 2: the marks gap
/** At a Runner decision: the state's marks, the shadow's and the map's hidden-zone entries side by side. */
function markGap(s: GameState, sw: GameState | undefined, memory: Map<string, string>, shadow: Map<string, Entry>, acc: GameAcc) {
  const m = acc.mk;
  inc(m, 'runnerDecisions');
  const hqList = X.source.H.knownInHand(s, 'corp') as { id: string; code: string }[];
  const hqIds = new Set(hqList.map(e => e.id));
  const rd = rdIds(s);
  const shapeOf = (e: Entry | undefined) => (!e ? 'none' : e.zones.size === 1 ? 'exact' : e.zones.has('root') || e.zones.has('ice') ? 'wideInstalled' : 'wideHidden');
  if (hqList.length) inc(m, 'hqList:decisions');
  inc(m, 'hqList:entries', hqList.length);
  // HIDDEN-READ: a listed card that is no longer in HQ (today the list still says HQ; hqAgendaOdds counts it there)
  const gone = hqList.filter(e => !s.corp.hq.some(c => c.instanceId === e.id));
  if (gone.length) inc(m, 'hqList:decisionsWithGone');
  inc(m, 'hqList:gone', gone.length);
  for (const e of hqList) inc(m, `hqList:shadow:${shapeOf(shadow.get(e.id))}`);
  if ((s.corp.rdKnownToRunner ?? []).length) inc(m, 'rdList:decisions');
  inc(m, 'rdList:entries', (s.corp.rdKnownToRunner ?? []).length);
  if (sw) {
    if ((sw.corp.rdKnownToRunner ?? []).length) inc(m, 'rdW:decisions');
    inc(m, 'rdW:entries', (sw.corp.rdKnownToRunner ?? []).length);
    if ((sw.corp.rdKnownToRunner ?? []).length > (s.corp.rdKnownToRunner ?? []).length) inc(m, 'rdW:decisionsMore');
  }
  // The shadow's entries by where the card is (HIDDEN-READ) and how wide the rule leaves them
  const byZone = new Map<string, number>();
  for (const [id, e] of shadow) {
    const z = place(s, id);
    inc(m, `shadow:${z}:${shapeOf(e)}`);
    inc(byZone, `${z}:${shapeOf(e)}`);
    if (z === 'hq' && !hqIds.has(id)) inc(m, `shadow:hq:notListed:${e.origin}`);
    if (z === 'rd' && !rd.has(id)) inc(m, `shadow:rd:notListed:${e.origin}`);
  }
  if ([...byZone.keys()].some(k => k.startsWith('arch:'))) inc(m, 'archMark:decisions');
  if (byZone.has('arch:exact')) inc(m, 'archMark:decisionsExact');
  if ([...byZone.keys()].some(k => k.startsWith('hq:') && !k.endsWith('exact'))) inc(m, 'hqWide:decisions');
  // The map's hidden-zone entries: covered by the state's marks, by the widened R&D marks, and the rule's shape
  let any = false;
  for (const [id] of memory) {
    const z = place(s, id);
    if (!HIDDEN.includes(z as Zone)) continue;
    any = true;
    const src = z === 'hq' ? hqIds.has(id) : z === 'rd' ? rd.has(id) : false;
    const w = z === 'rd' && !!sw && rdIds(sw).has(id);
    inc(m, `map:${z}:marks${src ? 1 : 0}:w${w ? 1 : 0}:${shapeOf(shadow.get(id))}`);
  }
  if (any) inc(m, 'mapHidden:decisions');
  // The reverse: marks the map does not hold
  for (const e of hqList) if (!memory.has(e.id)) inc(m, 'rev:hq');
  for (const id of rd) if (!memory.has(id)) inc(m, 'rev:rd');
  for (const [id] of shadow) if (place(s, id) === 'arch' && !memory.has(id)) inc(m, 'rev:arch');
}

// ------------------------------------------------------------------------------------------------ part 3: #66b prices
interface R13Board {
  T: number;
  s: GameState;
  memory: Map<string, string>;
  ac: [string, 'A' | 'C'][];
  rb: [string, string[]][];
  played: string;
}
/** Today's odds and serverValue of each class A, C or B remote on the Runner's decision view, and the same read as the arm. */
function r13Prices(src: string, b: R13Board) {
  const P = X.probe;
  const t = P.T;
  t.clear();
  const acSet = new Map(b.ac);
  const rbIds = new Set(b.rb.flatMap(([, ids]) => ids));
  const servers = Object.entries(b.s.corp.servers).filter(([, sv]) => sv.isRemote && sv.root.some(c => acSet.has(c.instanceId) || rbIds.has(c.instanceId)));
  const read = (hook: Hook | undefined) => {
    (globalThis as any).__B4_probe = hook;
    try {
      return t.synergy.asSide('runner', () => {
        const s = structuredClone(b.s);
        t.handValues.decisionContext(s, 'runner');
        const view: GameState = P.TP.runnerDecisionView(s, b.memory);
        const trap = t.runs.trapOdds(view, b.memory);
        return servers.map(([sid]) => {
          const sv = view.corp.servers[sid];
          const odds = sv.root.filter(isHiddenRoot).map(c => ({ id: c.instanceId, cls: acSet.get(c.instanceId) ?? (rbIds.has(c.instanceId) ? 'B' : '-'), odds: r4(t.runs.remoteAgendaOdds(view, sv, c, trap)) }));
          return { sid, odds, value: r4(t.runs.serverValue(view, sid, 0, b.memory, true)) };
        });
      });
    } finally {
      delete (globalThis as any).__B4_probe;
    }
  };
  const today = read(undefined);
  const ra = b.ac.length ? read({ odds: (_s, _v, c) => (acSet.has(c.instanceId) ? 0 : undefined) }) : null;
  const rb = b.rb.length ? read({ odds: (s, _v, c) => (rbIds.has(c.instanceId) ? rbOdds(s, c) : undefined) }) : null;
  out({ kind: 'r13', src, T: b.T, played: b.played, servers: today.map((x: any, i: number) => ({ ...x, ra: ra?.[i] ?? null, rb: rb?.[i] ?? null, ice: b.s.corp.servers[x.sid].ice.length, root: b.s.corp.servers[x.sid].root.length, runsHere: b.played.includes(`"targetServerId":"${x.sid}"`) })) });
}

// ------------------------------------------------------------------------------------------------ the asks
function askBoard(src: string, b: Board, acc: GameAcc) {
  const tag = `${b.side}|${b.kind}`;
  const ctrl = ask('probe', b.s, b.snaps, b.memory);
  inc(acc.asks, `ctrl|${tag}`);
  inc(acc.ms, `ctrl|${tag}`, ctrl.ms);
  if (ctrl.a !== b.played) inc(acc.asks, `ctrlMismatch|${tag}`);
  const acSet = new Set(b.proved.map(([id]) => id));
  const rbIds = new Set(b.rb.flatMap(([, ids]) => ids));
  for (const arm of b.arms) {
    let r: { a: string; ms: number };
    let ctx: unknown;
    if (arm === 'W') {
      r = ask('probeW', b.sw!, b.snaps, b.memory);
      ctx = { rd: b.s.corp.rdKnownToRunner ?? [], rdW: b.sw!.corp.rdKnownToRunner ?? [] };
    } else if (arm === 'H') {
      const hidden = [...b.memory].filter(([id]) => HIDDEN.includes(place(b.s, id) as Zone));
      const mem = new Map([...b.memory].filter(([id]) => !hidden.some(([h]) => h === id)));
      r = ask('probe', b.s, b.snaps, mem);
      ctx = { dropped: hidden.map(([id, code]) => ({ id, code: title(code), at: place(b.s, id) })) };
    } else if (arm === 'Ra' || arm === 'Rad') {
      const hook: Hook = { odds: (_s, _v, c) => (acSet.has(c.instanceId) ? 0 : undefined), ...(arm === 'Rad' && { deal: (c: CardInstance) => acSet.has(c.instanceId) }) };
      r = ask('probe', b.s, b.snaps, b.memory, hook);
      ctx = { proved: b.proved.map(([id, cls]) => ({ id, cls, code: title(b.s.corp.hq.concat(...Object.values(b.s.corp.servers).map(v => v.root)).find(c => c.instanceId === id)?.cardCode ?? '') })) };
    } else {
      r = ask('probe', b.s, b.snaps, b.memory, { odds: (s, _v, c) => (rbIds.has(c.instanceId) ? rbOdds(s, c) : undefined) });
      ctx = { rb: b.rb };
    }
    inc(acc.asks, `${arm}|${tag}`);
    inc(acc.ms, `${arm}|${tag}`, r.ms);
    inc(acc.ms, `ctrl@${arm}|${tag}`, ctrl.ms);
    if (r.a !== ctrl.a) {
      inc(acc.asks, `${arm}|${tag}|changed`);
      out({ kind: 'ch', src, arm, side: b.side, decision: b.kind, T: b.T, n: b.n, played: b.played, ctrl: ctrl.a, arm_a: r.a, ctx });
    }
  }
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const dirs = makeB4Trees(root, shard);
  X = {} as Record<TreeName, T4>;
  for (const name of TREES) {
    const m = (p: string) => import(/* @vite-ignore */ join(dirs[name], 'src', p));
    const T = await loadTree(name, dirs[name]);
    X[name] = { T, H: await m('core/engine/helpers.ts'), RR: await m('ai/runnerReply.ts'), TP: await m('ai/turnPlanner.ts') };
  }
  const sources: Driver[] = [];
  for (const pool of POOLS) {
    if (pool === 'jeff') {
      for (const dir of ['tests/fixtures/human-games', 'tests/fixtures/runner-issues'])
        for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) if (!DEALS.length || DEALS.includes(f)) sources.push({ kind: 'saved', pool: 'jeff', file: join(dir, f) });
      continue;
    }
    const run = pool === 'batch' ? '45794820047' : '45800011213';
    const recs: Rec[] = JSON.parse(readFileSync(`scripts/runner-rework/b4/deals-${run}.json`, 'utf8'));
    for (const r of recs) if (!DEALS.length || DEALS.includes(String(r.seed))) sources.push({ kind: 'deal', pool, rec: r });
  }
  let done = 0;
  for (const [i, d] of sources.entries()) {
    if (i % shards !== shard) continue;
    if (LIMIT && done >= LIMIT) break;
    done++;
    try {
      playGame(d);
    } catch (e) {
      out({ kind: 'err', src: d.kind === 'deal' ? `${d.pool}:${d.rec.seed}` : d.file, e: (e as Error).stack?.slice(0, 300) });
    }
  }
  out({ kind: 's', shard, sources: done });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
