/**
 * ai-breaker-guard-key (brief rev 2, phase 1): the measurement trees and the crossing probe. Each tree is a copy of
 * this tree's src/ (beta 247005f) with text patches, in its own module graph (as scripts/hold-reentry/trees.ts): every
 * patch must match exactly once, so a tree that drifted from what the patch expects throws instead of measuring
 * something else. Nothing here is in src/.
 *
 * Timed trees (no probe, so their times compare):
 *   beta  src as it is: the deal 3061 guard is the Set pricing().pricingBreakers, outside pricingKey;
 *   K     the guard as a boolean in the pricing context (pricingBreaker, set with withPricing around the two rig values
 *         in playedWorth), its character 'b' in pricingKey whenever it is up (built as pricingIce and countingHold);
 *   K2    (the brief's K') the character only while the guard is up and averaging is off, and the two deck-average
 *         keys (drawWorth, rootDeckAverage) built without it;
 *   R     for information: hosted breakers in runnerRigValue always take the rule-based worth (the guard raised around
 *         their held worth), a value change.
 * Audit trees (the timed tree's patches plus the probe; their picks are not compared, only checked):
 *   aB    beta with the crossing probe;
 *   aK2   K2 with the crossing probe (K2 is a candidate only if it leaves no differing crossing open).
 *
 * The probe (globalThis.__bg, a GuardProbe) sees every store keyed by pricingKey: memo (valueModel.ts), clickCache and
 * deckAverage (handValues.ts clickWorth, drawWorth), anchor.deckValues (rootDeckAverage) and the threat caches
 * (threatModel.ts remember: threatCache, probeCache). Each write is marked with whether the guard was up; a read whose
 * mark differs from the guard now is a crossing (written up and read down, or the other way). A crossing read is worked
 * out again in the reader's pricing context with empty caches (every store swapped for a shadow store, one per guard
 * state, so nothing crosses inside the recompute: the value a correctly keyed cache would give), capped at CAP_MS; when
 * it differs from the value served it is worked out a second time with the guard as the writer had it. A difference
 * between the two recomputes is the guard's (`guard`); a difference with no guard difference is another seam (the
 * lookup stack, the incomplete keys B1 recorded) and is counted apart. A few same-guard hits per store and decision are
 * recomputed the same way (`ctrl`), for that background.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type Arm = 'beta' | 'K' | 'K2' | 'R' | 'aB' | 'aK2';
export const TIMED: Arm[] = ['beta', 'K', 'K2', 'R'];

const once = (text: string, from: string, to: string, file: string): string => {
  if (text.split(from).length !== 2) throw new Error(`${file}: patch does not match once: ${from.slice(0, 90)}`);
  return text.replace(from, () => to);
};
function edit(dir: string, file: string, f: (text: string) => string) {
  const path = join(dir, 'src', file);
  writeFileSync(path, f(readFileSync(path, 'utf8')));
}

// --- K and K2: the guard as a boolean in the pricing context ---------------------------------------------------------
const GUARD_READ = 'if (isIcebreaker(card) && pricing().pricingBreakers.size === 0 && !pricing().averaging) {';
const GUARD_SET = `    const pricingBreakers = pricing().pricingBreakers;
    pricingBreakers.add(card.instanceId);
    try {
      return runnerRigValue(after) - runnerRigValue(state) - cost - CLICK;
    } finally {
      pricingBreakers.delete(card.instanceId);
    }`;
const KEY_TAIL = "    c.runRecord ? c.runRecord.map(turn => turn.join('+')).join('/') : '',\n  ].join(':');";
const DRAW_KEY = 'const key = `${pricingKey()}:${side}:${state.id}:${state.turnNumber}:${credits}';
const ROOT_KEY = 'const key = `${pricingKey()}:${side}`;';

function keyed(dir: string, narrow: boolean) {
  edit(dir, 'ai/pricing.ts', t => {
    t = once(t, '  countingHold: boolean;\n', '  countingHold: boolean;\n  /** ai-breaker-guard-key tree: a breaker is being priced by the rig it joins (handValues.ts playedWorth). */\n  pricingBreaker: boolean;\n', 'pricing.ts');
    t = once(t, '  countingHold: false,\n', '  countingHold: false,\n  pricingBreaker: false,\n', 'pricing.ts');
    // the last segment, so the deck-average keys of K2 can drop it
    const seg = narrow ? "    c.pricingBreaker && !c.averaging ? 'b' : ''," : "    c.pricingBreaker ? 'b' : '',";
    return once(t, KEY_TAIL, KEY_TAIL.replace('\n  ].join', `\n${seg}\n  ].join`), 'pricing.ts');
  });
  edit(dir, 'ai/handValues.ts', t => {
    t = once(t, GUARD_READ, 'if (isIcebreaker(card) && !pricing().pricingBreaker && !pricing().averaging) {', 'handValues.ts');
    t = once(t, GUARD_SET, '    return withPricing({ pricingBreaker: true }, () => runnerRigValue(after) - runnerRigValue(state)) - cost - CLICK;', 'handValues.ts');
    if (narrow) {
      t = once(t, DRAW_KEY, "const key = `${pricingKey().replace(/:b$/, ':')}:${side}:${state.id}:${state.turnNumber}:${credits}", 'handValues.ts');
      t = once(t, ROOT_KEY, "const key = `${pricingKey().replace(/:b$/, ':')}:${side}`;", 'handValues.ts');
    }
    return t;
  });
}

