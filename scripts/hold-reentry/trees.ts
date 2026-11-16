/**
 * ai-hold-reentry (brief rev 2): the measurement trees and their instrumentation. Each tree is a copy of this tree's
 * src/ with text patches (as the breaker-price-depth fire count did, ai-breaker-price-depth): every patch must match exactly once, so a
 * tree that drifted from what the patch expects throws instead of measuring something else. Nothing here is in src/.
 *
 *   beta    the guard and the loop reorder put back as on beta (commit 1 and commit 2 undone);
 *   c1      commit 1 only (the guard; the hold count's mask loop as on beta);
 *   c2      this tree (commit 1 and commit 2).
 *
 * Every tree is instrumented the same way, through globalThis.__hr (a Probe):
 *   - holdRunnerTurn and holdThisRun entries and exits (the depth taken at holdRunnerTurn's entry, so every route into it
 *     is seen, F1/F3), the time spent at hold-count depth 2 or more, and the time in rez windows (holdThisRun);
 *   - the route that opened a nested hold count (sampled call stacks between it and the hold count it sits in);
 *   - guarded reads (c1, c2): a countRezBudget call with the flag up, on the Corp's side, past the cheap exit;
 *   - rez sets priced: runBypasses calls inside the hold count's mask loop.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type Arm = 'beta' | 'c1' | 'c2' | 'asis';

/** Commit 1: the rez budget's corp read, with the guard and without (beta). */
const READ_C1 = "if (actingSide() === 'corp' && !pricing().countingHold) {";
const READ_BETA = "if (actingSide() === 'corp') {";
/** Commit 1: the hold count opened under the flag; beta's holdRunnerTurn is the count itself. */
const OPEN_C1 = 'function holdRunnerTurn(state: GameState, server: string, corpCredits: number): Hold {\n  if (pricing().countingHold) return countRunnerTurn(state, server, corpCredits);\n  return withPricing({ countingHold: true }, () => countRunnerTurn(state, server, corpCredits));\n}\n\nfunction countRunnerTurn(';
const OPEN_BETA = 'function holdRunnerTurn(';
/** Commit 2: the mask loop's head, rez worked out before the bypasses are priced. */
export const LOOP_C2 = `  for (let mask = 0; mask < 1 << n; mask++) {
    // A set with a rezzed ice's bit, or one the Corp can't pay for, is never the answer and never the most asked: its
    // bits cleared give the same board, a need at least as large and a rez it can pay, and come first. Skipped before
    // its bypasses are priced (each set once)
    let rez = 0;
    for (let i = 0; i < n && rez <= corpCredits; i++) {
      if (!(mask & (1 << i))) continue;
      rez = ice[i].isRezzed ? Infinity : rez + (rezOf[i] ??= rezCostOf(view, ice[i]));
    }
    if (rez > corpCredits || rez === Infinity) continue;
    let need = 0;
    // The ice the Runner's installed bypasses pass with this set rezzed (runs.ts runBypasses: rig cards, their counters
    // and the threat level, all public; 6.5.8a: a bypassed ice's subroutines never resolve), and what those bypasses
    // cost it in credits' worth (spec jeff-games-48-50 Part A, folded 2026-11-13: g3 +0.3 ± 0.2, run 43382962736)
    const bypassed = serverId ? runBypasses(rezzedSet(view, serverId, ice, mask, n), serverId) : undefined;
    if (bypassed) need += bypassed.price;
    for (let i = 0; i < n; i++) {
      const c = ice[i];
      if (!c.isRezzed && !(mask & (1 << i))) continue;
      if (bypassed?.ids.has(c.instanceId)) continue;
      need += (needOf[i] ??= iceNeed(view, c));
    }
    if (need > mostNeed) mostNeed = need;`;
export const LOOP_BETA = `  for (let mask = 0; mask < 1 << n; mask++) {
    let rez = 0;
    let need = 0;
    // The ice the Runner's installed bypasses pass with this set rezzed (runs.ts runBypasses: rig cards, their counters
    // and the threat level, all public; 6.5.8a: a bypassed ice's subroutines never resolve), and what those bypasses
    // cost it in credits' worth (spec jeff-games-48-50 Part A, folded 2026-11-13: g3 +0.3 ± 0.2, run 43382962736)
    const bypassed = serverId ? runBypasses(rezzedSet(view, serverId, ice, mask, n), serverId) : undefined;
    if (bypassed) need += bypassed.price;
    for (let i = 0; i < n; i++) {
      const c = ice[i];
      const on = !!(mask & (1 << i));
      if (c.isRezzed && on) {
        rez = Infinity; // each set once: a rezzed ice's bit stays clear
        break;
      }
      if (!c.isRezzed && !on) continue;
      if (!c.isRezzed) rez += (rezOf[i] ??= rezCostOf(view, c));
      if (bypassed?.ids.has(c.instanceId)) continue;
      need += (needOf[i] ??= iceNeed(view, c));
    }
    if (rez > corpCredits) continue;
    if (need > mostNeed) mostNeed = need;`;

