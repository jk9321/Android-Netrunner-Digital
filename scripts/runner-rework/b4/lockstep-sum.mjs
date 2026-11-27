// Sums a b4 lockstep.ts run: node scripts/runner-rework/b4/lockstep-sum.mjs <dir with out/*.txt> [--list]
// With CHAIN, each pair apart. Deals, first differences (by side and kind, by the reader hook that fired at them), the first knowledge difference
// (kn), deals whose base tree left its source record, errors, and time by caller kind: branch and control against base.
// With CHECK=1 (R-105): the upkeep-skip check's compared skips by walk and its failures, per pool.
// With PICKS=1 (bar 3): every Corp decision that differs (same pick or not) by part: the Hard determinize (H fired), the
// reply's Runner (a Runner reader fired inside the Corp's decision), neither (what fired, if anything); and for CONT=1 the
// paired continuations of the changed Corp picks (branch's pick against base's, Corp wins and points, with SE).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const list = process.argv.includes('--list');
const out = join(dir, 'out');
const deals = [];
let errs = 0;
const errLines = new Map();
for (const f of readdirSync(out).filter(f => /\.(txt|err)$/.test(f))) {
  const text = readFileSync(join(out, f), 'utf8');
  if (f.endsWith('.err')) {
    for (const l of text.split('\n').filter(l => /error|Error|throw/.test(l))) errLines.set(l.slice(0, 160), (errLines.get(l.slice(0, 160)) ?? 0) + 1);
    continue;
  }
  for (const l of text.split('\n')) {
    if (!l.startsWith('{')) continue;
    try {
      const j = JSON.parse(l);
      if (j.kind === 'deal') deals.push(j);
      if (j.kind === 'error') errs++;
    } catch {
      /* a cut line */
    }
  }
}
const by = (xs, key) => xs.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map());
const fired = f => (Array.isArray(f) ? f : Object.keys(f ?? {})).join('+') || 'none';
const show = m => [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
const pairs = [...new Set(deals.map(d => d.pair))];
for (const [pair, pool] of pairs.flatMap(p => [...new Set(deals.filter(d => d.pair === p).map(d => d.pool))].map(pool => [p, pool]))) {
  const ds = deals.filter(d => d.pool === pool && d.pair === pair);
  if (pair !== undefined) console.log(`== ${pair}`);
  const diff = ds.filter(d => d.diff);
  console.log(`${pool}: ${ds.length} deals, ${diff.length} with a first difference, ${ds.filter(d => d.kn != null).length} with a knowledge difference, ${ds.filter(d => d.recordSame === false).length} off their record`);
  // CHECK=1 (R-105 bar 2(b)): the branch tree's upkeep-skip check, summed over the pool's deals
  const chk = ds.filter(d => d.check);
  if (chk.length) {
    const sum = {};
    for (const d of chk) for (const [k, v] of Object.entries(d.check.checked)) sum[k] = (sum[k] ?? 0) + v;
    const failed = chk.reduce((a, d) => a + d.check.failures, 0);
    console.log(`  upkeep check (${chk.length} deals): checked ${Object.entries(sum).map(([k, v]) => `${k} ${v}`).join(', ')}; failures ${failed}${failed ? ` (first: ${JSON.stringify(chk.find(d => d.check.failures).check.detail[0]).slice(0, 300)})` : ''}`);
  }
  if (diff.length) {
    console.log(`  by side|kind: ${show(by(diff, d => `${d.diff.side}|${d.diff.kind}`))}`);
    console.log(`  fired at the first difference: ${show(by(diff, d => fired(d.diff.firesAt)))}`);
  }
  const fires = new Map();
  for (const d of ds) for (const [k, n] of Object.entries(d.fires ?? {})) fires.set(k, (fires.get(k) ?? 0) + n);
  if (fires.size) console.log(`  fires (all steps): ${show(fires)}`);
  const ms = {};
  for (const d of ds) for (const [tree, t] of Object.entries(d.ms ?? {})) for (const [k, v] of Object.entries(t)) ((ms[k] ??= {})[tree] = (ms[k]?.[tree] ?? 0) + v);
  for (const [k, t] of Object.entries(ms).sort()) if (t.base) console.log(`  time ${k}: branch ${((t.branch / t.base - 1) * 100).toFixed(1)}%, control ${((t.control / t.base - 1) * 100).toFixed(1)}% (base ${(t.base / 1000).toFixed(0)} s)`);
  if (list) for (const d of diff) console.log(`  ${d.seed} step ${d.diff.step} T${d.diff.T} ${d.diff.side}|${d.diff.kind} branch ${d.diff.branch} control ${d.diff.control} fires ${fired(d.diff.firesAt)}; picks ${d.diff.picks?.base === d.diff.picks?.branch ? 'same' : `${d.diff.picks?.base} / ${d.diff.picks?.branch}`}`);
}
const RUNNER_READERS = /^(a|b|c|d|e|h)\|inside\|corp$/;
const partOf = f => {
  const ks = Object.keys(f ?? {});
  if (ks.some(k => k.startsWith('H|'))) return 'hard';
  if (ks.some(k => RUNNER_READERS.test(k))) return 'reply';
  return `neither (${ks.filter(k => !k.startsWith('H|')).join('+') || 'none'})`;
};
const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const se = xs => (xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean(xs)) ** 2, 0) / (xs.length - 1) / xs.length) : 0);
if (deals.some(d => d.same)) {
  const rows = [];
  for (const d of deals) {
    for (const x of d.same ?? []) if (x.side === 'corp') rows.push({ d, x, changed: false });
    for (const x of d.changed ?? []) if (x.side === 'corp') rows.push({ d, x, changed: true });
    if (!d.changed && d.diff?.side === 'corp' && !d.diff.control) rows.push({ d, x: d.diff, changed: d.diff.picks?.base !== d.diff.picks?.branch });
  }
  const runnerChanged = deals.flatMap(d => (d.changed ?? []).filter(x => x.side === 'runner'));
  if (deals.some(d => d.changed)) console.log(`Runner picks that differ (forced to base's in FOLLOW): ${runnerChanged.length}, by kind: ${show(by(runnerChanged, x => x.kind))}`);
  console.log(`bar 3, Corp decisions that differ: ${rows.length} (${rows.filter(r => r.changed).length} with a changed pick)`);
  for (const [part, n] of by(rows, r => partOf(r.x.firesAt))) {
    const ch = rows.filter(r => partOf(r.x.firesAt) === part && r.changed);
    const cont = ch.filter(r => r.x.contBase && r.x.contBranch && !r.x.contBase.error && !r.x.contBranch.error);
    const win = cont.map(r => (r.x.contBranch.winner === 'corp') - (r.x.contBase.winner === 'corp'));
    const pts = cont.map(r => r.x.contBranch.corpPts - r.x.contBase.corpPts - (r.x.contBranch.runnerPts - r.x.contBase.runnerPts));
    console.log(`  ${part}: ${n} differ, ${ch.length} picks changed${cont.length ? `; continuations ${cont.length} (replayed ${cont.filter(r => r.x.contBase.replayed).length}): Corp wins branch-base ${mean(win).toFixed(3)} +- ${se(win).toFixed(3)}, Corp-Runner points ${mean(pts).toFixed(2)} +- ${se(pts).toFixed(2)}` : ''}`);
    if (list) for (const r of ch) console.log(`    ${r.d.pool} ${r.d.seed} T${r.x.T} ${r.x.kind}: ${r.x.picks.base} / ${r.x.picks.branch}; base ${JSON.stringify(r.x.contBase)} branch ${JSON.stringify(r.x.contBranch)}`);
  }
}
console.log(`errors: ${errs} error lines; stderr: ${errLines.size ? show(errLines) : 'none'}`);
