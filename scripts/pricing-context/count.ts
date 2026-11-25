/**
 * R-B B1b's first step (brief netrunner-ai/runner-rework/briefs/b1b-context-table.md rev 0 with the Corp side's items,
 * tracker R-12a), part 2: the count of pricing.ts's context on the pools, by hook.
 *
 * Two trees, each its own module graph (facts-trees.ts loadTree):
 *   hooked   this checkout's src with the hooks below; it PLAYS the game (step 0: its deal records equal the base's)
 *   control  this checkout's src unchanged, stepped beside it: the time arm (and a check that the sources reproduce)
 *
 * Hooks (applied to the hooked copy only; each is inert while its global is unset):
 *   reads    every read site of part 1's table (static-graph.ts positions): `expr` -> __pcR(id, expr), which counts and
 *            returns the value unchanged (`known` is returned as a read-through Proxy, to see which side's entry is read)
 *   setters  every call of withPricing/holdPricing/asSide/noteDecision: the callee -> __pcW(id, callee), a wrapper that
 *            counts the entry and keeps the stack of setters open
 *   rezzingToUse's add/delete (corp/rez.ts), the only writes outside the entry points
 *   time     pricing.ts's own work (holdPricing, its undo, noteDecision, asSide's planWith, pricingKey) timed
 *   scopes   GameRunner.step pushes its scope (top, reply, oracle, hardR/hardC: runner-rework/core-hooks.ts's hooks)
 *   item 7   (Corp side, 06:21Z) stopCredits, unseenInHand, ownHandValue, walkPick: when the anchor or `known` entry they
 *            read was noted by another decision, the same question is asked again in a SANDBOX (every value cache of
 *            src/ai neither read nor written: module Maps wrapped, anchor.deckValues a throwaway), once after a fresh note
 *            of the reading decision's own board and once on the value read (the control); memo(): a hit filled under
 *            another anchor, known, frozen or decisionSeed is recomputed in the sandbox under the context of the read
 *            and under the one of the fill (the control). A sandboxed question leaves no state behind (step 0 checks it).
 *
 * Kinds of caller (where a read or entry happens, inside a top-level decision): decider (the deciding side's own
 * decision, outside any playout), lookahead (inside the planner's playouts, planTurn's frozen scope), reply, oracle,
 * hard (a GameRunner of that scope). Every count is keyed by the top-level decider's side and by actingSide() at the read.
 *
 * POOL=batch (221 deals of g1 45499791395 = 45444888753), nrdb (110 of NRDB=1 g1 45503877309 = 45458221138), human (the 38
 * files of tests/fixtures/human-games: the person's moves replayed, the hooked agents asked on a copy at each decision).
 * Output: JSON lines (one per deal or file; one totals line), boards of differing answers under OUT_DIR/boards.
 *
 *   SHARD=0/64 npx vite-node scripts/pricing-context/count.ts -- POOL=batch,nrdb,human
 *   npx vite-node scripts/pricing-context/count.ts -- POOL=batch DEALS=1001,1641 CAP=20
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Tree, loadTree } from '../runner-rework/facts-trees';
import { HOOKS, applyPatches } from '../runner-rework/core-hooks';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/pricing-count', String(shard));
const POOLS = (process.env.POOL ?? 'batch,nrdb,human').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 4000);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity);
const CAP = Number(process.env.CAP ?? 20); // sandboxed re-asks per (question, class) per deal
const NO_Q = process.env.NO_Q === '1'; // step 0 can also be run without the re-asks
const OUT_DIR = process.env.OUT_DIR ?? '';
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const G = globalThis as any;
type Name = 'hooked' | 'control';
const NAMES: Name[] = ['hooked', 'control'];

// ------------------------------------------------------------------------------------------------ the hooked tree
type GRead = { what: string; field: string; file: string; line: number; at: [number, number]; text: string };
type GScope = { id: string; setter: string; file: string; line: number; fields: string[]; callee: [number, number] };
const R_ = (e: string) => `((globalThis as any).__pcR ? (globalThis as any).__pcR(%ID%, ${e}) : ${e})`;
const W_ = (e: string) => `((globalThis as any).__pcW ? (globalThis as any).__pcW(%ID%, ${e}) : ${e})`;
/** Wraps `function name(` (exported or not) so the question hook sees its arguments and answer. */
const question = (file: string, header: string, name: string): [string, string, string] => [
  file,
  header,
  `${header.replace(`function ${name}(`, `function __q_${name}(`)}`,
];
const QUESTIONS: [file: string, header: string, name: string][] = [
  ['ai/iceValues.ts', `function stopCredits(state: GameState): number {`, 'stopCredits'],
  ['ai/handValues.ts', `export function unseenInHand(state: GameState, side: SideCode): CardInstance[] {`, 'unseenInHand'],
  ['ai/handValues.ts', `export function ownHandValue(state: GameState, side: SideCode): number {`, 'ownHandValue'],
  ['ai/corp/hold.ts', `function walkPick(state: GameState, server: string, corpCredits: number, from: TurnFrom, picked: string[] | undefined): Hold {`, 'walkPick'],
];
/** The value caches of src/ai a sandboxed question must neither read nor write (module Maps; found by name). */
const CACHES: [file: string, name: string][] = [
  ['ai/valueModel.ts', 'memos'],
  ['ai/valueModel.ts', 'buildTargets'],
  ['ai/valueModel.ts', 'iceMeans'],
  ['ai/iceValues.ts', 'deckShares'],
  ['ai/oracle.ts', 'playedOut'],
  ['ai/handValues.ts', 'deckAverage'],
  ['ai/handValues.ts', 'clickCache'],
  ['ai/effectValues.ts', 'threats'],
  ['ai/effectValues.ts', 'boardFactCodes'],
  ['ai/prompts.ts', 'runAfters'],
  ['ai/corp/hold.ts', 'turnAnswers'],
  ['ai/corp/hold.ts', 'reachAnswers'],
  ['ai/corp/hold.ts', 'runAnswers'],
  ['ai/turnPlanner.ts', 'runnerViews'],
  ['ai/turnPlanner.ts', 'corpViews'],
  ['ai/turnPlanner.ts', 'corpViewSet'],
];
let READS: GRead[] = [];
let SETS: GScope[] = [];

function hookTree(dir: string) {
  const json = join(root, 'graph.json');
  execSync(`npx vite-node scripts/pricing-context/static-graph.ts -- OUT=${json}`, { stdio: 'ignore' });
  const g = JSON.parse(readFileSync(json, 'utf8'));
  READS = g.reads;
  SETS = g.scopes;
  // Position edits from the static graph (made on this checkout's src: the copy has the same text), last first per file
  const edits = new Map<string, [number, number, string][]>();
  const add = (file: string, at: [number, number], to: string) => edits.set(file, [...(edits.get(file) ?? []), [at[0], at[1], to]]);
  READS.forEach((r, i) => add(r.file, r.at, '\u0000R' + i));
  SETS.forEach((s, i) => add(s.file, s.callee, '\u0000W' + i));
  for (const [file, es] of edits) {
    const path = join(dir, file);
    let text = readFileSync(path, 'utf8');
    es.sort((a, b) => b[0] - a[0]);
    for (let k = 1; k < es.length; k++) if (es[k][1] > es[k - 1][0]) throw new Error(`overlapping hooks in ${file} at ${es[k][0]}`);
    for (const [a, b, tag] of es) {
      const expr = text.slice(a, b);
      const id = tag.slice(2);
      text = text.slice(0, a) + (tag[1] === 'R' ? R_(expr) : W_(expr)).replace('%ID%', id) + text.slice(b);
    }
    writeFileSync(path, text);
  }
  const read = (p: string) => readFileSync(p, 'utf8');
  const write = (p: string, t: string) => writeFileSync(p, t);
  // GameRunner scopes (runner-rework/core-hooks.ts: the step's scope push and the reply, oracle and Hard labels)
  applyPatches(dir, HOOKS.filter(h => h[2].includes('__lkIn') || h[2].includes('__lkScope')), 'scopes', read, write);
  // rezzingToUse, written outside the entry points
  applyPatches(
    dir,
    [
      ['ai/corp/rez.ts', `  rezzingToUse.add(card.instanceId);`, `  rezzingToUse.add(card.instanceId);\n  (globalThis as any).__pcZ?.(1, rezzingToUse.size);`],
      ['ai/corp/rez.ts', `    rezzingToUse.delete(card.instanceId);`, `    rezzingToUse.delete(card.instanceId);\n    (globalThis as any).__pcZ?.(-1, rezzingToUse.size);`],
    ],
    'rezzingToUse',
    read,
    write
  );
  // pricing.ts's own work, timed
  const T = (label: string, expr: string) => `((globalThis as any).__pcT ? (globalThis as any).__pcT('${label}', () => ${expr}) : ${expr})`;
  applyPatches(
    dir,
    [
      ['ai/pricing.ts', `  const undo = holdPricing(patch);\n  try {`, `  const undo = ${T('hold', 'holdPricing(patch)')};\n  try {`],
      ['ai/pricing.ts', `  } finally {\n    undo();\n  }\n}`, `  } finally {\n    ${T('undo', 'undo()')};\n  }\n}`],
      ['ai/pricing.ts', `export function noteDecision(`, `export function noteDecision(...__a: Parameters<typeof __noteDecision>) {\n  return ${T('note', '__noteDecision(...__a)')};\n}\nfunction __noteDecision(`],
      ['ai/pricing.ts', `planWith(base, sideOff[side])`, T('planWith', 'planWith(base, sideOff[side])')],
      ['ai/pricing.ts', `export function pricingKey(): string {\n  if (keyVersion === version) return key;`, `export function pricingKey(): string {\n  if (keyVersion === version) return key;\n  return ${T('key', '__pricingKey()')};\n}\nfunction __pricingKey(): string {`],
    ],
    'timing',
    read,
    write
  );
  // Item 7: the questions, the memo's fills and hits, the sandbox
  applyPatches(
    dir,
    QUESTIONS.map(([file, header, name]) => question(file, header, name)),
    'questions',
    read,
    write
  );
  for (const [file, header, name] of QUESTIONS) {
    const path = join(dir, 'src', file);
    const exp = header.startsWith('export ') ? 'export ' : '';
    write(path, read(path) + `\n${exp}function ${name}(...__a: any[]): any {\n  const Q = (globalThis as any).__pcQ;\n  return Q ? Q('${name}', __q_${name}, __a) : (__q_${name} as any)(...__a);\n}\n`);
  }
  applyPatches(
    dir,
    [
      [
        'ai/valueModel.ts',
        `  if (entry.values.has(key)) return entry.values.get(key) as T;\n  const value = work();\n  entry.values.set(key, value);`,
        `  if (entry.values.has(key)) {\n    const __v = entry.values.get(key) as T;\n    const __H = (globalThis as any).__pcMemoHit;\n    return __H ? __H(entry.values, key, __v, work) : __v;\n  }\n  const value = work();\n  entry.values.set(key, value);\n  (globalThis as any).__pcMemoFill?.(entry.values, key);`,
      ],
      ['ai/handValues.ts', `  const all = (anchor.deckValues ??= new Map());`, `  const all = (globalThis as any).__pcSB ? new Map<string, Map<string, number>>() : (anchor.deckValues ??= new Map());`],
      ['ai/synergy.ts', `const ownCache = { corp: new WeakMap<GameState, Profile>(), runner: new WeakMap<GameState, Profile>() };`, `const ownCache = { corp: (globalThis as any).__pcCache(new WeakMap<GameState, Profile>()), runner: (globalThis as any).__pcCache(new WeakMap<GameState, Profile>()) };`],
      ['ai/synergy.ts', `const oppCache = { corp: new WeakMap<GameState, Profile>(), runner: new WeakMap<GameState, Profile>() };`, `const oppCache = { corp: (globalThis as any).__pcCache(new WeakMap<GameState, Profile>()), runner: (globalThis as any).__pcCache(new WeakMap<GameState, Profile>()) };`],
    ],
    'memo and sandbox',
    read,
    write
  );
  for (const [file, name] of CACHES) {
    const path = join(dir, 'src', file);
    const text = read(path);
    const re = new RegExp(`^((?:export )?const ${name}\\s*(?::[^=]+)?=\\s*)(new (?:Weak)?(?:Map|Set)\\b.*?\\));?\\s*$`, 'm');
    if (!re.test(text)) throw new Error(`cache ${name} not found in ${file}`);
    write(path, text.replace(re, (_m, a, b) => `${a}(globalThis as any).__pcCache(${b});`));
  }
}

// A Map/WeakMap/Set/WeakSet that neither serves nor stores while a sandboxed question runs
class SandboxMap {
  constructor(private m: any) {}
  get(k: unknown) {
    return G.__pcSB ? undefined : this.m.get(k);
  }
  set(k: unknown, v: unknown) {
    if (!G.__pcSB) this.m.set(k, v);
    return this;
  }
  add(k: unknown) {
    if (!G.__pcSB) this.m.add(k);
    return this;
  }
  has(k: unknown) {
    return !G.__pcSB && this.m.has(k);
  }
  delete(k: unknown) {
    return G.__pcSB ? false : this.m.delete(k);
  }
  clear() {
    if (!G.__pcSB) this.m.clear();
  }
  get size() {
    return this.m.size;
  }
  forEach(f: any) {
    this.m.forEach(f);
  }
  keys() {
    return this.m.keys();
  }
  values() {
    return this.m.values();
  }
  entries() {
    return this.m.entries();
  }
  [Symbol.iterator]() {
    return this.m[Symbol.iterator]();
  }
}
G.__pcCache = (m: unknown) => new SandboxMap(m);

function makeTrees(): Record<Name, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs = {} as Record<Name, string>;
  for (const n of NAMES) {
    const dir = join(root, n);
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    if (n === 'hooked') hookTree(join(dir, 'src') === '' ? dir : dir);
    dirs[n] = dir;
  }
  return dirs;
}

// ------------------------------------------------------------------------------------------------ the counts
const counts = new Map<string, number>();
const maxes = new Map<string, number>();
const inc = (k: string, by = 1) => counts.set(k, (counts.get(k) ?? 0) + by);
const max = (k: string, v: number) => {
  if (v > (maxes.get(k) ?? -Infinity)) maxes.set(k, v);
};
const records: Record<string, unknown>[] = [];
const recCount = new Map<string, number>();
const budget = new Map<string, number>();

type Origin = { top: number; topSide: string; kind: string; acting: string; source: string };
type Top = { idx: number; side: string; kind: string; state: GameState; noted: boolean; first?: { anchor: any; known: Record<string, Set<string>> } };
let P: any; // the hooked tree's pricing module
let source = ''; // pool:seed of the deal being played
let top: Top | null = null;
let topIdx = 0;
const scopes: string[] = [];
const stack: { id: number; setter: string; fields: string[] }[] = [];
const anchorOrigin = new WeakMap<object, Origin>();
const knownOrigin: Record<string, Origin | undefined> = {};
const PLANTURN = () => SETS.findIndex(s => s.file === 'src/ai/turnPlanner.ts' && s.setter === 'withPricing' && s.fields.includes('frozen'));
let planTurnId = -1;
const timeIn: Record<string, Record<string, number>> = { corp: {}, runner: {}, '-': {} };

function kindNow(): string {
  const inner = scopes[scopes.length - 1];
  if (inner && inner !== 'top') return inner.startsWith('hard') ? 'hard' : inner;
  if (stack.some(e => e.id === planTurnId)) return 'lookahead';
  return 'decider';
}
const actingNow = () => P.pricing().side ?? '-';
const topSide = () => top?.side ?? '-';
function classify(o: Origin | undefined, kind: string, acting: string): string {
  if (!o) return 'none';
  if (o.top === topIdx && o.source === source) {
    if (o.kind === kind && o.acting === acting) return 'same';
    if (kind !== 'decider' && o.kind === 'decider') return 'outer';
    return `this-decision:${o.kind}/${o.acting}`;
  }
  const side = o.topSide === topSide() ? 'earlier-same-side' : 'earlier-other-side';
  return `${side}:${o.kind}/${o.acting}`;
}

/** A stable text of a value, for comparing answers (Maps and Sets by content, numbers bit for bit). */
function stable(v: unknown, depth = 0): string {
  if (depth > 40) return '…';
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (typeof v === 'function') return 'fn';
  if (typeof v !== 'object') return JSON.stringify(v);
  if (v instanceof Map) return `M{${[...v].map(([k, x]) => `${stable(k, depth + 1)}:${stable(x, depth + 1)}`).join(',')}}`;
  if (v instanceof Set) return `S{${[...v].map(x => stable(x, depth + 1)).sort().join(',')}}`;
  if (Array.isArray(v)) return `[${v.map(x => stable(x, depth + 1)).join(',')}]`;
  return `{${Object.keys(v)
    .sort()
    .map(k => `${k}:${stable((v as any)[k], depth + 1)}`)
    .join(',')}}`;
}
function sandbox<T>(fn: () => T): T {
  G.__pcSB = (G.__pcSB ?? 0) + 1;
  try {
    return fn();
  } finally {
    G.__pcSB--;
  }
}
function keepRecord(cls: string, rec: Record<string, unknown>, board?: GameState) {
  const n = recCount.get(cls) ?? 0;
  recCount.set(cls, n + 1);
  if (n >= 5) return;
  const r = { cls, source, top: topIdx, T: top?.state.turnNumber, decider: topSide(), ...rec };
  records.push(r);
  if (board && OUT_DIR) {
    mkdirSync(join(OUT_DIR, 'boards'), { recursive: true });
    writeFileSync(join(OUT_DIR, 'boards', `${cls.replace(/[^\w.-]+/g, '_')}-${n}.json`), JSON.stringify({ ...r, board }));
  }
}
/** The note the reading decision makes (or would make) of its own board: its first own note, else the top state. */
function freshNote(): { anchor: any; known: Record<string, Set<string> | null> } {
  const ctx = P.pricing();
  if (top?.first) return { anchor: top.first.anchor, known: { ...ctx.known, ...top.first.known } };
  const s = top!.state;
  const side = top!.side as 'corp' | 'runner';
  const hand = side === 'corp' ? s.corp.hq : s.runner.grip;
  return { anchor: { id: s.id, credits: s.runner.credits, root: s, side }, known: { ...ctx.known, [side]: new Set(hand.map(c => c.instanceId)) } };
}

function listen() {
  planTurnId = PLANTURN();
  G.__lkIn = (gr: any) => {
    scopes.push(gr.__lkScope ?? 'top');
    return () => void scopes.pop();
  };
  G.__pcT = (label: string, fn: () => unknown) => {
    if (G.__pcSB) return fn();
    const t = performance.now();
    try {
      return fn();
    } finally {
      const s = topSide();
      timeIn[s][label] = (timeIn[s][label] ?? 0) + performance.now() - t;
    }
  };
  G.__pcZ = (d: number, size: number) => {
    if (G.__pcSB) return;
    if (d > 0) {
      inc(`E|rezzingToUse|rez.ts:405|${topSide()}|${kindNow()}|${actingNow()}|rezzingToUse|`);
      max(`M|rezzingToUse|${topSide()}|${kindNow()}`, size);
    }
  };
  // ---- reads
  G.__pcR = (id: number, v: any) => {
    if (G.__pcSB) return v;
    const r = READS[id];
    const kind = kindNow();
    const acting = actingNow();
    const ts = topSide();
    const field = r.field.startsWith('plan.') ? 'plan' : r.what === 'actingSide()' ? 'side' : r.field;
    let state = '-';
    if (r.what === 'pricing()') {
      if (typeof v === 'boolean') state = v ? 'set' : 'clear';
      else if (field === 'rezzingToUse') state = v.size > 0 ? 'set' : 'clear';
      else if (field === 'side') state = String(v);
      else if (field === 'decisionSeed') state = v === null ? 'null' : 'seed';
      else if (field === 'anchor') state = v ? 'anchor' : 'null';
      else if (field === 'leaves') state = v.length ? 'leaf' : 'none';
      else if (field === 'known') state = 'known';
      else if (field === 'diagnostics') state = v ? 'sink' : 'null';
    } else if (r.what === 'plan()') state = P.pricing().plan ? 'side-plan' : 'tuning.plan';
    else if (r.what === 'actingSide()') state = String(v);
    const fdef = !stack.some(e => e.fields.includes(field));
    inc(`R|${id}|${ts}|${kind}|${acting}|${state}|${fdef ? 'nodef' : 'set'}|${stack.length ? 'stack' : 'empty'}`);
    if (field === 'anchor' && v) {
      const cls = classify(anchorOrigin.get(v), kind, acting);
      // decisionContext's own read of the last anchor (handValues.ts:116) is the note itself: it keeps deckValues only for the same root and side
      const own = r.unit.includes(':decisionContext@');
      const before = kind === 'decider' && !top?.noted && !own;
      inc(`S|anchor|${id}|${ts}|${kind}|${acting}|${cls}|${own ? 'note-own' : before ? 'before-note' : ''}`);
      if (before && top) {
        const f = freshNote().anchor;
        inc(`A7a|anchor|${ts}|${f.id === v.id && f.credits === v.credits ? 'same' : 'differs'}`);
      }
    }
    if (field === 'known' && v) {
      return new Proxy(v, {
        get(t, p) {
          const x = t[p as any];
          if (p === 'corp' || p === 'runner') {
            const cls = classify(knownOrigin[p], kind, acting);
            const before = kind === 'decider' && !top?.noted;
            inc(`S|known.${p}|${id}|${ts}|${kind}|${acting}|${cls}|${before ? 'before-note' : ''}`);
            if (before && top && p === top.side) {
              const f = freshNote().known[p];
              inc(`A7a|known.${p}|${ts}|${stable(f) === stable(x) ? 'same' : 'differs'}`);
            }
          }
          return x;
        },
      });
    }
    return v;
  };
  // ---- setters
  const wrappers = new Map<number, (...a: any[]) => any>();
  G.__pcW = (id: number, fn: (...a: any[]) => any) => {
    let w = wrappers.get(id);
    if (w) return w;
    const s = SETS[id];
    w = (...a: any[]) => {
      if (G.__pcSB) return fn(...a);
      const ctx = P.pricing();
      const kind = kindNow();
      const acting = actingNow();
      const ts = topSide();
      const changed: string[] = [];
      const same: string[] = [];
      let fields = s.fields;
      if (s.setter === 'asSide') (a[0] === ctx.side ? same : changed).push('side', 'plan');
      else if (s.setter === 'noteDecision') {
        const [known, anchor] = a;
        const was = ctx.anchor;
        (was && was.id === anchor.id && was.credits === anchor.credits && was.root === anchor.root && was.side === anchor.side ? same : changed).push('anchor');
        for (const side of Object.keys(known)) (stable(ctx.known[side]) === stable(known[side]) ? same : changed).push(`known.${side}`);
        fields = ['anchor', ...Object.keys(known).map(x => `known.${x}`)];
        const o: Origin = { top: topIdx, topSide: ts, kind, acting, source };
        anchorOrigin.set(anchor, o);
        for (const side of Object.keys(known)) knownOrigin[side] = o;
        if (top && !top.noted && kind === 'decider') {
          top.noted = true;
          top.first = { anchor, known };
        }
      } else {
        const patch = a[0] ?? {};
        fields = Object.keys(patch);
        for (const k of fields) (patch[k] === ctx[k] ? same : changed).push(k);
      }
      const depthSame = stack.filter(e => e.setter === s.setter).length + 1;
      inc(`E|${id}|${ts}|${kind}|${acting}|${changed.join(',')}|${same.join(',')}`);
      inc(`D|${s.setter}|${depthSame}|${stack.length + 1}`);
      max(`MD|${s.setter}`, depthSame);
      max(`MA|${s.setter}`, stack.length + 1);
      for (const f of fields) max(`M|${f}|${ts}|${kind}`, stack.filter(e => e.fields.includes(f)).length + 1);
      if (s.setter === 'noteDecision' || s.setter === 'holdPricing') return fn(...a);
      stack.push({ id, setter: s.setter, fields: s.setter === 'asSide' ? ['side', 'plan'] : fields });
      try {
        return fn(...a);
      } finally {
        stack.pop();
      }
    };
    wrappers.set(id, w);
    return w;
  };
  // ---- item 7 (b): the questions
  G.__pcQ = (name: string, fn: (...a: any[]) => any, a: any[]) => {
    if (G.__pcSB) return fn(...a);
    const result = fn(...a);
    const ctx = P.pricing();
    const kind = kindNow();
    const acting = actingNow();
    const ts = topSide();
    let o: Origin | undefined;
    if (name === 'stopCredits' || name === 'walkPick') o = ctx.anchor ? anchorOrigin.get(ctx.anchor) : undefined;
    else o = knownOrigin[a[1]];
    const cls = classify(o, kind, acting);
    inc(`Q|${name}|${ts}|${kind}|${acting}|${cls}`);
    if (cls === 'same' || cls === 'none' || NO_Q || !top) return result;
    const bk = `${name}|${cls}`;
    if ((budget.get(bk) ?? 0) >= CAP) return result;
    budget.set(bk, (budget.get(bk) ?? 0) + 1);
    const f = freshNote();
    const fresh = sandbox(() => P.withPricing({ anchor: f.anchor, known: f.known }, () => fn(...a)));
    const control = sandbox(() => P.withPricing({ anchor: ctx.anchor, known: { ...ctx.known } }, () => fn(...a)));
    const sr = stable(result);
    const differs = stable(fresh) !== sr;
    const controlDiffers = stable(control) !== sr;
    inc(`QA|${name}|${ts}|${kind}|${cls}|${differs ? 'differs' : 'same'}|${controlDiffers ? 'control-differs' : 'control-same'}`);
    if (differs) keepRecord(`q:${name}:${cls}`, { kind, acting, args: a.slice(1).map(x => stable(x).slice(0, 200)), value: sr.slice(0, 300), fresh: stable(fresh).slice(0, 300), control: stable(control).slice(0, 300), stateId: a[0]?.id }, a[0]);
    return result;
  };
  // ---- item 7 (c): memo hits filled under another context
  const fills = new WeakMap<Map<string, unknown>, Map<string, any>>();
  const snap = () => {
    const c = P.pricing();
    return { anchor: c.anchor, kc: c.known.corp, kr: c.known.runner, frozen: c.frozen, seed: c.decisionSeed, top: topIdx, source };
  };
  G.__pcMemoFill = (values: Map<string, unknown>, key: string) => {
    if (G.__pcSB) return;
    let m = fills.get(values);
    if (!m) fills.set(values, (m = new Map()));
    m.set(key, snap());
  };
  G.__pcMemoHit = (values: Map<string, unknown>, key: string, v: unknown, work: () => unknown) => {
    if (G.__pcSB) return v;
    const s = fills.get(values)?.get(key);
    if (!s) return v;
    const now = snap();
    const diff = [s.anchor !== now.anchor && 'anchor', s.kc !== now.kc && 'known.corp', s.kr !== now.kr && 'known.runner', s.frozen !== now.frozen && 'frozen', s.seed !== now.seed && 'decisionSeed'].filter(Boolean).join('+');
    const kind = kindNow();
    const ts = topSide();
    const what = key.split(':').slice(12, 13)[0] ?? key; // the caller's key after pricingKey's 12 parts
    inc(`H|${diff || 'none'}|${ts}|${kind}|${s.top === topIdx && s.source === source ? 'this-decision' : 'earlier-decision'}`);
    if (!diff || NO_Q) return v;
    if (v instanceof Map || v instanceof Set || typeof v === 'function') {
      inc(`HA|${diff}|${what}|container`);
      return v;
    }
    const bk = `memo|${diff}|${what}`;
    if ((budget.get(bk) ?? 0) >= CAP) return v;
    budget.set(bk, (budget.get(bk) ?? 0) + 1);
    const c = P.pricing();
    const again = sandbox(() => P.withPricing({ anchor: c.anchor, known: { ...c.known } }, work));
    const control = sandbox(() => P.withPricing({ anchor: s.anchor, known: { corp: s.kc, runner: s.kr }, frozen: s.frozen, decisionSeed: s.seed }, work));
    const sv = stable(v);
    const differs = stable(again) !== sv;
    const controlDiffers = stable(control) !== sv;
    inc(`HA|${diff}|${what}|${differs ? 'differs' : 'same'}|${controlDiffers ? 'control-differs' : 'control-same'}`);
    if (differs && !controlDiffers) keepRecord(`memo:${diff}:${what}`, { kind, key: key.slice(0, 160), value: sv.slice(0, 300), again: stable(again).slice(0, 300) });
    return v;
  };
}

// ------------------------------------------------------------------------------------------------ games
let T: Record<Name, Tree>;
type Deal = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(t: Tree, d: Deal): GameState {
  const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck);
  const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck);
  if (!c || !r) throw new Error(`deal ${d.seed}: deck not found (${d.corpDeck} v ${d.runnerDeck})`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r));
}
/** The decision GameRunner.step asks an agent for at `s`, or null (as runner-rework/core-lockstep.ts). */
function decisionOf(core: any, s: GameState): { side: 'corp' | 'runner'; kind: string } | null {
  const side = core.actingSide(s);
  if (!side || s.winner) return null;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
    const want = core.wantsStop(s, side, w);
    if (want && side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server')) return { side, kind: 'rez' };
    if (want && side === 'runner' && w.step === 'corp_action') return { side, kind: 'off' };
    return null;
  }
  return { side, kind: core.activePrompt(s) ? 'prompt' : 'main' };
}
const ms: Record<Name, Record<string, number[]>> = { hooked: { corp: [], runner: [] }, control: { corp: [], runner: [] } };
const started = Date.now();
const key = (a: unknown) => JSON.stringify(a);

