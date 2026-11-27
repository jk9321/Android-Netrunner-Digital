/**
 * R-B B1b build, step 0 (brief netrunner-ai/runner-rework/briefs/b1b-pricing-context.md rev 1a): the dynamic part, on
 * this checkout's src (beta's head; no src change). It asks what N2 (one frame per top-level decision, the re-notes
 * inside callees gone, a top-level decision starting with no anchor and no known hands) would change, in a tree that
 * still plays as today. Two trees, each its own module graph (facts-trees.ts loadTree):
 *   audit    src with the hooks below; it PLAYS today's game (every hook serves today's value)
 *   control  src unchanged (the scope hooks of core-hooks.ts only, inert): stepped beside it; every step's action and the
 *            deal's record must be equal, so the hooks change no answer
 *
 * The N2 model (kept by the hooks): a top-level decision is the outermost asSide. Inside it, the first note of a
 * (root object, side) makes that frame's anchor; a later note of the same root and side (today's re-note: corpAI's
 * rankMainActions after decideOn, the Runner's ranking after runnerDecide) maps to it. Outside a top-level decision, and
 * before its first note, N2 has no anchor and both known slots empty; inside, the deciding side's slot is its own note
 * and the other side's is empty. Known gap, by construction: a read after the note's own function returned but inside
 * the same asSide is counted as N2's anchor (none on the pools: every note sits at the top of the function that holds the
 * decision, corp/core.ts decideOn, runner/core.ts runnerDecide and runnerOffTurn, corpAI.ts chooseRez); the Hard search's
 * nested decisions (not on the pools) get their proof from the Hard lockstep.
 *
 * What is counted (per pool, by deciding side and caller kind: decider, lookahead (the planner's frozen playouts),
 * reply, oracle, hard):
 *  A. re-notes: every note mapped to an existing N2 frame, with id, credits and the known set's content compared
 *  B. the three hold caches (corp/hold.ts turnAnswers, reachAnswers, runAnswers): N2's map is the decision's first map,
 *     kept past the re-note (an alias of today's map before it, so nothing is solved twice); after the boundary every
 *     lookup is also made in N2's map, and an answer N2 would serve that today solved again is compared with today's
 *  C. the by-position maps keyed by contextKey (handValues drawWorth, clickWorth): the same lookup under N2's context key
 *     (the leftover known slot and a leftover anchor dropped); an entry N2 would serve under another of today's keys is
 *     compared with today's value (finding 2, rider b)
 *  D. anchor.deckValues carried into a later top-level decision (handValues decisionContext, same root and side): every
 *     price served from a carried map is priced again (N2 starts the decision without it) and compared
 *  E. every read of `anchor` and `known` at its read site (static-graph.ts positions): today's value against N2's, by
 *     site: same, a leftover of an earlier decision, the other side's slot, before the decision's own note (tables 6 and
 *     7a of part 2, taken again)
 *  F. entries: withPricing calls by caller kind and by the fields they patch, and the ones that change nothing (every
 *     patched field already that value: the frame N2 would not make); asSide calls (outer, same side, nested)
 *
 * POOL=batch (221 deals), nrdb (110), human (tests/fixtures/human-games). Output: JSON lines (one per deal or file, one
 * totals line). Samples of differing answers (B, C, D) and of non-N2 reads (E) are kept, five per class.
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/b1b/n2-audit.ts -- POOL=batch,nrdb,human
 *   npx vite-node scripts/runner-rework/b1b/n2-audit.ts -- POOL=batch DEALS=1001 MAX_STEPS=200
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../../src/core';
import { ALL_DECKS } from '../../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../../nrdb-test-decks';
import { Tree, loadTree } from '../facts-trees';
import { HOOKS, Patch, applyPatches } from '../core-hooks';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/b1b-n2-audit', String(shard));
const POOLS = (process.env.POOL ?? 'batch,nrdb,human').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 4000);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity);
const SAMPLES = 5;
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const G = globalThis as any;
type Name = 'audit' | 'control';
const NAMES: Name[] = ['audit', 'control'];

// ------------------------------------------------------------------------------------------------ the audit tree
const H = (name: string) => `(globalThis as any).${name}`;
const AUDIT_PATCHES: Patch[] = [
  // F, the N2 model: the outermost asSide is a top-level decision; every asSide and withPricing call is counted
  ['ai/pricing.ts', `export function withPricing<T>(patch: Partial<Pricing>, fn: () => T): T {\n  const undo = holdPricing(patch);`, `export function withPricing<T>(patch: Partial<Pricing>, fn: () => T): T {\n  ${H('__n2W')}?.(patch, context);\n  const undo = holdPricing(patch);`],
  ['ai/pricing.ts', `  if (context.side === side) return fn();\n  const outer = basePlan === null;`, `  ${H('__n2A')}?.(context.side === side, basePlan === null);\n  if (context.side === side) return fn();\n  const outer = basePlan === null;\n  const __d = outer ? ${H('__n2Dec')}?.(side) : undefined;`],
  ['ai/pricing.ts', `    if (outer) basePlan = null;`, `    if (outer) basePlan = null;\n    __d?.();`],
  // A: the note, before the context takes it
  ['ai/pricing.ts', `export function noteDecision(known: Partial<Record<SideCode, Set<string>>>, anchor: NonNullable<Pricing['anchor']>) {`, `export function noteDecision(known: Partial<Record<SideCode, Set<string>>>, anchor: NonNullable<Pricing['anchor']>) {\n  ${H('__n2Note')}?.(known, anchor, context);`],
  // B: the three hold caches
  ['ai/corp/hold.ts', `  let a = cache?.get(key);\n  if (!a) {\n    a = solveTurn(q);\n    cache?.set(key, a);\n  }`, `  let a = cache?.get(key);\n  if (!a) {\n    a = solveTurn(q);\n    cache?.set(key, a);\n  }\n  ${H('__n2Hold')}?.('turnAnswers', anchor, key, a, turnAnswers);`],
  ['ai/corp/hold.ts', `      let v = cache?.get(key);\n      if (!v) {\n        runStandStats.searched++;\n        v = qs.some(q => solveRun(q).holds) ? 'out' : 'in';\n        cache?.set(key, v);\n      }`, `      let v = cache?.get(key);\n      if (!v) {\n        runStandStats.searched++;\n        v = qs.some(q => solveRun(q).holds) ? 'out' : 'in';\n        cache?.set(key, v);\n      }\n      ${H('__n2Hold')}?.('runAnswers', anchor, key, v, runAnswers);`],
  [
    'ai/corp/hold.ts',
    `function reachSetsOf(q: ReachQuestion): (set: string[]) => boolean {\n  const anchor = pricing().anchor;`,
    `function reachSetsOf(q: ReachQuestion): (set: string[]) => boolean {\n  const anchor = pricing().anchor;\n  const f = __reachSetsOfC(q, anchor);\n  const Hk = ${H('__n2Reach')};\n  const n2 = Hk && anchor ? Hk.n2Of(anchor) : anchor;\n  if (!Hk || !anchor || n2 === anchor) return f;\n  const g = __reachSetsOfC(q, n2);\n  return (set: string[]) => {\n    const r = f(set);\n    Hk.cmp(r, g(set));\n    return r;\n  };\n}\nfunction __reachSetsOfC(q: ReachQuestion, anchor: object | null): (set: string[]) => boolean {`,
  ],
  // C: drawWorth and clickWorth, every value served or stored, with its key
  ['ai/handValues.ts', `  if (cached !== undefined && !drawAudit.on) return cached;`, `  if (cached !== undefined && !drawAudit.on) return ${H('__n2By')} ? ${H('__n2By')}('drawWorth', state, key, cached) : cached;`],
  ['ai/handValues.ts', `  entries.set(key, value);\n  return value;\n}\n\n/**\n * Counts for scripts`, `  entries.set(key, value);\n  return ${H('__n2By')} ? ${H('__n2By')}('drawWorth', state, key, value) : value;\n}\n\n/**\n * Counts for scripts`],
  ['ai/handValues.ts', `  if (cached !== undefined && !clickAudit.on) return cached;`, `  if (cached !== undefined && !clickAudit.on) return ${H('__n2By')} ? ${H('__n2By')}('clickWorth', state, key, cached) : cached;`],
  // D: anchor.deckValues, made and served
  ['ai/handValues.ts', `  const all = (anchor.deckValues ??= new Map());`, `  const all = (anchor.deckValues ??= ${H('__n2NewDeck')} ? ${H('__n2NewDeck')}(new Map()) : new Map());`],
  ['ai/handValues.ts', `    let played = values.get(c.instanceId);\n`, `    let played = values.get(c.instanceId);\n    if (played !== undefined && ${H('__n2Deck')}?.(all)) ${H('__n2DeckCmp')}(played, () => priceAtRoot(root, c));\n`],
];

function makeTrees(): Record<Name, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const read = (p: string) => readFileSync(p, 'utf8');
  const write = (p: string, t: string) => writeFileSync(p, t);
  const dirs = {} as Record<Name, string>;
  for (const name of NAMES) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    applyPatches(dir, HOOKS.filter(h => h[2].includes('__lkIn') || h[2].includes('__lkScope') || h[1].includes('this.last = action')), `scopes ${name}`, read, write);
    if (name === 'audit') {
      applyPatches(dir, AUDIT_PATCHES, 'audit', read, write);
      clickStore(dir, read, write);
      readSites(dir, read, write);
    }
    dirs[name] = dir;
  }
  return dirs;
}

/** clickWorth's own store (the second `entries.set(key, value)` of handValues.ts, after clickWorth's key line). */
function clickStore(dir: string, read: (p: string) => string, write: (p: string, t: string) => void) {
  const path = `${dir}/src/ai/handValues.ts`;
  const text = read(path);
  const from = text.indexOf('export function clickWorth(');
  const at = text.indexOf('  entries.set(key, value);\n  return value;', from);
  if (from < 0 || at < 0 || text.indexOf('  entries.set(key, value);\n  return value;', at + 1) >= 0) throw new Error('clickWorth store: not found once');
  write(path, text.slice(0, at) + `  entries.set(key, value);\n  return ${H('__n2By')} ? ${H('__n2By')}('clickWorth', state, key, value) : value;` + text.slice(at + '  entries.set(key, value);\n  return value;'.length));
}

