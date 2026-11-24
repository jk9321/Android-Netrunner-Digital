/**
 * The L9 count (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/l9-residual.md rev 1): what explains the
 * feasibility readings A-log's L9 left unexplained. Counts only: no src change, nothing fixed, nothing decided.
 *
 * 1. L9 again on beta's src tree (fd7831eb), as facts-log.ts takes it: every (board, server) at a Runner turn start and
 *    the run's server at a run start, on the board with every installed Corp card's identity public; the Runner's
 *    feasibility (runScore's price part, runnerCanGetIn) against the walk's (serverHold 'restOfTurn', the walk given the
 *    grip money). A difference is explained by a policy only if removing that policy alone makes the two agree
 *    (unrezzedFlat, rezChoice, money); none: unexplained. Also the three removed together ("policies together").
 * 2. For every unexplained reading, each fact difference set equal alone (an arm), both ways where both make sense,
 *    in two frames: "alone" (as L9 removed one policy) and "set aside" (the three policies removed together first, as
 *    specs/r-b.md's "Decided here" 2 words the test). Then the pairs of the arms present on that board, then all present
 *    together ("combined", one per direction). The arms are overrides in the eval tree (facts-trees.ts L9_PATCHES).
 *
 * Sources (pool, kept apart): batch = the 221 deals of g1 45444888753; nrdb = the 110 deals of NRDB=1 g1 45458221138
 * (winner/cr/sc checked against facts-deals-<run>.json: 'g' lines); human = tests/fixtures/human-games; issues = the
 * saved games of issues #58 and #59. Played by the `source` tree (never asked); read on the `eval` tree on clones.
 *
 * HIDDEN-READ: the measuring script reads the Corp's unrezzed ice (the public board, the policies' boards). No agent
 * reads them; every place is marked HIDDEN-READ.
 *
 *   SHARD=0/32 POOL=batch npx vite-node scripts/runner-rework/facts-l9.ts
 *   ARGS="POOL=batch DEALS=1001,1011" npx vite-node scripts/runner-rework/facts-l9.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CardInstance, GameAction, GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Tree, loadTree, makeTrees } from './facts-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const POOLS = (process.env.POOL ?? 'batch,nrdb,human,issues').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const HUMAN = (process.env.HUMAN ?? '').split(',').filter(Boolean);
/** No arms: the recount only. */
const RECOUNT_ONLY = process.env.RECOUNT === '1';
const BATCH_RUN = '45444888753';
const NRDB_RUN = '45458221138';
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/facts-l9', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r3 = (x: number | null | undefined) => (x === null || x === undefined ? null : Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x > 0 ? 'Inf' : '-Inf');
const key = (a: unknown) => JSON.stringify(a ?? null);

let T: Tree;
let ARM: Record<string, any>;
let EV: any; // effectValues (damageWorth)
const timing: Record<string, number> = {};
const timed = <X>(k: string, f: () => X): X => {
  const t0 = performance.now();
  try {
    return f();
  } finally {
    timing[k] = (timing[k] ?? 0) + performance.now() - t0;
  }
};
const counts = { asks: 0, walks: 0 };

// ------------------------------------------------------------------------------------------------ helpers
const rigOf = (s: GameState) => [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources];
const def = (c: CardInstance | string) => T.core.getCardDefinition(typeof c === 'string' ? c : c.cardCode);
const asRunner = <X>(s: GameState, f: () => X): X =>
  T.pricing.asSide('runner', () => {
    T.handValues.decisionContext(s, 'runner');
    return f();
  });
const asCorp = <X>(s: GameState, f: () => X): X =>
  T.pricing.asSide('corp', () => {
    T.handValues.decisionContext(s, 'corp');
    return f();
  });
const safe = <X>(f: () => X, dflt: X): X => {
  try {
    return f();
  } catch {
    return dflt;
  }
};
/** HIDDEN-READ: every installed Corp card's identity public (L9's board). */
function publicBoard(s: GameState): GameState {
  const b = structuredClone(s);
  for (const sv of Object.values(b.corp.servers)) for (const c of [...sv.ice, ...sv.root]) c.runnerKnows = true;
  return b;
}
/** HIDDEN-READ: a clone with these unrezzed ice rezzed. */
function withRezzed(s: GameState, ids: Set<string>): GameState {
  const b = structuredClone(s);
  for (const sv of Object.values(b.corp.servers)) for (const c of sv.ice) if (ids.has(c.instanceId)) c.isRezzed = true;
  return b;
}
/** The grip's "Gain N credits" events over the clicks but the run's (facts-log.ts gripMoney, unchanged). */
function gripMoney(s: GameState, clicksForMoney: number): number {
  const nets = s.runner.grip
    .map(c => {
      const d = def(c);
      const m = d.type_code === 'event' ? /\bgain (\d+) credits\b/i.exec(d.stripped_text ?? '') : null;
      return m ? { cost: d.cost ?? 0, net: Number(m[1]) - (d.cost ?? 0) } : null;
    })
    .filter((x): x is { cost: number; net: number } => !!x && x.net > 0)
    .sort((a, b) => b.net - a.net);
  let credits = s.runner.credits;
  let gained = 0;
  let used = 0;
  for (const n of nets) {
    if (used >= clicksForMoney) break;
    if (n.cost > credits) continue;
    credits += n.net;
    gained += n.net;
    used++;
  }
  return gained;
}

