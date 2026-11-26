/**
 * B4 step 0 (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/b4-hidden-zones.md rev 1a), parts 2 to 5, on the
 * g1 base 45794820047 (221 deals) and the NRDB g1 base 45800011213 (110 deals) at beta 85a89eb, and on Jeff's saved
 * games (tests/fixtures/human-games, tests/fixtures/runner-issues). Measurement only: no src change, nothing decided.
 * Notes: runner-rework/b4/step0.md.
 *
 * Trees (trees.ts): `source` plays each deal by a plain GameRunner, Normal v Normal (or replays a saved game's moves), and
 * is never asked or cleared mid-game. `shadowW` replays the same actions in lockstep with the W engine patch (ruling 1,
 * R&D: a shuffle keeps each mark at share 1 / N0). Every question is asked after the game, of `probe` or `probeW`, on a
 * structuredClone, by a one-step GameRunner with fresh agents restored from the source agents' fields (HIDDEN-READ: the
 * script reads them; no agent reads another's). A saved game's asks use fresh agents with the script-kept Runner map
 * (runnerAI.ts `remember`, written out here), and only the AI side is asked.
 *
 * Ruling 1's fields, kept by the script after each action from what each side sees (HIDDEN-READ for bookkeeping only):
 *  - HQ (the engine's knownToRunner list) and the grip (knownToCorp): each entry's time seen, and the times of the zone's
 *    unseen losses (a card left and the other side cannot tell which). Certain count = entries less the losses that can
 *    be matched to an entry seen before them; per code, max(0, entries of the code - matched losses). LOSS=kind (a
 *    recount, not ruling 1 as written): per code, only the losses whose place allows the code's kind (an ice slot: ice;
 *    a root: agenda, asset, upgrade) matched to that code's entries; `hq:certainByKind` counts it either way.
 *  - Facedown Archives: an entry per card seen going in facedown (it was public or known installed before), with the same
 *    count rule over Archives' unseen losses.
 *  - R&D: the engine's marks; after a shuffle the shadow's (share 1 / N0).
 *
 * Arms (one per reader of ruling 7, each against the control on the same board; a change = the answer differs):
 *  a    hqAgendaOdds reads the HQ count: (certain agendas + (size - certain) x odds) / size
 *  b    rdWorth reads the R&D share (probeW on the shadow's state)
 *  c    the Archives price counts facedown cards less the certain Archives marks
 *  d    unseenTraps: the map's entries for cards in HQ, R&D or facedown Archives are not read; the certain marked codes
 *       (HQ and Archives by count, R&D exact) leave the trap pool instead
 *  dH   d, and the map without its hidden-zone entries (is the map then a copy: dH = d?)
 *  e    the deciding Runner's deal keeps no HQ card by id; it puts the certain HQ and Archives codes in their zones
 *  g    the Corp's grip readers (corpSeenGrip, muWorth, winNow) read the grip count by code
 *  R1..R4  root kinds (B4b): (i) a central root card, (ii) beside a known asset or agenda, (iii) beside one that has
 *       left (#66b) are upgrade only (agenda odds 0, trap share 0, dealt an upgrade); (iv) two or more unknown cards in a
 *       remote root: each card's odds A / (U + k (A + S)) of the pool remoteAgendaOdds counts (the script's formula)
 *  S, NB, DV, CR  saveUpTarget, needsBiggerHand, digValue, chainReactionBonus read the Runner's view (asked only where the
 *       view's value differs from the real state's: the fire count)
 *  ALL  a, b, c, d, e, g together on probeW: whole decisions late in a game (T >= 10) with live marks (part 5, time)
 *  ctrlW  probeW with no hook: the W engine patch with every reader skipping it (ruling 3's play-identical prototype)
 * Asks are capped per game, side and arm, chosen evenly across the game; `eligible` counts every board that qualified.
 *
 * Lines (JSON; sums in step0-sum.mjs):
 *  'g'    per game: whether the source game matches the batch record (winner, cr, sc), decisions, shuffles, ms
 *  'site' per game: every hidden-zone gain or loss, by zone | in/out | other place | seen | label
 *  'mk'   per game: the marks under ruling 1 at the Runner's decisions (part 2), mark sources (1b), root cases (part 3),
 *         fire counts (part 4)
 *  'life' per shuffled R&D mark: how long it lived, and its share and truth at each Runner decision (part 2)
 *  'cp'   per Runner main board with a root case: each such remote's odds and serverValue today and under each case (part 3)
 *  'od'   per game: pooled agendaOdds against the marks-aware HQ and R&D odds on Runner main boards with live marks
 *  'ask'  per game: eligible, asked, changed by arm | side | kind, and ms against the control on the same boards
 *  'ch'   a changed decision
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
const CAP = { runner: Number(process.env.RUNNER_CAP ?? 40), corp: Number(process.env.CORP_CAP ?? 12) };
const ALL_CAP = Number(process.env.ALL_CAP ?? 6);
const ARMS = new Set((process.env.ARMS ?? 'a,b,c,d,dH,e,g,R1,R2,R3,R4,S,NB,DV,CR,ALL,ctrlW').split(','));
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/b4-step0', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const key = (a: unknown) => JSON.stringify(a ?? null);
const r4 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : x > 0 ? 'Inf' : '-Inf');

interface T4 {
  T: Tree;
  H: any; // core/engine/helpers.ts
  TP: any; // ai/turnPlanner.ts
  RA: any; // ai/runnerAI.ts
  EV: any; // ai/effectValues.ts
}
let X: Record<TreeName, T4>;
const S = () => X.source.T;
const def = (code: string) => S().core.getCardDefinition(code);
const typeOf = (code: string) => def(code)?.type_code as string;
const title = (code: string) => def(code)?.title ?? code;
const inc = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

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
/** One decision asked of `tree` on a copy: a one-step GameRunner with fresh agents restored from the snaps. */
function ask(tree: 'probe' | 'probeW', s: GameState, snaps: { runner?: Snap; corp?: Snap }, memory: Map<string, string> | undefined, hook?: Record<string, unknown>): { a: string; ms: number } {
  const t = X[tree].T;
  t.clear();
  const runner = restore(t.createAgent('runner', 'normal'), snaps.runner);
  if (memory) runner.memory = new Map(memory);
  const corp = restore(t.createAgent('corp', 'normal'), snaps.corp);
  const g = new t.GameRunner(structuredClone(s), { corp, runner });
  (globalThis as any)[`__B4_${tree}`] = hook;
  const t0 = performance.now();
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
type Zone = 'hq' | 'rd' | 'arch' | 'grip';
const ZONES: Zone[] = ['hq', 'rd', 'arch', 'grip'];
const CORP_HIDDEN = ['hq', 'rd', 'arch'];
const zoneCards = (s: GameState, z: Zone): CardInstance[] => (z === 'hq' ? s.corp.hq : z === 'rd' ? s.corp.rd : z === 'arch' ? s.corp.archives.faceDown : s.runner.grip);
function place(s: GameState, id: string): string {
  for (const z of ZONES) if (zoneCards(s, z).some(c => c.instanceId === id)) return z;
  if (s.runner.stack.some(c => c.instanceId === id)) return 'stack';
  for (const sv of Object.values(s.corp.servers)) {
    if (sv.root.some(c => c.instanceId === id)) return 'root';
    if (sv.ice.some(c => c.instanceId === id)) return 'ice';
  }
  if (s.corp.archives.faceUp.some(c => c.instanceId === id)) return 'archUp';
  if (s.corp.scoreArea.some(c => c.instanceId === id) || s.runner.scoreArea.some(c => c.instanceId === id)) return 'score';
  if (s.runner.heap.some(c => c.instanceId === id)) return 'heap';
  return 'other';
}
const isHiddenRoot = (c: CardInstance) => !c.isRezzed && !c.faceUp && !c.runnerKnows;
const listOf = (s: GameState, owner: 'corp' | 'runner') => X.source.H.knownInHand(s, owner) as { id: string; code: string }[];

function labelOf(prev: GameState, a: GameAction): string {
  const p: any = S().core.activePrompt(prev);
  if (a.type === 'RESOLVE_PROMPT' && p?.source?.cardCode) return `prompt:${title(p.source.cardCode)}:${p.source.step ?? ''}`;
  const id = (a as any).cardInstanceId;
  if (id) {
    const all = [...prev.corp.hq, ...prev.runner.grip, ...Object.values(prev.corp.servers).flatMap(v => [...v.root, ...v.ice]), ...prev.runner.rig.programs, ...prev.runner.rig.hardware, ...prev.runner.rig.resources];
    const c = all.find(x => x.instanceId === id);
    if (c) return `${a.type}:${title(c.cardCode)}`;
  }
  return prev.activeRun ? `${a.type}(run)` : a.type;
}

// ------------------------------------------------------------------------------------------------ ruling 1's fields
interface Counted {
  seen: Map<string, { code: string; at: number }>; // entries, by the engine's id (bookkeeping), with the time seen
  losses: { at: number; kinds?: string[] }[]; // the zone's unseen losses: when, and (LOSS=kind) the kinds the place it went to allows
  gone: Set<string>; // entries seen leaving: not re-added from the engine's list, which keeps them
}
/** Losses matched to an entry seen before them (each loss can take one such entry). */
function matched(c: Counted): number {
  const ats = [...c.seen.values()].map(e => e.at).sort((x, y) => x - y);
  let m = 0;
  let avail = 0;
  let i = 0;
  for (const { at: t } of c.losses) {
    while (i < ats.length && ats[i] < t) {
      avail++;
      i++;
    }
    if (avail > 0) {
      avail--;
      m++;
    }
  }
  return m;
}
/** Per code: the losses that can be this code (LOSS=kind: by the kind the place it went to allows), matched to this code's entries seen before them. */
function matchedCode(c: Counted, code: string): number {
  const ats = [...c.seen.values()].filter(e => e.code === code).map(e => e.at).sort((x, y) => x - y);
  const kind = typeOf(code);
  let m = 0;
  let avail = 0;
  let i = 0;
  for (const l of c.losses) {
    if (l.kinds && !l.kinds.includes(kind)) continue;
    while (i < ats.length && ats[i] < l.at) {
      avail++;
      i++;
    }
    if (avail > 0) {
      avail--;
      m++;
    }
  }
  return m;
}
const LOSS = process.env.LOSS ?? 'any';
function certain(c: Counted): { n: number; k: number; byCode: [string, number][]; byKind: [string, number][]; byAny: [string, number][] } {
  const m = matched(c);
  const n = c.seen.size;
  const per = new Map<string, number>();
  for (const e of c.seen.values()) inc(per, e.code);
  const byKind = [...per].map(([code, x]) => [code, Math.max(0, x - matchedCode(c, code))] as [string, number]).filter(([, x]) => x > 0);
  const byAny = [...per].map(([code, x]) => [code, Math.max(0, x - m)] as [string, number]).filter(([, x]) => x > 0);
  return { n, k: Math.max(0, n - m), byCode: LOSS === 'kind' ? byKind : byAny, byKind, byAny };
}

interface Shadow {
  hq: Counted;
  grip: Counted;
  arch: Counted;
  proved: Map<string, 'A' | 'B'>; // root cards proved upgrade-only by the Runner's knowledge of an asset or agenda in their root
  rdBirth: Map<string, { code: string; n0: number; T: number; n: number; decisions: number; shares: number[]; truth: number }>;
}

interface GameAcc {
  sites: Map<string, number>;
  mk: Map<string, number>;
  asks: Map<string, number>;
  ms: Map<string, number>;
}

/** After one action: the gains and losses of the hidden zones, and ruling 1's fields kept from what each side sees. */
function afterAction(prev: GameState, next: GameState, a: GameAction, n: number, sh: Shadow, acc: GameAcc) {
  const H = X.source.H;
  const pubPrev: Map<string, string> = H.publicCards(prev);
  const pubNext: Map<string, string> = H.publicCards(next);
  const hqPrev = new Set(listOf(prev, 'corp').map(e => e.id));
  const hqNext = listOf(next, 'corp');
  const gripNext = listOf(next, 'runner');
  const rdNext = new Set((next.corp.rdKnownToRunner ?? []).map(e => e.id));
  const exactNext = new Set((next.corp.rdKnownToRunner ?? []).filter(e => e.lo === e.hi && !e.left).map(e => e.id));
  const label = labelOf(prev, a);
  for (const z of ZONES) {
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
      // Seen: it is public after, or a mark follows it (a known R&D card drawn joins the HQ list), or the whole zone went
      const seen = pubNext.has(id) || (to === 'hq' && hqNext.some(e => e.id === id) && !hqPrev.has(id)) || (to === 'rd' && exactNext.has(id)) || wholeZone;
      inc(acc.sites, `${z}|out|${to}|${seen ? 'seen' : 'unseen'}|${label}`);
      if (!seen && (z === 'hq' || z === 'grip' || z === 'arch')) sh[z].losses.push({ at: n, kinds: to === 'ice' ? ['ice'] : to === 'root' ? ['agenda', 'asset', 'upgrade'] : undefined });
      if (seen && (z === 'hq' || z === 'grip') && sh[z].seen.has(id)) {
        sh[z].seen.delete(id);
        sh[z].gone.add(id);
      }
      if (z === 'arch' && seen) sh.arch.seen.delete(id);
    });
    for (const c of now) {
      if (wasIds.has(c.instanceId)) continue;
      const id = c.instanceId;
      const from = place(prev, id);
      const seen = pubPrev.has(id) || (z === 'hq' && hqNext.some(e => e.id === id)) || (z === 'rd' && rdNext.has(id)) || (z === 'grip' && gripNext.some(e => e.id === id));
      inc(acc.sites, `${z}|in|${from}|${seen ? 'seen' : 'unseen'}|${label}`);
      // Facedown Archives: a card seen going in is marked there (1b: its source is the label)
      if (z === 'arch' && seen && !sh.arch.seen.has(id)) {
        sh.arch.seen.set(id, { code: c.cardCode, at: n });
        inc(acc.mk, `src:arch:${from}:${label}`);
      }
    }
  }
  // The engine's lists: a new entry is seen now; an entry the list dropped goes
  for (const [zone, list] of [
    ['hq', hqNext],
    ['grip', gripNext],
  ] as const) {
    const c = sh[zone];
    const ids = new Set(list.map(e => e.id));
    for (const e of list)
      if (!c.seen.has(e.id) && !c.gone.has(e.id)) {
        c.seen.set(e.id, { code: e.code, at: n });
        inc(acc.mk, `src:${zone}:${label}`);
      }
    for (const id of [...c.seen.keys()]) if (!ids.has(id)) c.seen.delete(id);
    for (const id of [...c.gone]) if (!ids.has(id)) c.gone.delete(id);
  }
  for (const e of next.corp.rdKnownToRunner ?? []) if (!(prev.corp.rdKnownToRunner ?? []).some(x => x.id === e.id)) inc(acc.mk, `src:rd:${label}`);
}

