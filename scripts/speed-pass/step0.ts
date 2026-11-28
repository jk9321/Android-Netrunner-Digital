/**
 * AI speed pass (tracker L-24), step 0 (brief netrunner-ai/speed-pass/brief.md rev 1 section 4, with ruling-rev0.md's red
 * team section): where the time goes on this checkout's src, scripts only. One tree (this checkout's src, copied and
 * patched with timers and counters; no line of logic changes) plays each deal by GameRunner (RULE-SCRIPT-RULES); the
 * GameRunner's own two agents are wrapped, so every top-level decision is timed once, by side and kind (main, prompt,
 * rez, off), and all counts below are split by that kind.
 *
 * Item 1, timers (outermost call of a name only; `a>b` is b's outermost time while a is open): answerPrompt,
 * scoreAnswer, followChain, scoreOutcome, arrivalTerms, ownHandBefore, ownHandValue, handCount, sumKeep, keep (sumKeep's
 * per-card keep), evaluate, tagLossPerTurn, creditsLessCost, creditNeed, boardNeed, rezMoney (corpPorts.keep's owner),
 * boardPlansWorth, addRigCard, serverHold (the hold count), rezBudget, stateEntries (F3's three maps' lookups). Each
 * row is [ms, outermost calls, all calls]. The timer's own cost per call is measured at the start (`calib`).
 *
 * Item 2, repeat counts, by kind:
 *  - B (lever B, the tag clock's inner reads): every memo miss on a board that comes from tagLossPerTurn's copy (the
 *    copy itself, or its afterRun / nextTurnBoard board) is classed against the memo entries already made for the same
 *    home (the board the copy was made from, through the same afterRun / nextTurnBoard path) and the same name:
 *    `same` (the same pricing key: an entry homed on the original would have served it; exact, the copy is a shallow
 *    copy), `other` (only another pricing key had it: a section 6 item 3 share, never built; `eq`/`diff` say whether its
 *    value equals every other key's), `fresh` (none). A copy made through tagCost's one-click-fewer copy (finding 10)
 *    is homed on tagCost's original with the clicks in its path, and counted apart as `~name`. ms: `same` outermost among same misses; `other` outside any
 *    same or other miss; `all` (every copy miss) outermost among copy misses.
 *  - D (lever D): ownHandValue, handCount and sumKeep's keep asked again on the same board OBJECT (finding 6) under the
 *    same side (and viewer; card and synergy for keep) and the same frameKeys().pricing + .context (finding 4): what a
 *    memo on that object would serve. [n, ms] by name and `arrivalTerms>name`.
 *  - E is timed in item 1 (stateEntries); A is the chain counters (`chainUsed`, prompts.ts chainStats.used's length).
 *
 *   BOARD=tests/fixtures/tag-loss-time/t18-corp.json npx vite-node scripts/speed-pass/step0.ts   (item 3: one decision)
 *   SHARD=0/64 npx vite-node scripts/speed-pass/step0.ts -- POOL=batch,nrdb
 *   ARGS="POOL=batch DEALS=1001 MAX_STEPS=200" npx vite-node scripts/speed-pass/step0.ts
 * Step 0b (MAKERS=1): who makes the boards equal in whole state on distinct objects (see `maker` below); with it every
 * executeAction result is tagged and a content repeat's `sameObj` (the same object asked again) is counted apart.
 *   SHARD=0/64 npx vite-node scripts/speed-pass/step0.ts -- POOL=batch,nrdb MAKERS=1
 * Summed by scripts/speed-pass/step0-sum.mjs.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { loadTree, type Tree } from '../runner-rework/facts-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/speed-pass-step0', String(shard));
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 4000);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity);
/** BOARD=<saved state .json>: one decision on that board instead of the deals (item 3). */
const BOARD = process.env.BOARD;
const started = Date.now();
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));