// ------------------------------------------------------------------------------------------------ the two readings
interface RunnerOpts {
  budget?: number;
  /** Ice the Runner's reading skips (the walk's bypasses, L8 R; a run's bypass ids from another board). */
  bypass?: Set<string>;
  /**
   * L13 R with the walk's money (the policies set aside): what k earning clicks make (runnerEarnings, the walk's own);
   * the clicks the prices spend on bioroids do not also earn, as in the walk (walkNeed).
   */
  earn?: number[];
}
/** The Runner's feasibility (facts-log.ts runnerCanGetIn, with the two overrides). */
function runnerCanGetIn(s: GameState, id: string, o: RunnerOpts = {}): { can: boolean; why: string; known: number; budget: number } {
  counts.asks++;
  const server = s.corp.servers[id];
  const bypassed = o.bypass ?? (T.runs.runBypasses(s, id) as { ids: Set<string> }).ids;
  const prices = T.runs.__runPrices(
    s,
    server.ice.filter((ice: CardInstance) => !bypassed.has(ice.instanceId))
  ) as Map<string, any> | null;
  let budget = o.budget ?? (T.runs.runBudget(s) as number);
  if (o.earn && ARM.spent) {
    const k = Math.max(0, s.runner.clicks - 1);
    budget -= o.earn[k] - o.earn[Math.max(0, k - ARM.spent)];
  }
  delete ARM.spent;
  if (!prices) return { can: false, why: 'flatline', known: Infinity, budget };
  // A run with no click (R side of the arm): the Runner's reading needs the run's click
  if (ARM.needClick && !s.activeRun && s.runner.clicks < 1) return { can: false, why: 'clicks', known: Infinity, budget };
  let known = 0;
  for (const ice of server.ice) {
    if (bypassed.has(ice.instanceId)) continue;
    // Partial break R: the credits to break only the subroutines that stop the run (iceCreditNeed, the Runner's own reader)
    if (ARM.partial && ice.isRezzed) {
      const need = T.runs.iceCreditNeed(s, ice) as number;
      if (need === Infinity) return { can: false, why: 'block', known: Infinity, budget };
      known += need;
      continue;
    }
    const p = prices.get(ice.instanceId) ?? T.runs.icePrice(s, ice);
    if (p.credits + p.value === Infinity) return { can: false, why: 'block', known: Infinity, budget };
    if (ice.isRezzed) known += p.credits;
  }
  if (known > budget) return { can: false, why: 'credits', known, budget };
  const approach = T.runs.approachCost(s, id, s.runner.clicks - 1 - T.runs.bioroidClicks(s, server.ice), budget - known);
  if (!approach) return { can: false, why: 'approach', known, budget };
  return { can: true, why: 'in', known, budget };
}
/** The walk (serverHold 'restOfTurn', the grip money given), on a fresh clone so no question or memo is reused. */
function walkHolds(pub: GameState, id: string, grip: number): { holds: boolean; set: string[]; need: number; budget: number } {
  counts.walks++;
  const b = structuredClone(pub);
  T.clear();
  T.hold.CHECK.runnerExtra = grip;
  try {
    const h = asCorp(b, () => T.hold.serverHold(b, id, { when: 'restOfTurn', corpCredits: b.corp.credits }));
    return { holds: h.holds, set: h.holds ? (h.rez ?? []) : (h.rezMost ?? []), need: h.need, budget: h.budget };
  } finally {
    T.hold.CHECK.runnerExtra = 0;
  }
}
const runOnlyOf = (pub: GameState) => {
  T.clear();
  return (asRunner(pub, () => T.runs.runBudget(pub)) as number) - pub.runner.credits;
};

