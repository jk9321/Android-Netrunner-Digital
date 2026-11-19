/**
 * R0 count 1, part D (brief /mnt/project-files/netrunner-ai/runner-rework/r0/count1-audit-map/brief.md): the Runner AI's
 * private memory (runnerAI.ts `remember`) and its prompt answers on the real state (`promptAnswer`), counted on the
 * sources. Scripts only: nothing in src or tests changes; no tree is patched (map-trees.ts).
 *
 * Sources (kinds kept apart: self, humanRunner = a person played the Runner, humanCorp = a person played the Corp
 * against our Runner; the Hard Runner's games (config.difficulty hard) are marked `hard`):
 *  (a) the 221 deals of the g1 base 44381468776 (scripts/stage-d/post-pick-deals.json; each game's winner, cr and sc
 *      checked against that record), played by the `source` tree with a plain GameRunner, Normal v Normal, as the batch.
 *  (b) tests/fixtures/human-games: the recorded moves replayed. A shadow Normal Runner (probe tree) is shown every state
 *      where the Runner decides (`observe`, i.e. `remember` only), so its memory is what our Runner's would be there.
 *
 * D1/D3, at every Runner decision (main, prompt, off-turn), after that decision's `remember`: every memory entry is
 * located on the board and called EXPLAINED when the state already marks it (rezzed, faceup, `runnerKnows`; in HQ known
 * by knownInHand; in R&D known by knownInRd; faceup in Archives, scored, or out of the Corp's hidden zones) or
 * UNEXPLAINED, with a class:
 *  - preAccess: a root card of the server being breached that the Runner has not accessed yet (memory is set when the run
 *    is declared successful, before 7.4.1's candidates are accessed);
 *  - breachReplaced: put in memory after a successful run whose breach was replaced (`breachInstead`: Eru, Beatriz,
 *    Privileged Access, Burner, Cataloguer) and never accessed;
 *  - installedThisTurn: installed in the root this turn after the successful run that put it in memory (runsThisTurn is
 *    read all turn);
 *  - notAccessed: any other root card put in memory by a successful run and never accessed (an access prohibition:
 *    Adrian Seis, Flagship; a breach ended early);
 *  - hiddenZone: the instance is now in HQ, R&D or facedown in Archives and the state does not mark it known there
 *    (rule 1.12.3: a new object); `seenBefore` says whether it was explained earlier;
 *  - recycled: an installed instance that has been in HQ, R&D or facedown Archives since it was put in memory (installed
 *    again: a new object, rule 1.12.3; the memory keeps the old identity).
 * Human games: the control ask is compared with the recorded move only in the Normal Runner's game (report-54);
 * elsewhere the recorded Runner is a person or the Hard Runner, and the asks are compared with the control ask.
 * HONEST-MEMORY asks (a fire count, not an arm: no rule changes, only the memory handed in): at a decision with an
 * unexplained entry (CAP a game), the probe tree is asked with the agent's copied fields (control: must equal the played
 * action, else a stop) and again with the unexplained entries taken out of the memory. A changed answer is counted.
 *
 * D2, at every Runner prompt: does `promptAnswer` take the real-state path (the prompt names a stack card or a card of
 * runnerUnknownSlots)? By prompt kind, source card, step, and what it names. Where it does: the probe tree is asked on the
 * board (control) and on boards where only cards the Runner cannot know are changed: P1 the stack's order outside the
 * named cards; P2 the codes of the unknown Corp cards outside the named ones, permuted within their kind (unrezzed ice,
 * facedown root cards (advanced apart), and the loose cards of HQ, R&D and facedown Archives); P3 the codes of the
 * NAMED installed cards that are still facedown to the Runner (a prompt that names a facedown card does not show it),
 * each swapped with another unknown card of its kind; two seeds each.
 *
 * Hidden information: the measuring script reads the real board to say what was true (HIDDEN-READ marks); the agents
 * are only asked through GameRunner.
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/map-hidden.ts
 *   ARGS="DEALS=1001 HUMAN=none" npx vite-node scripts/runner-rework/map-hidden.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { dealState } from '../stage-a/harness';
import { MapTree, mapTrees } from './map-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/runner-map', String(shard));
const CAP = Number(process.env.CAP ?? 30);
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const key = (a: unknown) => (a ? JSON.stringify(a) : 'null');

let T: { source: MapTree; probe: MapTree };

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
/** One Runner decision asked of the probe tree on a copy (fresh agents; the Runner restored from `snap`). */
function ask(s: GameState, snap: Snap, memory?: Map<string, string>): string {
  const t = T.probe;
  t.clear();
  const runner = restore(t.createAgent('runner', 'normal'), snap);
  if (memory) runner.memory = new Map(memory);
  const g = new t.GameRunner(structuredClone(s), { corp: t.createAgent('corp', 'normal'), runner });
  try {
    g.step();
    return key(g.last);
  } catch (e) {
    return `error: ${(e as Error).message.slice(0, 80)}`;
  }
}