const once = (text: string, from: string, to: string, file: string): string => {
  if (text.split(from).length !== 2) throw new Error(`${file}: patch does not match once: ${from.slice(0, 80)}`);
  return text.replace(from, () => to);
};

function edit(dir: string, file: string, f: (text: string) => string) {
  const path = join(dir, 'src', file);
  writeFileSync(path, f(readFileSync(path, 'utf8')));
}

/** The instrumentation, the same in every tree (applied after the arm's own patches). */
function instrument(dir: string) {
  edit(dir, 'ai/corp/hold.ts', t => {
    // holdRunnerTurn's outer name (beta: the count itself; c1/c2: the guard's wrapper) is wrapped by the probe
    t = once(t, 'function holdRunnerTurn(state: GameState, server: string, corpCredits: number): Hold {', 'function holdRunnerTurnP(state: GameState, server: string, corpCredits: number): Hold {', 'hold.ts');
    t = once(t, 'function holdThisRun(state: GameState, server: string, opts: HoldOptions): Hold {', 'function holdThisRunP(state: GameState, server: string, opts: HoldOptions): Hold {', 'hold.ts');
    t = once(t, '    const bypassed = serverId ? runBypasses(', '    if ((globalThis as any).__hr) (globalThis as any).__hr.sets++;\n    const bypassed = serverId ? runBypasses(', 'hold.ts');
    return `${t}
// hold-reentry probe (scripts/hold-reentry/trees.ts)
function holdRunnerTurn(state: GameState, server: string, corpCredits: number): Hold {
  const g = (globalThis as any).__hr;
  if (!g) return holdRunnerTurnP(state, server, corpCredits);
  g.enter('turn');
  try { return holdRunnerTurnP(state, server, corpCredits); } finally { g.exit('turn'); }
}
function holdThisRun(state: GameState, server: string, opts: HoldOptions): Hold {
  const g = (globalThis as any).__hr;
  if (!g) return holdThisRunP(state, server, opts);
  g.enter('run');
  try { return holdThisRunP(state, server, opts); } finally { g.exit('run'); }
}
`;
  });
  edit(dir, 'ai/iceValues.ts', t => {
    const read = t.includes(READ_C1) ? READ_C1 : READ_BETA;
    return once(t, `  ${read}`, `  if ((globalThis as any).__hr && actingSide() === 'corp') (globalThis as any).__hr.read((pricing() as any).countingHold === true);\n  ${read}`, 'iceValues.ts');
  });
}

/** Builds the three trees under `root` and returns their directories. */
export function makeTrees(root: string, arms: Arm[] = ['beta', 'c1', 'c2']): Record<Arm, string> {
  rmSync(root, { recursive: true, force: true });
  const out = {} as Record<Arm, string>;
  for (const arm of arms) {
    const dir = join(root, arm);
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    if (arm !== 'c2' && arm !== 'asis') edit(dir, 'ai/corp/hold.ts', t => once(t, LOOP_C2, LOOP_BETA, 'hold.ts'));
    if (arm === 'beta') {
      edit(dir, 'ai/corp/hold.ts', t => once(t, OPEN_C1, OPEN_BETA, 'hold.ts'));
      edit(dir, 'ai/iceValues.ts', t => once(t, READ_C1, READ_BETA, 'iceValues.ts'));
    }
    instrument(dir);
    out[arm] = dir;
  }
  return out;
}

/** What one decision did, as the probe saw it. */
export interface Tally {
  /** Hold counts (holdRunnerTurn) started, and the deepest nesting. */
  turns: number;
  maxDepth: number;
  /** Hold counts started at depth 2, 3, 4 or more. */
  d2: number;
  d3: number;
  d4: number;
  /** ms spent at hold-count depth 2 or more (the outermost nested count's wall time). */
  msDeep: number;
  /** Rez windows (holdThisRun) started, hold counts started inside one, and ms in rez windows (outermost). */
  runs: number;
  turnInRun: number;
  msRun: number;
  /** Rez sets priced (runBypasses calls in the hold count's mask loop). */
  sets: number;
  /** The rez budget's corp reads past the cheap exit, with the flag up (guarded) and down. */
  guarded: number;
  reads: number;
  /** Routes that opened a nested hold count (sampled): route -> count. */
  routes: Record<string, number>;
}

const zero = (): Tally => ({ turns: 0, maxDepth: 0, d2: 0, d3: 0, d4: 0, msDeep: 0, runs: 0, turnInRun: 0, msRun: 0, sets: 0, guarded: 0, reads: 0, routes: {} });