function startTop(s: GameState) {
  const d = decisionOf(T.hooked.core, s);
  topIdx++;
  top = d ? { idx: topIdx, side: d.side, kind: d.kind, state: s, noted: false } : null;
  if (top) {
    // (a) of the Corp side's 06:20Z note: who noted the anchor and each known entry this decision starts with
    const ctx = P.pricing();
    const who = (o: Origin | undefined) => (!o ? 'none' : `${o.topSide === top!.side ? 'own-side' : 'other-side'}:${o.kind}/${o.acting}`);
    inc(`B|anchor|${top.side}|${top.kind}|${who(ctx.anchor ? anchorOrigin.get(ctx.anchor) : undefined)}`);
    for (const sd of ['corp', 'runner']) inc(`B|known.${sd}|${top.side}|${top.kind}|${who(knownOrigin[sd])}`);
  }
}

function deal(pool: string, d: Deal) {
  source = `${pool}:${d.seed}`;
  const g = {} as Record<Name, any>;
  for (const n of NAMES) {
    T[n].clear();
    g[n] = new T[n].GameRunner(dealStateOf(T[n], d), { corp: T[n].createAgent('corp'), runner: T[n].createAgent('runner') });
  }
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  let steps = 0;
  let diverged: string | null = null;
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.hooked.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const dec = decisionOf(T.hooked.core, s);
    const more = {} as Record<Name, boolean>;
    const order: Name[] = i % 2 ? ['control', 'hooked'] : ['hooked', 'control'];
    for (const n of order) {
      if (n === 'hooked') startTop(s);
      const t0 = performance.now();
      more[n] = g[n].step();
      const dt = performance.now() - t0;
      if (dec && more[n]) ms[n][dec.side].push(dt);
    }
    top = null;
    if (!more.hooked && !more.control) break;
    steps++;
    if (more.hooked !== more.control || key(g.hooked.last) !== key(g.control.last)) {
      diverged = `step ${i} T${s.turnNumber}`;
      break;
    }
    if (!more.hooked) break;
  }
  const B = g.hooked.state;
  const recordSame = !diverged && (B.winner ?? null) === d.winner && key(cr) === key(d.cr) && key(sc) === key(d.sc);
  out({ kind: 'deal', pool, seed: d.seed, steps, recordSame, diverged, winner: B.winner ?? null, T: B.turnNumber, ms: Date.now() - started });
}