type Cls = 'runnerPrompt' | 'runnerMain' | 'runnerOff';
function decisionOf(core: any, s: GameState): Cls | null {
  const side = core.actingSide(s);
  if (side !== 'runner' || s.winner) return null;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) return core.wantsStop(s, side, w) && w.step === 'corp_action' ? 'runnerOff' : null;
  return core.activePrompt(s) ? 'runnerPrompt' : 'runnerMain';
}

// ------------------------------------------------------------------------------------------------ D1/D3: where an id is
type Where = { zone: string; card?: any; server?: string };
function whereIs(s: GameState, id: string): Where {
  for (const [sid, sv] of Object.entries(s.corp.servers)) {
    const r = sv.root.find(c => c.instanceId === id);
    if (r) return { zone: 'root', card: r, server: sid };
    const i = sv.ice.find(c => c.instanceId === id);
    if (i) return { zone: 'ice', card: i, server: sid };
  }
  const zones: [string, any[]][] = [
    ['hq', s.corp.hq],
    ['rd', s.corp.rd],
    ['archivesDown', s.corp.archives.faceDown],
    ['archivesUp', s.corp.archives.faceUp],
    ['corpScore', s.corp.scoreArea],
    ['runnerScore', s.runner.scoreArea],
  ];
  for (const [z, list] of zones) {
    const c = list.find((x: any) => x.instanceId === id);
    if (c) return { zone: z, card: c };
  }
  return { zone: 'elsewhere' };
}

/** HIDDEN-READ: reads the real board to say whether the state marks the card known to the Runner. */
function explained(t: MapTree, s: GameState, id: string, w: Where): boolean {
  switch (w.zone) {
    case 'root':
    case 'ice':
      return !!(w.card.isRezzed || w.card.faceUp || w.card.runnerKnows);
    case 'hq':
      return t.helpers.knownInHand(s, 'corp').some((k: any) => k.id === id);
    case 'rd':
      return t.rdKnowledge.knownInRd(s).some((e: any) => e.id === id);
    case 'archivesDown':
      return false;
    default:
      return true;
  }
}

interface Entry {
  label: string;
  everExplained: boolean;
  code: string;
  /** Seen in HQ, R&D or facedown in Archives since it was put in memory (rule 1.12.3: a new object from then on). */
  wentHidden: boolean;
}

