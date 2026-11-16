// V-B B5 (AI Coordinator's ruling 5): time and tag-clock work per arm and side, on all decisions and on games whose
// Runner holds one of the six cards (or Vic for the vic arm). STOP: mean above 1.05x or p95 above 1.15x of base.
//   node scripts/value-b5/time-sum.mjs <files or dirs of scripts/value-b1/fire-count.ts output>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).forEach(f => walk(join(p, f))) : /\.(txt|jsonl)$/.test(p) && files.push(p));
process.argv.slice(2).forEach(walk);
const rows = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{"src"')).map(l => JSON.parse(l)));
const ARMS = Object.keys(rows[0]?.ms ?? {});
const SIX = ['34003', '34007', '34008', '34073', '34074', '36013'];
const sets = {
  all: () => true,
  six: r => (r.flags ?? []).some(c => SIX.includes(c)),
  vic: r => (r.flags ?? []).includes('36009'),
};
const stat = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return { mean: s.reduce((a, b) => a + b, 0) / Math.max(1, s.length), p95: s[Math.floor(0.95 * (s.length - 1))] ?? 0 };
};
let stop = false;
for (const [name, keep] of Object.entries(sets)) for (const side of ['corp', 'runner']) {
  const rs = rows.filter(r => r.side === side && keep(r));
  const games = new Set(rs.map(r => r.src)).size;
  console.log(`\n${name} / ${side}: ${rs.length} decisions in ${games} sources, changed ${rs.filter(r => r.changed).length}`);
  const b = stat(rs.map(r => r.ms.base));
  for (const arm of ARMS) {
    const t = stat(rs.map(r => r.ms[arm]));
    const tl = v => stat(rs.map(r => r.tl?.[arm]?.[v] ?? 0)).mean;
    const m = t.mean / b.mean, p = t.p95 / b.p95;
    const flag = arm !== 'base' && rs.length && (m > 1.05 || p > 1.15);
    if (flag) stop = true;
    console.log(`  ${arm}: mean ${t.mean.toFixed(1)} ms (x${m.toFixed(3)}), p95 ${t.p95.toFixed(1)} (x${p.toFixed(3)}); tag clock per decision: corp view ${tl('corp').toFixed(2)}, runner view ${tl('runner').toFixed(2)}${flag ? '  <- STOP' : ''}`);
  }
}
console.log(`\n${stop ? 'STOP: a time ratio is over its line (mean 1.05x, p95 1.15x)' : 'no time stop'}`);