// ------------------------------------------------------------------------------------------------ the tree's patches
type Patch = [file: string, at: string, to: string];
/** Functions timed by name: [file, name, how] ('fn' a function declaration, 'const' an arrow function const). */
const TIMED: [string, string, 'fn' | 'const'][] = [
  ['ai/prompts.ts', 'answerPrompt', 'fn'],
  ['ai/prompts.ts', 'scoreAnswer', 'fn'],
  ['ai/prompts.ts', 'followChain', 'fn'],
  ['ai/prompts.ts', 'scoreOutcome', 'fn'],
  ['ai/prompts.ts', 'arrivalTerms', 'fn'],
  ['ai/prompts.ts', 'ownHandBefore', 'fn'],
  ['ai/prompts.ts', 'sumKeep', 'const'],
  ['ai/handValues.ts', 'ownHandValue', 'fn'],
  ['ai/evaluate.ts', 'evaluate', 'fn'],
  ['ai/evaluate.ts', 'handCount', 'fn'],
  ['ai/evaluate.ts', 'tagLossPerTurn', 'fn'],
  ['ai/evaluate.ts', 'addRigCard', 'fn'],
  ['ai/valueModel.ts', 'creditsLessCost', 'fn'],
  ['ai/valueModel.ts', 'creditNeed', 'const'],
  ['ai/valueModel.ts', 'boardNeed', 'fn'],
  ['ai/valueModel.ts', 'stateEntries', 'fn'],
  ['ai/corp/rezMoney.ts', 'rezMoney', 'fn'],
  ['ai/cardPlans.ts', 'boardPlansWorth', 'fn'],
  ['ai/corp/hold.ts', 'serverHold', 'fn'],
  ['ai/iceValues.ts', 'rezBudget', 'fn'],
  // Step 0b: the engine's board maker (its result tagged with the board and action it came from)
  ['core/engine/gameEngine.ts', 'executeAction', 'fn'],
];
const OTHER: Patch[] = [
  // memo's miss path: the work goes through the B count's hook (the value and the entry are as in play)
  ['ai/valueModel.ts', '  const value = work();\n  entry.values.set(key, value);', '  const __m = (globalThis as any).__spMiss;\n  const value = __m ? __m(state, key, name, work) : work();\n  entry.values.set(key, value);'],
  // tagLossPerTurn's copy, made by the hook (the same shallow copy) so its boards are known as the copy's
  ['ai/evaluate.ts', 'tagLoss({ ...state }, viewer, skip)', 'tagLoss((globalThis as any).__spCopy ? (globalThis as any).__spCopy(state) : { ...state }, viewer, skip)'],
  // tagCost's one-click-fewer copy, known as its original's (finding 10: a board one Runner click apart, path `~c<clicks>`)
  ['ai/runs.ts', 'const s = !state.activeRun ? { ...state, runner: { ...state.runner, clicks: state.runner.clicks - 1 } } : state;', 'const s = !state.activeRun ? ((globalThis as any).__spTag ?? ((_: unknown, x: GameState) => x))(state, { ...state, runner: { ...state.runner, clicks: state.runner.clicks - 1 } }) : state;'],
  // sumKeep's per-card keep, timed and counted as `keep`
  ['ai/prompts.ts', 'n + keep(state, c, synergy), 0);', "n + ((globalThis as any).__spT ? (globalThis as any).__spT('keep', keep, [state, c, synergy]) : keep(state, c, synergy)), 0);"],
];

function applyPatches(dir: string) {
  const edit = (f: string, fn: (text: string) => string) => {
    const path = join(dir, 'src', f);
    writeFileSync(path, fn(readFileSync(path, 'utf8')));
  };
  for (const [f, at, to] of OTHER)
    edit(f, text => {
      if (text.split(at).length !== 2) throw new Error(`a patch does not match once in ${f}: ${at.slice(0, 80)}`);
      return text.replace(at, () => to);
    });
  for (const [f, name, how] of TIMED)
    edit(f, text => {
      const re = how === 'fn' ? new RegExp(`^(export )?function ${name}(<[^>(]*>)?\\(`, 'gm') : new RegExp(`^(export )?const ${name} = `, 'gm');
      const hits = text.match(re) ?? [];
      if (hits.length !== 1) throw new Error(`timer ${name}: ${hits.length} definitions in ${f}`);
      const exported = hits[0].startsWith('export ');
      const renamed = text.replace(re, m => m.replace(` ${name}`, ` __${name}`).replace(/^export /, how === 'const' ? '' : 'export '));
      return `${renamed}\n${exported ? 'export ' : ''}function ${name}(...a: any[]): any {\n  const w = (globalThis as any).__spT;\n  return w ? w('${name}', __${name}, a) : (__${name} as any)(...a);\n}\n`;
    });
}

