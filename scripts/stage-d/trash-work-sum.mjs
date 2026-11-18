// Record of the parked trash count (work-cap-note.md section 2): sums the trash-work probe's shard files; run in the unpacked artifact's folder (reads out/).
import { readdirSync, readFileSync } from 'node:fs';
const rows = readdirSync('out').filter(f => f.endsWith('.txt')).flatMap(f => readFileSync('out/' + f, 'utf8').split('\n').filter(l => l.startsWith('{"src"')).map(l => JSON.parse(l)));
const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
console.log('rows', rows.length, 'corp', rows.filter(r => r.side === 'corp').length);
for (const tree of ['base', 'all', 'branch']) {
  const rs = rows.filter(r => r.tl?.[tree]);
  const work = rs.map(r => r.tl[tree].work ?? 0).sort((a, b) => a - b);
  const wmax = rs.map(r => r.tl[tree].wmaxms ?? 0).sort((a, b) => a - b);
  const top = rs.map(r => ({ r, w: r.tl[tree].work ?? 0, m: r.tl[tree].wmaxms ?? 0 })).sort((a, b) => b.w - a.w).slice(0, 6);
  console.log(`${tree}: ${rs.length} decisions; total work p50 ${q(work, .5)} p99 ${q(work, .99)} p999 ${q(work, .999)} max ${work.at(-1)}; largest walk p50 ${q(wmax, .5)} p99 ${q(wmax, .99)} p999 ${q(wmax, .999)} max ${wmax.at(-1)}`);
  for (const { r, w, m } of top) console.log(`   ${r.src} #${r.i} ${r.side} T${r.T}: work ${w}, largest ${m}, ms ${r.ms[tree]}`);
  const topm = rs.map(r => ({ r, m: r.tl[tree].wmaxms ?? 0 })).sort((a, b) => b.m - a.m).slice(0, 4);
  for (const { r, m } of topm) console.log(`   largest: ${r.src} #${r.i} ${r.side} T${r.T}: ${m}, work ${r.tl[tree].work}, ms ${r.ms[tree]}`);
}