// --- R: hosted breakers always rule-based (information only) ---------------------------------------------------------
const HOSTED = "    value += hosted.reduce((n, h) => n + heldWorth(state, h, 'runner', freeInstall), 0);";
function ruleBased(dir: string) {
  edit(dir, 'ai/evaluate.ts', t => {
    t = once(t, HOSTED, "    value += hosted.reduce((n, h) => n + (isIcebreaker(h) ? bgRuleWorth(state, h, freeInstall) : heldWorth(state, h, 'runner', freeInstall)), 0);", 'evaluate.ts');
    return `${t}
// ai-breaker-guard-key tree R: a hosted breaker takes the rule-based worth it already gets inside any guarded pricing
function bgRuleWorth(state: GameState, h: CardInstance, free: boolean): number {
  const s = pricing().pricingBreakers;
  if (s.has('__R')) return heldWorth(state, h, 'runner', free);
  s.add('__R');
  try {
    return heldWorth(state, h, 'runner', free);
  } finally {
    s.delete('__R');
  }
}
`;
  });
}

// --- The probe's hooks ---------------------------------------------------------------------------------------------
const HOOKS = `
// ai-breaker-guard-key probe hooks (scripts/breaker-guard-key/trees.ts)
function __bgS<T>(m: T): T {
  const g = (globalThis as any).__bg;
  return g ? g.store(m) : m;
}
function __bgH(store: string, name: string, m: object, k: unknown, v: unknown, fn: () => unknown): void {
  const g = (globalThis as any).__bg;
  if (g) g.hit(store, name, m, k, v, fn);
}
function __bgM(m: object, k: unknown): void {
  const g = (globalThis as any).__bg;
  if (g) g.mark(m, k);
}
`;
const MEMO = `  let entry = memos.get(state);
  if (!entry || entry.print !== print) {
    entry = { print, values: new Map() };
    memos.set(state, entry);
  }
  key = pricingKey() + ':' + key; // values depend on the pricing context: the deciding side, its plan, the guards up (pricing.ts)
  if (entry.values.has(key)) return entry.values.get(key) as T;
  const value = work();
  entry.values.set(key, value);
  return value;`;