// ------------------------------------------------------------------------------------------------ D2: perturbations
function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled<T>(xs: T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/** P1: the stack's order outside the named cards (named cards keep their places). */
function permuteStack(s: GameState, named: Set<string>, seed: number): GameState {
  const c = structuredClone(s);
  const free = c.runner.stack.map((x, i) => i).filter(i => !named.has(c.runner.stack[i].instanceId));
  const cards = shuffled(
    free.map(i => c.runner.stack[i]),
    mulberry(seed)
  );
  free.forEach((i, k) => (c.runner.stack[i] = cards[k]));
  return c;
}
/** P2: the codes of the Corp cards the Runner cannot know (runnerUnknownSlots), outside the named ones, permuted within their kind. */
function permuteCorp(s: GameState, named: Set<string>, memory: Map<string, string>, seed: number): GameState {
  const c = structuredClone(s);
  const { ice, root, loose } = T.probe.reply.runnerUnknownSlots(c, memory);
  const rnd = mulberry(seed);
  const groups = [ice, root.filter((x: any) => x.advancementCounters > 0), root.filter((x: any) => !(x.advancementCounters > 0)), loose];
  for (const g of groups) {
    const free = g.filter((x: any) => !named.has(x.instanceId));
    const codes = shuffled(
      free.map((x: any) => x.cardCode),
      rnd
    );
    free.forEach((x: any, k: number) => (x.cardCode = codes[k]));
  }
  return c;
}
/**
 * P3: the codes of the named installed cards that are still facedown to the Runner (unrezzed ice, facedown root cards not
 * in memory and not runnerKnows: a prompt naming such a card does not show it, e.g. Tao Salonga's swap, Hermes' bounce),
 * each swapped with another unknown card of the same kind (ice with ice; a root card with an agenda, asset or upgrade),
 * taken first from the other unknown slots and the loose pool. The board keeps its multiset of hidden cards.
 */
function permuteNamedFacedown(s: GameState, named: Set<string>, memory: Map<string, string>, seed: number): GameState | null {
  const c = structuredClone(s);
  const { ice, root, loose } = T.probe.reply.runnerUnknownSlots(c, memory);
  const rnd = mulberry(seed);
  const type = (x: any) => T.probe.core.getCardDefinition(x.cardCode).type_code;
  let changed = false;
  for (const x of [...ice, ...root].filter((y: any) => named.has(y.instanceId))) {
    const want = (y: any) => (type(x) === 'ice' ? type(y) === 'ice' : ['agenda', 'asset', 'upgrade'].includes(type(y))) && y.cardCode !== x.cardCode && y !== x;
    const pool = [...ice, ...root, ...loose].filter(want);
    if (!pool.length) continue;
    const y: any = pool[Math.floor(rnd() * pool.length)];
    [x.cardCode, y.cardCode] = [y.cardCode, x.cardCode];
    changed = true;
  }
  return changed ? c : null;
}

// ------------------------------------------------------------------------------------------------ one source
interface Ctx {
  src: string;
  sk: string;
  who: string;
  hard: boolean;
}
interface Acc {
  decisions: number;
  byCls: Record<string, number>;
  withUnexplained: Record<string, number>;
  ids: Record<string, Set<string>>;
  asks: number;
  honestFlips: number;
  stops: number;
  prompts: number;
  realPath: number;
}
function acc(): Acc {
  return { decisions: 0, byCls: {}, withUnexplained: {}, ids: {}, asks: 0, honestFlips: 0, stops: 0, prompts: 0, realPath: 0 };
}

/** One Runner decision: D1/D3 classification of `memory` (after this decision's remember) and, at a prompt, D2. */
function measure(c: Ctx, a: Acc, s: GameState, cls: Cls, memory: Map<string, string>, entries: Map<string, Entry>, snap: Snap | null, played: string | null, extra: Record<string, unknown>) {
  const t = T.probe;
  a.decisions++;
  a.byCls[cls] = (a.byCls[cls] ?? 0) + 1;
  // ---- D1/D3
  const run = s.activeRun as any;
  const unexplained: { id: string; code: string; label: string; zone: string; server?: string }[] = [];
  for (const [id, code] of memory) {
    const w = whereIs(s, id);
    let e = entries.get(id);
    if (!e) {
      // First seen in memory here: why it was put there (HIDDEN-READ: the real board)
      let label = 'other';
      if (w.zone === 'root' && run?.isSuccessful && run.server === w.server) label = run.breachInstead ? 'breachReplaced' : 'preAccess';
      else if (w.zone === 'root') {
        const runs = (s.runsThisTurn ?? []).filter((r: any) => r.successful && r.server === w.server);
        label = runs.length ? (w.card.installedTurn === `${s.turnNumber}-${s.activePlayer}` ? 'installedThisTurn' : 'notAccessed') : 'other';
      }
      e = { label, everExplained: false, code, wentHidden: false };
      entries.set(id, e);
    }
    if (w.zone === 'hq' || w.zone === 'rd' || w.zone === 'archivesDown') e.wentHidden = true;
    if (explained(t, s, id, w)) {
      e.everExplained = true;
      continue;
    }
    let label: string;
    if (w.zone === 'root' || w.zone === 'ice') {
      const candidate = run?.server === w.server && (run?.isSuccessful || run?.breached) && !(run.accessed ?? []).some((x: any) => x.id === id);
      // A remembered instance that went back to a hidden zone and was installed again (rule 1.12.3): the memory keeps
      // the old identity on what is a new object to the Runner
      if (e.wentHidden) label = 'recycled';
      else label = candidate && e.label === 'preAccess' ? 'preAccess' : e.label === 'preAccess' ? 'notAccessed' : e.label;
    } else label = `hiddenZone:${w.zone}:${e.everExplained ? 'seenBefore' : 'never'}`;
    unexplained.push({ id, code, label, zone: w.zone, server: w.server });
  }
  const labels = [...new Set(unexplained.map(u => u.label))];
  for (const l of labels) a.withUnexplained[l] = (a.withUnexplained[l] ?? 0) + 1;
  for (const u of unexplained) (a.ids[u.label] ??= new Set()).add(u.id);
  if (unexplained.length) {
    const rec: Record<string, unknown> = { kind: 'u', ...c, T: s.turnNumber, cls, unexplained: unexplained.map(u => ({ ...u, title: t.core.getCardDefinition(u.code)?.title })), ...extra };
    // Honest-memory ask: the same decision with the unexplained entries taken out (installed ones only: the classes D1 is about)
    if (snap && a.asks < CAP && unexplained.some(u => u.zone === 'root' || u.zone === 'ice')) {
      a.asks++;
      const control = ask(s, snap);
      if (played !== null && control !== played) {
        a.stops++;
        rec.stop = { control, played };
      } else {
        const honest = new Map(memory);
        for (const u of unexplained) if (u.zone === 'root' || u.zone === 'ice') honest.delete(u.id);
        const h = ask(s, snap, honest);
        rec.honest = h === control ? 'same' : h;
        if (h !== control) a.honestFlips++;
      }
    }
    out(rec);
  }
  // ---- D2
  if (cls !== 'runnerPrompt') return;
  a.prompts++;
  const p = t.core.activePrompt(s);
  const shown = JSON.stringify(p);
  const named = new Set<string>();
  const what: string[] = [];
  const { ice, root: rootSlots, loose } = t.reply.runnerUnknownSlots(s, memory);
  const tag = (list: any[], name: string) => {
    for (const x of list)
      if (shown.includes(`"${x.instanceId}"`)) {
        named.add(x.instanceId);
        what.push(name);
      }
  };
  tag(s.runner.stack, 'stack');
  tag(ice, 'corpIce');
  tag(rootSlots, 'corpRoot');
  tag(
    loose.filter((x: any) => s.corp.hq.includes(x)),
    'corpHq'
  );
  tag(
    loose.filter((x: any) => s.corp.rd.includes(x)),
    'corpRd'
  );
  tag(
    loose.filter((x: any) => s.corp.archives.faceDown.includes(x)),
    'corpArchives'
  );
  const real = named.size > 0;
  const base = { kind: 'p', ...c, T: s.turnNumber, pk: p?.kind, code: p?.source?.cardCode ?? null, step: p?.source?.step ?? null, title: p?.source?.cardCode ? t.core.getCardDefinition(p.source.cardCode)?.title : null, real, named: [...new Set(what)], nNamed: named.size, stack: s.runner.stack.length };
  if (!real || !snap) {
    out(base);
    return;
  }
  a.realPath++;
  const control = ask(s, snap);
  const rec: Record<string, unknown> = { ...base, played, control };
  if (played !== null && control !== played) {
    a.stops++;
    rec.stop = true;
  }
  const p1 = [11, 12].map(seed => ask(permuteStack(s, named, seed), snap));
  const p2 = [21, 22].map(seed => ask(permuteCorp(s, named, memory, seed), snap));
  const p3 = [31, 32].map(seed => permuteNamedFacedown(s, named, memory, seed)).map(b => (b ? ask(b, snap) : 'n/a'));
  rec.p1 = p1.map(x => (x === control ? 'same' : x));
  rec.p2 = p2.map(x => (x === control ? 'same' : x));
  rec.p3 = p3.map(x => (x === control || x === 'n/a' ? x === 'n/a' ? 'n/a' : 'same' : x));
  out(rec);
}

function finish(c: Ctx, a: Acc, extra: Record<string, unknown>) {
  out({ kind: 's', ...c, ...extra, decisions: a.decisions, byCls: a.byCls, withUnexplained: a.withUnexplained, ids: Object.fromEntries(Object.entries(a.ids).map(([k, v]) => [k, v.size])), asks: a.asks, honestFlips: a.honestFlips, stops: a.stops, prompts: a.prompts, realPath: a.realPath });
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  T = await mapTrees(root);
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
  const sources: { kind: 'deal' | 'human'; id: any }[] = [...humans.map(f => ({ kind: 'human' as const, id: f })), ...dealList.map(r => ({ kind: 'deal' as const, id: r }))];

  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    const t0 = performance.now();
    const a = acc();
    const entries = new Map<string, Entry>();
    if (src.kind === 'deal') {
      const rec = src.id as (typeof record)[number];
      const c: Ctx = { src: `deal:${rec.seed}`, sk: 'self', who: 'ai', hard: false };
      const t = T.source;
      t.clear();
      const ag = { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') };
      const g = new t.GameRunner(dealState(rec.seed), ag);
      const cr: number[] = [];
      const sc: number[] = [];
      let lastTurn = -1;
      const pending: { s: GameState; cls: Cls; snap: Snap; played: string; memory: Map<string, string> }[] = [];
      for (let n = 0; n < 4000; n++) {
        const s: GameState = g.state;
        if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
          cr.push(s.corp.credits);
          sc.push(s.corp.score);
          lastTurn = s.turnNumber;
        }
        const cls = decisionOf(t.core, s);
        const copy = cls ? structuredClone(s) : null;
        const snap = cls ? snapAgent(ag.runner) : null;
        if (!g.step()) break;
        // The memory after this decision's remember (read, never written)
        if (cls && copy && snap) pending.push({ s: copy, cls, snap, played: key(g.last), memory: new Map((ag.runner as any).memory) });
      }
      const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
      out({ kind: 'g', src: c.src, decks: `${rec.corpDeck} v ${rec.runnerDeck}`, winner: g.state.winner ?? null, T: g.state.turnNumber, matchesBatch: matches, ...(matches ? {} : { cr, sc, recCr: rec.cr, recSc: rec.sc, recWinner: rec.winner }) });
      // Measured after the game, so the source tree is never interleaved with the probe's asks
      for (const d of pending) measure(c, a, d.s, d.cls, d.memory, entries, d.snap, d.played, {});
      finish(c, a, { matchesBatch: matches, ms: Math.round(performance.now() - t0) });
    } else {
      const file = join(hdir, src.id as string);
      const r = JSON.parse(readFileSync(file, 'utf8'));
      if (!r.moves?.length) continue;
      const aiRunner = r.config.ai !== 'corp';
      const c: Ctx = { src: `human:${src.id}`, sk: aiRunner ? 'humanCorp' : 'humanRunner', who: aiRunner ? 'ai' : 'person', hard: r.config.difficulty === 'hard' };
      const t = T.probe;
      const core = t.core;
      let s: GameState;
      if (r.startsAt === 'state') s = structuredClone(r.state);
      else {
        s = core.createInitialGameState(t.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
        if (r.startStops) s = { ...s, stops: r.startStops };
      }
      // The shadow Runner: shown each Runner decision board (remember only); asked only through `ask` on copies
      const shadow: any = t.createAgent('runner', 'normal');
      let stopped: string | null = null;
      for (const [j, move] of (r.moves as GameAction[]).entries()) {
        const ai = { ...s, stops: { corp: 'ai', runner: 'ai' } } as GameState;
        const cls = decisionOf(core, ai);
        if (cls) {
          const snap = snapAgent(shadow);
          shadow.observe(s);
          const copy = structuredClone(ai);
          // The played move is the recorded one: a control ask is compared with it only where our Runner played it
          measure(c, a, copy, cls, new Map(shadow.memory), entries, snap, aiRunner && !c.hard ? key(move) : null, { at: j });
        }
        try {
          s = core.executeAction(s, move);
        } catch (e) {
          stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
          break;
        }
      }
      finish(c, a, { moves: r.moves.length, stopped, ms: Math.round(performance.now() - t0) });
    }
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
