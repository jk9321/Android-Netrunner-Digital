/**
 * Stage D item 1 follow-up 4, step 1.3 (brief section 2.3): how often the Runner's missing money matters to the hold
 * count, on the recorded states (the 56 local deals played by this tree's Normal AIs and the human games replayed:
 * scripts/stage-a/harness.ts, the fire count's 92 sources), split by SHARD.
 *
 * Every serverHold call the AI makes in this tree (beta) is watched (hold-baseline.ts's wrap). For each distinct
 * question: which groups' cards are in play (runner-money-trees.ts `present`), and each arm's answer (beta plus that
 * arm's patches, runner-money-arms.json; the count asked as the Corp on the question's board, as hold-baseline's BETA
 * tree). A question where an arm's `holds` differs from beta's is a flip.
 *
 * Kept for the oracle (the fixed hold-oracle.ts, retries on, the whole turn's truth as hold-baseline judgeBoth): every
 * flip of an installed-card arm (FLIPQ per source and arm, default all), and the questions with a card of an installed
 * group in play (MAXQ per source, default 150, the first by hash order). Each count (beta and every arm) is labelled
 * against that truth. The F2 arms are not asked of the oracle: it never plays a grip card (by its definition), so
 * every F2 flip would read as a false "does not hold" there; F2 is judged by the continuations (runner-money-fire.ts).
 *
 * Output: one JSON line per kept question (`q`), and per source one line of counts (`src`: questions, by group in play,
 * flips by arm and group, hold-count milliseconds by arm). Sum with runner-money-sum.mjs.
 *
 *   SHARD=0/64 npx vite-node scripts/stage-d/runner-money.ts
 *   DEALS=1881 HUMAN=none npx vite-node scripts/stage-d/runner-money.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GameState, cardDef, rezCostOf } from '../../src/core';
import * as holdModule from '../../src/ai/corp/hold';
import { Hold, HoldOptions } from '../../src/ai/corp/hold';
import { deals, humanFiles, playDeal, replayHuman } from '../stage-a/harness';
import { oracle } from './hold-oracle';
import { makeTrees, present, readArms } from './runner-money-trees';

for (const kv of (process.env.ARGS ?? '').split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
if (process.env.ONLY && !process.env.ONLY.split(',').map(Number).includes(shard)) process.exit(0);
const CAP = Number(process.env.CAP ?? 40_000);
const QCAP = Number(process.env.QCAP ?? 20_000);
const MAX_SETS = Number(process.env.MAX_SETS ?? 16);
const MAXQ = Number(process.env.MAXQ ?? 150);
const FLIPQ = Number(process.env.FLIPQ ?? Infinity);
const NO_ORACLE = process.env.NO_ORACLE === '1';
const DUMP = process.env.OUT_DIR ?? process.env.DUMP ?? '';
/**
 * KEEP (part 1's check on the branch line): a file of question keys (their first 12 hex digits, one a line, an earlier
 * run's kept questions): exactly those are kept (the flip and sample rules off), for labelling offline against that
 * run's truth (with NO_ORACLE=1). ARMS_FILE names the arms (runner-money-base.json: the branch's base as the one arm).
 */
const KEEP = process.env.KEEP ? new Set(readFileSync(process.env.KEEP, 'utf8').split('\n').map(x => x.trim()).filter(Boolean)) : null;

const file = readArms();
const ARMS = Object.keys(file.arms);
const F2 = new Set(['f2max', 'f2odds']);
const root = resolve('.rm-trees', String(shard));
const dirs = makeTrees(file, root);
type Ask = (s: GameState, server: string, opts: HoldOptions) => Hold;
const trees: Record<string, Ask> = {};
for (const arm of ARMS) {
  const m = (p: string) => import(/* @vite-ignore */ join(dirs[arm], 'src', p));
  // One at a time, the AI's index first (it registers the ports the count reads; hold-baseline.ts's note)
  await m('ai/index.ts');
  const hm = await m('ai/corp/hold.ts');
  const pr = await m('ai/pricing.ts');
  const hv = await m('ai/handValues.ts');
  trees[arm] = (s, server, opts) => pr.asSide('corp', () => (hv.decisionContext(s, 'corp'), hm.serverHold(s, server, opts)));
}