function makeTree(): string {
  const dir = join(root, 'tree');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync('src', join(dir, 'src'), { recursive: true });
  applyPatches(dir);
  return dir;
}

// ------------------------------------------------------------------------------------------------ the counters
type Row = [ms: number, outer: number, calls: number];
type Kind = string;
const S = {
  on: false,
  kind: '' as Kind,
  timers: {} as Record<Kind, Record<string, Row>>,
  reps: {} as Record<Kind, Record<string, [n: number, ms: number]>>,
  content: {} as Record<Kind, Record<string, { asked: number; same: [number, number]; other: [number, number]; inClock: number; inClockSame: number; verified: [number, number]; sameObj: [number, number]; differ: Record<string, number> }>>,
  makers: {} as Record<Kind, Record<string, Record<string, { n: number; ms: number; logEq: number }>>>,
  exec: {} as Record<Kind, { n: number; ms: number; dup: number; dupMs: number; sites: Record<string, [number, number]> }>,
  B: {} as Record<Kind, Record<string, { all: [number, number]; fresh: number; same: [number, number]; other: [number, number]; eq: number; diff: number }>>,
};
const depth: Record<string, number> = {};
const open: string[] = [];
let frame: () => { pricing: string; context: string } = () => ({ pricing: '', context: '' });

/** Repeat keys of lever D's names: the part of the call that is not the board object. */
const REPEAT: Record<string, (a: any[]) => string> = {
  ownHandValue: a => String(a[1]),
  handCount: a => `${a[1]}|${a[2]}`,
  keep: a => `${a[1].instanceId}|${a[2]}`,
};
const asked = new WeakMap<object, Set<string>>();
/** The names whose `a>b` rows are kept (every innermost parent is kept as `a@b`). */
const PARENTS = new Set(['answerPrompt', 'scoreAnswer', 'scoreOutcome', 'arrivalTerms', 'sumKeep', 'evaluate', 'tagLossPerTurn', 'creditsLessCost', 'rezBudget', 'rezMoney']);

function bumpRow(name: string, ms: number, outer: number) {
  const t = (S.timers[S.kind] ??= {});
  const r = (t[name] ??= [0, 0, 0]);
  r[0] += ms;
  r[1] += outer;
}
function timer(name: string, f: (...a: any[]) => any, a: any[]) {
  if (!S.on) return f(...a);
  const t = (S.timers[S.kind] ??= {});
  (t[name] ??= [0, 0, 0])[2]++;
  let repeat = false;
  const rk = REPEAT[name];
  if (rk && a[0] && typeof a[0] === 'object') {
    const fk = frame();
    const k = `${rk(a)}|${fk.pricing}|${fk.context}`;
    let set = asked.get(a[0]);
    if (!set) asked.set(a[0], (set = new Set()));
    if (set.has(k)) repeat = true;
    else set.add(k);
  }
  const content = CONTENT[name] ? contentKey(name, a) : null;
  if (depth[name]) {
    if (repeat) addRep(name, 0);
    if (content) addContent(name, content, 0);
    if (name === 'executeAction' && MAKERS) {
      const t1 = performance.now();
      const result = f(...a);
      if (result && typeof result === 'object') born(a[0], a[1], result, performance.now() - t1);
      return result;
    }
    return f(...a);
  }
  depth[name] = 1;
  open.push(name);
  const t0 = performance.now();
  let result: any;
  try {
    return (result = f(...a));
  } finally {
    const ms = performance.now() - t0;
    if (name === 'executeAction' && MAKERS && result && typeof result === 'object') born(a[0], a[1], result, ms);
    depth[name] = 0;
    open.pop();
    bumpRow(name, ms, 1);
    for (const p of open) if (PARENTS.has(p)) bumpRow(`${p}>${name}`, ms, 1);
    if (open.length) bumpRow(`${open[open.length - 1]}@${name}`, ms, 1);
    if (content) addContent(name, content, ms);
    if (repeat) addRep(name, ms);
  }
}
function addRep(name: string, ms: number) {
  const r = (S.reps[S.kind] ??= {});
  const add = (k: string) => {
    const x = (r[k] ??= [0, 0]);
    x[0]++;
    x[1] += ms;
  };
  add(name);
  if (depth.arrivalTerms) add(`arrivalTerms>${name}`);
}

