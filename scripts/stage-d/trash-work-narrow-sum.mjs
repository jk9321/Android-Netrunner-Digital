// Record of the parked trash count (work-cap-note.md section 2): sums the trash-work-narrow probe's shard files; run in the unpacked artifact's folder (reads out/).
import { readdirSync, readFileSync } from 'node:fs';
const rows = readdirSync('out').filter(f => f.endsWith('.txt')).flatMap(f => readFileSync('out/' + f, 'utf8').split('\n').filter(l => l.startsWith('{"src"')).map(l => JSON.parse(l)));
const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const kOf = t => Math.max(0, ...Object.keys(t ?? {}).filter(x => /^t\d+$/.test(x) && t[x] > 0).map(x => Number(x.slice(1))));
console.log('rows', rows.length);
for (const tree of ['base', 'all']) {
  const rs = rows.filter(r => r.tl?.[tree]);
  const nw = rs.map(r => r.tl[tree].nwork ?? 0).sort((a, b) => a - b);
  const nm = rs.map(r => r.tl[tree].nwmaxms ?? 0).sort((a, b) => a - b);
  console.log(`${tree}: narrow total p50 ${q(nw, .5)} p99 ${q(nw, .99)} p999 ${q(nw, .999)} max ${nw.at(-1)}; largest trash walk p99 ${q(nm, .99)} max ${nm.at(-1)}`);
  for (const r of rs.map(r => r).sort((a, b) => (b.tl[tree].nwork ?? 0) - (a.tl[tree].nwork ?? 0)).slice(0, 5)) console.log(`   ${r.src} #${r.i} ${r.side} T${r.T}: narrow ${r.tl[tree].nwork}, largest ${r.tl[tree].nwmaxms}, k ${kOf(r.tl[tree])}, ms ${r.ms[tree]}`);
  const ks = {}; for (const r of rs) { const k = kOf(r.tl[tree]); ks[k] = (ks[k] ?? 0) + 1; } console.log('   decisions by most trash ice on one path:', JSON.stringify(ks));
}
const ch = rows.filter(r => r.side === 'corp' && r.changed);
console.log('changed Corp decisions', ch.length, 'causes', JSON.stringify([...new Set(ch.flatMap(r => r.causes))]));
for (const r of ch) console.log(`   ${r.src} #${r.i} T${r.T}: k(branch) ${kOf(r.tl.all)}, k(base) ${kOf(r.tl.base)}, causes ${r.causes}`);
const chr = rows.filter(r => r.side === 'runner' && r.changed).length; console.log('changed Runner decisions', chr);