interface Question { src: string; key: string; state: GameState; server: string; opts: HoldOptions; beta: Hold; arms: Record<string, Hold>; groups: string[]; known: string[]; flips: string[] }
let src = '';
const seen = new Set<string>();
let kept: Question[] = [];
type Tally = { questions: number; distinct: number; byGroup: Record<string, number>; flips: Record<string, number>; flipsInGroup: Record<string, Record<string, number>>; ms: Record<string, number>; known: Record<string, number> };
const fresh = (): Tally => ({ questions: 0, distinct: 0, byGroup: {}, flips: {}, flipsInGroup: {}, ms: {}, known: {} });
let tally = fresh();
const keptBy = { flips: new Map<string, number>(), sample: 0 };

const original = holdModule.serverHold;
function watched(state: GameState, server: string, opts: HoldOptions): Hold {
  let t = performance.now();
  const h = original(state, server, opts);
  tally.ms.beta = (tally.ms.beta ?? 0) + performance.now() - t;
  tally.questions++;
  const rest: Partial<GameState> = { ...state };
  delete rest.log;
  const key = createHash('sha1').update(JSON.stringify(rest)).update(`|${server}|${JSON.stringify(opts)}`).digest('hex');
  if (seen.has(key)) return h;
  seen.add(key);
  tally.distinct++;
  const p = present(state);
  const groups = Object.entries(p).filter(([g, v]) => g !== 'known' && v === true).map(([g]) => g);
  const known = p.known as string[];
  for (const g of groups) tally.byGroup[g] = (tally.byGroup[g] ?? 0) + 1;
  for (const k of known) tally.known[k] = (tally.known[k] ?? 0) + 1;
  const arms: Record<string, Hold> = {};
  const flips: string[] = [];
  for (const arm of ARMS) {
    t = performance.now();
    try {
      arms[arm] = trees[arm](structuredClone(state), server, structuredClone(opts));
    } catch (e) {
      console.log(JSON.stringify({ kind: 'error', src, arm, error: (e as Error).message }));
      continue;
    }
    tally.ms[arm] = (tally.ms[arm] ?? 0) + performance.now() - t;
    if (arms[arm].holds !== h.holds) {
      flips.push(arm);
      tally.flips[arm] = (tally.flips[arm] ?? 0) + 1;
      for (const g of groups.length ? groups : ['none']) ((tally.flipsInGroup[arm] ??= {})[g] = (tally.flipsInGroup[arm]?.[g] ?? 0) + 1);
    }
  }
  if (KEEP) {
    if (KEEP.has(key.slice(0, 12))) kept.push({ src, key, state: structuredClone(state), server, opts: structuredClone(opts), beta: structuredClone(h), arms: structuredClone(arms), groups, known, flips });
    return h;
  }
  const installedFlips = flips.filter(a => !F2.has(a));
  const keepFlip = installedFlips.some(a => (keptBy.flips.get(`${src}|${a}`) ?? 0) < FLIPQ);
  const keepSample = groups.some(g => g !== 'f2') && keptBy.sample < MAXQ;
  if (keepFlip || keepSample) {
    installedFlips.forEach(a => keptBy.flips.set(`${src}|${a}`, (keptBy.flips.get(`${src}|${a}`) ?? 0) + 1));
    if (!keepFlip && keepSample) keptBy.sample++;
    kept.push({ src, key, state: structuredClone(state), server, opts: structuredClone(opts), beta: structuredClone(h), arms: structuredClone(arms), groups, known, flips });
  }
  return h;
}
Object.defineProperty(holdModule, 'serverHold', { get: () => watched, configurable: true, enumerable: true });

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
function subsets<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let m = 0; m < 1 << xs.length; m++) out.push(xs.filter((_, i) => m & (1 << i)));
  return out.sort((a, b) => b.length - a.length);
}
/** hold-baseline.ts affordableSets. */
function affordableSets(q: Question): string[][] {
  const s = q.state;
  const sv = s.corp.servers[q.server];
  if (!sv) return [[]];
  const credits = q.opts.corpCredits ?? s.corp.credits;
  if (q.opts.when === 'runnerTurn') {
    const open = sv.ice.slice(0, 10).filter(c => !c.isRezzed);
    return subsets(open).filter(set => set.reduce((n, c) => n + rezCostOf(s, c), 0) <= credits).map(set => set.map(c => c.instanceId));
  }
  const run = s.activeRun;
  const pos = q.opts.from ?? run?.icePosition ?? null;
  if (!run || pos === null) return [[]];
  const must = sv.ice.filter(c => q.opts.mustRez?.includes(c.instanceId));
  const base = must.reduce((n, c) => n + rezCostOf(s, c), 0);
  const open = (q.opts.further ?? true) ? sv.ice.slice(0, pos).filter(c => !c.isRezzed).slice(0, 10) : [];
  return subsets(open)
    .map(set => ({ ids: [...must, ...set].map(c => c.instanceId), cost: base + set.reduce((n, c) => n + rezCostOf(s, c), 0) }))
    .filter(x => x.cost - base <= Math.max(0, credits - base) || x.ids.length === must.length)
    .map(x => x.ids);
}