// ------------------------------------------------------------------------------------------------ fact readers for the arms
type Cls = 'worthless' | 'borrow' | 'lethal' | 'orEnd' | 'ends' | 'none';
let ruleClass: Map<unknown, Cls>;
function initRules() {
  ruleClass = new Map();
  const rules = T.runs.__L9_SUB_RULES as [RegExp, unknown, unknown][];
  // `never` is the blocks test most rules share (a subroutine whose price is never BLOCK)
  const uses = new Map<unknown, number>();
  for (const r of rules) uses.set(r[2], (uses.get(r[2]) ?? 0) + 1);
  const never = [...uses.entries()].sort((a, b) => b[1] - a[1])[0][0];
  for (const [re, price, blocks] of rules) {
    const src = re.source;
    let c: Cls;
    if (/cannot steal/.test(src)) c = 'worthless';
    else if (/resolve 1 subroutine/.test(src)) c = 'borrow';
    else if (/suffers|at least 2 tags|do x net damage|core damage|\(net\|meat\) damage/.test(src)) c = 'lethal';
    else if (src === 'or end the run') c = 'orEnd';
    else if (blocks === never) c = 'none';
    else c = 'ends';
    ruleClass.set(price, c);
  }
}
/** The Runner's first applying rule for a label: its class, whether it blocks on this board, the rules after it. */
function firstRule(state: GameState, label: string): { cls: Cls; blocks: boolean; rest: [any, any, any][] } | null {
  const rules = T.runs.__rulesFor(label) as [any, any, any][];
  for (let i = 0; i < rules.length; i++) {
    const [price, blocks, m] = rules[i];
    const b = blocks(state, m);
    if (b === T.runs.__NEXT) continue;
    return { cls: ruleClass.get(price) ?? 'ends', blocks: !!b, rest: rules.slice(i + 1) };
  }
  return null;
}
/** The price of a label from the rules after the first, those not of a class (a NEXT passes; none: undefined). */
function restPrice(state: GameState, rest: [any, any, any][], not: Cls[]): number | undefined {
  for (const [price, , m] of rest) {
    if (not.includes(ruleClass.get(price) ?? 'ends')) continue;
    const c = price(state, m);
    if (c !== T.runs.__NEXT) return c;
  }
  return undefined;
}
const threat = (s: GameState) => Math.max(s.corp.score, s.runner.score);
function condNow(s: GameState, c: any): boolean {
  switch (c.kind) {
    case 'runnerCreditsAtMost':
      return s.runner.credits <= c.n;
    case 'threatAtLeast':
      return threat(s) >= c.n;
    case 'corpCreditsMoreThanRunner':
      return s.corp.credits > s.runner.credits;
    case 'hqMoreThanGrip':
      return s.corp.hq.length > s.runner.grip.length;
    case 'runnerTagsAtLeast':
      return s.runner.tags >= c.n;
    default:
      return false; // trashedOddCost: the walk leaves it out
  }
}
/** The walk's fact "this subroutine ends the run" read on this board (its own conditions, its nested costs, ruling 6). */
function factsEndsNow(s: GameState, f: any): boolean {
  if (f.when?.kind === 'runnerTagsAtLeast' && s.runner.tags < f.when.n) return false;
  if (f.orEndRun) return true;
  let ends = f.does.some((e: any) => e.kind === 'endRun' && (!e.if || condNow(s, e.if))) || f.does.some((e: any) => e.kind === 'corpMayTrashHqToEndRun' && s.corp.hq.length > 0);
  if (ends && f.unless) {
    if (f.unless.credits !== undefined && s.runner.credits >= f.unless.credits) ends = false;
    if (f.unless.netDamage !== undefined && f.unless.netDamage <= s.runner.grip.length) ends = false;
    if (f.unless.trashInstalled && rigOf(s).length > 0) ends = false;
  }
  return ends;
}
/** The walk's damage for a subroutine (its facts, its `when` read at these tags; a nested net damage counts as the tank's). */
function factsDamage(f: any, tags: number): number {
  if (f.when?.kind === 'runnerTagsAtLeast' && tags < f.when.n) return 0;
  const d = f.does.filter((e: any) => e.kind === 'damage').reduce((n: number, e: any) => n + (e.n === 'runnerTags' ? tags : e.n), 0);
  return d + (f.unless?.netDamage ?? 0);
}
const isEnd = (e: any) => e.kind === 'endRun' || e.kind === 'corpMayTrashHqToEndRun';

// ------------------------------------------------------------------------------------------------ the arms
interface Ctx {
  s: GameState;
  pub: GameState;
  id: string;
  grip: number;
  runOnly: number;
  base: ReturnType<typeof walkHolds>;
  runnerByp: { ids: Set<string>; price: number };
  walkByp: Set<string>;
  labels: { ice: CardInstance; label: string; f: any }[];
}
interface Arm {
  /** The fact (pairs are taken between facts). */
  fact: string;
  /** R: the Runner takes the walk's fact; W: the walk takes the Runner's. */
  dir: 'R' | 'W';
  present: (c: Ctx) => boolean;
  /** Sets the override keys (cleared after). */
  set?: (c: Ctx) => void;
  /** R arms: extra credits for the Runner's budget (the walk's money the Runner does not read). */
  budget?: (c: Ctx, policies: boolean) => number;
  /** R arm: the Runner skips the walk's bypasses. */
  bypass?: (c: Ctx, walkSetByp: Set<string>) => Set<string>;
}
const runBeginGain = (s: GameState, coal: boolean): number =>
  rigOf(s).reduce((n, c) => {
    const f = T.cards[c.cardCode]?.holdFacts;
    if (!f) return n;
    let g = 0;
    if (f.runBeginCredits) {
      const held = T.effects.counters(c, 'credit') + f.runBeginCredits.place;
      if (held >= f.runBeginCredits.takeAllAt) g += held;
    }
    if (f.firstRunTrashForCost && s.runsThisTurn.length === 0) g += rigOf(s).reduce((m, r) => (r.instanceId === c.instanceId ? m : Math.max(m, def(r).cost ?? 0)), 0);
    if (coal && f.counterCredits) g += T.hold.counterCredits(c);
    return n + g;
  }, 0);

