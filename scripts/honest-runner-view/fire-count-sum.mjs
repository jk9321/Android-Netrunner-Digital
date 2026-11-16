// Sums scripts/honest-runner-view/fire-count.ts output: node scripts/honest-runner-view/fire-count-sum.mjs <dir or files...>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).flatMap(f => walk(join(p, f))) : p.endsWith('.txt') ? [p] : []);
const files = process.argv.slice(2).flatMap(walk);
const rows = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const games = new Set(rows.map(r => r.src)).size;
const CAUSES = ['ice', 'agenda', 'loose', 'installed', 'pool', 'deal', 'struct'];
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
console.log(`decisions ${rows.length} in ${games} games (deals ${new Set(rows.filter(r => r.src.startsWith('deal:')).map(r => r.src)).size}, human ${new Set(rows.filter(r => r.src.startsWith('human:')).map(r => r.src)).size})`);
const errors = rows.filter(r => String(r.beta ?? '').startsWith('error') || String(r.branch ?? '').startsWith('error'));
console.log(`engine/AI errors in a pick: ${errors.length}`);
for (const r of errors.slice(0, 10)) console.log('  ERROR', r.src, '#' + r.i, r.side, r.beta, '|', r.branch);
for (const side of ['runner', 'corp']) {
  const rs = rows.filter(r => r.side === side);
  const ch = rs.filter(r => r.changed);
  console.log(`\n${side}: ${rs.length} decisions, ${ch.length} changed, ${(ch.length / Math.max(1, games)).toFixed(2)} a game (deals ${ch.filter(r => r.src.startsWith('deal:')).length}, human ${ch.filter(r => r.src.startsWith('human:')).length})`);
  for (const kind of ['main', 'prompt']) {
    const k = rs.filter(r => r.kind === kind);
    if (k.length) console.log(`  ${kind}: ${k.length} decisions, ${k.filter(r => r.changed).length} changed`);
  }
  console.log(`  reproduced alone by: ${CAUSES.map(c => `${c} ${ch.filter(r => r.causes.includes(c)).length}`).join(', ')}`);
  console.log(`  only cause: ${CAUSES.map(c => `${c} ${ch.filter(r => r.causes.length === 1 && r.causes[0] === c).length}`).join(', ')}`);
  console.log(`  goes away without (leave-one-out): ${CAUSES.slice(0, 5).map(c => `${c} ${ch.filter(r => r.needs?.includes(c)).length}`).join(', ')}`);
  const none = ch.filter(r => !r.causes.length);
  console.log(`  reproduced by none: ${none.length}`);
  for (const r of none.slice(0, 15)) console.log('    NONE', r.src, '#' + r.i, 'T' + r.T, r.kind, 'needs', JSON.stringify(r.needs), r.beta, '->', r.branch);
  const b = rs.map(r => r.msBeta), h = rs.map(r => r.msBranch);
  console.log(`  time mean beta ${mean(b).toFixed(1)} ms, branch ${mean(h).toFixed(1)} ms (x${(mean(h) / Math.max(1e-9, mean(b))).toFixed(3)}); p95 ${q(b, 0.95)} vs ${q(h, 0.95)} (x${(q(h, 0.95) / Math.max(1e-9, q(b, 0.95))).toFixed(3)})`);
}