/** The whole turn's truth (retries on), every count's set first, and each count labelled against it (judgeBoth). */
function judge(q: Question) {
  const t0 = performance.now();
  const counts: Record<string, Hold> = { beta: q.beta, ...Object.fromEntries(Object.entries(q.arms).filter(([a]) => !F2.has(a))) };
  const first: string[][] = [];
  for (const c of Object.values(counts)) if (c.holds && c.rez && !first.some(f => sameSet(f, c.rez!))) first.push(c.rez);
  const order = [...first, ...affordableSets(q).filter(x => !first.some(f => sameSet(f, x)))];
  const verdict = new Map<string, string>();
  let truth: boolean | null = null;
  let unknown = 0;
  let skipped: string | undefined;
  let work = 0;
  let tried = 0;
  let set: string[] | null = null;
  for (const ids of order) {
    if (++tried > MAX_SETS + first.length || work >= QCAP) {
      unknown++;
      break;
    }
    const a = oracle(q.state, { when: q.opts.when, targets: [q.server], rez: new Set(ids), corpCredits: q.opts.corpCredits, cap: Math.min(CAP, QCAP - work), retries: true });
    work += a.work;
    const v = a.skipped ? 'skipped' : a.reached === null ? 'unknown' : a.reached >= 1 ? 'getsIn' : 'holds';
    verdict.set([...ids].sort().join(','), v);
    if (v === 'skipped') {
      skipped = a.skipped;
      break;
    }
    if (v === 'unknown') unknown++;
    if (v === 'holds') {
      truth = true;
      set = ids;
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
  return { truth, set, unknown, skipped, labels: Object.fromEntries(Object.entries(counts).map(([a, c]) => [a, labelOf(c)])), work, ms: Math.round(performance.now() - t0) };
}

const brief = (c: Hold) => ({ holds: c.holds, rez: c.rez, need: c.need, budget: c.budget, entries: c.entries });
function flush() {
  const batch = kept;
  kept = [];
  for (const q of batch) {
    const s = q.state;
    const line = {
      kind: 'q',
      src: q.src,
      key: q.key.slice(0, 12),
      when: q.opts.when,
      corpCredits: q.opts.corpCredits ?? null,
      server: q.server,
      turn: s.turnNumber,
      ice: (s.corp.servers[q.server]?.ice ?? []).map(c => cardDef(c).title + (c.isRezzed ? '*' : '')),
      rig: [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].map(c => cardDef(c).title),
      runner: { credits: s.runner.credits, grip: s.runner.grip.length, clicks: s.runner.maxClicks },
      groups: q.groups,
      known: q.known,
      flips: q.flips,
      beta: brief(q.beta),
      arms: Object.fromEntries(Object.entries(q.arms).map(([a, c]) => [a, brief(c)])),
      oracle: undefined as ReturnType<typeof judge> | undefined | { error: string },
    };
    if (!NO_ORACLE) {
      try {
        line.oracle = judge(q);
      } catch (e) {
        line.oracle = { error: (e as Error).message };
      }
    }
    console.log(JSON.stringify(line));
    // The boards of the flips, for reading (OUT_DIR: the ai-script artifact)
    if (DUMP && q.flips.length) {
      mkdirSync(DUMP, { recursive: true });
      writeFileSync(join(DUMP, `${q.key.slice(0, 12)}.json`), JSON.stringify({ line, server: q.server, opts: q.opts, state: q.state }));
    }
  }
}

const sources: [string, () => void][] = [
  ...deals().map(seed => [`deal:${seed}`, () => void playDeal(seed, {})] as [string, () => void]),
  ...humanFiles().map(f => [`human:${f.split('/').pop()}`, () => replayHuman(f, {})] as [string, () => void]),
];
sources.forEach(([name, play], k) => {
  if (k % shards !== shard) return;
  src = name;
  tally = fresh();
  keptBy.flips.clear();
  keptBy.sample = 0;
  play();
  console.log(JSON.stringify({ kind: 'src', src, ...tally, ms: Object.fromEntries(Object.entries(tally.ms).map(([a, v]) => [a, Math.round(v)])) }));
  flush();
});
rmSync(root, { recursive: true, force: true });
