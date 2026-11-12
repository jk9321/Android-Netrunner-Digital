// Pairs two scripts/money-flow.ts runs on the same seeds: node scripts/money-flow-sum.mjs arm.jsonl base.jsonl
import { readFileSync } from 'node:fs';

const load = f => new Map(readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)).map(d => [d.seed, d]));
const [arm, base] = process.argv.slice(2).map(load);
const pair = (label, f) => {
  const ds = [];
  for (const [seed, a] of arm) {
    const b = base.get(seed);
    const x = b && f(a);
    const y = b && f(b);
    if (x !== undefined && x !== null && y !== undefined && y !== null) ds.push([x, y]);
  }
  const n = ds.length;
  const m = ds.reduce((t, [x, y]) => t + x - y, 0) / n;
  const se = Math.sqrt(ds.reduce((t, [x, y]) => t + (x - y - m) ** 2, 0) / (n - 1) / n);
  const avg = k => (ds.reduce((t, d) => t + d[k], 0) / n).toFixed(2);
  console.log(`  ${label.padEnd(34)} ${avg(0)} vs ${avg(1)}: ${m >= 0 ? '+' : ''}${m.toFixed(2)} ± ${se.toFixed(2)} (n ${n})`);
};
console.log(`${arm.size} deals in the arm, ${base.size} in the base`);
pair('cumulative income by end of T5', d => d.byTurn[4]);
pair('cumulative income by end of T10', d => d.byTurn[9]);
for (const t of [2, 4, 6, 10]) pair(`credits at turn ${t} start`, d => d.start[t - 1]);
pair('ms per Corp step', d => d.ms / Math.max(1, d.corpSteps));