// ------------------------------------------------------------------------------------------------ root kinds (B4b)
/** Flags every hidden card of a root where the Runner knows an asset or agenda (now, or one scored or stolen from it). */
function updateProved(prev: GameState, next: GameState, proved: Map<string, 'A' | 'B'>) {
  for (const [sid, sv] of Object.entries(next.corp.servers)) {
    if (!sv.isRemote) continue;
    const known = sv.root.some(c => !isHiddenRoot(c) && ['agenda', 'asset'].includes(typeOf(c.cardCode)));
    if (known) for (const c of sv.root) if (isHiddenRoot(c) && !proved.has(c.instanceId)) proved.set(c.instanceId, 'B');
    const was = prev.corp.servers[sid];
    if (!was) continue;
    const scored = was.root.some(c => typeOf(c.cardCode) === 'agenda' && place(next, c.instanceId) === 'score');
    if (scored) for (const c of sv.root) if (isHiddenRoot(c) && was.root.some(x => x.instanceId === c.instanceId) && !proved.has(c.instanceId)) proved.set(c.instanceId, 'A');
  }
  const roots = new Map(Object.values(next.corp.servers).flatMap(v => v.root.map(c => [c.instanceId, c] as const)));
  for (const id of [...proved.keys()]) {
    const c = roots.get(id);
    if (!c || !isHiddenRoot(c)) proved.delete(id);
  }
}
/** The four cases on a board: card ids by case (i central, ii beside a known asset or agenda, iii beside one gone, iv joint). */
function rootCases(s: GameState, proved: Map<string, 'A' | 'B'>): { R1: string[]; R2: string[]; R3: string[]; R4: string[] } {
  const R1: string[] = [];
  const R2: string[] = [];
  const R3: string[] = [];
  const R4: string[] = [];
  for (const sv of Object.values(s.corp.servers)) {
    const hidden = sv.root.filter(isHiddenRoot);
    if (!hidden.length) continue;
    if (!sv.isRemote) {
      R1.push(...hidden.map(c => c.instanceId));
      continue;
    }
    const known = sv.root.some(c => !isHiddenRoot(c) && ['agenda', 'asset'].includes(typeOf(c.cardCode)));
    if (known) R2.push(...hidden.map(c => c.instanceId));
    else if (hidden.some(c => proved.has(c.instanceId))) R3.push(...hidden.filter(c => proved.has(c.instanceId)).map(c => c.instanceId));
    else if (hidden.length >= 2) R4.push(...hidden.map(c => c.instanceId));
  }
  return { R1, R2, R3, R4 };
}
const iceBump = (base: number, server: { ice: unknown[] }) => Math.min(0.9, base + (1 - base) * Math.min(0.45, 0.15 * server.ice.length));
/** R4's odds for a card of a joint root (the pool remoteAgendaOdds counts, read on the state it is handed). */
function r4Odds(s: GameState, card: CardInstance): number | undefined {
  if (card.advancementCounters > 0 || !isHiddenRoot(card)) return undefined;
  const sv = Object.values(s.corp.servers).find(v => v.isRemote && v.root.some(c => c.instanceId === card.instanceId));
  if (!sv) return undefined;
  const k = sv.root.filter(isHiddenRoot).length;
  if (k < 2) return undefined;
  const corp = [...s.corp.hq, ...s.corp.rd, ...s.corp.archives.faceDown, ...Object.values(s.corp.servers).flatMap(v => v.root.filter(isHiddenRoot))];
  const kinds = corp.map(c => typeOf(c.cardCode));
  const A = kinds.filter(t => t === 'agenda').length;
  const As = kinds.filter(t => t === 'asset').length;
  const U = kinds.filter(t => t === 'upgrade').length;
  const d = U + k * (A + As);
  return iceBump(d > 0 ? A / d : 0, sv);
}