/**
 * Item 3 and the content repeats: a name in CONTENT asked again on a board equal in content (memo's fingerprint, the
 * turn's flags and the run under way, and the call's other arguments) under the same frame (`same`: frameKeys().pricing
 * and .context) or only under another (`other`), whatever the board object; `inClock` the asks with the tag clock open
 * (tagLossPerTurn), as tests/tagLossTimeSaved.test.ts counts them. The fingerprint does not hold every field, so one
 * repeat in VERIFY is checked against the first board's whole state (its log left out): `verified` [checked, equal].
 * Repeats are counted within one top-level decision (the hold's answers are per decision). ms: the repeat's own call.
 */
const CONTENT: Record<string, (a: any[]) => string> = {
  serverHold: a => `${a[1]}#${JSON.stringify(a[2])}`,
  tagLossPerTurn: a => `${a[1]}#${a[2] ?? 0}`,
  rezMoney: a => JSON.stringify(a[1] ?? {}),
  creditNeed: a => String(a[1]),
  evaluate: a => String(a[1]),
};
const VERIFY = Number(process.env.VERIFY ?? 8);
let fingerprint: (s: GameState) => string = () => '';
const contentSeen = new Map<string, { frames: Set<string>; first: object; objs: Set<object> }>();
const fullText = new WeakMap<object, string>();
const whole = (s: any): string => {
  let t = fullText.get(s);
  if (t === undefined) fullText.set(s, (t = JSON.stringify({ ...s, log: undefined })));
  return t;
};
let repeatsSeen = 0;
/** Where two boards differ (paths to 3 levels, an array index as []), for a fingerprint repeat that is not one in content. */
function diffPaths(a: any, b: any, at = '', level = 0, outPaths = new Set<string>()): Set<string> {
  if (a === b || outPaths.size > 12) return outPaths;
  if (level >= 4 || !a || !b || typeof a !== 'object' || typeof b !== 'object') {
    if (JSON.stringify(a) !== JSON.stringify(b)) outPaths.add(at || '.');
    return outPaths;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (k !== 'log') diffPaths(a[k], b[k], `${at}.${Array.isArray(a) ? '[]' : k}`, level + 1, outPaths);
  return outPaths;
}
function contentKey(name: string, a: any[]): [string, string, object] | null {
  const s: GameState = a[0];
  if (!s || typeof s !== 'object' || !s.corp) return null;
  const fk = frame();
  return [`${name}#${fingerprint(s)}#${JSON.stringify(s.turnFlags)}#${s.activeRun ? JSON.stringify(s.activeRun) : ''}#${CONTENT[name](a)}`, `${fk.pricing}|${fk.context}`, s];
}
function addContent(name: string, [board, fk, state]: [string, string, object], ms: number) {
  const h = ((S.content[S.kind] ??= {})[name] ??= { asked: 0, same: [0, 0], other: [0, 0], inClock: 0, inClockSame: 0, verified: [0, 0], sameObj: [0, 0], differ: {} });
  const clock = depth.tagLossPerTurn > 0 && name !== 'tagLossPerTurn';
  h.asked++;
  if (clock) h.inClock++;
  let seen = contentSeen.get(board);
  if (!seen) contentSeen.set(board, (seen = { frames: new Set(), first: state, objs: new Set() }));
  const repeat = seen.frames.has(fk) ? 'same' : seen.frames.size ? 'other' : null;
  if (repeat) {
    h[repeat][0]++;
    h[repeat][1] += ms;
    if (clock && repeat === 'same') h.inClockSame++;
    // The same board object asked again in the same frame (no memo on it): a repeat that needs no maker
    if (repeat === 'same' && seen.objs.has(state)) {
      h.sameObj[0]++;
      h.sameObj[1] += ms;
    } else if (repeatsSeen++ % VERIFY === 0 && seen.first !== state) {
      h.verified[0]++;
      if (whole(seen.first) === whole(state)) {
        h.verified[1]++;
        if (MAKERS && repeat === 'same') maker(name, seen.first, state, ms);
      } else for (const path of diffPaths(seen.first, state)) h.differ[path] = (h.differ[path] ?? 0) + 1;
    }
  }
  seen.frames.add(fk);
  seen.objs.add(state);
}

/**
 * Step 0b (MAKERS=1; ruling-rev0.md "Step 0, ruled" 3): who makes the boards that are equal in whole state on distinct
 * objects. Every executeAction result inside a decision is tagged with the board and the action it came from; the same
 * (board object, action) executed again is `dup` (its engine time `dupMs`, and the calling stack `sites`, one in VERIFY).
 * A verified equal same-frame repeat of a CONTENT name is classed by how its second board was made:
 *   exec twice       both boards are executeAction results of the same (board object, action)
 *   exec, equal from both are executeAction results of the same action on two equal boards (the cascade of one above)
 *   exec             the second is an executeAction result, the first is not or came another way
 *   copy             the second is no executeAction result (an AI spread copy: withHand, tagCost's copy, ...)
 * and by the stack it was asked from (src function names, innermost first, the timers' wrappers left out), with whether
 * the two boards' logs are equal too (the same history, not a transposition). ms: the repeat's own call, on the sample.
 */
const MAKERS = !!process.env.MAKERS;
type Birth = { from: object; action: string; dupOf?: object };
const birth = new WeakMap<object, Birth>();
const execSeen = new WeakMap<object, Map<string, object>>();
/** PAIRS=1 (with MAKERS, a local read): the first executeAction's stack is kept too, and a repeat's site reads `first => again`. */
const PAIRS = !!process.env.PAIRS;
const firstSite = new WeakMap<object, string>();
let execCount = 0;
function born(from: object, action: unknown, result: object, ms: number) {
  if (!S.on) return;
  const key = JSON.stringify(action);
  const e = (S.exec[S.kind] ??= { n: 0, ms: 0, dup: 0, dupMs: 0, sites: {} });
  e.n++;
  e.ms += ms;
  let m = execSeen.get(from);
  if (!m) execSeen.set(from, (m = new Map()));
  const prev = m.get(key);
  const b: Birth = { from, action: key };
  if (prev && prev !== result) {
    b.dupOf = prev;
    e.dup++;
    e.dupMs += ms;
    if (execCount++ % VERIFY === 0) {
      const sig = PAIRS ? `${firstSite.get(prev) ?? '?'} => ${stackSig(8)}` : stackSig();
      const x = (e.sites[sig] ??= [0, 0]);
      x[0]++;
      x[1] += ms;
    }
  } else {
    m.set(key, result);
    if (PAIRS) firstSite.set(result, stackSig(8));
  }
  if (!birth.has(result)) birth.set(result, b);
}
function maker(name: string, first: object, second: object, ms: number) {
  const a = birth.get(first);
  const b = birth.get(second);
  const how = b && a && (b.dupOf === first || a.dupOf === second || (a.from === b.from && a.action === b.action)) ? 'exec twice' : b && a && a.action === b.action && whole(a.from) === whole(b.from) ? 'exec, equal from' : b ? 'exec' : 'copy';
  const sig = `${how} | ${stackSig()}`;
  const x = (((S.makers[S.kind] ??= {})[name] ??= {})[sig] ??= { n: 0, ms: 0, logEq: 0 });
  x.n++;
  x.ms += ms;
  if (JSON.stringify((first as any).log) === JSON.stringify((second as any).log)) x.logEq++;
}
/** The calling stack in the tree's src, innermost first: function names (wrappers and anonymous frames left out), 16 deep. */
function stackSig(deep = 16): string {
  const e: { stack?: string } = {};
  const lim = Error.stackTraceLimit;
  Error.stackTraceLimit = 60;
  Error.captureStackTrace(e);
  Error.stackTraceLimit = lim;
  const names: string[] = [];
  for (const line of (e.stack ?? '').split('\n').slice(1)) {
    const m = /at (?:([^ ]+) )?\(?(.*?):\d+:\d+\)?$/.exec(line.trim());
    if (!m || !m[2].includes('/tree/src/')) continue;
    const fn = (m[1] ?? '').replace(/^Object\./, '').replace(/^__/, '');
    if (!fn || fn === 'timer' || fn === 'w' || names[names.length - 1] === fn) continue;
    names.push(`${fn}(${m[2].split('/tree/src/')[1].replace(/\.ts$/, '')})`);
    if (names.length >= deep) break;
  }
  return names.join(' < ');
}

// Lever B: tagLossPerTurn's copies and the boards made from them, by home (the original) and path
type Origin = { home: object; path: string; copy: boolean };
const origin = new WeakMap<object, Origin>();
const shadow = new WeakMap<object, Map<string, Map<string, unknown>>>();
const originOf = (s: object): Origin => origin.get(s) ?? { home: s, path: '', copy: false };
let inCopyMiss = 0;
let inSame = 0;
let inOther = 0;
let sameValue: (a: unknown, b: unknown) => boolean = Object.is;
function copyOf(state: GameState): GameState {
  const copy = { ...state };
  const o = originOf(state);
  origin.set(copy, { home: o.home, path: o.path, copy: true });
  return copy;
}
function tagCopy(state: GameState, copy: GameState): GameState {
  const o = originOf(state);
  origin.set(copy, { home: o.home, path: `${o.path}~c${copy.runner.clicks}`, copy: o.copy });
  return copy;
}
function miss(state: GameState, key: string, name: string, work: () => unknown): unknown {
  if (!S.on) return work();
  const o = originOf(state);
  const pk = key.slice(0, key.length - name.length - 1);
  const slot = `${o.path}|${name}`;
  let homeMap = shadow.get(o.home);
  if (!homeMap) shadow.set(o.home, (homeMap = new Map()));
  let byKey = homeMap.get(slot);
  const cls = !o.copy ? null : byKey?.has(pk) ? 'same' : byKey?.size ? 'other' : 'fresh';
  // Through tagCost's copy (one Runner click apart from its home): counted apart, as `~name`
  const base = name.split(':')[0];
  const head = (o.path.includes('~') ? '~' : '') + base;
  let t0 = 0;
  const timeAll = cls !== null && inCopyMiss === 0;
  const timeSame = cls === 'same' && inSame === 0;
  const timeOther = cls === 'other' && inSame === 0 && inOther === 0;
  if (cls) {
    inCopyMiss++;
    if (cls === 'same') inSame++;
    if (cls === 'other') inOther++;
    t0 = performance.now();
  }
  let value: unknown;
  try {
    value = work();
  } finally {
    if (cls) {
      const ms = performance.now() - t0;
      inCopyMiss--;
      if (cls === 'same') inSame--;
      if (cls === 'other') inOther--;
      const b = ((S.B[S.kind] ??= {})[head] ??= { all: [0, 0], fresh: 0, same: [0, 0], other: [0, 0], eq: 0, diff: 0 });
      b.all[0]++;
      if (timeAll) b.all[1] += ms;
      if (cls === 'fresh') b.fresh++;
      if (cls === 'same') {
        b.same[0]++;
        if (timeSame) b.same[1] += ms;
      }
      if (cls === 'other') {
        b.other[0]++;
        if (timeOther) b.other[1] += ms;
      }
    }
  }
  if (cls === 'other') {
    const b = S.B[S.kind][head];
    if ([...byKey!.values()].every(v => sameValue(v, value))) b.eq++;
    else b.diff++;
  }
  if ((base === 'nextTurnBoard' || base === 'afterRun') && value && typeof value === 'object' && value !== state && !origin.has(value)) origin.set(value, { home: o.home, path: `${o.path}>${head}`, copy: o.copy });
  if (!byKey) homeMap.set(slot, (byKey = new Map()));
  byKey.set(pk, value);
  return value;
}

/** The timer's own cost per call (a no-op timed), to read stateEntries' and handCount's rows against. */
function calibrate(): number {
  const was = S.kind;
  S.on = true;
  S.kind = '_calib';
  const noop = (x: number) => x;
  const n = 200_000;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) timer('noop', noop, [i]);
  const per = (performance.now() - t0) / n;
  delete S.timers._calib;
  S.on = false;
  S.kind = was;
  return per;
}

