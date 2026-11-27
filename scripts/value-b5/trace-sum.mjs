// B5 caller trace: sums of scripts/value-b5/trace.ts. node scripts/value-b5/trace-sum.mjs <files>
import { readFileSync } from 'node:fs';
const T = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{"kind":"trace"')).map(l => JSON.parse(l)));
const add = (field, keep = () => true) => { const o = {}; for (const r of T) for (const [k, v] of Object.entries(r[field] ?? {})) if (keep(k)) o[k] = (o[k] ?? 0) + v; return o; };
const top = (o, n = 30) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `  ${String(v).padStart(6)}  ${k}`).join('\n');
const n = add('n');
console.log(`# B5 caller trace: ${T.length} games (${T.map(r => r.seed).join(', ')}), ${T.reduce((a, r) => a + r.decisions, 0)} decisions; by kind ${JSON.stringify(n)}`);
const prices = add('prices');
console.log('\n## Runner-view clock prices per decision, base -> branch, by caller kind (B5 = a stack through one of the six formulas)');
for (const k of Object.keys(n).sort()) {
  const g = (tree, b5, where) => Object.entries(prices).filter(([x]) => x.startsWith(`${tree} ${k} runner `) && (!b5 || x.includes(` ${b5} `)) && (!where || x.endsWith(where))).reduce((a, [, v]) => a + v, 0);
  const d = n[k];
  if (!g('base') && !g('branch')) continue;
  console.log(`  ${k} (${d}): base ${(g('base') / d).toFixed(1)} -> branch ${(g('branch') / d).toFixed(1)}; branch B5 ${(g('branch', 'b5') / d).toFixed(1)} (new board ${(g('branch', 'b5', 'new') / d).toFixed(1)}, same object other frame ${(g('branch', 'b5', 'sameObjOtherFrame') / d).toFixed(1)}, same content other object ${(g('branch', 'b5', 'sameContentOtherObj') / d).toFixed(1)}); branch other ${(g('branch', 'other') / d).toFixed(1)}`);
}
console.log('\n## All prices (tree kind view b5|other where)\n' + top(prices, 40));
console.log('\n## B5 prices by card (branch, Runner view)\n' + top(add('byCard'), 40));
console.log('\n## B5: the frame above the formula\n' + top(add('firstAbove'), 15));
console.log('\n## B5: caller chains (formula upward, 7 deep)\n' + top(add('chains'), 30));
console.log('\n## Exactness: the earlier price of the same board (what a narrower key would serve) against this price\n' + top(add('exact'), 40));
console.log('\n## Where a same-object price differs: frame key before -> now (branch)\n' + top(add('frameDiffs'), 12));