// ------------------------------------------------------------------------------------------------ the arms' hooks
interface B4Data {
  hqCert: [string, number][];
  archK: number;
  archCert: [string, number][];
  rdExact: string[];
  gripCert: [string, number][];
}
const d4 = (s: GameState): B4Data | undefined => (s.corp as any).__b4;
const expand = (xs: [string, number][]) => xs.flatMap(([c, n]) => Array(n).fill(c) as string[]);
let placeMisses = 0;
const HOOKS: Record<string, (b: Board) => Record<string, unknown>> = {
  a: () => ({
    hq: (s: GameState, _known: unknown, size: number, odds: number) => {
      const d = d4(s);
      if (!d || size === 0) return undefined;
      let ag = 0;
      let tot = 0;
      for (const [c, n] of d.hqCert) {
        tot += n;
        if (typeOf(c) === 'agenda') ag += n;
      }
      tot = Math.min(tot, size);
      return (Math.min(ag, tot) + (size - tot) * odds) / size;
    },
  }),
  b: () => ({ rdShare: true }),
  c: () => ({ archUnknown: (s: GameState) => Math.max(0, s.corp.archives.faceDown.length - (d4(s)?.archK ?? 0)) }),
  d: () => ({ traps: trapsHook }),
  dH: () => ({ traps: trapsHook }),
  e: () => ({ dealHq: true, place: placeHook }),
  g: () => ({ gripIds: gripHook }),
  S: () => ({ saveView: true }),
  NB: () => ({ nbView: true }),
  DV: () => ({ dvView: true }),
  CR: () => ({ crView: true }),
  ALL: () => ({ hq: HOOKS.a({} as Board).hq, rdShare: true, archUnknown: HOOKS.c({} as Board).archUnknown, traps: trapsHook, dealHq: true, place: placeHook, gripIds: gripHook }),
};
const trapsHook = {
  skip: (s: GameState, card: CardInstance) => CORP_HIDDEN.includes(place(s, card.instanceId)),
  codes: (s: GameState) => {
    const d = d4(s);
    return d ? [...expand(d.hqCert), ...expand(d.archCert), ...d.rdExact] : [];
  },
};
/** 7e: after the deal, each certain HQ and Archives code is in its zone (at least as many copies as marked), by code only. */
function placeHook(s: GameState, loose: CardInstance[]) {
  const d = d4(s);
  if (!d) return;
  const used = new Set<CardInstance>();
  for (const [zone, cert] of [
    [s.corp.hq, d.hqCert],
    [s.corp.archives.faceDown, d.archCert],
  ] as const) {
    const inZone = loose.filter(c => zone.includes(c));
    for (const [code, n] of cert) {
      let have = inZone.filter(c => c.cardCode === code && !used.has(c));
      for (const c of have.slice(0, n)) used.add(c);
      for (let k = have.length; k < n; k++) {
        const from = loose.find(c => !zone.includes(c) && c.cardCode === code && !used.has(c));
        const to = inZone.find(c => !used.has(c) && !cert.some(([x]) => x === c.cardCode));
        if (!from || !to) {
          placeMisses++;
          continue;
        }
        [from.cardCode, to.cardCode] = [to.cardCode, from.cardCode];
        used.add(to);
        have = [...have, to];
      }
    }
  }
}
function gripHook(s: GameState): Set<string> {
  const d = d4(s);
  const ids = new Set<string>();
  if (!d) return ids;
  for (const [code, n] of d.gripCert) for (const c of s.runner.grip.filter(x => x.cardCode === code).slice(0, n)) ids.add(c.instanceId);
  return ids;
}
const caseHook = (ids: string[], joint: boolean) => {
  const set = new Set(ids);
  return joint ? { odds: (s: GameState, _v: unknown, c: CardInstance) => (set.has(c.instanceId) ? r4Odds(s, c) : undefined) } : { odds: (_s: GameState, _v: unknown, c: CardInstance) => (set.has(c.instanceId) ? 0 : undefined), upgradeOnly: (c: CardInstance) => set.has(c.instanceId), deal: (c: CardInstance) => set.has(c.instanceId) };
};

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
  cases: ReturnType<typeof rootCases>;
  fire?: string[];
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
  const pool = d.kind === 'deal' ? d.pool : 'jeff';
  for (const n of TREES) X[n].T.clear();
  placeMisses = 0;
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
  const empty = (): Counted => ({ seen: new Map(), losses: [], gone: new Set() });
  const sh: Shadow = { hq: empty(), grip: empty(), arch: empty(), proved: new Map(), rdBirth: new Map() };
  const memory = new Map<string, string>();
  const cands: Board[] = [];
  const mains: { s: GameState; memory: Map<string, string>; data: B4Data; sw?: GameState }[] = [];
  const cr: number[] = [];
  const scs: number[] = [];
  let lastTurn = -1;
  let wOk = true;
  let shuffles = 0;
  let decisions = 0;
  const lives: unknown[] = [];
  for (let n = 0; n < (moves ? moves.length : 4000); n++) {
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      scs.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    // ---- the board before this step
    const dec = decisionOf(sc.core, moves ? ({ ...s, stops: { corp: 'ai', runner: 'ai' } } as GameState) : s);
    let board: Board | null = null;
    if (dec) {
      decisions++;
      if (g) {
        memory.clear();
        for (const [k, v] of (ag.runner as any).memory ?? []) memory.set(k, v); // HIDDEN-READ: the source Runner's map, read only
      } else if (dec.side === 'runner') rememberInto(memory, s);
      const hq = certain(sh.hq);
      const grip = certain(sh.grip);
      const arch = certain(sh.arch);
      const rdExact = (s.corp.rdKnownToRunner ?? []).filter(e => e.lo === e.hi && !e.left).map(e => e.code);
      const data: B4Data = { hqCert: hq.byCode, archK: arch.k, archCert: arch.byCode, rdExact, gripCert: grip.byCode };
      const swN0 = wOk ? (sw.corp.rdKnownToRunner ?? []).filter((e: any) => e.n0) : [];
      const wDiff = wOk && key(s.corp.rdKnownToRunner ?? []) !== key(sw.corp.rdKnownToRunner ?? []);
      const cases = rootCases(s, sh.proved);
      const mapHidden = [...memory.keys()].filter(id => CORP_HIDDEN.includes(place(s, id)));
      if (dec.side === 'runner') markGap(s, wOk ? sw : undefined, memory, sh, hq, arch, acc);
      if (dec.side === 'corp' && grip.n) {
        inc(acc.mk, 'grip:decisions');
        if (grip.k < grip.n) inc(acc.mk, 'grip:fewer');
      }
      for (const [c, ids] of Object.entries(cases)) if (ids.length) inc(acc.mk, `case:${c}:${dec.side}:${dec.kind}`);
      // ---- which arms this board is eligible for
      const arms: string[] = [];
      const want = (arm: string, ok: boolean) => ok && ARMS.has(arm) && arms.push(arm);
      if (aiSide === 'both' || aiSide === dec.side) {
        const live = hq.n > 0 || arch.n > 0 || (s.corp.rdKnownToRunner ?? []).length > 0 || swN0.length > 0;
        want('a', hq.n > 0 && hq.k < hq.n);
        want('b', swN0.length > 0);
        want('ctrlW', wDiff);
        want('c', arch.k > 0);
        want('d', mapHidden.length > 0 || hq.k > 0 || arch.k > 0 || rdExact.length > 0);
        want('dH', dec.side === 'runner' && mapHidden.length > 0);
        want('e', dec.side === 'runner' && (hq.n > 0 || arch.k > 0));
        want('g', dec.side === 'corp' && grip.n > 0 && grip.k < grip.n);
        for (const c of ['R1', 'R2', 'R3', 'R4'] as const) want(c, cases[c].length > 0);
        want('ALL', s.turnNumber >= 10 && live);
      }
      board = { n, T: s.turnNumber, side: dec.side, kind: dec.kind, s: structuredClone(s), sw: wOk && (arms.includes('b') || arms.includes('ALL') || arms.includes('ctrlW')) ? structuredClone(sw) : undefined, snaps: g ? { runner: snapAgent(ag.runner), corp: snapAgent(ag.corp) } : {}, memory: new Map(memory), played: '', arms, cases };
      (board.s.corp as any).__b4 = data;
      if (board.sw) (board.sw.corp as any).__b4 = data;
      if (dec.side === 'runner' && dec.kind === 'main' && (aiSide === 'both' || aiSide === 'runner')) mains.push({ s: board.s, memory: board.memory, data, sw: board.sw });
      // A shuffled R&D mark's share and truth at this Runner decision (HIDDEN-READ truth)
      if (dec.side === 'runner')
        for (const e of swN0 as any[]) {
          const b = sh.rdBirth.get(e.id);
          if (!b) continue;
          b.decisions++;
          b.shares.push(r4((e.hi - e.lo + 1) / e.n0) as number);
          if (s.corp.rd.some(c => c.instanceId === e.id)) b.truth++;
        }
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
      if (board.arms.length || board.side === 'runner') cands.push(board);
    }
    const swPrev = sw;
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
    if (wOk) {
      // A shuffle that emptied marks the rule keeps (the source's list emptied, the shadow's kept at 1 / N0)
      const born = (sw.corp.rdKnownToRunner ?? []).filter((e: any) => e.n0 && !(swPrev.corp.rdKnownToRunner ?? []).some((x: any) => x.id === e.id && x.n0));
      if (born.length) {
        shuffles++;
        inc(acc.mk, 'shuffle:events');
        inc(acc.mk, 'shuffle:marksKept', born.length);
        inc(acc.sites, `rd|shuffle|rd|marks kept at 1/N0|${labelOf(sBefore, a)}`);
        for (const e of born as any[]) sh.rdBirth.set(e.id, { code: e.code, n0: e.n0, T: s.turnNumber, n, decisions: 0, shares: [], truth: 0 });
      }
      for (const [id, b] of sh.rdBirth)
        if (!(sw.corp.rdKnownToRunner ?? []).some((e: any) => e.id === id && e.n0)) {
          const p = place(s, id);
          lives.push({ code: title(b.code), n0: b.n0, turns: s.turnNumber - b.T, decisions: b.decisions, truthInRd: b.truth, shares: b.shares.slice(0, 40), endedBy: X.source.H.publicCards(s).has(id) ? 'surfaced' : `gone:${p}` });
          sh.rdBirth.delete(id);
        }
    }
    afterAction(sBefore, s, a, n, sh, acc);
    updateProved(sBefore, s, sh.proved);
  }
  for (const [, b] of sh.rdBirth) lives.push({ code: title(b.code), n0: b.n0, turns: s.turnNumber - b.T, decisions: b.decisions, truthInRd: b.truth, shares: b.shares.slice(0, 40), endedBy: 'gameEnd' });
  const matches = d.kind === 'deal' ? (s.winner ?? null) === d.rec.winner && key(cr) === key(d.rec.cr) && key(scs) === key(d.rec.sc) : null;
  // ---- after the game (the source tree is never interleaved with the probe's asks)
  fireCounts(cands, acc);
  casePrices(src, cands);
  oddsCount(src, pool, mains);
  askAll(src, cands, acc);
  if (placeMisses) inc(acc.mk, 'e:placeMisses', placeMisses);
  for (const l of lives) out({ kind: 'life', src, pool, ...(l as object) });
  out({ kind: 'g', src, pool, matchesBatch: matches, decisions, shuffles, wOk, T: s.turnNumber, winner: s.winner ?? null, ms: Math.round(performance.now() - t0) });
  out({ kind: 'site', src, pool, sites: Object.fromEntries(acc.sites) });
  out({ kind: 'mk', src, pool, mk: Object.fromEntries(acc.mk) });
  out({ kind: 'ask', src, pool, asks: Object.fromEntries(acc.asks), ms: Object.fromEntries([...acc.ms].map(([k, v]) => [k, Math.round(v)])) });
}

