/**
 * Stage D item 1 (brief rev 2, 4.2): the baseline table, the engine oracle (hold-oracle.ts) against today's count
 * (serverHold, src/ai/corp/hold.ts) on the recorded states: the 56 local deals played by this tree's Normal AIs and the
 * human games replayed (scripts/stage-a/harness.ts), split by SHARD.
 *
 * Every serverHold call the AI makes there is watched (the module's export is wrapped; the readers call it through the
 * module, so every question a decision asks is seen, the hypothetical boards of its candidates included). Distinct
 * questions (the board without its log, the server, the options) are kept by a hash sample: a question is kept when its
 * hash falls under SAMPLE (default 1: all), at most MAXQ per source (default 400, the first ones by hash order of
 * arrival). Each kept question is then asked of the oracle:
 *  - the count holds with rez set R: the oracle on R; if R gets in, the oracle on every other affordable set (the
 *    count's own enumeration), so a "false holds" is one where no affordable set holds;
 *  - the count does not hold: the oracle on every affordable set, largest first, until one holds ("false does not hold").
 * One JSON line per question: source, horizon, the count's answer, the oracle's, the families on the board (the rows of
 * the brief's section 2 that could explain a disagreement), work, ms. Sum with hold-baseline-sum.mjs.
 *
 * COMPARE=1 (branch 2, brief 7: the oracle on recorded states): each question is also asked of the count as on beta
 * (the walk's switches off, `old`). Every question where the two answer `holds` differently (a flip) is kept, and the
 * others by SAMPLE and MAXQ. The oracle answers for the whole turn (retries on, ruling of 04:54Z): the walk's set and the
 * old set first, then the other affordable sets until one holds; both counts are labelled against that truth (`label`
 * the walk's, `oldLabel` beta's). Sum with hold-walk-compare-sum.mjs. On a tree without the walk's switches (the hand-off,
 * after a92a50a deleted them) `BETA=<full sha>` names beta's commit: its hold.ts, rezMoney.ts and runs.ts go into a copy
 * of src/ (.hb-beta/<shard>, its own module graph, as the fire count's trees) and beta's count is asked there, as the
 * Corp on the question's board (the way the walk tests ask it).
 *
 *   SHARD=0/64 npx vite-node scripts/stage-d/hold-baseline.ts > out-0.txt
 *   DEALS=1001 HUMAN=none SAMPLE=0.05 npx vite-node scripts/stage-d/hold-baseline.ts
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CardInstance, GameState, cardDef, rezCostOf } from '../../src/core';
import { plan, withPricing } from '../../src/ai/pricing';
import * as holdModule from '../../src/ai/corp/hold';
import { Hold, HoldOptions } from '../../src/ai/corp/hold';
import { deals, humanFiles, playDeal, replayHuman } from '../stage-a/harness';
import { oracle } from './hold-oracle';

// ai-script.yml passes settings in ARGS ("SAMPLE=0.05 MAXQ=400")
for (const kv of (process.env.ARGS ?? '').split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const SAMPLE = Number(process.env.SAMPLE ?? 1);
const MAXQ = Number(process.env.MAXQ ?? 400);
const CAP = Number(process.env.CAP ?? 40_000);
const DUMP = process.env.OUT_DIR ?? process.env.DUMP ?? '';
const MAX_SETS = Number(process.env.MAX_SETS ?? 16);
const COMPARE = process.env.COMPARE === '1';
// The count as on beta: on a tree with the walk's temporary switches (ai-hold-walk cbab0ad or earlier) `holdWalk: false`
// reaches it; on a later tree it is beta's own files in a copy of src/ (BETA=<full sha>)
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
// ONLY=10,20: run these shards and no others (to redo the shards of a run that failed)
if (process.env.ONLY && !process.env.ONLY.split(',').map(Number).includes(shard)) process.exit(0);
const betaRoot = resolve('.hb-beta', String(shard));
let betaHold: ((s: GameState, server: string, opts: HoldOptions) => Hold) | undefined;
if (COMPARE && !('holdWalk' in plan())) {
  const sha = process.env.BETA;
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('COMPARE on a tree without plan.holdWalk needs BETA=<full sha>');
  // Four processes share a runner's checkout: the first fetch may race the others, so each tries until the commit is there
  for (let k = 0; ; k++) {
    try {
      execSync(`git cat-file -e ${sha}^{commit}`, { stdio: 'ignore' });
      break;
    } catch {
      if (k >= 10) throw new Error(`hold-baseline: could not fetch ${sha}`);
      try {
        execSync(`git fetch -q --depth=1 origin ${sha}`, { stdio: 'ignore' });
      } catch {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 + Math.floor(Math.random() * 1500));
      }
    }
  }
  rmSync(betaRoot, { recursive: true, force: true });
  cpSync('src', join(betaRoot, 'src'), { recursive: true });
  for (const f of ['ai/corp/hold.ts', 'ai/corp/rezMoney.ts', 'ai/runs.ts']) writeFileSync(join(betaRoot, 'src', f), execSync(`git show ${sha}:src/${f}`, { maxBuffer: 1 << 26 }));
  const m = (p: string) => import(/* @vite-ignore */ join(betaRoot, 'src', p));
  // One at a time: vite-node can deadlock on concurrent imports of modules that import each other. The AI's index first:
  // it loads corpAI.ts, which registers the ports beta's count reads (corpPorts.holdingRezIds; run 44098196814 lost four
  // shards to it)
  await m('ai/index.ts');
  const hm = await m('ai/corp/hold.ts');
  const pr = await m('ai/pricing.ts');
  const hv = await m('ai/handValues.ts');
  betaHold = (s, server, opts) => pr.asSide('corp', () => (hv.decisionContext(s, 'corp'), hm.serverHold(s, server, opts)));
}
/** COMPARE: at most this many flips kept per source (default all); the ones over it are counted in `flipsOver`. */
const FLIPQ = Number(process.env.FLIPQ ?? Infinity);

