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
  six: r => (r.flags ?? []).some(f => SIX.includes(f.split(':')[0])),
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
// The AI Coordinator (20:13Z): changed decisions by card and zone (which of the six the Runner held where)
const TITLES = { '34003': 'Solidarity Badge', '34007': 'Eru Ayase-Pessoa', '34008': 'Hannah Wheels Pilintra', '34073': 'Arruaceiras Crew', '34074': 'Friend of a Friend', '36013': 'Borrowed Goods' };
for (const side of ['corp', 'runner']) {
  const rs = rows.filter(r => r.side === side);
  const by = {};
  for (const r of rs) for (const f of r.flags ?? []) {
    const [c, z] = f.split(':');
    const e = (by[`${TITLES[c] ?? c} (${z})`] ??= { n: 0, changed: 0 });
    e.n++;
    if (r.changed) e.changed++;
  }
  const none = rs.filter(r => !(r.flags ?? []).length);
  console.log(`\nchanged by card held, ${side} (a decision counts under every card it holds): none held ${none.filter(r => r.changed).length} of ${none.length}`);
  for (const [k, e] of Object.entries(by).sort((a, b) => b[1].changed - a[1].changed)) console.log(`  ${k}: ${e.changed} of ${e.n}`);
}
console.log(`\n${stop ? 'STOP: a time ratio is over its line (mean 1.05x, p95 1.15x)' : 'no time stop'}`);