const MEMO_P = `  const __m = __bgS(memos);
  let entry = __m.get(state);
  if (!entry || entry.print !== print) {
    entry = { print, values: new Map() };
    __m.set(state, entry);
  }
  const __name = key;
  key = pricingKey() + ':' + key;
  if (entry.values.has(key)) {
    const __v = entry.values.get(key) as T;
    __bgH('memo', __name, entry.values, key, __v, work);
    return __v;
  }
  const value = work();
  entry.values.set(key, value);
  __bgM(entry.values, key);
  return value;`;

function instrument(dir: string) {
  edit(dir, 'ai/valueModel.ts', t => once(t, MEMO, MEMO_P, 'valueModel.ts') + HOOKS);
  edit(dir, 'ai/handValues.ts', t => {
    t = once(t, '  const cached = clickCache.get(key);\n', "  const __cc = __bgS(clickCache);\n  const cached = __cc.get(key);\n  if (cached !== undefined) __bgH('click', 'clickWorth', __cc, key, cached, () => clickWorth(state, side));\n", 'handValues.ts');
    t = once(t, '  clickCache.set(key, value);\n', '  __cc.set(key, value);\n  __bgM(__cc, key);\n', 'handValues.ts');
    t = once(t, '  const cached = deckAverage.get(key);\n', "  const __da = __bgS(deckAverage);\n  const cached = __da.get(key);\n  if (cached !== undefined) __bgH('deck', 'drawWorth', __da, key, cached, () => drawWorth(state, side));\n", 'handValues.ts');
    t = once(t, '  deckAverage.set(key, value);\n', '  __da.set(key, value);\n  __bgM(__da, key);\n', 'handValues.ts');
    t = once(t, '  const all = (anchor.deckValues ??= new Map());\n', '  const all = __bgS(anchor.deckValues ??= new Map());\n', 'handValues.ts');
    t = once(t, '    let played = values.get(c.instanceId);\n', "    let played = values.get(c.instanceId);\n    if (played !== undefined) __bgH('deckValues', 'rootDeck', values, c.instanceId, played, () => priceAtRoot(root, c));\n", 'handValues.ts');
    t = once(t, '      values.set(c.instanceId, played);\n', '      values.set(c.instanceId, played);\n      __bgM(values, c.instanceId);\n', 'handValues.ts');
    return t + HOOKS;
  });
  edit(dir, 'ai/threatModel.ts', t => {
    t = once(t, '  const hit = cache.get(key);\n  if (hit !== undefined) return hit;\n', "  const __c = __bgS(cache);\n  const hit = __c.get(key);\n  if (hit !== undefined) {\n    __bgH('threat', cache === (threatCache as unknown) ? 'threat' : 'remoteRunChance', __c, key, hit, work);\n    return hit;\n  }\n", 'threatModel.ts');
    t = once(t, '  cache.set(key, value);\n  return value;\n};', '  __c.set(key, value);\n  __bgM(__c, key);\n  return value;\n};', 'threatModel.ts');
    return t + HOOKS;
  });
}

/** Builds the trees under `root` and returns their directories. */
export function makeTrees(root: string, arms: Arm[]): Record<Arm, string> {
  rmSync(root, { recursive: true, force: true });
  const out = {} as Record<Arm, string>;
  for (const arm of arms) {
    const dir = join(root, arm);
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    if (arm === 'K') keyed(dir, false);
    if (arm === 'K2' || arm === 'aK2') keyed(dir, true);
    if (arm === 'R') ruleBased(dir);
    if (arm === 'aB' || arm === 'aK2') instrument(dir);
    out[arm] = dir;
  }
  return out;
}
export const treeRoot = (name: string) => resolve('.bg-trees', name);

// --- The probe -----------------------------------------------------------------------------------------------------
export class Capped extends Error {}