interface Question { src: string; key: string; state: GameState; server: string; opts: HoldOptions; count: Hold; old?: Hold; flip?: boolean }

let src = '';
const seen = new Set<string>();
let kept: Question[] = [];
const calls = { all: 0, distinct: 0, kept: 0, flips: 0, flipsOver: 0 };

const original = holdModule.serverHold;
function watched(state: GameState, server: string, opts: HoldOptions): Hold {
  const h = original(state, server, opts);
  calls.all++;
  const rest: Partial<GameState> = { ...state };
  delete rest.log;
  const key = createHash('sha1').update(JSON.stringify(rest)).update(`|${server}|${JSON.stringify(opts)}`).digest('hex');
  if (seen.has(key)) return h;
  seen.add(key);
  calls.distinct++;
  // The count as on beta: beta's own files (BETA), or the walk's temporary switches off (synergy.ts) on a tree that has them
  const old = !COMPARE ? undefined : betaHold ? betaHold(state, server, opts) : withPricing({ plan: { ...plan(), holdWalk: false } as ReturnType<typeof plan> }, () => original(state, server, opts));
  const flip = !!old && old.holds !== h.holds;
  if (flip) calls.flips++;
  if (flip && kept.filter(q => q.src === src && q.flip).length >= FLIPQ) {
    calls.flipsOver++;
    return h;
  }
  if (!flip && parseInt(key.slice(0, 8), 16) / 0xffffffff >= SAMPLE) return h;
  if (!flip && kept.filter(q => q.src === src && !q.flip).length >= MAXQ) return h;
  calls.kept++;
  kept.push({ src, key, state: structuredClone(state), server, opts: structuredClone(opts), count: structuredClone(h), old: old && structuredClone(old), flip });
  return h;
}
Object.defineProperty(holdModule, 'serverHold', { get: () => watched, configurable: true, enumerable: true });

