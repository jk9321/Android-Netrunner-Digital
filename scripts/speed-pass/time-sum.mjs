// Speed pass bar 3 (brief rev 1): time by caller kind from a core-lockstep / f117 lockstep run with TIMES=1.
// Per shard (one out/*.txt file), each kind's time in the branch and the control tree against the base; then the
// per-shard mean ± SE of (tree / base - 1) over the shards, and the pooled ratio over all deals.
//   node scripts/speed-pass/time-sum.mjs <dir with out/*.txt>
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.argv[2], 'out');
const shards = [];
const pooled = {};
let deals = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith('.txt'))) {
  const sums = {};
  for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.kind !== 'deal' || !o.kinds) continue;
    deals++;
    for (const [tree, ks] of Object.entries(o.kinds))
      for (const [k, v] of Object.entries(ks)) {
        ((sums[k] ??= {})[tree] = (sums[k]?.[tree] ?? 0) + v.ms);
        ((pooled[k] ??= {})[tree] = (pooled[k]?.[tree] ?? 0) + v.ms);
      }
  }
  if (Object.keys(sums).length) shards.push(sums);
}
const stat = xs => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
  return [m, sd / Math.sqrt(xs.length)];
};
const pc = ([m, se]) => `${(m * 100).toFixed(1)}% ± ${(se * 100).toFixed(1)}`;
console.log(`deals ${deals}, shards ${shards.length}`);
console.log('| kind | base s | branch vs base (shard mean ± SE) | control vs base | pooled branch | pooled control |\n|---|---|---|---|---|---|');
for (const k of Object.keys(pooled).sort((a, b) => pooled[b].base - pooled[a].base)) {
  const rows = shards.filter(s => s[k]?.base > 0);
  const b = stat(rows.map(s => s[k].branch / s[k].base - 1));
  const c = stat(rows.map(s => s[k].control / s[k].base - 1));
  const p = pooled[k];
  console.log(`| ${k} | ${(p.base / 1000).toFixed(0)} | ${pc(b)} | ${pc(c)} | ${((p.branch / p.base - 1) * 100).toFixed(1)}% | ${((p.control / p.base - 1) * 100).toFixed(1)}% |`);
}
