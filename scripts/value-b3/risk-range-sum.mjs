// Adds up scripts/value-b3/risk-range.ts shard lines.   node scripts/value-b3/risk-range-sum.mjs <files or dirs...>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const files = [];
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).forEach(f => walk(join(p, f))) : /\.(txt|jsonl)$/.test(p) && files.push(p));
process.argv.slice(2).forEach(walk);
const t = { boards: 0, riskMin: Infinity, riskMax: -Infinity, riskOverHalf: 0, paid: 0, paidMin: Infinity, paidMax: -Infinity, paidFloored: 0, paidBare: 0 };
for (const f of files)
  for (const l of readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{"riskRange"'))) {
    const r = JSON.parse(l).riskRange;
    for (const k of ['boards', 'riskOverHalf', 'paid', 'paidFloored', 'paidBare']) t[k] += r[k];
    for (const k of ['riskMin', 'paidMin']) t[k] = Math.min(t[k], r[k] ?? Infinity);
    for (const k of ['riskMax', 'paidMax']) t[k] = Math.max(t[k], r[k] ?? -Infinity);
  }
console.log(t);