/** The rows of the brief's section 2 a board can show (by its cards and counters), for labelling a disagreement. */
function families(s: GameState, server: string, rez: string[]): string[] {
  const ice = s.corp.servers[server]?.ice ?? [];
  const title = (c: CardInstance) => cardDef(c).title;
  const kw = (c: CardInstance) => cardDef(c).keywords ?? '';
  const rig = [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources];
  const rigTitles = new Set(rig.map(title));
  const f = new Set<string>();
  if (ice.some(c => /Bioroid/.test(kw(c)))) f.add('A bioroid');
  if (['Botulus', 'Tranquilizer', 'Hantu', 'Mayfly', 'Audrey v2'].some(t => rigTitles.has(t))) f.add('A/T counters');
  if (rig.some(c => ['Botulus', 'Tranquilizer'].includes(title(c)) && ice.some(i => i.instanceId === c.hostedOnId))) f.add('T turn start');
  const toRez = ice.filter(c => rez.includes(c.instanceId));
  if (toRez.some(c => ['Flyswatter', 'Ping', 'Bumi 1.0'].includes(title(c)))) f.add('R rez-time');
  if (s.runner.tags > 0) f.add('G1 tagged');
  if (ice.some(c => /tag/i.test(cardDef(c).text ?? ''))) f.add('G2 tag subs');
  if (ice.some(c => /damage/i.test(cardDef(c).text ?? ''))) f.add('G3 damage');
  if (ice.some(c => /pays? \d|loses? \d\[credit\] when|they lose \d/i.test(cardDef(c).text ?? ''))) f.add('B pay or lose');
  if (ice.some(c => /\d\[credit\] or (less|more)|more credits than/i.test(cardDef(c).text ?? ''))) f.add('C credit condition');
  if (s.corp.badPublicity > 0) f.add('E bad publicity');
  if (ice.some(c => /Lose \[click\]|\[click\]/.test(cardDef(c).text ?? '') && !/Bioroid/.test(kw(c)))) f.add('click ice');
  return [...f];
}

/** The rez sets the count enumerates for this question, cheapest first (its own rules; hold.ts). */
function affordableSets(q: Question): { ids: string[]; cost: number }[] {
  const s = q.state;
  const sv = s.corp.servers[q.server];
  if (!sv) return [{ ids: [], cost: 0 }];
  if (q.opts.when === 'runnerTurn') {
    const credits = q.opts.corpCredits ?? s.corp.credits;
    const open = sv.ice.slice(0, 10).filter(c => !c.isRezzed);
    return subsets(open).map(set => ({ ids: set.map(c => c.instanceId), cost: set.reduce((n, c) => n + rezCostOf(s, c), 0) })).filter(x => x.cost <= credits);
  }
  const run = s.activeRun;
  const pos = q.opts.from ?? run?.icePosition ?? null;
  if (!run || pos === null) return [{ ids: [], cost: 0 }];
  const credits = q.opts.corpCredits ?? s.corp.credits;
  const must = sv.ice.filter(c => q.opts.mustRez?.includes(c.instanceId));
  const base = must.reduce((n, c) => n + rezCostOf(s, c), 0);
  const open = (q.opts.further ?? true) ? sv.ice.slice(0, pos).filter(c => !c.isRezzed).slice(0, 10) : [];
  return subsets(open)
    .map(set => ({ ids: [...must, ...set].map(c => c.instanceId), cost: base + set.reduce((n, c) => n + rezCostOf(s, c), 0) }))
    .filter(x => x.cost - base <= Math.max(0, credits - base) || x.ids.length === must.length);
}
function subsets<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let m = 0; m < 1 << xs.length; m++) out.push(xs.filter((_, i) => m & (1 << i)));
  return out.sort((a, b) => b.length - a.length);
}

