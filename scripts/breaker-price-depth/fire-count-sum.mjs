// Sums scripts/breaker-price-depth/fire-count.ts output: node scripts/breaker-price-depth/fire-count-sum.mjs <dir or files...>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).flatMap(f => walk(join(p, f))) : p.endsWith('.txt') ? [p] : []);
const rows = process.argv.slice(2).flatMap(walk).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const games = new Set(rows.map(r => r.src)).size;
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const max = xs => xs.reduce((a, b) => Math.max(a, b), 0);
console.log(`decisions ${rows.length} in ${games} games (deals ${new Set(rows.filter(r => r.src.startsWith('deal:')).map(r => r.src)).size}, human ${new Set(rows.filter(r => r.src.startsWith('human:')).map(r => r.src)).size})`);
const errors = rows.filter(r => String(r.beta ?? '').startsWith('error') || String(r.branch ?? '').startsWith('error'));
console.log(`errors in a pick: ${errors.length}`);
for (const r of errors.slice(0, 10)) console.log('  ERROR', r.src, '#' + r.i, r.side, r.beta, '|', r.branch);
const stops = rows.filter(r => r.changed && r.priced <= 1);
console.log(`STOP check, changed with at most one breaker priced this way: ${stops.length}`);
for (const r of stops.slice(0, 10)) console.log('  STOP', r.src, '#' + r.i, r.side, 'T' + r.T, r.beta, '->', r.branch);
const by = f => rows.filter(f).length;
console.log(`positions by breakers priced this way: 0-1 ${by(r => r.priced <= 1)}, exactly 2 ${by(r => r.priced === 2)}, 3+ ${by(r => r.priced >= 3)} (games with 2+: ${new Set(rows.filter(r => r.priced >= 2).map(r => r.src)).size})`);
for (const side of ['runner', 'corp']) {
  const rs = rows.filter(r => r.side === side);
  const ch = rs.filter(r => r.changed);
  console.log(`\n${side}: ${rs.length} decisions, ${ch.length} changed, ${(ch.length / Math.max(1, games)).toFixed(3)} a game; changed at exactly 2: ${ch.filter(r => r.priced === 2).length}, at 3+: ${ch.filter(r => r.priced >= 3).length}`);
  for (const r of ch) console.log('  ', r.src, '#' + r.i, 'T' + r.T, r.kind, `priced ${r.priced} (hosted ${r.hosted}, grip ${r.grip})`, r.beta, '->', r.branch);
  const b = rs.map(r => r.msBeta), h = rs.map(r => r.msBranch);
  console.log(`  time mean beta ${mean(b).toFixed(1)} ms, branch ${mean(h).toFixed(1)} ms (x${(mean(h) / Math.max(1e-9, mean(b))).toFixed(3)}); p95 ${q(b, 0.95)} vs ${q(h, 0.95)} (x${(q(h, 0.95) / Math.max(1e-9, q(b, 0.95))).toFixed(3)}); max ${max(b)} vs ${max(h)}`);
  const two = rs.filter(r => r.priced >= 2);
  if (two.length) console.log(`  positions with 2+: ${two.length}, mean beta ${mean(two.map(r => r.msBeta)).toFixed(1)} vs branch ${mean(two.map(r => r.msBranch)).toFixed(1)} ms; max ${max(two.map(r => r.msBeta))} vs ${max(two.map(r => r.msBranch))}`);
}
