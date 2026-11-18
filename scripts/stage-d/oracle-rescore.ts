/**
 * Stage D item 1 follow-up 4, step 1.1 (brief section 2.1): comparison 44200015527 re-scored with the oracle's three
 * faults fixed (found-list row 56; hold-oracle.ts: B a breach under "cannot steal or trash" is not getting in, D the
 * Corp's unlimited credits set after the turn ends, E no Runner action that moves a grip card onto the table).
 *
 * Input: the boards that run dumped (hold-baseline.ts COMPARE=1 writes every flip and every disagreement to OUT_DIR;
 * agreements are not dumped, so they cannot be re-asked: a fault only ever pushed the oracle toward "gets in", so of
 * them only an agreement on "does not hold" can turn, into a false "does not hold" for both counts; the fresh
 * comparison of this follow-up, runner-money.ts, measures beta's count from scratch). The tarball is read from the
 * ai-batch-results branch (`scripts/<RUN>.tar.gz`, fetched on the runner) or from DUMPS=<dir> (its out/files).
 *
 * Each board is asked again as hold-baseline judged it (judgeBoth: the whole turn's truth with retries, the walk's set
 * and beta's set first, then every other affordable set, largest first, until one holds; CAP per ask, QCAP per question
 * as 44200015527: 40,000 and 20,000) and both counts are labelled against the new truth. One JSON line per board with
 * the old and new labels; sum with oracle-rescore-sum.mjs.
 *
 *   SHARD=0/64 RUN=44200015527 npx vite-node scripts/stage-d/oracle-rescore.ts
 *   DUMPS=/tmp/r/out/files ONLY_KEY=02548ce76cd1 npx vite-node scripts/stage-d/oracle-rescore.ts
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GameState, cardDef, rezCostOf } from '../../src/core';
import { oracle } from './hold-oracle';

for (const kv of (process.env.ARGS ?? '').split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const RUN = process.env.RUN ?? '44200015527';
const CAP = Number(process.env.CAP ?? 40_000);
const QCAP = Number(process.env.QCAP ?? 20_000);
const MAX_SETS = Number(process.env.MAX_SETS ?? 16);

interface Brief { holds: boolean; rez: string[] | null }
interface Dump { line: Record<string, unknown> & { count: Brief; old: Brief; label: string; oldLabel: string; oracle: { holds: boolean | null } }; server: string; opts: { when: 'runnerTurn' | 'thisRun'; corpCredits?: number | null; from?: number; mustRez?: string[]; further?: boolean }; state: GameState }

function dumpDir(): string {
  if (process.env.DUMPS) return process.env.DUMPS;
  const dir = resolve('.rescore', String(shard));
  const files = join(dir, 'out', 'files');
  if (existsSync(files)) return files;
  mkdirSync(dir, { recursive: true });
  // Four processes share a runner's checkout: each fetches until the branch is there
  for (let k = 0; ; k++) {
    try {
      execSync(`git show origin/ai-batch-results:scripts/${RUN}.tar.gz > ${join(dir, 'run.tar.gz')}`, { stdio: 'ignore', shell: '/bin/bash' });
      break;
    } catch {
      if (k >= 10) throw new Error('oracle-rescore: could not read the tarball');
      try {
        execSync('git fetch -q --depth=1 origin ai-batch-results:refs/remotes/origin/ai-batch-results', { stdio: 'ignore' });
      } catch {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 + Math.floor(Math.random() * 1500));
      }
    }
  }
  execSync(`tar -xzf run.tar.gz`, { cwd: dir });
  return files;
}

const dir = dumpDir();
const all = readdirSync(dir).flatMap(d => readdirSync(join(dir, d)).filter(f => f.endsWith('.json')).map(f => join(dir, d, f))).sort();
const mine = all.filter((f, i) => i % shards === shard && (!process.env.ONLY_KEY || f.includes(process.env.ONLY_KEY)));

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
function subsets<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let m = 0; m < 1 << xs.length; m++) out.push(xs.filter((_, i) => m & (1 << i)));
  return out.sort((a, b) => b.length - a.length);
}
/** hold-baseline.ts affordableSets, the same rules. */
function affordableSets(s: GameState, server: string, opts: Dump['opts'], corpCredits: number | undefined): string[][] {
  const sv = s.corp.servers[server];
  if (!sv) return [[]];
  const credits = corpCredits ?? s.corp.credits;
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

for (const file of mine) {
  const d: Dump = JSON.parse(readFileSync(file, 'utf8'));
  const t0 = performance.now();
  // JSON wrote the unlimited budget (holdingRez's Infinity) as null
  const corpCredits = d.opts.corpCredits === null ? Infinity : d.opts.corpCredits;
  const { count, old } = d.line;
  const first = [count.holds && count.rez ? count.rez : null, old.holds && old.rez ? old.rez : null].filter((x): x is string[] => !!x);
  const order = [...first.filter((x, i) => i === 0 || !sameSet(x, first[0])), ...affordableSets(d.state, d.server, d.opts, corpCredits).filter(x => !first.some(f => sameSet(f, x)))];
  const verdict = new Map<string, string>();
  let truth: boolean | null = null;
  let unknown = 0;
  let skipped: string | undefined;
  let work = 0;
  let tried = 0;
  let holdingSet: string[] | null = null;
  for (const ids of order) {
    if (++tried > MAX_SETS + first.length || work >= QCAP) {
      unknown++;
      break;
    }
    const a = oracle(d.state, { when: d.opts.when, targets: [d.server], rez: new Set(ids), corpCredits, cap: Math.min(CAP, QCAP - work), retries: true });
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
      holdingSet = ids;
      break;
    }
  }
  if (truth === null && !skipped && unknown === 0) truth = false;
  const labelOf = (c: Brief): string => {
    if (skipped) return 'skipped';
    if (c.holds && c.rez && verdict.get([...c.rez].sort().join(',')) === 'holds') return 'agree';
    if (truth === null) return 'unknown';
    if (c.holds === truth) return c.holds ? 'agree, other set' : 'agree';
    return c.holds ? 'false holds' : 'false does not hold';
  };
  const s = d.state;
  const rig = [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].map(c => cardDef(c).title);
  console.log(
    JSON.stringify({
      key: file.split('/').pop()!.replace('.json', ''),
      src: d.line.src,
      when: d.opts.when,
      server: d.server,
      turn: s.turnNumber,
      flip: d.line.flip,
      ice: d.line.ice,
      rig,
      ansel: (s.corp.servers[d.server]?.ice ?? []).some(c => cardDef(c).title === 'Ansel 1.0'),
      before: { truth: d.line.oracle.holds, label: d.line.label, oldLabel: d.line.oldLabel },
      after: { truth, set: holdingSet, unknown, skipped, label: labelOf(count), oldLabel: labelOf(old) },
      count: { holds: count.holds, rez: count.rez },
      old: { holds: old.holds, rez: old.rez },
      work,
      ms: Math.round(performance.now() - t0),
    }),
  );
}