// ------------------------------------------------------------------------------------------------ part 2: the marks
function markGap(s: GameState, sw: GameState | undefined, memory: Map<string, string>, sh: Shadow, hq: ReturnType<typeof certain>, arch: ReturnType<typeof certain>, acc: GameAcc) {
  const m = acc.mk;
  inc(m, 'runnerDecisions');
  if (hq.n) {
    inc(m, 'hq:decisions');
    inc(m, 'hq:entries', hq.n);
    inc(m, 'hq:certain', hq.k);
    // by code: as ruling 1 reads it (every loss may be any card), and with each loss limited to the kinds its place allows
    const sum = (xs: [string, number][]) => xs.reduce((a, [, x]) => a + x, 0);
    inc(m, 'hq:certainByCode', sum(hq.byAny));
    inc(m, 'hq:certainByKind', sum(hq.byKind));
    // HIDDEN-READ: the by-kind count is sound per code
    for (const [code, x] of hq.byKind) if (s.corp.hq.filter(c => c.cardCode === code).length < x) inc(m, 'hq:kindUNSOUND');
    if (hq.k < hq.n) inc(m, 'hq:fewer');
    // HIDDEN-READ: how many listed cards really left HQ, and how many certain ones are really there (the count is sound)
    const really = [...sh.hq.seen.keys()].filter(id => s.corp.hq.some(c => c.instanceId === id)).length;
    inc(m, 'hq:reallyThere', really);
    if (really < hq.k) inc(m, 'hq:UNSOUND');
  }
  if (arch.n) {
    inc(m, 'arch:decisions');
    inc(m, 'arch:entries', arch.n);
    inc(m, 'arch:certain', arch.k);
    const really = [...sh.arch.seen.keys()].filter(id => s.corp.archives.faceDown.some(c => c.instanceId === id)).length;
    if (really < arch.k) inc(m, 'arch:UNSOUND');
  }
  const rd = s.corp.rdKnownToRunner ?? [];
  if (rd.length) inc(m, 'rd:decisions');
  inc(m, 'rd:entries', rd.length);
  const n0 = (sw?.corp.rdKnownToRunner ?? []).filter((e: any) => e.n0);
  if (n0.length) inc(m, 'rd:n0Decisions');
  inc(m, 'rd:n0Entries', n0.length);
  // The map's hidden-zone entries: what ruling 1's fields hold of the same card
  let any = false;
  for (const [id] of memory) {
    const z = place(s, id);
    if (!CORP_HIDDEN.includes(z)) continue;
    any = true;
    const cover =
      z === 'hq'
        ? sh.hq.seen.has(id)
          ? hq.k === hq.n
            ? 'certain'
            : 'counted'
          : 'none'
        : z === 'rd'
          ? rd.some(e => e.id === id)
            ? 'marked'
            : n0.some((e: any) => e.id === id)
              ? 'share'
              : 'none'
          : sh.arch.seen.has(id)
            ? arch.k === arch.n
              ? 'certain'
              : 'counted'
            : 'none';
    inc(m, `map:${z}:${cover}`);
  }
  if (any) inc(m, 'map:decisionsWithHidden');
  // The reverse: marks the map does not hold
  for (const id of sh.hq.seen.keys()) if (!memory.has(id)) inc(m, 'rev:hq');
  for (const e of rd) if (!memory.has(e.id)) inc(m, 'rev:rd');
  for (const id of sh.arch.seen.keys()) if (!memory.has(id)) inc(m, 'rev:arch');
}

