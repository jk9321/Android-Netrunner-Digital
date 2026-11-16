// Sums scripts/stage-c/playout-tally.ts: node scripts/stage-c/playout-tally-sum.mjs <files...>
import { readFileSync } from 'node:fs';

const add = (a, b) => {
  for (const [k, v] of Object.entries(b)) {
    if (typeof v === 'number') a[k] = (a[k] ?? 0) + v;
    else if (v && typeof v === 'object') add((a[k] ??= {}), v);
  }
  return a;
};
const sum = {};
let shards = 0;
for (const f of process.argv.slice(2))
  for (const l of readFileSync(f, 'utf8').split('\n'))
    if (l.startsWith('{"shard"')) {
      const { shard: _, ...row } = JSON.parse(l);
      add(sum, row);
      shards++;
    }
console.log(JSON.stringify({ shards, ...sum }, null, 1));
