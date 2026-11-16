// Sum scripts/step-s/arm-time.ts output: per family, total time vs base (ratio), mean/p95/max ms. Usage: node arm-time-sum.mjs files...
import { readFileSync } from 'node:fs';
const rows = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const stat = xs => { const s = [...xs].sort((a, b) => a - b); const sum = s.reduce((a, b) => a + b, 0); return { sum, mean: sum / s.length, p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] }; };
const base = stat(rows.map(r => r.base));
console.log(`${rows.length} Corp decisions; base mean ${base.mean.toFixed(0)} ms, p95 ${base.p95} ms, max ${base.max} ms`);
console.log('| family | total vs base | mean ms | p95 ms | max ms |\n|---|---|---|---|---|');
for (const f of Object.keys(rows[0]?.ms ?? {})) {
  const s = stat(rows.map(r => r.ms[f]));
  console.log(`| ${f} | ${(s.sum / base.sum).toFixed(2)}x | ${s.mean.toFixed(0)} | ${s.p95} | ${s.max} |`);
}
