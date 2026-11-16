// V-B B1: sums scripts/value-b1/fire-count.ts output (one JSON line per decision, any number of files or directories).
//   node scripts/value-b1/fire-count-sum.mjs <files or dirs...>
// Per side: decisions, changed (and per game), split by cache (causes: the cache alone reproduces the change; needs:
// leave-one-out), unexplained (a stop), errors; time per arm (mean, p95, total) on the same decisions, as a ratio to base.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).forEach(f => walk(join(p, f))) : /\.(txt|jsonl)$/.test(p) && files.push(p));
process.argv.slice(2).forEach(walk);
const rows = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{"src"')).map(l => JSON.parse(l)));
const CACHES = Object.keys(rows[0]?.ms ?? {}).filter(k => k !== 'base' && k !== 'branch');
const ARMS = ['base', 'branch', ...CACHES];
const games = new Set(rows.map(r => r.src)).size;
console.log(`${rows.length} decisions in ${games} sources (${files.length} files)`);
for (const side of ['corp', 'runner']) {
  const rs = rows.filter(r => r.side === side);
  const ch = rs.filter(r => r.changed);
  const err = rs.filter(r => String(r.base ?? '').startsWith('error') || String(r.branch ?? '').startsWith('error')).length;
  const unexplained = ch.filter(r => !r.causes.length && !r.needs.length);
  console.log(`\n${side}: ${rs.length} decisions, changed ${ch.length} (${(ch.length / games).toFixed(2)} a game), errors ${err}, unexplained ${unexplained.length}`);
  for (const c of CACHES) console.log(`  ${c}: alone reproduces ${ch.filter(r => r.causes.includes(c)).length}, needed (leave-one-out) ${ch.filter(r => r.needs.includes(c)).length}`);
  const kinds = {};
  for (const r of ch) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
  console.log(`  changed by kind: ${JSON.stringify(kinds)}`);
  for (const r of unexplained.slice(0, 10)) console.log(`  UNEXPLAINED ${r.src} #${r.i} T${r.T} ${r.kind}: base ${r.base} branch ${r.branch}`);
  const stat = arm => {
    const xs = rs.map(r => r.ms[arm]).sort((a, b) => a - b);
    const sum = xs.reduce((a, b) => a + b, 0);
    return { mean: sum / xs.length, p95: xs[Math.floor(0.95 * (xs.length - 1))], sum };
  };
  const b = stat('base');
  for (const arm of ARMS) {
    const s = stat(arm);
    console.log(`  time ${arm}: mean ${s.mean.toFixed(1)} ms, p95 ${s.p95.toFixed(1)}, total ${(s.sum / 1000).toFixed(0)} s, x${(s.sum / b.sum).toFixed(3)} mean, p95 x${(s.p95 / b.p95).toFixed(3)}`);
  }
}