/** Part 2's added count: pooled agendaOdds against the marks-aware HQ and R&D odds, Runner main boards with live marks. */
function oddsCount(src: string, pool: string, mains: { s: GameState; memory: Map<string, string>; data: B4Data; sw?: GameState }[]) {
  const P = X.probe;
  const rows: number[][] = [];
  for (const b of mains) {
    const rdMarks = ((b.sw ?? b.s).corp.rdKnownToRunner ?? []) as any[];
    if (!b.data.hqCert.length && !b.data.archCert.length && !rdMarks.length && !(b.s.corp.rdKnownToRunner ?? []).length) continue;
    P.T.clear();
    const s = structuredClone(b.s);
    const pooled = P.EV.agendaOdds(s).odds as number;
    const today = P.T.runs.hqAgendaOdds(s, pooled) as number;
    const hqCert = b.data.hqCert.reduce((n, [, x]) => n + x, 0);
    const hqAg = b.data.hqCert.reduce((n, [c, x]) => n + (typeOf(c) === 'agenda' ? x : 0), 0);
    const archAg = b.data.archCert.reduce((n, [c, x]) => n + (typeOf(c) === 'agenda' ? x : 0), 0);
    const exact = rdMarks.filter(e => !e.n0 && e.lo === e.hi && !e.left);
    const exactAg = exact.filter(e => typeOf(e.code) === 'agenda').length;
    // The pool less what is certainly marked (count only; the shared R&D marks are shares, not removed)
    const unseenN = (() => {
      const corp = [...s.corp.hq, ...s.corp.rd, ...s.corp.archives.faceDown, ...Object.values(s.corp.servers).flatMap(v => v.root.filter(c => !c.isRezzed))];
      return corp.length;
    })();
    const pooledAgendas = pooled * unseenN;
    const marked = hqCert + b.data.archK + exact.length;
    const aware = unseenN - marked > 0 ? Math.max(0, pooledAgendas - hqAg - archAg - exactAg) / (unseenN - marked) : 0;
    const size = s.corp.hq.length;
    const hqAware = size ? (Math.min(hqAg, hqCert) + (size - Math.min(hqCert, size)) * aware) / size : 0;
    let seen = 0;
    let rdAg = 0;
    for (const e of rdMarks) {
      if (0 < e.lo || 0 > e.hi) continue;
      const share = e.n0 ? 1 / e.n0 : 1 / (e.hi - e.lo + 1);
      seen += share;
      if (typeOf(e.code) === 'agenda') rdAg += share;
    }
    const rdAware = s.corp.rd.length ? rdAg + Math.max(0, 1 - seen) * aware : 0;
    rows.push([r4(pooled), r4(today), r4(hqAware), r4(rdAware), r4(aware)] as number[]);
  }
  if (rows.length) out({ kind: 'od', src, pool, cols: ['pooled', 'hqToday', 'hqAware', 'rdTopAware', 'poolAware'], rows });
}

