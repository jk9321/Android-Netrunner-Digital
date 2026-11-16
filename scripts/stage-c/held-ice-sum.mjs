// Stage C: sums scripts/stage-c/held-ice.ts output (JSON lines in any number of files).
//   node scripts/stage-c/held-ice-sum.mjs out/*.txt
import { readFileSync } from 'node:fs';

const rows = [];
let decisions = 0;
let ice = 0;
for (const f of process.argv.slice(2))
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    const r = JSON.parse(line);
    if (r.summary) {
      decisions += r.decisions;
      ice += r.iceInstalls;
    } else rows.push(r);
  }
const differs = rows.filter(r => r.differs);
console.log(`${decisions} decisions, ${ice} ice installs by the new core, ${rows.length} of them while a line is held, ${differs.length} where rules 2-5 would place it elsewhere`);
const pairs = {};
for (const r of differs) pairs[`${r.made} -> ${r.rules}`] = (pairs[`${r.made} -> ${r.rules}`] ?? 0) + 1;
console.log('| made | rules 2-5 | count |\n|---|---|---|');
for (const [k, n] of Object.entries(pairs).sort((a, b) => b[1] - a[1])) console.log(`| ${k.split(' -> ')[0]} | ${k.split(' -> ')[1]} | ${n} |`);
for (const r of differs.slice(0, 20)) console.log(`  ${r.src} #${r.i} T${r.T} ${r.ice}: ${r.made} (rules: ${r.rules}), line ${r.line}`);
