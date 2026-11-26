// Sums a b4 lockstep.ts run: node scripts/runner-rework/b4/lockstep-sum.mjs <dir with out/*.txt> [--list]
// Deals, first differences (by side and kind, by the reader hook that fired at them), the first knowledge difference
// (kn), deals whose base tree left its source record, errors, and time by caller kind: branch and control against base.
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
for (const pool of [...new Set(deals.map(d => d.pool))]) {
  const ds = deals.filter(d => d.pool === pool);
  const diff = ds.filter(d => d.diff);
  console.log(`${pool}: ${ds.length} deals, ${diff.length} with a first difference, ${ds.filter(d => d.kn != null).length} with a knowledge difference, ${ds.filter(d => d.recordSame === false).length} off their record`);
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
console.log(`errors: ${errs} error lines; stderr: ${errLines.size ? show(errLines) : 'none'}`);
