// ai-value-time: compares two sets of scripts/value-time/record.ts outputs decision by decision, and reports decision
// time per side (mean, p95, max) on each.   node scripts/value-time/compare.mjs base-*.tsv -- head-*.tsv
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const split = args.indexOf('--');
const load = files => {
  const out = new Map();
  for (const f of files)
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const [src, side, i, kind, turn, action, ms] = line.split('\t');
      out.set(`${src}\t${side}\t${i}`, { src, side, kind, turn, action, ms: Number(ms) });
    }
  return out;
};
const base = load(args.slice(0, split));
const head = load(args.slice(split + 1));
let same = 0;
const diffs = [];
for (const [key, b] of base) {
  const h = head.get(key);
  if (h && h.action === b.action && h.kind === b.kind) same++;
  else diffs.push(`${key}\tturn ${b.turn}\tbase ${b.action}\thead ${h?.action ?? '(none)'}`);
}
console.log(`decisions identical: ${same} of ${base.size} (head has ${head.size})`);
for (const d of diffs.slice(0, 20)) console.log('DIFF ' + d);
const stats = (m, side) => {
  const xs = [...m.values()].filter(r => r.side === side).map(r => r.ms).sort((a, b) => a - b);
  const sum = xs.reduce((a, b) => a + b, 0);
  return { n: xs.length, mean: sum / xs.length, p95: xs[Math.floor(0.95 * (xs.length - 1))], max: xs[xs.length - 1], total: sum };
};
for (const side of ['corp', 'runner']) {
  const b = stats(base, side);
  const h = stats(head, side);
  const f = x => x.toFixed(1);
  console.log(`${side}: base mean ${f(b.mean)} p95 ${f(b.p95)} max ${f(b.max)} total ${f(b.total / 1000)} s | head mean ${f(h.mean)} p95 ${f(h.p95)} max ${f(h.max)} total ${f(h.total / 1000)} s | ratio ${(h.total / b.total).toFixed(3)} (n ${b.n}/${h.n})`);
}
