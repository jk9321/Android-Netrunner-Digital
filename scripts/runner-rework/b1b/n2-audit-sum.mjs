// Sums n2-audit.ts shard outputs (an ai-script run's out/ folder): play identical per pool, the totals' counts
// summed, the samples merged (five per class), the time of each tree. Usage: node n2-audit-sum.mjs <out dir>
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const files = readdirSync(dir).filter(f => f.endsWith('.txt'));
const pools = {};
const count = {};
const samples = {};
const ms = {};
const errors = [];
let totals = 0;
for (const f of files) {
  for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let x;
    try {
      x = JSON.parse(line);
    } catch {
      continue;
    }
    if (x.kind === 'deal' || x.kind === 'human') {
      const p = (pools[x.pool ?? 'human'] ??= { n: 0, same: 0, differ: [] });
      p.n++;
      const same = x.kind === 'deal' ? !x.diff : x.diffs === 0;
      if (same) p.same++;
      else p.differ.push(x.kind === 'deal' ? `${x.seed}: ${JSON.stringify(x.diff).slice(0, 200)}` : `${x.src}: ${x.diffs} (${JSON.stringify(x.first).slice(0, 200)})`);
      if (x.kind === 'human' && x.stopped) p.stopped = [...(p.stopped ?? []), `${x.src}: ${x.stopped}`];
    } else if (x.kind === 'error') errors.push(`${x.pool} ${x.src}: ${x.error.split('\n')[0]}`);
    else if (x.kind === 'totals') {
      totals++;
      for (const [k, v] of Object.entries(x.count)) count[k] = (count[k] ?? 0) + v;
      for (const [k, v] of Object.entries(x.samples ?? {})) samples[k] = [...(samples[k] ?? []), ...(Array.isArray(v) ? v : [v])].slice(0, 5);
      for (const [k, v] of Object.entries(x.ms ?? {})) ms[k] = (ms[k] ?? 0) + v;
    }
  }
}
console.log(`## Files ${files.length}, totals lines ${totals}, errors ${errors.length}`);
for (const e of errors) console.log(`- error ${e}`);
console.log('\n## Play identical (audit tree against control, every step)');
for (const [k, p] of Object.entries(pools)) {
  console.log(`- ${k}: ${p.same} of ${p.n}`);
  for (const d of p.differ) console.log(`  - differs ${d}`);
  for (const s of p.stopped ?? []) console.log(`  - stopped ${s}`);
}
console.log('\n## Time (ms, summed over shards)');
for (const [k, v] of Object.entries(ms)) console.log(`- ${k}: ${Math.round(v)}`);
if (ms.audit && ms.control) console.log(`- audit / control: ${(ms.audit / ms.control).toFixed(3)}`);
console.log('\n## Counts');
const groups = {};
for (const [k, v] of Object.entries(count).sort()) (groups[k.split('|')[0]] ??= []).push([k, v]);
for (const [g, rows] of Object.entries(groups)) {
  console.log(`\n### ${g}\n| key | count |\n|---|--:|`);
  for (const [k, v] of rows) console.log(`| ${k.split('|').slice(1).join(' / ')} | ${v.toLocaleString('en-US')} |`);
}
console.log('\n## Samples (five per class)');
for (const [k, v] of Object.entries(samples).sort()) console.log(`- ${k}: ${JSON.stringify(v).slice(0, 600)}`);