function human(file: string) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  if (!r.moves?.length) return;
  source = `human:${file.split('/').pop()}`;
  const core = T.hooked.core;
  let s: GameState;
  if (r.startsAt === 'state') s = structuredClone(r.state);
  else {
    s = core.createInitialGameState(T.hooked.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
    if (r.startStops) s = { ...s, stops: r.startStops };
  }
  const agents = {} as Record<Name, { corp: any; runner: any }>;
  for (const n of NAMES) {
    T[n].clear();
    agents[n] = { corp: T[n].createAgent('corp'), runner: T[n].createAgent('runner') };
  }
  let decisions = 0;
  let differ = 0;
  const errors: string[] = [];
  let stopped: string | null = null;
  for (const [j, move] of (r.moves as any[]).entries()) {
    const ai = { ...s, stops: { corp: 'ai', runner: 'ai' } } as GameState;
    const d = decisionOf(core, ai);
    if (d) {
      decisions++;
      const last = {} as Record<Name, string>;
      for (const n of (j % 2 ? ['control', 'hooked'] : ['hooked', 'control']) as Name[]) {
        const gr = new T[n].GameRunner(structuredClone(ai), agents[n]);
        if (n === 'hooked') startTop(gr.state);
        const t0 = performance.now();
        try {
          gr.step();
          last[n] = key(gr.last);
        } catch (e) {
          last[n] = `error: ${(e as Error).message.slice(0, 100)}`;
          errors.push(`${n} moves[${j}]: ${last[n]}`);
        }
        ms[n][d.side].push(performance.now() - t0);
      }
      top = null;
      if (last.hooked !== last.control) differ++;
    }
    try {
      s = core.executeAction(s, move);
    } catch (e) {
      stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
      break;
    }
  }
  out({ kind: 'human', src: source, moves: r.moves.length, decisions, differ, stopped, errors: errors.slice(0, 3) });
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const dirs = makeTrees();
  T = {} as typeof T;
  for (const n of NAMES) T[n] = await loadTree(n, dirs[n]);
  P = T.hooked.pricing;
  listen();
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
  let pool = '';
  const flush = () => {
    if (!pool) return;
    out({ kind: 'counts', pool, counts: Object.fromEntries(counts), maxes: Object.fromEntries(maxes), timeIn, ms: Object.fromEntries(NAMES.map(n => [n, { corp: sum(ms[n].corp), runner: sum(ms[n].runner), nCorp: ms[n].corp.length, nRunner: ms[n].runner.length }])), records });
    counts.clear();
    maxes.clear();
    records.length = 0;
    recCount.clear();
    for (const s of Object.values(timeIn)) for (const k of Object.keys(s)) delete s[k];
    for (const n of NAMES) for (const k of Object.keys(ms[n])) ms[n][k] = [];
  };
  const sum = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0));
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    if (Date.now() - started > MAX_MS) break;
    if (src.pool !== pool) {
      flush();
      pool = src.pool;
    }
    budget.clear();
    try {
      if (src.pool === 'human') human(src.id);
      else deal(src.pool, src.id);
    } catch (e) {
      out({ kind: 'error', pool: src.pool, src: src.pool === 'human' ? src.id : src.id.seed, error: (e as Error).stack?.slice(0, 600) });
    }
  }
  flush();
  if (OUT_DIR && existsSync(OUT_DIR)) writeFileSync(join(OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