const ARMS: Record<string, Arm> = {
  // L1: "ends the run" (BLOCK's first meaning), the Runner's price rule against the walk's facts, per subroutine
  L1R: {
    fact: 'L1',
    dir: 'R',
    present: c => c.labels.some(l => l1Differs(c.pub, l)),
    set: () => {
      ARM.l1 = true;
    },
  },
  L1W: {
    fact: 'L1',
    dir: 'W',
    present: c => c.labels.some(l => l1Differs(c.pub, l)),
    set: () => {
      ARM.l1w = true;
    },
  },
  // BLOCK as lethal damage: the grip the lethal tests read (the walk draws before a run; the Runner reads the grip now)
  lethalR: {
    fact: 'lethal',
    dir: 'R',
    present: c => lethalPresent(c),
    set: () => {
      ARM.grip = (st: GameState) => st.runner.grip.length + (st.activeRun ? 0 : Math.min(st.runner.stack.length, Math.max(0, st.runner.clicks - 1)));
    },
  },
  lethalW: {
    fact: 'lethal',
    dir: 'W',
    present: c => lethalPresent(c),
    set: () => {
      ARM.noDraw = true;
    },
  },
  // L2: the damage a subroutine does
  L2R: {
    fact: 'L2',
    dir: 'R',
    present: c => c.labels.some(l => factsDamage(l.f, c.pub.runner.tags) !== T.runs.__subroutineDamage(l.label, c.pub.runner.tags)),
    set: () => {
      ARM.l2 = true;
      ARM.damage = (label: string, tags: number) => factsDamage(T.runs.subroutineFacts(label), tags);
    },
  },
  L2W: {
    fact: 'L2',
    dir: 'W',
    present: c => c.labels.some(l => factsDamage(l.f, c.pub.runner.tags) !== T.runs.__subroutineDamage(l.label, c.pub.runner.tags)),
    set: () => {
      ARM.l2w = true;
    },
  },
  // L4: "X or end the run"
  L4R: {
    fact: 'L4',
    dir: 'R',
    present: c => c.labels.some(l => l.f.orEndRun),
    set: () => {
      ARM.l4 = true;
    },
  },
  L4W: {
    fact: 'L4',
    dir: 'W',
    present: c => c.labels.some(l => l.f.orEndRun),
    set: () => {
      ARM.l4w = true;
    },
  },
  // L7: run-begin money (Side Hustle, Knickknack) and hosted counters that pay (Coalescence)
  L7R: {
    fact: 'L7',
    dir: 'R',
    present: c => rigOf(c.pub).some(x => {
      const f = T.cards[x.cardCode]?.holdFacts;
      return !!(f?.runBeginCredits || f?.firstRunTrashForCost || f?.counterCredits);
    }),
    // with the policies set aside the walk's budget already holds the counters (runnerBudget)
    budget: (c, policies) => runBeginGain(c.pub, !policies),
  },
  L7W: {
    fact: 'L7',
    dir: 'W',
    present: c => rigOf(c.pub).some(x => {
      const f = T.cards[x.cardCode]?.holdFacts;
      return !!(f?.runBeginCredits || f?.firstRunTrashForCost || f?.counterCredits);
    }),
    set: () => {
      ARM.noRunBegin = true;
    },
  },
  // L8: a rig bypass (the walk reads it on its rez set's board)
  L8R: {
    fact: 'L8',
    dir: 'R',
    present: c => c.runnerByp.ids.size > 0 || c.walkByp.size > 0,
    bypass: (_c, w) => w,
  },
  L8W: {
    fact: 'L8',
    dir: 'W',
    present: c => c.runnerByp.ids.size > 0 || c.walkByp.size > 0,
    set: c => {
      ARM.bypass = (server: string) => (server === c.id ? c.runnerByp : { ids: new Set(), price: 0 });
    },
  },
  // L12: Mycoweb's lenders (the walk lends from ice it rezzes; the Runner reads the ice rezzed now)
  L12W: {
    fact: 'L12',
    dir: 'W',
    present: c => c.labels.some(l => l.f.does.some((e: any) => e.kind === 'borrow')),
    set: () => {
      ARM.lendNow = true;
    },
  },
  // L13: bioroid clicks counted once along the run (the walk shares them)
  L13R: {
    fact: 'L13',
    dir: 'R',
    present: c => c.pub.corp.servers[c.id].ice.some(i => T.ice.isBioroid(i)),
    set: () => {
      ARM.seqPrices = seqPrices;
    },
  },
  // Approach toll: Manegarm (the walk has no toll)
  tollR: {
    fact: 'toll',
    dir: 'R',
    present: c => c.pub.corp.servers[c.id].root.some(x => x.isRezzed && x.cardCode === T.runs.MANEGARM),
    set: () => {
      ARM.noToll = true;
    },
  },
  // Added (not in the brief): the failed run. The walk lets a run end and runs again with what it left; the Runner's
  // feasibility is one run
  retryW: {
    fact: 'retry',
    dir: 'W',
    present: () => true,
    set: () => {
      ARM.noRetry = true;
    },
  },
  // Added: credits and clicks a subroutine or toll takes. The walk counts them against the pool and the clicks; the
  // Runner's feasibility prices them as worth (value), not as credits it must hold
  lossW: {
    fact: 'loss',
    dir: 'W',
    present: c => c.labels.some(l => l.f.does.some((e: any) => e.kind === 'runnerLosesCredits' || e.kind === 'runnerLosesClicks')) || c.pub.corp.servers[c.id].ice.some(i => !!T.cards[i.cardCode]?.holdFacts?.encounter?.loses),
    set: () => {
      ARM.noLoss = true;
    },
  },
  // Added: a partial break. The walk breaks the subroutines it must and lets the rest resolve; the Runner's run price
  // tanks every subroutine or breaks every one (plainIcePrice)
  partialR: {
    fact: 'partial',
    dir: 'R',
    present: c => c.pub.corp.servers[c.id].ice.length > 0,
    set: () => {
      ARM.partial = true;
    },
  },
  partialW: {
    fact: 'partial',
    dir: 'W',
    present: c => c.pub.corp.servers[c.id].ice.length > 0,
    set: () => {
      ARM.allOrNone = true;
    },
  },
  // Added: a run begun with no click (a card began it). The walk's rest of the turn has no click for a run; the
  // Runner's reading does not read its clicks
  clickR: {
    fact: 'click',
    dir: 'R',
    present: c => c.s.runner.clicks < 1,
    set: () => {
      ARM.needClick = true;
    },
  },
  clickW: {
    fact: 'click',
    dir: 'W',
    present: c => c.s.runner.clicks < 1,
    set: () => {
      ARM.runClick = true;
    },
  },
  // Added: the bad publicity fund (10.6.3): the walk fills it at each run; the Runner's budget outside a run reads none
  bpR: {
    fact: 'bp',
    dir: 'R',
    present: c => c.pub.corp.badPublicity > 0,
    budget: c => c.pub.corp.badPublicity,
  },
};
const ARM_NAMES = (process.env.ARMS ?? Object.keys(ARMS).join(',')).split(',').filter(a => ARMS[a]);

