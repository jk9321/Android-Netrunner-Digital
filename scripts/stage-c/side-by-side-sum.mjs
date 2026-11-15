// Stage C3: sums scripts/stage-c/side-by-side.ts output (JSON lines in any number of files).
//   node scripts/stage-c/side-by-side-sum.mjs out/*.txt
import { readFileSync } from 'node:fs';

const rows = [];
for (const f of process.argv.slice(2)) for (const line of readFileSync(f, 'utf8').split('\n')) if (line.startsWith('{"src"')) rows.push(JSON.parse(line));
const JEFF = /report-(4[89]|5[0-4])\.json/;
const stat = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const q = p => s[Math.floor(p * (s.length - 1))] ?? 0;
  return { n: s.length, mean: s.reduce((a, b) => a + b, 0) / Math.max(1, s.length), p95: q(0.95), max: s[s.length - 1] ?? 0 };
};
const group = (label, rs) => {
  const same = rs.filter(r => r.old === r.new).length;
  const card = rs.filter(r => r.old !== r.new && r.sameCard).length;
  const o = stat(rs.map(r => r.msOld));
  const n = stat(rs.map(r => r.msNew));
  console.log(`${label}: ${rs.length} decisions; same move ${same} (${((100 * same) / Math.max(1, rs.length)).toFixed(1)}%); same card at another server ${card}; another move ${rs.length - same - card}`);
  console.log(`  time ms old mean ${o.mean.toFixed(0)} p95 ${o.p95} max ${o.max}; new mean ${n.mean.toFixed(0)} p95 ${n.p95} max ${n.max}; ratio mean ${(n.mean / o.mean).toFixed(3)} p95 ${(n.p95 / o.p95).toFixed(3)} max ${(n.max / o.max).toFixed(3)}`);
  const byKind = {};
  for (const r of rs) if (r.old !== r.new) { const k = `${r.old.split(' ')[0]} -> ${r.new.split(' ')[0]}`; byKind[k] = (byKind[k] ?? 0) + 1; }
  console.log('  changed, by move type: ' + Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join('; '));
};
group('local deals', rows.filter(r => r.src.startsWith('deal:')));
group('human games', rows.filter(r => r.src.startsWith('human:')));
group('all', rows);
const slow = [...rows].sort((a, b) => Math.max(b.msOld, b.msNew) - Math.max(a.msOld, a.msNew)).slice(0, 8);
console.log('slowest: ' + slow.map(r => `${r.src} T${r.T} c${r.clicks} old ${r.msOld} new ${r.msNew}`).join('; '));
console.log("\nJeff's games #48 to #54, every decision that changes:");
for (const r of rows.filter(r => JEFF.test(r.src) && r.old !== r.new).sort((a, b) => a.src.localeCompare(b.src) || a.i - b.i))
  console.log(`  ${r.src.replace('human:', '')} #${r.i} T${r.T} (${r.clicks} clicks, $${r.credits}): old ${r.old}; new ${r.new}`);
