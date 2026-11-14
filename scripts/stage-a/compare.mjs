// Step 4 Stage A, table 8: compares two sets of scripts/stage-a/record.ts outputs, decision by decision.
//   node scripts/stage-a/compare.mjs base-0.tsv base-1.tsv -- head-0.tsv head-1.tsv [--md]
// Prints the count of identical decisions per source kind, every decision that differs (the first per source, with how
// many follow), and the mean Corp decision time on each side.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const md = args.includes('--md');
const split = args.indexOf('--');
const [baseFiles, headFiles] = [args.slice(0, split), args.slice(split + 1)].map(a => a.filter(f => !f.startsWith('--')));
const load = files => {
  const out = new Map();
  for (const f of files)
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const [src, i, kind, turn, action, ms] = line.split('\t');
      out.set(`${src}\t${i}`, { src, i: Number(i), kind, turn, action, ms: Number(ms) });
    }
  return out;
};
const base = load(baseFiles);
const head = load(headFiles);
const bySrc = new Map();
let same = 0;
let diff = 0;
const firsts = [];
for (const [key, b] of base) {
  const h = head.get(key);
  const k = b.src.split(':')[0];
  const row = bySrc.get(k) ?? { decisions: 0, identical: 0, sources: new Set(), differing: new Set() };
  row.decisions++;
  row.sources.add(b.src);
  if (h && h.action === b.action && h.kind === b.kind) {
    same++;
    row.identical++;
  } else {
    diff++;
    if (!row.differing.has(b.src)) firsts.push({ src: b.src, i: b.i, turn: b.turn, kind: b.kind, base: b.action, head: h?.action ?? '(none)' });
    row.differing.add(b.src);
  }
  bySrc.set(k, row);
}
const extra = [...head.keys()].filter(k => !base.has(k)).length;
const mean = m => [...m.values()].reduce((a, r) => a + r.ms, 0) / Math.max(1, m.size);
const p95 = m => {
  const v = [...m.values()].map(r => r.ms).sort((a, b) => a - b);
  return v[Math.floor(0.95 * (v.length - 1))] ?? 0;
};
const bar = md ? '|' : ' ';
console.log(md ? '| Source | Sources | Decisions | Identical | Sources differing |\n|---|---|---|---|---|' : 'source sources decisions identical differing');
for (const [k, r] of bySrc) console.log(`${bar} ${k} ${bar} ${r.sources.size} ${bar} ${r.decisions} ${bar} ${r.identical} ${bar} ${r.differing.size} ${bar}`);
console.log(`\nAll: ${same} of ${same + diff} decisions identical; ${extra} decisions only on the head side.`);
console.log(`Corp decision ms: base mean ${mean(base).toFixed(1)} p95 ${p95(base).toFixed(1)}; head mean ${mean(head).toFixed(1)} p95 ${p95(head).toFixed(1)} (ratio ${(mean(head) / Math.max(1e-9, mean(base))).toFixed(3)})`);
for (const f of firsts) console.log(`DIFF ${f.src} #${f.i} T${f.turn} ${f.kind}\n  base ${f.base}\n  head ${f.head}`);