function l1Differs(s: GameState, l: { label: string; f: any }): boolean {
  const r = firstRule(s, l.label);
  if (!r || r.cls === 'worthless' || r.cls === 'borrow' || r.cls === 'orEnd' || r.cls === 'lethal') return false;
  return (r.cls === 'ends' && r.blocks) !== factsEndsNow(s, l.f);
}
function lethalPresent(c: Ctx): boolean {
  const s = c.pub;
  const dmg = c.labels.some(l => factsDamage(l.f, s.runner.tags) > 0 || firstRule(s, l.label)?.cls === 'lethal');
  return dmg && s.runner.stack.length > 0 && s.runner.clicks > 1;
}
/** L13 R: the prices outermost first, the bioroid clicks a price spends taken from the next ice's (the walk's sharing). */
function seqPrices(state: GameState, ices: CardInstance[]): Map<string, any> {
  const m = new Map<string, any>();
  const start = state.activeRun ? state.runner.clicks : state.runner.clicks - 1;
  let left = start;
  try {
    for (const ice of [...ices].reverse()) {
      ARM.clicksLeft = left;
      const p = T.runs.icePrice(state, ice);
      if (p.clicks) left -= p.clicks;
      m.set(ice.instanceId, p);
    }
  } finally {
    delete ARM.clicksLeft;
  }
  ARM.spent = start - left;
  return new Map(ices.map(i => [i.instanceId, m.get(i.instanceId)]));
}

/** The hooks the flags above drive (one owner: set once, read by the patched lines). */
function installHooks() {
  ARM.cost = (state: GameState, label: string): number | null | undefined => {
    if (!ARM.l1 && !ARM.l2 && !ARM.l4) return undefined;
    const r = firstRule(state, label);
    if (!r) return undefined;
    const f = T.runs.subroutineFacts(label);
    if (ARM.l4 && r.cls === 'orEnd') return T.runs.BLOCK; // the walk takes the end (ruling 6)
    if (ARM.l1 && r.cls !== 'worthless' && r.cls !== 'borrow' && r.cls !== 'orEnd' && r.cls !== 'lethal') {
      const rEnds = r.cls === 'ends' && r.blocks;
      const wEnds = factsEndsNow(state, f);
      if (wEnds && !rEnds) return T.runs.BLOCK;
      if (rEnds && !wEnds) return restPrice(state, r.rest, ['ends']) ?? null;
    }
    if (ARM.l2 && r.cls === 'lethal') {
      const n = factsDamage(f, state.runner.tags);
      const grip = ARM.grip ? ARM.grip(state) : state.runner.grip.length;
      const orig = r.blocks;
      if (n > grip && !orig) return T.runs.BLOCK;
      if (n <= grip && orig) return n > 0 ? EV.damageWorth(state, n, T.runs.__ownRun(state)) : (restPrice(state, r.rest, ['lethal']) ?? null);
    }
    return undefined;
  };
  ARM.facts = (view: GameState, _ice: CardInstance, label: string, f: any) => {
    let g = f;
    if (ARM.l4w && g.orEndRun && view.runner.rig.programs.length > 0) g = { ...g, orEndRun: undefined };
    if (ARM.l1w) {
      const r = firstRule(view, label);
      if (r && r.cls !== 'worthless' && r.cls !== 'borrow' && r.cls !== 'orEnd' && r.cls !== 'lethal') {
        const rEnds = r.cls === 'ends' && r.blocks;
        const wEnds = factsEndsNow(view, g);
        if (rEnds && !wEnds) g = { does: [{ kind: 'endRun' }] };
        else if (!rEnds && wEnds) g = { ...g, orEndRun: undefined, when: undefined, unless: undefined, does: g.does.filter((e: any) => !isEnd(e)) };
      }
    }
    if (ARM.l2w) {
      const nR = T.runs.__subroutineDamage(label, view.runner.tags);
      if (nR !== factsDamage(g, view.runner.tags)) {
        const rest = g.does.filter((e: any) => e.kind !== 'damage');
        g = { ...g, when: g.when?.kind === 'runnerTagsAtLeast' ? undefined : g.when, unless: g.unless?.netDamage !== undefined ? undefined : g.unless, does: [...rest, ...(nR > 0 ? [{ kind: 'damage', type: 'net', n: nR }] : [])] };
      }
    }
    return g;
  };
}
/** The Runner's side's keys and the walk's: each side's reading is taken with only its own keys set. */
const R_KEYS = ['l1', 'l2', 'l4', 'grip', 'damage', 'seqPrices', 'clicksLeft', 'spent', 'noToll', 'partial', 'needClick'];
const W_KEYS = ['l1w', 'l2w', 'l4w', 'noDraw', 'noRunBegin', 'bypass', 'lendNow', 'noRetry', 'noLoss', 'allOrNone', 'runClick'];
const clearFlags = () => {
  for (const k of [...R_KEYS, ...W_KEYS]) delete ARM[k];
};
/** Runs f with the keys of `hide` taken off ARM, then put back. */
function without<X>(hide: string[], f: () => X): X {
  const kept: Record<string, any> = {};
  for (const k of hide) if (k in ARM) {
    kept[k] = ARM[k];
    delete ARM[k];
  }
  try {
    return f();
  } finally {
    Object.assign(ARM, kept);
  }
}

