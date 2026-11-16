// Stage C7: sums scripts/stage-c/leave-one-out-pins.ts output: the tests that fail under the new core with nothing left
// out, then for each rule left out the tests that fail only then.
//   node scripts/stage-c/leave-one-out-pins-sum.mjs out/*.txt
import { readFileSync } from 'node:fs';

const by = {};
for (const f of process.argv.slice(2))
  for (const line of readFileSync(f, 'utf8').split('\n'))
    if (line.startsWith('{"config"')) {
      const r = JSON.parse(line);
      const c = (by[r.config] ??= { groups: 0, total: 0, failed: [] });
      c.groups++;
      c.total += r.total;
      c.failed.push(...r.failed);
    }
const base = new Set(by.none?.failed ?? []);
console.log(`nothing left out: ${by.none?.total ?? '?'} tests in ${by.none?.groups ?? 0} groups, ${base.size} fail under the new core`);
for (const t of [...base].sort()) console.log(`  ${t}`);
console.log('\n| rule left out | groups | tests | fail only with it out | pass only with it out |');
console.log('|---|---|---|---|---|');
for (const [k, c] of Object.entries(by)) {
  if (k === 'none') continue;
  const set = new Set(c.failed);
  const only = [...set].filter(t => !base.has(t));
  const fixed = [...base].filter(t => !set.has(t));
  console.log(`| ${k} | ${c.groups} | ${c.total} | ${only.length} | ${fixed.length} |`);
  c.only = only;
  c.fixed = fixed;
}
for (const [k, c] of Object.entries(by)) if (c.only?.length || c.fixed?.length) console.log(`\n${k}:\n${c.only.map(t => '  fails: ' + t).join('\n')}${c.fixed.length ? '\n' + c.fixed.map(t => '  passes: ' + t).join('\n') : ''}`);