// ------------------------------------------------------------------------------------------------ part 3: prices
/** Each remote holding a case card on a Runner main board: today's odds and serverValue, and the same read under each case's rule. */
function casePrices(src: string, cands: Board[]) {
  const P = X.probe;
  const t = P.T;
  for (const b of cands) {
    if (b.side !== 'runner' || b.kind !== 'main') continue;
    const present = (['R1', 'R2', 'R3', 'R4'] as const).filter(c => b.cases[c].length);
    if (!present.length) continue;
    const all = new Set(present.flatMap(c => b.cases[c]));
    const sids = Object.entries(b.s.corp.servers)
      .filter(([, sv]) => sv.root.some(c => all.has(c.instanceId)))
      .map(([sid]) => sid);
    const read = (hook: Record<string, unknown> | undefined) => {
      t.clear();
      (globalThis as any).__B4_probe = hook;
      try {
        return t.synergy.asSide('runner', () => {
          const s = structuredClone(b.s);
          t.handValues.decisionContext(s, 'runner');
          const view: GameState = P.TP.runnerDecisionView(s, b.memory);
          const trap = t.runs.trapOdds(view, b.memory);
          return sids.map(sid => {
            const sv = view.corp.servers[sid];
            return { odds: sv.root.filter(isHiddenRoot).map(c => r4(t.runs.remoteAgendaOdds(view, sv, c, trap))), value: r4(t.runs.serverValue(view, sid, 0, b.memory, true)) };
          });
        });
      } finally {
        delete (globalThis as any).__B4_probe;
      }
    };
    const today = read(undefined);
    const under = Object.fromEntries(present.map(c => [c, read(caseHook(b.cases[c], c === 'R4'))]));
    out({
      kind: 'cp',
      src,
      T: b.T,
      servers: sids.map((sid, i) => ({
        sid,
        cases: present.filter(c => b.cases[c].some(id => b.s.corp.servers[sid].root.some(x => x.instanceId === id))),
        today: today[i],
        under: Object.fromEntries(present.map(c => [c, under[c][i]])),
        ice: b.s.corp.servers[sid].ice.length,
        runsHere: b.played.includes(`"targetServerId":"${sid}"`),
      })),
    });
  }
}

