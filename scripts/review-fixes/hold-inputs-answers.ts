/**
 * Bundle H build (netrunner-ai/review-fixes-1119/hold-inputs/brief.md rev 2, "Judged by", the recorded answers; red team
 * S4): my copy of scripts/stage-d/hold-baseline.ts (which is not edited), asked of every commit of the branch in turn.
 *
 * Sources: the 221 deals of the g1 base (scripts/stage-d/post-pick-deals.json, dealState(seed), Normal v Normal played by
 * this checkout's tree) and the human files replayed (scripts/stage-a/harness.ts), split by SHARD. Watched, as the
 * readers call them (the module exports wrapped, the Corp ports replaced): serverHold (every horizon), runStands (its
 * verdict; the run term's reader), rezMoney (keep, byServer, unholdable; every form), holdingRezIds, lineFloor.
 * Distinct questions (the board without its log, the call's arguments) are kept by hash.
 *
 * Trees: TREES, a comma-separated list of full SHAs in commit order (the merge base first). Each is a copy of src/ with
 * hold.ts, rezMoney.ts and runs.ts from that commit, its own module graph (as hold-baseline's BETA). This checkout is the
 * last tree (HEAD). Every tree is asked the question afresh, as the Corp, in a fresh decision context (asSide,
 * decisionContext), so every tree is asked the same way. The first and last trees are asked every question; where they
 * differ, or for a SAMPLE_ALL share of the rest (default 0.1, to see a change that a later commit takes back), every tree.
 * A changed answer is listed at each commit where it differs from the commit before ("first appears").
 *
 * Labels (the engine oracle, scripts/stage-d/hold-oracle.ts, retries on for the Runner's turn: its whole truth):
 *  - serverHold 'runnerTurn' and 'thisRun': the truth over the affordable rez sets (as hold-baseline's judgeBoth, the
 *    trees' holding sets first); each tree's verdict is right, `false holds` or `false does not hold`; a tree's holds
 *    with a set the oracle gets in through is `false holds (its set)` when another set holds. A transition is labelled
 *    fixed (wrong -> right), made (right -> wrong), `still wrong`, `other answer, both right`, or `not decidable`.
 *    'restOfTurn' has no oracle start: not decidable.
 *  - runStands: the truth over the rez sets its gathered questions list (the Corp's choices, 6.9.2b): out if one holds.
 *  - rezMoney, holdingRezIds, lineFloor: not decidable (their per-server answers are serverHold's, labelled there).
 *
 * One JSON line per changed question (`kind: 'q'`), and one summary line per source (`kind: 'src'`: distinct questions
 * by reader and horizon, the mid-run 'runnerTurn' questions, the changed ones). Boards of changed questions go to OUT_DIR.
 * Sum with hold-inputs-answers-sum.mjs.
 *
 *   SHARD=0/64 TREES=<sha0>,...,<sha6> npx vite-node scripts/review-fixes/hold-inputs-answers.ts
 *   ARGS="DEALS=1001 HUMAN=none TREES=..." npx vite-node scripts/review-fixes/hold-inputs-answers.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { rezCostOf } from '../../src/core';
import * as ai from '../../src/ai';
import * as holdModule from '../../src/ai/corp/hold';
import * as rezModule from '../../src/ai/corp/rezMoney';
import * as pricing from '../../src/ai/pricing';
import * as handValues from '../../src/ai/handValues';
import { corpPorts } from '../../src/ai/corpPorts';
import { humanFiles, playDeal, replayHuman } from '../stage-a/harness';
import { oracle, oracleStart } from '../stage-d/hold-oracle';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
void ai;
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
if (process.env.ONLY && !process.env.ONLY.split(',').map(Number).includes(shard)) process.exit(0);
const SHAS = (process.env.TREES ?? '').split(',').filter(Boolean);
if (!SHAS.length || SHAS.some(s => !/^[0-9a-f]{40}$/.test(s))) throw new Error('TREES=<full sha>,... (the merge base first, HEAD last)');
const SAMPLE_ALL = Number(process.env.SAMPLE_ALL ?? 0.1);
const CAP = Number(process.env.CAP ?? 40_000);
const QCAP = Number(process.env.QCAP ?? 400_000);
const MAX_SETS = Number(process.env.MAX_SETS ?? 16);
const DUMP = process.env.OUT_DIR ?? '';
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/hold-inputs', String(shard));

interface Tree {
  name: string;
  serverHold: (s: GameState, server: string, opts: any) => any;
  runStands: (s: GameState, server: string) => any;
  rezMoney: (s: GameState, opts?: any) => any;
  holdingRezIds: (s: GameState) => any;
  lineFloor: (s: GameState, id: string) => number;
  asCorp: <T>(s: GameState, f: () => T) => T;
}

function fetchSha(sha: string) {
  for (let k = 0; ; k++) {
    try {
      execSync(`git cat-file -e ${sha}^{commit}`, { stdio: 'ignore' });
      return;
    } catch {
      if (k >= 10) throw new Error(`hold-inputs-answers: could not fetch ${sha}`);
      try {
        execSync(`git fetch -q --depth=1 origin ${sha}`, { stdio: 'ignore' });
      } catch {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 + Math.floor(Math.random() * 1500));
      }
    }
  }
}

const original = { serverHold: holdModule.serverHold, runStands: holdModule.runStands, rezMoney: rezModule.rezMoney, holdingRezIds: rezModule.holdingRezIds, lineFloor: rezModule.lineFloor };
const asCorpHere = <T>(s: GameState, f: () => T): T => pricing.asSide('corp', () => (handValues.decisionContext(s, 'corp'), f()));
const head: Tree = { name: 'HEAD', ...original, asCorp: asCorpHere };

async function loadTrees(): Promise<Tree[]> {
  const out: Tree[] = [];
  rmSync(root, { recursive: true, force: true });
  for (const [k, sha] of SHAS.slice(0, -1).entries()) {
    fetchSha(sha);
    const dir = join(root, String(k));
    cpSync('src', join(dir, 'src'), { recursive: true });
    for (const f of ['ai/corp/hold.ts', 'ai/corp/rezMoney.ts', 'ai/runs.ts']) writeFileSync(join(dir, 'src', f), execSync(`git show ${sha}:src/${f}`, { maxBuffer: 1 << 26 }));
    const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
    // One at a time; the AI's index first (it registers the Corp ports the count reads)
    await m('ai/index.ts');
    const hm = await m('ai/corp/hold.ts');
    const rm = await m('ai/corp/rezMoney.ts');
    const pr = await m('ai/pricing.ts');
    const hv = await m('ai/handValues.ts');
    out.push({
      name: sha.slice(0, 7),
      serverHold: hm.serverHold,
      runStands: hm.runStands,
      rezMoney: rm.rezMoney,
      holdingRezIds: rm.holdingRezIds,
      lineFloor: rm.lineFloor,
      asCorp: (s, f) => pr.asSide('corp', () => (hv.decisionContext(s, 'corp'), f())),
    });
  }
  // The last SHA is this checkout's src (fix 7 and the scripts change no src): its own module graph, the one watched
  const last = SHAS[SHAS.length - 1];
  fetchSha(last);
  try {
    execSync(`git diff --quiet ${last} HEAD -- src`, { stdio: 'ignore' });
  } catch {
    throw new Error(`the last of TREES must have this checkout's src (${last})`);
  }
  out.push({ ...head, name: last.slice(0, 7) });
  return out;
}

type Reader = 'serverHold' | 'runStands' | 'rezMoney' | 'holdingRezIds' | 'lineFloor';
interface Question { src: string; key: string; reader: Reader; state: GameState; args: any[]; when: string; midRun: boolean }

let src = '';
const seen = new Set<string>();
let queue: Question[] = [];
let watching = true;
const counts: Record<string, number> = {};
const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

function watch(reader: Reader, state: GameState, args: any[]) {
  if (!watching) return;
  const rest: Partial<GameState> = { ...state };
  delete rest.log;
  const key = createHash('sha1').update(JSON.stringify(rest)).update(`|${reader}|${JSON.stringify(args)}`).digest('hex');
  if (seen.has(key)) return;
  seen.add(key);
  const when = reader === 'serverHold' ? args[1].when : reader === 'rezMoney' ? (args[0]?.restOfTurn ? 'restOfTurn' : args[0]?.without?.length ? 'without' : 'plain') : reader;
  const midRun = !!state.activeRun && (reader !== 'serverHold' || when === 'runnerTurn');
  bump(`${reader}:${when}`);
  if (midRun) bump(`${reader}:${when}:midRun`);
  queue.push({ src, key, reader, state: structuredClone(state), args: structuredClone(args), when, midRun });
}
Object.defineProperty(holdModule, 'serverHold', { get: () => (s: GameState, server: string, opts: any) => (watch('serverHold', s, [server, opts]), original.serverHold(s, server, opts)), configurable: true, enumerable: true });
Object.defineProperty(rezModule, 'rezMoney', { get: () => (s: GameState, opts?: any) => (watch('rezMoney', s, [opts ?? {}]), original.rezMoney(s, opts)), configurable: true, enumerable: true });
Object.defineProperty(rezModule, 'lineFloor', { get: () => (s: GameState, id: string) => (watch('lineFloor', s, [id]), original.lineFloor(s, id)), configurable: true, enumerable: true });
const portStands = corpPorts.runStands;
corpPorts.runStands = (s, server) => (watch('runStands', s, [server]), portStands(s, server));
const portIds = corpPorts.holdingRezIds;
corpPorts.holdingRezIds = s => (watch('holdingRezIds', s, []), portIds(s));

/** A tree's answer to a question, as comparable plain data. */
function answer(t: Tree, q: Question): unknown {
  const s = q.state;
  return t.asCorp(s, () => {
    switch (q.reader) {
      case 'serverHold': {
        const h = t.serverHold(s, q.args[0], q.args[1]);
        return { holds: h.holds, rez: h.rez ? [...h.rez].sort() : null, rezCost: h.rezCost, need: h.need, budget: h.budget, entries: h.entries };
      }
      case 'runStands': {
        const r = t.runStands(s, q.args[0]);
        return r ? { key: r.key, verdict: r.verdict() } : null;
      }
      case 'rezMoney': {
        const m = t.rezMoney(s, q.args[0]);
        return { keep: m.keep, byServer: m.byServer, rezIds: Object.fromEntries(Object.entries(m.rezIds as Record<string, string[]>).map(([k, v]) => [k, [...v].sort()])), unholdable: m.unholdable };
      }
      case 'holdingRezIds':
        return Object.fromEntries(Object.entries(t.holdingRezIds(s) as Record<string, string[]>).map(([k, v]) => [k, [...v].sort()]));
      case 'lineFloor':
        return t.lineFloor(s, q.args[0]);
    }
  });
}
const same = (a: unknown, b: unknown) => JSON.stringify(a, (_, v) => (typeof v === 'number' && !Number.isFinite(v) ? `#${v}` : v)) === JSON.stringify(b, (_, v) => (typeof v === 'number' && !Number.isFinite(v) ? `#${v}` : v));