// ------------------------------------------------------------------------------------------------ one reading
interface Ask {
  runner: boolean;
  holds: boolean;
  agree: boolean;
}
/** Both sides with the arms `names` set, in a frame (alone, or the three policies set aside). */
function ask(c: Ctx, names: string[], policies: boolean): Ask {
  const arms = names.map(n => ARMS[n]);
  clearFlags();
  for (const a of arms) a.set?.(c);
  try {
    const walkMoves = arms.some(a => a.dir === 'W' && a.set);
    const hold = walkMoves ? without(R_KEYS, () => walkHolds(c.pub, c.id, c.grip)) : c.base;
    let board = c.pub;
    let budget: number | undefined;
    let byp: Set<string> | undefined;
    // the walk's bypasses on the set's board (the base set or this arm's)
    const setByp = (set: string[]) => {
      if (set === c.base.set) return c.walkByp;
      const sb = withRezzed(c.s, new Set(set));
      T.clear();
      return without([...R_KEYS, ...W_KEYS], () => (asCorp(sb, () => T.runs.runBypasses(sb, c.id)) as { ids: Set<string> }).ids);
    };
    if (policies) {
      board = withRezzed(c.pub, new Set(hold.set));
      budget = hold.budget + c.runOnly;
    }
    const extra = arms.reduce((n, a) => n + (a.budget ? a.budget(c, policies) : 0), 0);
    if (extra) budget = (budget ?? (asRunner(board, () => T.runs.runBudget(board)) as number)) + extra;
    for (const a of arms) if (a.bypass) byp = a.bypass(c, setByp(hold.set));
    T.clear();
    const b2 = structuredClone(board);
    const earn = policies && ARM.seqPrices ? (T.hold.runnerEarnings(c.pub, T.hold.restOfTurn(c.pub)) as number[]) : undefined;
    const r = without(W_KEYS, () => asRunner(b2, () => runnerCanGetIn(b2, c.id, { budget, bypass: byp, earn })));
    if (process.env.DEBUG)
      without(W_KEYS, () =>
        asRunner(b2, () => {
          const sv = b2.corp.servers[c.id];
          const pr = T.runs.__runPrices(b2, sv.ice) as Map<string, any> | null;
          console.error(names.join('+') || 'ctrl', policies ? 'aside' : 'alone', JSON.stringify(r), JSON.stringify({ need: hold.need, budget: hold.budget, set: hold.set, holds: hold.holds }), sv.ice.map(i => `${def(i).title}:${i.isRezzed}:${JSON.stringify(pr?.get(i.instanceId))}`).join(' | '));
        })
      );
    return { runner: r.can, holds: hold.holds, agree: r.can !== hold.holds };
  } finally {
    clearFlags();
  }
}

function reading(s: GameState, id: string, pub: GameState, grip: number) {
  const sv = s.corp.servers[id];
  T.clear();
  clearFlags();
  const runner = asRunner(pub, () => runnerCanGetIn(structuredClone(pub), id));
  const hold = walkHolds(pub, id, grip);
  const res: any = { id, ice: sv.ice.length, rezzed: sv.ice.filter(c => c.isRezzed).length, runner: runner.can, why: runner.why, known: r3(runner.known), budget: r3(runner.budget), holds: hold.holds, need: r3(hold.need), walkBudget: r3(hold.budget), walkSet: hold.set };
  if (runner.can !== hold.holds) return { res, differ: false };
  // The three policies, one at a time (facts-log.ts lServer, unchanged)
  const unrezzed = new Set(sv.ice.filter(c => !c.isRezzed).map(c => c.instanceId));
  const canRez = new Set(
    [...unrezzed].filter(x => {
      const c = sv.ice.find(i => i.instanceId === x)!;
      return pub.corp.credits >= safe(() => T.effects.rezCost(pub, c), Infinity);
    })
  );
  const ex: Record<string, boolean> = {};
  T.clear();
  ex.unrezzedFlat = unrezzed.size > 0 && asRunner(pub, () => runnerCanGetIn(withRezzed(pub, canRez), id)).can !== hold.holds;
  T.clear();
  ex.rezChoice = asRunner(pub, () => runnerCanGetIn(withRezzed(pub, new Set(hold.set)), id)).can !== hold.holds;
  T.clear();
  const runOnly = runOnlyOf(pub);
  T.clear();
  ex.money = asRunner(pub, () => runnerCanGetIn(structuredClone(pub), id, { budget: hold.budget + runOnly })).can !== hold.holds;
  // Added: the three together (r-b.md "Decided here" 2: "after the three named policy differences are set aside")
  T.clear();
  const together = withRezzed(pub, new Set(hold.set));
  ex.together = asRunner(together, () => runnerCanGetIn(together, id, { budget: hold.budget + runOnly })).can !== hold.holds;
  res.explain = ex;
  res.unexplained = !ex.unrezzedFlat && !ex.rezChoice && !ex.money;
  return { res, differ: true, hold, runOnly };
}