// ------------------------------------------------------------------------------------------------ part 4: fire counts
/** saveUpTarget, needsBiggerHand, digValue, chainReactionBonus on the Runner's view against the real state. */
function fireCounts(cands: Board[], acc: GameAcc) {
  const P = X.probe;
  for (const b of cands) {
    if (b.side !== 'runner' || b.kind !== 'main') continue;
    P.T.clear();
    const fire: string[] = [];
    P.T.synergy.asSide('runner', () => {
      const s = structuredClone(b.s);
      P.T.handValues.decisionContext(s, 'runner');
      const view: GameState = P.TP.runnerDecisionView(s, b.memory);
      const sv = (x: GameState) => P.RA.saveUpTarget(x, b.memory);
      if (sv(s) !== sv(view)) fire.push('S');
      if (P.T.runs.needsBiggerHand(s, b.memory) !== P.T.runs.needsBiggerHand(view, b.memory)) fire.push('NB');
      if (Math.abs(P.T.evaluate.digValue(s, 'runner') - P.T.evaluate.digValue(view, 'runner')) > 1e-9) fire.push('DV');
      if (Object.keys(s.corp.servers).some(id => Math.abs(P.T.runs.chainReactionBonus(s, id) - P.T.runs.chainReactionBonus(view, id)) > 1e-9)) fire.push('CR');
    });
    inc(acc.mk, 'fire:boards');
    for (const f of fire) {
      inc(acc.mk, `fire:${f}`);
      if (ARMS.has(f)) b.arms.push(f);
    }
  }
}