// ---------------------------------------------------------------------------------------------------- the oracle
function subsets<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let m = 0; m < 1 << xs.length; m++) out.push(xs.filter((_, i) => m & (1 << i)));
  return out.sort((a, b) => b.length - a.length);
}
const setKey = (ids: string[]) => [...ids].sort().join(',');
const key = (a: unknown) => JSON.stringify(a);
/** The rez sets the count enumerates (hold-baseline's affordableSets). */
function affordable(s: GameState, server: string, opts: any): string[][] {
  const sv = s.corp.servers[server];
  if (!sv) return [[]];
  const credits = opts.corpCredits ?? s.corp.credits;
  if (opts.when === 'runnerTurn') {
    const open = sv.ice.slice(0, 10).filter(c => !c.isRezzed);
    return subsets(open).filter(set => set.reduce((n, c) => n + rezCostOf(s, c), 0) <= credits).map(set => set.map(c => c.instanceId));
  }
  const run = s.activeRun;
  const pos = opts.from ?? run?.icePosition ?? null;
  if (!run || pos === null) return [[]];
  const must = sv.ice.filter(c => opts.mustRez?.includes(c.instanceId));
  const base = must.reduce((n, c) => n + rezCostOf(s, c), 0);
  const open = (opts.further ?? true) ? sv.ice.slice(0, pos).filter(c => !c.isRezzed).slice(0, 10) : [];
  return subsets(open)
    .map(set => ({ ids: [...must, ...set].map(c => c.instanceId), cost: base + set.reduce((n, c) => n + rezCostOf(s, c), 0) }))
    .filter(x => x.cost - base <= Math.max(0, credits - base) || x.ids.length === must.length)
    .map(x => x.ids);
}
type V = 'getsIn' | 'holds' | 'unknown' | 'skipped';
/** The truth for a hold question: does some set hold, and the oracle's verdict on each set asked. */
function truthOf(s: GameState, server: string, when: 'runnerTurn' | 'thisRun', corpCredits: number | undefined, first: string[][], all: string[][]) {
  const verdict = new Map<string, V>();
  let work = 0;
  let truth: boolean | null = null;
  let unknown = 0;
  const order = [...first, ...all.filter(x => !first.some(f => setKey(f) === setKey(x)))];
  let tried = 0;
  for (const ids of order) {
    if (verdict.has(setKey(ids))) continue;
    if (++tried > MAX_SETS + first.length || work >= QCAP) {
      unknown++;
      break;
    }
    const a = oracle(s, { when, targets: [server], rez: new Set(ids), corpCredits, cap: CAP, retries: when === 'runnerTurn' });
    work += a.work;
    const v: V = a.skipped ? 'skipped' : a.reached === null ? 'unknown' : a.reached >= 1 ? 'getsIn' : 'holds';
    verdict.set(setKey(ids), v);
    if (v === 'skipped') return { truth: null, verdict, work, skipped: a.skipped };
    if (v === 'unknown') unknown++;
    if (v === 'holds') {
      truth = true;
      break;
    }
  }
  if (truth === null && unknown === 0) truth = false;
  return { truth, verdict, work };
}