function arms(s: GameState, id: string, pub: GameState, grip: number, base: ReturnType<typeof walkHolds>, runOnly: number) {
  const sv = pub.corp.servers[id];
  // HIDDEN-READ: the path's ice as rezzed, their subroutines' labels and facts
  const allUp = withRezzed(pub, new Set(sv.ice.map(c => c.instanceId)));
  const labels = allUp.corp.servers[id].ice.flatMap(ice => (T.runs.plannedSubroutines(allUp, ice) as { label: string }[]).map(x => ({ ice, label: x.label, f: T.runs.subroutineFacts(x.label) })));
  T.clear();
  const runnerByp = asRunner(pub, () => T.runs.runBypasses(pub, id)) as { ids: Set<string>; price: number };
  const sb = withRezzed(s, new Set(base.set));
  T.clear();
  const walkByp = (asCorp(sb, () => T.runs.runBypasses(sb, id)) as { ids: Set<string> }).ids;
  const c: Ctx = { s, pub, id, grip, runOnly, base, runnerByp, walkByp, labels };
  const present = ARM_NAMES.filter(n => ARMS[n].present(c));
  const out: any = { present, alone: {}, aside: {}, leak: [] as string[] };
  // control: no arm, both frames (the base reading again: a stop if it does not match)
  const ctrl = { alone: ask(c, [], false), aside: ask(c, [], true) };
  out.control = { alone: ctrl.alone.agree, aside: ctrl.aside.agree };
  for (const n of ARM_NAMES) {
    for (const frame of ['alone', 'aside'] as const) {
      const a = ask(c, [n], frame === 'aside');
      out[frame][n] = a.agree;
      // a stop: an arm not present on this board changes a reading
      if (!present.includes(n) && (a.runner !== ctrl[frame].runner || a.holds !== ctrl[frame].holds)) out.leak.push(`${n}:${frame}`);
    }
  }
  // Rule 5 (step-0 rulings): retry and partial are present on every board, so the absent-fact stop cannot guard them.
  // For each arm that explains a reading alone (frame aside), whether adding retry or partial to it undoes the agreement
  out.asideBreaks = {} as Record<string, string[]>;
  for (const x of ARM_NAMES.filter(n => out.aside[n]))
    for (const y of ['retryW', 'partialR', 'partialW'].filter(n => ARMS[n] && ARMS[n].fact !== ARMS[x].fact))
      if (!ask(c, [x, y], true).agree) (out.asideBreaks[y] ??= []).push(x);
  // pairs of the facts present (each fact either way), then all present together, in each frame where no single explains
  const facts = [...new Set(present.map(n => ARMS[n].fact))];
  for (const frame of ['alone', 'aside'] as const) {
    if (ctrl[frame].agree || present.some(n => out[frame][n])) continue;
    const pairs: string[] = [];
    for (let i = 0; i < facts.length; i++)
      for (let j = i + 1; j < facts.length; j++)
        for (const x of present.filter(n => ARMS[n].fact === facts[i]))
          for (const y of present.filter(n => ARMS[n].fact === facts[j])) if (ask(c, [x, y], frame === 'aside').agree) pairs.push(`${x}+${y}`);
    out[`${frame}Pairs`] = pairs;
    if (!pairs.length && facts.length > 2) {
      const pick = (d: 'R' | 'W') => facts.map(f => present.find(n => ARMS[n].fact === f && ARMS[n].dir === d) ?? present.find(n => ARMS[n].fact === f)!);
      out[`${frame}CombinedR`] = ask(c, pick('R'), frame === 'aside').agree;
      out[`${frame}CombinedW`] = ask(c, pick('W'), frame === 'aside').agree;
    }
  }
  // the path, for the unexplained list
  out.path = sv.ice.map(i => `${def(i).title}${i.isRezzed ? '' : '(u)'}`).reverse();
  out.root = sv.root.map(i => `${def(i).title}${i.isRezzed ? '' : '(u)'}`);
  out.rig = rigOf(pub).map(x => def(x).title);
  return out;
}