/** E: every `anchor` and `known` read site of the static graph (static-graph.ts), wrapped: `expr` -> __n2R(id, expr). */
type GRead = { what: string; field: string; file: string; line: number; at: [number, number]; text: string };
let READS: GRead[] = [];
function readSites(dir: string, read: (p: string) => string, write: (p: string, t: string) => void) {
  const json = join(root, 'graph.json');
  execSync(`npx vite-node scripts/pricing-context/static-graph.ts -- OUT=${json}`, { stdio: 'ignore' });
  const g = JSON.parse(readFileSync(json, 'utf8'));
  READS = (g.reads as GRead[]).filter(r => r.field === 'anchor' || r.field === 'known');
  // The static graph's positions are this checkout's src; the patches above changed hold.ts and handValues.ts, so each
  // read is found again by its text near its line in the patched copy
  const byFile = new Map<string, GRead[]>();
  READS.forEach(r => byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]));
  for (const [file, rs] of byFile) {
    const orig = readFileSync(file, 'utf8');
    const path = join(dir, file);
    let text = read(path);
    // Last first: positions in `orig` are mapped to `text` by the expression's occurrence index
    const edits: [number, number, string][] = [];
    for (const r of rs) {
      const expr = orig.slice(r.at[0], r.at[1]);
      const nth = orig.slice(0, r.at[0]).split(expr).length - 1;
      let pos = -1;
      for (let k = 0; k <= nth; k++) pos = text.indexOf(expr, pos + 1);
      if (pos < 0) throw new Error(`read ${file}:${r.line} ${expr} not found`);
      edits.push([pos, pos + expr.length, `((globalThis as any).__n2R ? (globalThis as any).__n2R(${READS.indexOf(r)}, ${expr}) : ${expr})`]);
    }
    edits.sort((a, b) => b[0] - a[0]);
    for (const [a, b, to] of edits) text = text.slice(0, a) + to + text.slice(b);
    write(path, text);
  }
}