type Truth = ReturnType<typeof truthOf>;
/** Per staked server, its truth (rezMoney and holdingRezIds: the next Runner turn, the Corp's money unbounded). */
type Judged = { one: Truth } | { per: Record<string, Truth>; next: GameState | null } | null;
/** A server's hold answer against its truth: holds (with its set) or not. */
function holdRight(holds: boolean, rez: string[] | null, t: Truth): string | null {
  if (t.truth === null) return null;
  if (holds !== t.truth) return holds ? 'false holds' : 'false does not hold';
  if (holds && rez && t.verdict.get(setKey(rez)) === 'getsIn') return 'right verdict, its set gets in';
  return 'right';
}
/** Right or which wrong, for one tree's answer (null: no truth). Per-server answers: the worst server's, the servers listed. */
function correctness(q: Question, a: any, j: Judged): string | null {
  if (!j) return null;
  if ('one' in j) {
    const t = j.one;
    if (t.truth === null) return null;
    if (q.reader === 'runStands') {
      if (a === null) return 'no walk';
      const out = a.verdict === 'out';
      return out === t.truth ? 'right' : out ? 'false out' : 'false in';
    }
    return holdRight(a.holds, a.rez, t);
  }
  // rezMoney: byServer / rezIds / unholdable; holdingRezIds: rezIds only (a server left out does not hold)
  const rezIds: Record<string, string[]> = q.reader === 'rezMoney' ? a.rezIds : a;
  const per = Object.entries(j.per).map(([sv, t]) => [sv, holdRight(sv in rezIds, rezIds[sv] ?? null, t)] as const);
  // rezMoney's cost of a holding set, against the set's rez cost on the oracle's next-turn board (a run's own rez cost
  // change ends with the run, 6.9.6d); read even where the oracle left the hold undecided (its cap)
  let wrongCost: string[] = [];
  if (q.reader === 'rezMoney' && j.next) {
    const next = j.next;
    wrongCost = Object.keys(j.per).filter(sv => sv in a.byServer && a.byServer[sv] !== a.rezIds[sv].reduce((n: number, id: string) => n + rezCostOf(next, next.corp.servers[sv].ice.find(c => c.instanceId === id)!), 0));
  }
  if (per.some(([, r]) => r === null)) {
    if (q.reader !== 'rezMoney' || !j.next) return null;
    return wrongCost.length ? `wrong rez cost, hold undecided (${wrongCost.join(',')})` : 'right cost, hold undecided';
  }
  if (wrongCost.length && per.every(([, r]) => r === 'right')) return `wrong rez cost (${wrongCost.join(',')})`;
  for (const bad of ['false holds', 'false does not hold']) {
    const xs = per.filter(([, r]) => r === bad).map(([sv]) => sv);
    if (xs.length) return `${bad} (${xs.join(',')})`;
  }
  return per.some(([, r]) => r !== 'right') ? 'right verdict, its set gets in' : 'right';
}
function transition(before: string | null, after: string | null): string {
  if (before === null || after === null) return 'not decidable';
  const rb = before.startsWith('right');
  const ra = after.startsWith('right');
  if (rb && ra) return before === after ? 'other answer, both right' : `right: ${before} -> ${after}`;
  if (!rb && ra) return `${before.replace(/ \(.*\)$/, '')} fixed`;
  if (rb && !ra) return `${after.replace(/ \(.*\)$/, '')} made`;
  return before === after ? `still ${before}` : `${before} -> ${after}`;
}