// ------------------------------------------------------------------------------------------------ watching the games
class Watch {
  seenTurnStart = new Set<number>();
  constructor(
    public src: string,
    public pool: string,
    public sk: string
  ) {}
  see(s: GameState, next: GameState) {
    const core = T.core;
    if (
      core.actingSide(s) === 'runner' &&
      s.activePlayer === 'runner' &&
      !s.activeRun &&
      !core.activePrompt(s) &&
      !(s.priority && s.priority.holder !== s.activePlayer) &&
      s.runsThisTurn.length === 0 &&
      s.runner.clicks === s.runner.maxClicks &&
      !this.seenTurnStart.has(s.turnNumber)
    ) {
      this.seenTurnStart.add(s.turnNumber);
      this.board(structuredClone(s), 'turnStart', Object.keys(s.corp.servers));
    }
    if (!s.activeRun && next.activeRun && s.activePlayer === 'runner') this.board(structuredClone(s), 'runStart', [next.activeRun.server]);
  }
  board(s: GameState, at: string, ids: string[]) {
    const t0 = performance.now();
    const pub = publicBoard(s);
    const grip = gripMoney(s, Math.max(0, s.runner.clicks - 1));
    let met = 0;
    let err = 0;
    for (const id of ids) {
      if (!s.corp.servers[id]) continue;
      try {
        const r = timed('reading', () => reading(s, id, pub, grip));
        met++;
        if (!r.differ) continue;
        const line: any = { kind: 'd', src: this.src, pool: this.pool, sk: this.sk, at, T: s.turnNumber, rk: s.runner.clicks, rc: s.runner.credits, cc: s.corp.credits, ...r.res };
        if (r.res.unexplained && !RECOUNT_ONLY) line.arms = timed('arms', () => arms(s, id, pub, grip, r.hold!, r.runOnly!));
        out(line);
      } catch (e) {
        err++;
        out({ kind: 'err', src: this.src, at, T: s.turnNumber, id, err: (e as Error).message.slice(0, 160) });
      }
    }
    out({ kind: 'b', src: this.src, pool: this.pool, sk: this.sk, at, T: s.turnNumber, met, err, ms: Math.round(performance.now() - t0) });
  }
}

type Rec = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(src: Tree, rec: Rec): GameState {
  const c = DECK_POOL.find(d => d.side === 'corp' && d.name === rec.corpDeck);
  const r = DECK_POOL.find(d => d.side === 'runner' && d.name === rec.runnerDeck);
  if (!c || !r) throw new Error(`deal ${rec.seed}: deck not found (${rec.corpDeck} v ${rec.runnerDeck})`);
  return src.core.createInitialGameState(src.decks.deckGameSetup(rec.seed, c, r));
}

async function main() {
  const dirs = makeTrees(root, { l9: true });
  const source = await loadTree('source', dirs.source);
  T = await loadTree('eval', dirs.eval);
  ARM = T.runs.L9ARM;
  EV = await import(/* @vite-ignore */ join(dirs.eval, 'src', 'ai/effectValues.ts'));
  initRules();
  installHooks();
  const sources: { pool: string; id: any }[] = [];
  for (const pool of POOLS) {
    if (pool === 'batch' || pool === 'nrdb') {
      const run = pool === 'batch' ? BATCH_RUN : NRDB_RUN;
      const recs: Rec[] = JSON.parse(readFileSync(`scripts/runner-rework/facts-deals-${run}.json`, 'utf8'));
      for (const r of recs) if (!DEALS.length || DEALS.includes(String(r.seed))) sources.push({ pool, id: r });
    } else {
      const dir = pool === 'human' ? 'tests/fixtures/human-games' : 'tests/fixtures/runner-facts/issues';
      for (const f of readdirSync(dir)
        .filter(x => x.endsWith('.json'))
        .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b)))
        if (!HUMAN.length || HUMAN.some(h => f.startsWith(h))) sources.push({ pool, id: join(dir, f) });
    }
  }
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    const t0 = performance.now();
    if (src.pool === 'batch' || src.pool === 'nrdb') {
      const rec = src.id as Rec;
      const name = `${src.pool}:${rec.seed}`;
      source.clear();
      const ag = { corp: source.createAgent('corp', 'normal'), runner: source.createAgent('runner', 'normal') };
      const g = new source.GameRunner(dealStateOf(source, rec), ag);
      const w = new Watch(name, src.pool, 'self');
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
        timed('watch', () => w.see(s, g.state));
      }
      const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
      out({ kind: 'g', src: name, pool: src.pool, matchesBatch: matches, ...(matches ? {} : { cr, sc, recCr: rec.cr, recSc: rec.sc, winner: g.state.winner, recWinner: rec.winner }), ms: Math.round(performance.now() - t0) });
    } else {
      const file = src.id as string;
      const r = JSON.parse(readFileSync(file, 'utf8'));
      const sk = r.config.ai === 'corp' ? 'humanRunner' : 'humanCorp';
      const name = `${src.pool}:${file.split('/').pop()}`;
      if (!r.moves?.length) continue;
      let s: GameState;
      if (r.startsAt === 'state') s = structuredClone(r.state);
      else {
        s = T.core.createInitialGameState(T.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
        if (r.startStops) s = { ...s, stops: r.startStops };
      }
      const w = new Watch(name, src.pool, sk);
      let stopped: string | null = null;
      for (const [j, move] of (r.moves as GameAction[]).entries()) {
        let next: GameState;
        try {
          next = T.core.executeAction(s, move);
        } catch (e) {
          stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
          break;
        }
        timed('watch', () => w.see(s, next));
        s = next;
      }
      out({ kind: 'h', src: name, pool: src.pool, sk, moves: r.moves.length, stopped, ms: Math.round(performance.now() - t0) });
    }
  }
  const tm: Record<string, number> = {};
  for (const [k2, v] of Object.entries(timing)) tm[k2] = Math.round(v);
  out({ kind: 's', shard, timing: tm, ...counts });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