let T: Record<Name, Tree>;

// ------------------------------------------------------------------------------------------------ the N2 model and counts
type Frame = { root: object; side: string; id: string; credits: number; known: Set<string> | null; dec: number; anchor0: object };
const count = new Map<string, number>();
const bump = (k: string, n = 1) => count.set(k, (count.get(k) ?? 0) + n);
const samples = new Map<string, unknown[]>();
const sample = (k: string, x: () => unknown) => {
  const s = samples.get(k) ?? [];
  if (s.length < SAMPLES) s.push(x());
  samples.set(k, s);
};
let where = { src: '', step: 0, T: 0 };

const HOOK_NAMES = ['__lkIn', '__n2Dec', '__n2A', '__n2W', '__n2Note', '__n2Hold', '__n2Reach', '__n2By', '__n2NewDeck', '__n2Deck', '__n2DeckCmp', '__n2R'];
/** The audit tree's hooks for one deal or file (the model's state lives in this closure); set as globals around its steps only. */
function install(t: Tree): Record<string, unknown> {
  const pricing = t.pricing;
  const scopes: string[] = [];
  // Top-level decisions (the outermost asSide), numbered
  let decSerial = 0;
  let dec: { n: number; side: string; frames: Frame[]; noted: boolean } | null = null;
  /** today's anchor object -> its N2 frame (the decision's first note of that root and side) */
  const n2 = new WeakMap<object, Frame>();
  /** the decision each anchor object and each known Set was noted in, and by which side */
  const notedIn = new WeakMap<object, { dec: number; side: string }>();
  /** anchor.deckValues maps: the decision they were made in */
  const deckOrigin = new WeakMap<object, number>();
  const kind = () => {
    const p = scopes.join('>');
    if (p.includes('oracle')) return 'oracle';
    if (p.includes('hard')) return 'hard';
    if (p.includes('reply')) return 'reply';
    return pricing.pricing().frozen ? 'lookahead' : 'decider';
  };
  const tag = () => `${dec?.side ?? 'none'}:${kind()}`;

  G.__lkIn = (gr: any) => {
    scopes.push(gr.__lkScope ?? 'top');
    return () => void scopes.pop();
  };
  G.__n2Dec = (side: string) => {
    const was = dec;
    dec = { n: ++decSerial, side, frames: [], noted: false };
    return () => void (dec = was);
  };
  G.__n2A = (same: boolean, outer: boolean) => bump(`F|asSide|${dec?.side ?? 'none'}|${same ? 'same side' : outer ? 'outer' : 'nested'}`);
  G.__n2W = (patch: Record<string, unknown>, c: Record<string, unknown>) => {
    const fields = Object.keys(patch).sort().join(',');
    const noop = Object.keys(patch).every(k => Object.is(c[k], patch[k]));
    bump(`F|withPricing|${tag()}|${fields}|${noop ? 'no change' : 'change'}`);
  };
  G.__n2Note = (known: Record<string, Set<string>>, anchor: any) => {
    const side = anchor.side as string;
    const set = known[side] ?? null;
    if (!dec) {
      bump(`A|note outside a decision|${side}`);
      return;
    }
    notedIn.set(anchor, { dec: dec.n, side });
    if (set) notedIn.set(set, { dec: dec.n, side });
    const f = dec.frames.find(x => x.root === anchor.root && x.side === side);
    if (!f) {
      const frame: Frame = { root: anchor.root, side, id: anchor.id, credits: anchor.credits, known: set, dec: dec.n, anchor0: anchor };
      dec.frames.push(frame);
      n2.set(anchor, frame);
      // deckValues carried from an earlier decision (decisionContext: the same root and side as the last anchor)
      if (anchor.deckValues && deckOrigin.get(anchor.deckValues) !== undefined && deckOrigin.get(anchor.deckValues)! < dec.n) bump(`D|carried into a later decision|${tag()}`);
      bump(`A|first note|${tag()}`);
      dec.noted = true;
      return;
    }
    n2.set(anchor, f);
    const same = f.id === anchor.id && f.credits === anchor.credits && sameSet(f.known, set);
    bump(`A|re-note|${tag()}|${same ? 'equal' : 'differs'}`);
    if (!same) sample(`A|re-note differs|${tag()}`, () => ({ ...where, was: { id: f.id, credits: f.credits, known: f.known?.size }, now: { id: anchor.id, credits: anchor.credits, known: set?.size } }));
  };
  /** N2's anchor for today's: the frame's first anchor object (the one its maps were made under). */
  const n2Of = (a: object) => n2.get(a)?.anchor0 ?? a;
  // B: a lookup after the boundary, in N2's map
  G.__n2Hold = (cache: string, anchor: object | null, key: string, today: any, maps: WeakMap<object, Map<string, any>>) => {
    if (!anchor) return bump(`B|${cache}|${tag()}|no anchor`);
    const a2 = n2Of(anchor);
    if (a2 === anchor) return bump(`B|${cache}|${tag()}|before the boundary`);
    let m = maps.get(a2);
    if (!m) maps.set(a2, (m = new Map()));
    const kept = m.get(key);
    if (kept === undefined) {
      m.set(key, today);
      return bump(`B|${cache}|${tag()}|after, N2 solves too`);
    }
    const same = cache === 'runAnswers' ? kept === today : kept.holds === today.holds && kept.set === today.set && kept.need === today.need && (kept.entries === undefined || today.entries === undefined || kept.entries === today.entries);
    bump(`B|${cache}|${tag()}|after, N2 serves ${kept === today ? 'the same object' : same ? 'an equal answer' : 'A DIFFERENT ANSWER'}`);
    if (!same) sample(`B|${cache} differs`, () => ({ ...where, key: key.slice(0, 200), kept: cache === 'runAnswers' ? kept : { holds: kept.holds, set: kept.set, need: kept.need }, today: cache === 'runAnswers' ? today : { holds: today.holds, set: today.set, need: today.need } }));
  };
  G.__n2Reach = {
    n2Of,
    cmp: (r: boolean, r2: boolean) => {
      bump(`B|reachAnswers|${tag()}|after, ${r === r2 ? 'equal' : 'A DIFFERENT ANSWER'}`);
      if (r !== r2) sample('B|reachAnswers differs', () => ({ ...where, today: r, n2: r2 }));
    },
  };
  // C: the by-position maps under N2's context key
  const byN2 = { drawWorth: new WeakMap<object, Map<string, { v: number; k: string }>>(), clickWorth: new WeakMap<object, Map<string, { v: number; k: string }>>() };
  G.__n2By = (map: 'drawWorth' | 'clickWorth', state: object, key: string, value: number) => {
    const ck = pricing.contextKey();
    if (!key.endsWith(ck)) throw new Error(`${map}: the key does not end with contextKey`);
    const k2 = key.slice(0, key.length - ck.length) + n2ContextKey();
    let m = byN2[map].get(state);
    if (!m) byN2[map].set(state, (m = new Map()));
    const e = m.get(k2);
    if (!e) {
      m.set(k2, { v: value, k: key });
      bump(`C|${map}|${tag()}|${k2 === key ? 'key the same' : 'key differs'}`);
      return value;
    }
    if (e.k === key) {
      bump(`C|${map}|${tag()}|${k2 === key ? 'key the same' : 'key differs'}`);
      return value;
    }
    const same = Object.is(e.v, value);
    bump(`C|${map}|${tag()}|N2 serves another key's entry: ${same ? 'equal' : 'A DIFFERENT VALUE'}`);
    if (!same) sample(`C|${map} differs`, () => ({ ...where, today: key.slice(-160), n2: k2.slice(-160), was: e.k.slice(-160), v: value, n2v: e.v }));
    return value;
  };
  /** contextKey as N2 would build it: a leftover anchor and the leftover known slots dropped (the root by today's ids). */
  const n2ContextKey = () => {
    const c = pricing.pricing();
    const a = c.anchor;
    const fresh = (x: object | null) => !!x && !!dec && notedIn.get(x)?.dec === dec.n;
    const hand = (side: string) => {
      const s = c.known[side];
      return s && fresh(s) && notedIn.get(s)!.side === side ? [...s].join(',') : '-';
    };
    let anchor = '';
    if (a && fresh(a)) {
      const real = pricing.contextKey().split('|')[3];
      anchor = real;
    }
    return `${c.frozen ? 'f' : ''}|${hand('corp')}|${hand('runner')}|${anchor}|${c.decisionSeed ?? ''}|${[...c.rezzingToUse].join(',')}`;
  };
  // D
  G.__n2NewDeck = (m: Map<string, unknown>) => {
    if (dec) deckOrigin.set(m, dec.n);
    return m;
  };
  G.__n2Deck = (all: object) => !!dec && deckOrigin.get(all) !== undefined && deckOrigin.get(all)! < dec.n;
  G.__n2DeckCmp = (played: number, fresh: () => number) => {
    const v = fresh();
    bump(`D|carried price|${tag()}|${Object.is(v, played) ? 'equal' : 'A DIFFERENT VALUE'}`);
    if (!Object.is(v, played)) sample('D|carried price differs', () => ({ ...where, carried: played, fresh: v }));
  };
  // E: reads of anchor and known
  const classify = (x: object | null, side: string | null): string => {
    if (!x) return 'empty';
    if (!dec) return 'outside a decision (N2: empty)';
    const at = notedIn.get(x);
    if (!at) return 'not noted by a decision (N2: as is)';
    if (at.dec !== dec.n) return at.side === dec.side ? 'leftover: an earlier decision of the same side (N2: empty)' : "leftover: the other side's last decision (N2: empty)";
    if (side && at.side !== side) return 'this decision, another slot (N2: empty)';
    return 'this decision (N2: the same)';
  };
  G.__n2R = (id: number, value: any) => {
    const r = READS[id];
    const site = `${r.file.replace('src/ai/', '')}:${r.line}`;
    if (r.field === 'anchor') {
      const cl = classify(value, null);
      bump(`E|anchor|${site}|${tag()}|${dec && !dec.noted ? 'before the own note, ' : ''}${cl}`);
      if (cl.includes('N2: empty')) sample(`E|anchor ${site} ${cl}`, () => ({ ...where, kind: tag() }));
      return value;
    }
    // known: the record, read per side
    return new Proxy(value, {
      get(t, k) {
        const v = t[k];
        if (k === 'corp' || k === 'runner') {
          const cl = classify(v, k);
          bump(`E|known.${k}|${site}|${tag()}|${dec && !dec.noted ? 'before the own note, ' : ''}${cl}`);
          if (cl.includes('N2: empty')) sample(`E|known.${k} ${site} ${cl}`, () => ({ ...where, kind: tag() }));
        }
        return v;
      },
    });
  };
  const hooks = Object.fromEntries(HOOK_NAMES.map(k => [k, G[k]]));
  for (const k of HOOK_NAMES) G[k] = undefined;
  return hooks;
}
const sameSet = (a: Set<string> | null, b: Set<string> | null) => (!a || !b ? a === b : a.size === b.size && [...a].every(x => b.has(x)));