function judge(q: Question, answers: any[]): Judged {
  const s = q.state;
  if (q.reader === 'serverHold') {
    const [server, opts] = q.args;
    if (opts.when === 'restOfTurn') return null;
    const first = answers.flatMap((a: any) => (a?.holds && a.rez ? [a.rez] : []));
    return { one: truthOf(s, server, opts.when, opts.corpCredits, first, affordable(s, server, opts)) };
  }
  if (q.reader === 'runStands') {
    // The rez sets the stand's gathered questions list (HEAD's key)
    const r = head.asCorp(s, () => original.runStands(s, q.args[0]));
    if (!r || r.key === 'in' || r.key === 'out') return null;
    const qs = JSON.parse(r.key) as { sets: { up: string[] }[]; none: boolean }[];
    const sets = qs.flatMap(x => x.sets.map(y => y.up));
    if (!sets.length) sets.push([]);
    return { one: truthOf(s, q.args[0], 'thisRun', undefined, [], sets) };
  }
  // rezMoney's next-turn forms and holdingRezIds: each staked server whose answer changed between trees, as serverHold
  // 'runnerTurn' with the Corp's money unbounded (the oracle moves the board to the Corp's end of turn: the run is over)
  if ((q.reader === 'rezMoney' && q.when !== 'restOfTurn') || q.reader === 'holdingRezIds') {
    const ids = (a: any): Record<string, string[]> => (q.reader === 'rezMoney' ? a.rezIds : a);
    const servers = new Set<string>();
    for (const a of answers) for (const sv of [...Object.keys(ids(a)), ...(q.reader === 'rezMoney' ? a.unholdable : [])]) servers.add(sv);
    const cost = (a: any, sv: string) => (q.reader === 'rezMoney' ? (a.byServer[sv] ?? null) : null);
    const differs = [...servers].filter(sv => answers.some(a => key(ids(a)[sv] ?? null) !== key(ids(answers[0])[sv] ?? null) || cost(a, sv) !== cost(answers[0], sv)));
    // Only the keep moved (the reach, not a server's hold): not decidable here
    if (!differs.length) return null;
    const opts = { when: 'runnerTurn', corpCredits: Infinity };
    const start = oracleStart(s, { when: 'runnerTurn', targets: differs, rez: new Set(), corpCredits: Infinity });
    return { next: 'state' in start ? start.state : null, per: Object.fromEntries(differs.map(sv => [sv, truthOf(s, sv, 'runnerTurn', Infinity, answers.flatMap(a => (ids(a)[sv] ? [ids(a)[sv]] : [])), affordable(s, sv, opts))])) };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------- the run
const trees = await loadTrees();
const record: { seed: number }[] = JSON.parse(readFileSync('scripts/stage-d/post-pick-deals.json', 'utf8'));
const wantDeals = (process.env.DEALS ?? '').split(',').filter(Boolean);
const seeds = wantDeals.includes('none') ? [] : wantDeals.length ? wantDeals.map(Number) : record.map(r => r.seed);
const sources: [string, () => void][] = [
  ...seeds.map(seed => [`deal:${seed}`, () => void playDeal(seed, {})] as [string, () => void]),
  ...humanFiles().map(f => [`human:${f.split('/').pop()}`, () => replayHuman(f, {})] as [string, () => void]),
];
const MAXQ = Number(process.env.MAXQ ?? Infinity);
/** The first question asked of a source (with MAXQ, a slice of a long source run apart). */
const QFROM = Number(process.env.QFROM ?? 0);
sources.forEach(([name, play], k) => {
  if (k % shards !== shard) return;
  src = name;
  for (const c of Object.keys(counts)) delete counts[c];
  const t0 = performance.now();
  watching = true;
  play();
  watching = false;
  const batch: (Question | null)[] = queue.slice(QFROM, QFROM + MAXQ);
  const over = queue.length - batch.length;
  queue = [];
  let changed = 0;
  let allAsked = 0;
  const asked = batch.length;
  for (let i = 0; i < batch.length; i++) {
    // Each question's board is let go once asked (the trees' memos hang on it): a long human file ran out of memory
    const q = batch[i]!;
    batch[i] = null;
    try {
      const firstA = answer(trees[0], q);
      const lastA = answer(trees[trees.length - 1], q);
      const differ = !same(firstA, lastA);
      const sampleAll = parseInt(q.key.slice(0, 8), 16) / 0xffffffff < SAMPLE_ALL;
      if (!differ && !sampleAll) continue;
      allAsked++;
      const answers = [firstA, ...trees.slice(1, -1).map(t => answer(t, q)), lastA];
      const steps = answers.flatMap((a, i) => (i > 0 && !same(answers[i - 1], a) ? [i] : []));
      if (!steps.length) continue;
      changed++;
      const t = judge(q, answers);
      const right = answers.map(a => correctness(q, a, t));
      const s = q.state;
      const line = {
        kind: 'q',
        src: q.src,
        key: q.key.slice(0, 12),
        reader: q.reader,
        when: q.when,
        args: q.reader === 'serverHold' ? { server: q.args[0], ...q.args[1] } : q.args,
        midRun: q.midRun,
        active: s.activePlayer,
        turn: s.turnNumber,
        phase: s.activeRun?.phase ?? null,
        rig: [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].map(c => c.cardCode),
        truth: !t ? null : 'one' in t ? { holds: t.one.truth, work: t.one.work, skipped: (t.one as any).skipped } : Object.fromEntries(Object.entries(t.per).map(([sv, x]) => [sv, { holds: x.truth, work: x.work, skipped: (x as any).skipped }])),
        changes: steps.map(i => ({ commit: trees[i].name, from: answers[i - 1], to: answers[i], label: transition(right[i - 1], right[i]) })),
        final: transition(right[0], right[right.length - 1]),
      };
      console.log(JSON.stringify(line));
      if (DUMP) {
        mkdirSync(DUMP, { recursive: true });
        writeFileSync(join(DUMP, `${q.key.slice(0, 12)}.json`), JSON.stringify({ line, reader: q.reader, args: q.args, state: s }));
      }
    } catch (e) {
      console.log(JSON.stringify({ kind: 'error', src: q.src, reader: q.reader, error: (e as Error).message }));
    }
  }
  console.log(JSON.stringify({ kind: 'src', src: name, distinct: asked, over, ...(QFROM ? { from: QFROM } : {}), counts: { ...counts }, allAsked, changed, ms: Math.round(performance.now() - t0) }));
});
rmSync(root, { recursive: true, force: true });