/** One store's crossings in one decision. Reads count every crossing read; entries count each crossed entry once. */
export interface StoreTally {
  hits: number;
  unmarked: number;
  /** crossing reads: written with the guard up and read with it down, and the other way */
  up2down: number;
  down2up: number;
  /** crossed entries worked out again (once per reader guard state); capped, errors, and reads past the limits */
  entries: number;
  capped: number;
  errors: number;
  skipped: number;
  /** crossed entries whose value worked out in the reader's context differs from the value served, and the reads of them */
  differE: number;
  differ: number;
  /** of those, entries that differ again with the guard as the writer had it (the guard's difference), and their reads */
  guardE: number;
  guard: number;
  /** the second recompute capped */
  capped2: number;
  maxDiff: number;
  maxGuardDiff: number;
  /** a difference that is not a number (a key or a field present on one side only, a string) */
  nonNumeric: number;
  /** by key name, in reads: [crossings, up2down, differ, guard] */
  names: Record<string, [number, number, number, number]>;
  /** same-guard hits recomputed for the background: [recomputed, differ, capped] */
  ctrl: [number, number, number];
}
const zero = (): StoreTally => ({ hits: 0, unmarked: 0, up2down: 0, down2up: 0, entries: 0, capped: 0, errors: 0, skipped: 0, differE: 0, differ: 0, guardE: 0, guard: 0, capped2: 0, maxDiff: 0, maxGuardDiff: 0, nonNumeric: 0, names: {}, ctrl: [0, 0, 0] });

/** The largest numeric difference between two values (NaN: they differ in something that is not a number). */
export function diff(a: unknown, b: unknown, depth = 0): number {
  if (a === b) return 0;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return 0;
    const d = Math.abs(a - b);
    return Number.isNaN(d) ? Infinity : d;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || depth > 8) return NaN;
  let worst = 0;
  const take = (d: number) => {
    if (Number.isNaN(d) || Number.isNaN(worst)) worst = NaN;
    else if (d > worst) worst = d;
  };
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) return NaN;
    for (const [k, v] of a) {
      if (!b.has(k)) return NaN;
      take(diff(v, b.get(k), depth + 1));
    }
    return worst;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set && b instanceof Set) || a.size !== b.size) return NaN;
    for (const v of a) if (!b.has(v)) return NaN;
    return 0;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return NaN;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return NaN;
  for (const k of ka) {
    if (!(k in (b as object))) return NaN;
    take(diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth + 1));
  }
  return worst;
}
const differs = (d: number) => d !== 0;

export class GuardProbe {
  /** Crossing detection on (an audit tree's decision); off, every hook passes through. */
  on = false;
  /** The asking tree's guard: up now? and run `fn` with it set. */
  guardUp: () => boolean = () => false;
  setGuard: <T>(up: boolean, fn: () => T) => T = (_up, fn) => fn();
  capMs = 10_000;
  /** per decision: crossed entries recomputed per store at most, then counted only; and a time budget for all recomputes */
  maxPerStore = 20_000;
  budgetMs = 120_000;
  ctrlPerStore = 5;
  t: Record<string, StoreTally> = {};
  private marks = new WeakMap<object, Map<unknown, boolean>>();
  private sh: Map<object, [object | undefined, object | undefined]> | null = null;
  private deadline = 0;
  private cappedNow = false;
  spent = 0;