/**
 * The route from a nested hold count back to the one it sits in: the AI frames between them, read from the call stack,
 * shortened to the frames that name the edge (the rez budget's read, the keep port, rez money, the card worth).
 */
function route(): string {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 400;
  const stack = new Error().stack ?? '';
  Error.stackTraceLimit = limit;
  const frames = stack.split('\n').slice(1).map(l => {
    const m = /at (?:Object\.)?([\w$.<>]+) \(([^)]*)\)/.exec(l);
    return m ? { fn: m[1], file: m[2].replace(/^.*\/src\//, '').replace(/:\d+$/, '') } : null;
  }).filter((f): f is { fn: string; file: string } => !!f);
  // the probe's holdRunnerTurn frame, and the next holdRunnerTurn frame below it: the hold count this one sits in
  const self = frames.findIndex(f => f.fn === 'holdRunnerTurn');
  const outer = frames.findIndex((f, i) => i > self && f.fn === 'holdRunnerTurn');
  const between = frames.slice(self + 1, outer < 0 ? frames.length : outer);
  const names: string[] = [];
  for (const f of between) {
    const n = f.file.startsWith('ai/cards/') ? `${f.fn}@${f.file.replace(/\.ts.*$/, '')}` : f.fn;
    if (/^(holdRunnerTurnP?|holdThisRunP?|countRunnerTurn|withPricing|memo|guardLoop|logValue)$|^(Map|Array)\.|^<anonymous>$/.test(f.fn)) continue;
    if (names[names.length - 1] !== n) names.push(n);
  }
  // innermost first: the call that opened this hold count, out to the price inside the outer one
  const key = ['countRezBudget', 'holdingRezIds', 'keep', 'rezMoney', 'evaluate', 'runSuccess', 'ownIce', 'iceWorth', 'runBypasses', 'iceNeed', 'tagClock', 'tagLossPerTurn'];
  const short = names.filter(n => key.includes(n) || n.includes('@') || /^(holding|holdingRez|serverHold|counterWorth|redTeamCredit)$/.test(n));
  return (outer < 0 ? 'NO OUTER ' : '') + short.slice(0, 14).join(' < ');
}

export class Probe {
  t: Tally = zero();
  private stack: ('turn' | 'run')[] = [];
  private turnDepth = 0;
  private tDeep = 0;
  private tRun = 0;
  private nested = 0;
  /** Sample the route of the first `first` nested counts of a decision, then one in `every`. */
  constructor(private first = 30, private every = 200, private onTick?: (t: Tally) => void, private tickMs = 0) {}
  private lastTick = 0;
  reset(): Tally {
    const out = this.t;
    this.t = zero();
    this.stack = [];
    this.turnDepth = 0;
    this.nested = 0;
    return out;
  }
  enter(kind: 'turn' | 'run') {
    const now = performance.now();
    if (kind === 'run') {
      if (!this.stack.includes('run')) this.tRun = now;
      this.t.runs++;
    } else {
      this.turnDepth++;
      this.t.turns++;
      if (this.stack.includes('run')) this.t.turnInRun++;
      if (this.turnDepth > this.t.maxDepth) this.t.maxDepth = this.turnDepth;
      if (this.turnDepth === 2) {
        this.t.d2++;
        this.tDeep = now;
      }
      if (this.turnDepth === 3) this.t.d3++;
      if (this.turnDepth >= 4) this.t.d4++;
      if (this.turnDepth >= 2) {
        const k = this.nested++;
        if (k < this.first || k % this.every === 0) {
          const r = route();
          this.t.routes[r] = (this.t.routes[r] ?? 0) + 1;
        }
      }
    }
    this.stack.push(kind);
    if (this.onTick && now - this.lastTick > this.tickMs) {
      this.lastTick = now;
      this.onTick(this.t);
    }
  }
  exit(kind: 'turn' | 'run') {
    const now = performance.now();
    this.stack.pop();
    if (kind === 'run') {
      if (!this.stack.includes('run')) this.t.msRun += now - this.tRun;
    } else {
      if (this.turnDepth === 2) this.t.msDeep += now - this.tDeep;
      this.turnDepth--;
    }
  }
  sets = 0;
  read(guarded: boolean) {
    if (guarded) this.t.guarded++;
    else this.t.reads++;
  }
}

/** Installs a probe (one per process: every tree writes to it); sets counts are moved into the tally on reset. */
export function installProbe(p: Probe): Probe {
  (globalThis as unknown as { __hr: Probe }).__hr = p;
  const reset = p.reset.bind(p);
  p.reset = () => {
    p.t.sets = p.sets;
    p.sets = 0;
    return reset();
  };
  return p;
}

export const treeRoot = (name: string) => resolve('.hr-trees', name);
