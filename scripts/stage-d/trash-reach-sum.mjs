// Sums the trash-reach probe (scripts/stage-d/trash-reach.mjs through value-b1/fire-count.ts): per tree (base = every
// change back, as beta; branch), over the Corp decisions, the most distinct trashed sets one walk reached, how the
// decisions spread by that most (p50, p99, max), and the walks that reached more than 4. Also the slowest decisions.
//   node scripts/stage-d/trash-reach-sum.mjs <files or dirs...>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).forEach(f => walk(join(p, f))) : /\.txt$/.test(p) && files.push(p));
process.argv.slice(2).forEach(walk);
const rows = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{"src"')).map(l => JSON.parse(l)));
const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
for (const tree of ['base', 'branch']) {
  const rs = rows.filter(r => r.side === 'corp' && r.tl?.[tree]);
  const most = rs.map(r => Math.max(0, ...Object.keys(r.tl[tree]).filter(k => /^g\d+$/.test(k) && r.tl[tree][k] > 0).map(k => Number(k.slice(1)))));
  const sorted = [...most].sort((a, b) => a - b);
  const over4 = rs.reduce((n, r) => n + (r.tl[tree].g5 ?? 0), 0);
  const decisionsOver4 = most.filter(m => m > 4).length;
  const walks = rs.reduce((n, r) => n + (r.tl[tree].g1 ?? 0), 0);
  console.log(`${tree}: ${rs.length} Corp decisions, ${walks} walks; most trashed sets in one walk: p50 ${q(sorted, 0.5)}, p99 ${q(sorted, 0.99)}, max ${sorted.at(-1)}; walks over 4: ${over4} (in ${decisionsOver4} decisions)`);
  const top = rs.map((r, i) => ({ r, m: most[i] })).sort((a, b) => b.m - a.m).slice(0, 8);
  for (const { r, m } of top) console.log(`  ${r.src} #${r.i} T${r.T}: ${m} sets; base ${r.ms.base} ms, branch ${r.ms.branch} ms`);
}
const slow = rows.filter(r => r.side === 'corp').sort((a, b) => b.ms.branch - a.ms.branch).slice(0, 5);
console.log('slowest Corp decisions on the branch:');
for (const r of slow) console.log(`  ${r.src} #${r.i} T${r.T}: base ${r.ms.base} ms, branch ${r.ms.branch} ms`);