  reset(): Record<string, StoreTally> {
    const out = this.t;
    this.t = {};
    this.marks = new WeakMap();
    this.outcomes = new WeakMap();
    this.spent = 0;
    return out;
  }
  private tally(store: string) {
    return (this.t[store] ??= zero());
  }
  private tick() {
    if (this.deadline && performance.now() > this.deadline) {
      this.cappedNow = true;
      throw new Capped('cap');
    }
  }
  /** The store to use: the real one, or inside a recompute a shadow one for the guard state now. */
  store<T extends object>(m: T): T {
    if (!this.sh) return m;
    this.tick();
    const up = this.guardUp() ? 1 : 0;
    let pair = this.sh.get(m);
    if (!pair) this.sh.set(m, (pair = [undefined, undefined]));
    return (pair[up] ??= m instanceof WeakMap ? new WeakMap() : new Map()) as T;
  }
  mark(m: object, k: unknown) {
    if (!this.on || this.sh) return;
    let mk = this.marks.get(m);
    if (!mk) this.marks.set(m, (mk = new Map()));
    mk.set(k, this.guardUp());
  }
  private recompute(fn: () => unknown): { v?: unknown; capped: boolean; error?: string } {
    const t0 = performance.now();
    this.sh = new Map();
    this.deadline = t0 + this.capMs;
    this.cappedNow = false;
    let v: unknown;
    let error: string | undefined;
    try {
      v = fn();
    } catch (e) {
      if (!(e instanceof Capped)) error = (e as Error).message;
    } finally {
      this.sh = null;
      this.deadline = 0;
      this.spent += performance.now() - t0;
    }
    return { v, capped: this.cappedNow, error };
  }
  hit(store: string, name: string, m: object, k: unknown, served: unknown, fn: () => unknown) {
    if (!this.on) return;
    if (this.sh) {
      this.tick();
      return;
    }
    const t = this.tally(store);
    t.hits++;
    const w = this.marks.get(m)?.get(k);
    if (w === undefined) {
      t.unmarked++;
      return;
    }
    const up = this.guardUp();
    const over = this.spent > this.budgetMs;
    if (w === up) {
      if (t.ctrl[0] + t.ctrl[2] >= this.ctrlPerStore || over) return;
      const r = this.recompute(fn);
      if (r.capped || r.error) t.ctrl[2]++;
      else {
        t.ctrl[0]++;
        if (differs(diff(r.v, served))) t.ctrl[1]++;
      }
      return;
    }
    if (w) t.up2down++;
    else t.down2up++;
    const nm = /^[A-Za-z]+/.exec(name)?.[0] ?? name;
    const row = (t.names[nm] ??= [0, 0, 0, 0]);
    row[0]++;
    if (w) row[1]++;
    // Each crossed entry is worked out once per reader guard state; its later crossing reads take that outcome
    let seen = this.outcomes.get(m);
    if (!seen) this.outcomes.set(m, (seen = new Map()));
    const ek = `${up ? 1 : 0}|${String(k)}`;
    let out = seen.get(ek);
    if (out === undefined) {
      if (t.entries + t.capped + t.errors >= this.maxPerStore || over) {
        t.skipped++;
        return;
      }
      out = this.work(t, w, served, fn);
      seen.set(ek, out);
    }
    if (out === 'differ' || out === 'guard') {
      t.differ++;
      row[2]++;
    }
    if (out === 'guard') {
      t.guard++;
      row[3]++;
    }
  }
  private outcomes = new WeakMap<object, Map<string, Outcome>>();
  /** One crossed entry: worked out in the reader's context, and if it differs, with the guard as the writer had it. */
  private work(t: StoreTally, w: boolean, served: unknown, fn: () => unknown): Outcome {
    const reader = this.recompute(fn);
    if (reader.error) {
      t.errors++;
      return 'error';
    }
    if (reader.capped) {
      t.capped++;
      return 'capped';
    }
    t.entries++;
    const d = diff(reader.v, served);
    if (!differs(d)) return 'same';
    t.differE++;
    if (Number.isNaN(d)) t.nonNumeric++;
    else t.maxDiff = Math.max(t.maxDiff, d);
    const writer = this.recompute(() => this.setGuard(w, fn));
    if (writer.capped || writer.error) {
      t.capped2++;
      return 'differ';
    }
    const g = diff(writer.v, reader.v);
    if (!differs(g)) return 'differ';
    t.guardE++;
    if (!Number.isNaN(g)) t.maxGuardDiff = Math.max(t.maxGuardDiff, g);
    return 'guard';
  }
}
type Outcome = 'same' | 'differ' | 'guard' | 'capped' | 'error';

export function installProbe(p: GuardProbe): GuardProbe {
  (globalThis as unknown as { __bg: GuardProbe }).__bg = p;
  return p;
}