// ------------------------------------------------------------------------------------------------ the games
type Deal = { seed: number; corpDeck: string; runnerDeck: string };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealState(t: Tree, d: Deal): GameState {
  const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck);
  const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck);
  if (!c || !r) throw new Error(`deal ${d.seed}: deck not found (${d.corpDeck} v ${d.runnerDeck})`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r));
}

type Loaded = Tree & { vm: any; prompts: any };
const round = (x: number) => Math.round(x * 10) / 10;

function playDeal(pool: string, d: Deal, t: Loaded) {
  t.clear();
  S.timers = {};
  S.reps = {};
  S.B = {};
  S.content = {};
  S.makers = {};
  S.exec = {};
  const ms: Record<Kind, { n: number; ms: number; asked: number; searched: number }> = {};
  const over: Record<string, { n: number; ms: number }> = { corp: { n: 0, ms: 0 }, runner: { n: 0, ms: 0 } };
  let nested = 0;
  const wrap = (agent: any, side: 'corp' | 'runner') => {
    for (const m of ['chooseAction', 'chooseRez', 'chooseOffTurn']) {
      const f = agent[m];
      if (typeof f !== 'function') continue;
      agent[m] = (s: GameState, ...rest: unknown[]) => {
        if (nested) return f.call(agent, s, ...rest);
        const kind = `${side}:${m === 'chooseRez' ? 'rez' : m === 'chooseOffTurn' ? 'off' : t.core.activePrompt(s) ? 'prompt' : 'main'}`;
        nested++;
        contentSeen.clear();
        const hc = t.hold.holdCacheStats;
        const was = [hc.asked, hc.searched];
        S.on = true;
        S.kind = kind;
        const t0 = performance.now();
        try {
          return f.call(agent, s, ...rest);
        } finally {
          const took = performance.now() - t0;
          S.on = false;
          nested--;
          const k = (ms[kind] ??= { n: 0, ms: 0, asked: 0, searched: 0 });
          k.n++;
          k.ms += took;
          k.asked += hc.asked - was[0];
          k.searched += hc.searched - was[1];
          if (took > 1000) {
            over[side].n++;
            over[side].ms += took;
          }
        }
      };
    }
    return agent;
  };
  const agents = { corp: wrap(t.createAgent('corp', 'normal'), 'corp'), runner: wrap(t.createAgent('runner', 'normal'), 'runner') };
  let steps = 0;
  let error: string | null = null;
  let g: any;
  if (BOARD) {
    // One saved decision (item 3: tests/tagLossTimeSaved.test.ts's board), asked of a fresh agent of its acting side
    const s: GameState = JSON.parse(readFileSync(BOARD, 'utf8'));
    const side = t.core.actingSide(s) as 'corp' | 'runner';
    out({ kind: 'board', file: BOARD, side, action: agents[side].chooseAction(s) });
    g = { state: s };
  } else {
    g = new t.GameRunner(dealState(t, d), agents);
    try {
      while (steps < MAX_STEPS && g.step()) steps++;
    } catch (e) {
      error = (e as Error).message.slice(0, 200);
    }
  }
  const r = (o: Record<string, Record<string, number[]>>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([n, x]) => [n, x.map(round)]))]));
  out({
    kind: 'deal',
    pool,
    seed: d.seed,
    steps,
    T: g.state.turnNumber,
    winner: g.state.winner ?? null,
    error,
    ms: Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, { ...v, ms: round(v.ms) }])),
    makers: S.makers,
    exec: Object.fromEntries(Object.entries(S.exec).map(([k, v]) => [k, { ...v, ms: round(v.ms), dupMs: round(v.dupMs) }])),
    content: Object.fromEntries(Object.entries(S.content).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([n, x]) => [n, { ...x, same: x.same.map(round), other: x.other.map(round), sameObj: x.sameObj.map(round) }]))])),
    over1s: Object.fromEntries(Object.entries(over).map(([k, v]) => [k, { n: v.n, ms: round(v.ms) }])),
    timers: r(S.timers),
    reps: r(S.reps),
    B: Object.fromEntries(Object.entries(S.B).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([n, b]) => [n, { ...b, all: b.all.map(round), same: b.same.map(round), other: b.other.map(round) }]))])),
    chainUsed: t.prompts.chainStats.used.length,
  });
}