// ------------------------------------------------------------------------------------------------ the asks
/** Up to `cap` of `xs`, evenly spaced. */
const spread = <T,>(xs: T[], cap: number): T[] => (xs.length <= cap ? xs : Array.from({ length: cap }, (_, i) => xs[Math.floor((i * xs.length) / cap)]));

function askAll(src: string, cands: Board[], acc: GameAcc) {
  const chosen = new Map<Board, string[]>();
  const all = new Set(cands.flatMap(b => b.arms));
  for (const arm of all)
    for (const side of ['runner', 'corp'] as const) {
      const el = cands.filter(b => b.side === side && b.arms.includes(arm));
      for (const b of el) inc(acc.asks, `eligible|${arm}|${side}|${b.kind}`);
      for (const b of spread(el, arm === 'ALL' ? ALL_CAP : CAP[side])) chosen.set(b, [...(chosen.get(b) ?? []), arm]);
    }
  for (const [b, arms] of chosen) {
    const tag = `${b.side}|${b.kind}`;
    const ctrl = ask('probe', b.s, b.snaps, b.memory);
    inc(acc.asks, `ctrl|${tag}`);
    inc(acc.ms, `ctrl|${tag}`, ctrl.ms);
    if (ctrl.a !== b.played) inc(acc.asks, `ctrlMismatch|${tag}`);
    let dAnswer: string | null = null;
    for (const arm of arms.sort((x, y) => (x === 'd' ? -1 : y === 'd' ? 1 : 0))) {
      let r: { a: string; ms: number };
      if (arm === 'b' || arm === 'ALL' || arm === 'ctrlW') r = ask('probeW', b.sw!, b.snaps, b.memory, arm === 'ctrlW' ? undefined : HOOKS[arm](b));
      else if (arm === 'dH') r = ask('probe', b.s, b.snaps, new Map([...b.memory].filter(([id]) => !CORP_HIDDEN.includes(place(b.s, id)))), HOOKS.dH(b));
      else if (arm.startsWith('R')) r = ask('probe', b.s, b.snaps, b.memory, caseHook(b.cases[arm as 'R1'], arm === 'R4'));
      else r = ask('probe', b.s, b.snaps, b.memory, HOOKS[arm](b));
      if (arm === 'd') dAnswer = r.a;
      inc(acc.asks, `${arm}|${tag}`);
      inc(acc.ms, `${arm}|${tag}`, r.ms);
      inc(acc.ms, `ctrl@${arm}|${tag}`, ctrl.ms);
      if (r.a !== ctrl.a) {
        inc(acc.asks, `${arm}|${tag}|changed`);
        out({ kind: 'ch', src, arm, side: b.side, decision: b.kind, T: b.T, n: b.n, played: b.played, ctrl: ctrl.a, arm_a: r.a, ctx: ctxOf(arm, b) });
      }
      if (arm === 'dH' && dAnswer !== null && r.a !== dAnswer) inc(acc.asks, `dH|${tag}|differsFromD`);
    }
  }
}
function ctxOf(arm: string, b: Board): unknown {
  const d = d4(b.s)!;
  if (arm === 'a' || arm === 'e') return { hqList: listOf(b.s, 'corp').map(e => title(e.code)), hqCert: d.hqCert.map(([c, n]) => `${title(c)}x${n}`), hqSize: b.s.corp.hq.length, archCert: d.archCert.map(([c, n]) => `${title(c)}x${n}`) };
  if (arm === 'b' || arm === 'ctrlW') return { rd: b.s.corp.rdKnownToRunner ?? [], rdW: b.sw?.corp.rdKnownToRunner ?? [] };
  if (arm === 'c') return { archK: d.archK, archCert: d.archCert.map(([c, n]) => `${title(c)}x${n}`), faceDown: b.s.corp.archives.faceDown.length };
  if (arm === 'd' || arm === 'dH') return { mapHidden: [...b.memory].filter(([id]) => CORP_HIDDEN.includes(place(b.s, id))).map(([id, c]) => `${title(c)}@${place(b.s, id)}`), codes: trapsHook.codes(b.s).map(title) };
  if (arm === 'g') return { gripList: listOf(b.s, 'runner').map(e => title(e.code)), gripCert: d.gripCert.map(([c, n]) => `${title(c)}x${n}`) };
  if (arm.startsWith('R')) {
    const ids = b.cases[arm as 'R1'];
    const roots = Object.entries(b.s.corp.servers).filter(([, v]) => v.root.some(c => ids.includes(c.instanceId)));
    return roots.map(([sid, v]) => ({ sid, root: v.root.map(c => `${isHiddenRoot(c) ? '?' : ''}${title(c.cardCode)}`), ice: v.ice.length }));
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const dirs = makeB4Trees(root, shard);
  X = {} as Record<TreeName, T4>;
  for (const name of TREES) {
    const m = (p: string) => import(/* @vite-ignore */ join(dirs[name], 'src', p));
    const T = await loadTree(name, dirs[name]);
    X[name] = { T, H: await m('core/engine/helpers.ts'), TP: await m('ai/turnPlanner.ts'), RA: await m('ai/runnerAI.ts'), EV: await m('ai/effectValues.ts') };
  }
  if (typeof X.probe.RA.saveUpTarget !== 'function') throw new Error('probe tree: saveUpTarget not exported');
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
      out({ kind: 'err', src: d.kind === 'deal' ? `${d.pool}:${d.rec.seed}` : d.file, e: (e as Error).stack?.slice(0, 400) });
    }
  }
  out({ kind: 's', shard, sources: done });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