type Verdict = 'getsIn' | 'holds' | 'unknown' | 'skipped';
let movedFlag = false;
function ask(q: Question, ids: string[], retries = false): { v: Verdict; work: number; why?: string } {
  const a = oracle(q.state, { when: q.opts.when, targets: [q.server], rez: new Set(ids), corpCredits: q.opts.corpCredits, cap: CAP, retries });
  if (a.skipped) return { v: 'skipped', work: 0, why: a.skipped };
  if (a.moved) movedFlag = true;
  if (a.reached === null) return { v: 'unknown', work: a.work };
  return { v: a.reached >= 1 ? 'getsIn' : 'holds', work: a.work };
}

function judge(q: Question) {
  const t = performance.now();
  movedFlag = false;
  let work = 0;
  const sets = affordableSets(q);
  const count = q.count;
  let oracleHolds: boolean | null = null;
  let holdingSet: string[] | null = null;
  let countSet: Verdict | null = null;
  let unknown = 0;
  let skipped: string | undefined;
  if (count.holds && count.rez) {
    const r = ask(q, count.rez);
    work += r.work;
    countSet = r.v;
    if (r.v === 'skipped') skipped = r.why;
    if (r.v === 'holds') {
      oracleHolds = true;
      holdingSet = count.rez;
    }
  }
  if (oracleHolds === null && !skipped) {
    let tried = 0;
    for (const set of sets) {
      if (count.holds && count.rez && sameSet(set.ids, count.rez)) continue;
      if (++tried > MAX_SETS) {
        unknown++;
        break;
      }
      const r = ask(q, set.ids);
      work += r.work;
      if (r.v === 'skipped') {
        skipped = r.why;
        break;
      }
      if (r.v === 'unknown') unknown++;
      if (r.v === 'holds') {
        oracleHolds = true;
        holdingSet = set.ids;
        break;
      }
    }
    if (oracleHolds === null && !skipped && unknown === 0) oracleHolds = false;
  }
  let label: string;
  if (skipped) label = 'skipped';
  else if (oracleHolds === null) label = 'unknown';
  else if (count.holds === oracleHolds) label = count.holds && countSet !== 'holds' ? 'agree, other set' : 'agree';
  else label = count.holds ? 'false holds' : 'false does not hold';
  // A one-run "holds" the Runner beats by running again (a rez-time tag spent on the first run): the turn's whole truth
  let retryGetsIn: boolean | undefined;
  if (oracleHolds && holdingSet && q.opts.when === 'runnerTurn') {
    const r = ask(q, holdingSet, true);
    work += r.work;
    retryGetsIn = r.v === 'getsIn' ? true : r.v === 'holds' ? false : undefined;
  }
  const s = q.state;
  return {
    src: q.src,
    when: q.opts.when,
    corpCredits: q.opts.corpCredits ?? null,
    server: q.server,
    turn: s.turnNumber,
    ice: (s.corp.servers[q.server]?.ice ?? []).map(c => cardDef(c).title + (c.isRezzed ? '*' : '')),
    rig: [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].map(c => cardDef(c).title),
    runner: { credits: s.runner.credits, tags: s.runner.tags, grip: s.runner.grip.length, clicks: s.runner.maxClicks },
    corp: { credits: s.corp.credits, bp: s.corp.badPublicity },
    count: { holds: count.holds, rez: count.rez, need: count.need, budget: count.budget },
    oracle: { holds: oracleHolds, set: holdingSet, countSet, retryGetsIn, unknown, skipped },
    label,
    moved: movedFlag,
    families: families(s, q.server, holdingSet ?? count.rez ?? []),
    sets: sets.length,
    work,
    ms: Math.round(performance.now() - t),
  };
}
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));