// ------------------------------------------------------------------------------------------------ deals
type Deal = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(t: Tree, d: Deal): GameState {
  const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck);
  const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck);
  if (!c || !r) throw new Error(`deal ${d.seed}: deck not found (${d.corpDeck} v ${d.runnerDeck})`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r));
}
const agentsOf = (t: Tree) => ({ corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') });
const ms: Record<Name, number> = { audit: 0, control: 0 };

/** One step of each tree (audit with its hooks installed, control with none); the action each applied. */
let hooks: Record<string, unknown> = {};
function stepBoth(g: Record<Name, any>, i: number): { more: Record<Name, boolean>; act: Record<Name, string> } {
  const more = {} as Record<Name, boolean>;
  const act = {} as Record<Name, string>;
  for (const n of i % 2 ? (['control', 'audit'] as Name[]) : NAMES) {
    if (n === 'audit') Object.assign(G, hooks);
    const t0 = performance.now();
    try {
      more[n] = g[n].step();
    } finally {
      ms[n] += performance.now() - t0;
      if (n === 'audit') for (const k of HOOK_NAMES) G[k] = undefined;
    }
    act[n] = JSON.stringify(g[n].last ?? null);
  }
  return { more, act };
}

function deal(pool: string, d: Deal) {
  const g = {} as Record<Name, any>;
  for (const n of NAMES) {
    T[n].clear();
    g[n] = new T[n].GameRunner(dealStateOf(T[n], d), agentsOf(T[n]));
  }
  hooks = install(T.audit);
  let diff: unknown = null;
  let steps = 0;
  for (let i = 0; i < MAX_STEPS; i++) {
    where = { src: `${pool}:${d.seed}`, step: i, T: g.audit.state.turnNumber };
    const { more, act } = stepBoth(g, i);
    if (more.audit !== more.control || act.audit !== act.control) {
      diff = { step: i, T: g.audit.state.turnNumber, audit: act.audit.slice(0, 200), control: act.control.slice(0, 200) };
      break;
    }
    steps++;
    if (!more.audit) break;
  }
  out({ kind: 'deal', pool, seed: d.seed, steps, winner: g.audit.state.winner ?? null, T: g.audit.state.turnNumber, diff });
}

function human(file: string) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  if (!r.moves?.length) return;
  const src = `human:${file.split('/').pop()}`;
  const core = T.audit.core;
  let s: GameState;
  if (r.startsAt === 'state') s = structuredClone(r.state);
  else {
    s = core.createInitialGameState(T.audit.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
    if (r.startStops) s = { ...s, stops: r.startStops };
  }
  const agents = {} as Record<Name, { corp: any; runner: any }>;
  for (const n of NAMES) {
    T[n].clear();
    agents[n] = agentsOf(T[n]);
  }
  hooks = install(T.audit);
  let decisions = 0;
  let stopped: string | null = null;
  const diffs: unknown[] = [];
  for (const [j, move] of (r.moves as any[]).entries()) {
    where = { src, step: j, T: s.turnNumber };
    const ai = { ...s, stops: { corp: 'ai', runner: 'ai' } } as GameState;
    if (core.actingSide(ai) && !ai.winner) {
      decisions++;
      const g = { audit: new T.audit.GameRunner(structuredClone(ai), agents.audit), control: new T.control.GameRunner(structuredClone(ai), agents.control) };
      try {
        const { act } = stepBoth(g, j);
        if (act.audit !== act.control) diffs.push({ at: j, audit: act.audit.slice(0, 160), control: act.control.slice(0, 160) });
      } catch (e) {
        diffs.push({ at: j, error: (e as Error).message.slice(0, 160) });
      }
    }
    try {
      s = core.executeAction(s, move);
    } catch (e) {
      stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
      break;
    }
  }
  out({ kind: 'human', src, moves: r.moves.length, stopped, decisions, diffs: diffs.length, first: diffs.slice(0, 3) });
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const dirs = makeTrees();
  T = {} as typeof T;
  for (const n of NAMES) T[n] = await loadTree(n, dirs[n]);
  const batch: Deal[] = JSON.parse(readFileSync('scripts/runner-rework/facts-deals-45444888753.json', 'utf8'));
  const nrdb: Deal[] = JSON.parse(readFileSync('scripts/runner-rework/facts-deals-45458221138.json', 'utf8'));
  const pick = (recs: Deal[]) => recs.filter(r => !DEALS.length || DEALS.includes(String(r.seed)));
  const sources: { pool: string; id: any }[] = [];
  for (const pool of POOLS) {
    if (pool === 'batch') for (const r of pick(batch)) sources.push({ pool, id: r });
    else if (pool === 'nrdb') for (const r of pick(nrdb)) sources.push({ pool, id: r });
    else if (pool === 'human') {
      const dir = 'tests/fixtures/human-games';
      for (const f of readdirSync(dir).filter(f => f.endsWith('.json') && (!DEALS.length || DEALS.includes(f.slice(0, -5)))).sort()) sources.push({ pool, id: join(dir, f) });
    } else throw new Error(`unknown pool ${pool}`);
  }
  const started = Date.now();
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    if (Date.now() - started > MAX_MS) break;
    try {
      if (src.pool === 'human') human(src.id);
      else deal(src.pool, src.id);
    } catch (e) {
      out({ kind: 'error', pool: src.pool, src: src.pool === 'human' ? src.id : src.id.seed, error: (e as Error).stack?.slice(0, 400) });
    }
  }
  out({ kind: 'totals', shard, ms, count: Object.fromEntries([...count].sort()), samples: Object.fromEntries(samples) });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