async function main() {
  const dir = makeTree();
  (globalThis as any).__spT = timer;
  (globalThis as any).__spMiss = miss;
  (globalThis as any).__spCopy = copyOf;
  (globalThis as any).__spTag = tagCopy;
  const t = (await loadTree('tree', dir)) as Loaded;
  t.vm = await import(/* @vite-ignore */ join(dir, 'src', 'ai/valueModel.ts'));
  t.prompts = await import(/* @vite-ignore */ join(dir, 'src', 'ai/prompts.ts'));
  frame = () => t.pricing.frameKeys();
  fingerprint = t.vm.fingerprint;
  sameValue = valueEqual;
  const calib = calibrate();
  out({ kind: 'calib', shard, timerMsPerCall: calib });
  const recs = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Deal[];
  const pools: Record<string, string> = {
    batch: process.env.RECORDS_BATCH ?? 'scripts/f117/recs/deals-45940481387.json',
    nrdb: process.env.RECORDS_NRDB ?? 'scripts/runner-rework/facts-deals-45458221138.json',
  };
  const sources: { pool: string; d: Deal }[] = [];
  for (const pool of POOLS) {
    if (!pools[pool]) throw new Error(`unknown pool ${pool}`);
    for (const d of recs(pools[pool])) if (!DEALS.length || DEALS.includes(String(d.seed))) sources.push({ pool, d });
  }
  if (BOARD) sources.splice(0, sources.length, { pool: 'board', d: { seed: 0, corpDeck: '', runnerDeck: '' } });
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    if (Date.now() - started > MAX_MS) break;
    try {
      playDeal(src.pool, src.d, t);
    } catch (e) {
      out({ kind: 'error', pool: src.pool, seed: src.d.seed, error: (e as Error).stack?.slice(0, 400) });
    }
  }
  out({ kind: 'done', shard, ms: Date.now() - started });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

/** Equal as values (memoAudit's rule): numbers bit for bit, arrays, Maps, Sets and plain objects field by field. */
function valueEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return typeof a === 'function' && typeof b === 'function';
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => valueEqual(x, b[i]));
  if (a instanceof Map) {
    if (!(b instanceof Map) || a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !valueEqual(v, b.get(k))) return false;
    return true;
  }
  if (a instanceof Set) return b instanceof Set && a.size === b.size && [...a].every(x => b.has(x));
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every(k => valueEqual((a as any)[k], (b as any)[k]));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