/** COMPARE: the whole turn's truth (retries on) and both counts labelled against it. */
function judgeBoth(q: Question) {
  const t = performance.now();
  movedFlag = false;
  let work = 0;
  const count = q.count;
  const old = q.old!;
  const all = affordableSets(q);
  const first = [count.holds && count.rez ? count.rez : null, old.holds && old.rez ? old.rez : null].filter((x): x is string[] => !!x);
  const order = [...first.filter((x, i) => i === 0 || !sameSet(x, first[0])).map(ids => ({ ids })), ...all.filter(x => !first.some(f => sameSet(f, x.ids)))];
  const verdict = new Map<string, Verdict>();
  let truth: boolean | null = null;
  let holdingSet: string[] | null = null;
  let unknown = 0;
  let skipped: string | undefined;
  let tried = 0;
  for (const set of order) {
    if (++tried > MAX_SETS + first.length) {
      unknown++;
      break;
    }
    const r = ask(q, set.ids, true);
    work += r.work;
    verdict.set([...set.ids].sort().join(','), r.v);
    if (r.v === 'skipped') {
      skipped = r.why;
      break;
    }
    if (r.v === 'unknown') unknown++;
    if (r.v === 'holds') {
      truth = true;
      holdingSet = set.ids;
      break;
    }
  }
  if (truth === null && !skipped && unknown === 0) truth = false;
  const labelOf = (c: Hold): string => {
    if (skipped) return 'skipped';
    if (c.holds && c.rez && verdict.get([...c.rez].sort().join(',')) === 'holds') return 'agree';
    if (truth === null) return 'unknown';
    if (c.holds === truth) return c.holds ? 'agree, other set' : 'agree';
    return c.holds ? 'false holds' : 'false does not hold';
  };
  const s = q.state;
  const brief = (c: Hold) => ({ holds: c.holds, rez: c.rez, need: c.need, budget: c.budget, entries: c.entries });
  return {
    src: q.src,
    when: q.opts.when,
    corpCredits: q.opts.corpCredits ?? null,
    server: q.server,
    turn: s.turnNumber,
    ice: (s.corp.servers[q.server]?.ice ?? []).map(c => cardDef(c).title + (c.isRezzed ? '*' : '')),
    rig: [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].map(c => cardDef(c).title),
    runner: { credits: s.runner.credits, tags: s.runner.tags, grip: s.runner.grip.length, clicks: s.runner.maxClicks },
    corp: { credits: s.corp.credits, bp: s.corp.badPublicity },
    flip: q.flip,
    count: brief(count),
    old: brief(old),
    oracle: { holds: truth, set: holdingSet, unknown, skipped },
    label: labelOf(count),
    oldLabel: labelOf(old),
    moved: movedFlag,
    families: families(s, q.server, holdingSet ?? count.rez ?? old.rez ?? []),
    sets: all.length,
    work,
    ms: Math.round(performance.now() - t),
  };
}

const sources: [string, () => void][] = [
  ...deals().map(seed => [`deal:${seed}`, () => void playDeal(seed, {})] as [string, () => void]),
  ...humanFiles().map(f => [`human:${f.split('/').pop()}`, () => replayHuman(f, {})] as [string, () => void]),
];
sources.forEach(([name, play], k) => {
  if (k % shards !== shard) return;
  src = name;
  play();
  flush();
});
if (betaHold) rmSync(betaRoot, { recursive: true, force: true });

function flush() {
  const batch = kept;
  kept = [];
  for (const q of batch) {
    try {
      const line = COMPARE ? judgeBoth(q) : judge(q);
      console.log(JSON.stringify(line));
      // The boards of the disagreements, for reading (OUT_DIR: the ai-script artifact)
      if (DUMP && ((line.label !== 'agree' && line.label !== 'agree, other set') || q.flip)) {
        mkdirSync(DUMP, { recursive: true });
        writeFileSync(join(DUMP, `${q.key.slice(0, 12)}.json`), JSON.stringify({ line, server: q.server, opts: q.opts, state: q.state }));
      }
    } catch (e) {
      console.log(JSON.stringify({ src: q.src, when: q.opts.when, label: 'error', error: (e as Error).message }));
    }
  }
  console.error(`calls ${calls.all}, distinct ${calls.distinct}, kept ${calls.kept}, flips ${calls.flips} (over FLIPQ ${calls.flipsOver})`);
}
