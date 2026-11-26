// Sums core-lockstep.ts shard outputs (an ai-script run's out/ folder) for B1b bars 1 and 4: play identical per pool
// (branch and control against base, every column, the value column included), the base against its records, and
// with TIMES=1 the time of each tree by side and kind, Corp decisions over 1 s, and the named entries.
// Usage: node lockstep-sum.mjs <out dir>
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const files = readdirSync(dir).filter(f => f.endsWith('.txt'));
const pools = {};
const errors = [];
const NAMES = ['base', 'branch', 'control'];
const kinds = {};
const named = {};
const over = { base: [0, 0], branch: [0, 0], control: [0, 0] };
const side = { base: {}, branch: {}, control: {} };
const columns = {};
let totals = 0;
const add = (acc, k, ms, n) => {
  const a = (acc[k] ??= { ms: 0, n: 0 });
  a.ms += ms;
  a.n += n;
};
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
      const pool = x.pool ?? 'human';
      const p = (pools[pool] ??= { n: 0, same: 0, record: 0, recordChecked: 0, differ: [], stopped: [] });
      p.n++;
      const same = x.kind === 'deal' ? !x.diff : x.diffs === 0;
      if (same) p.same++;
      else p.differ.push(x.kind === 'deal' ? `${x.seed} step ${x.diff.step} T${x.diff.T} ${x.diff.side} ${x.diff.kind}: branch ${x.diff.branchCols} control ${x.diff.controlCols}` : `${x.src}: ${x.diffs} ${JSON.stringify(x.first).slice(0, 200)}`);
      if (x.recordSame !== null && x.recordSame !== undefined) {
        p.recordChecked++;
        if (x.recordSame) p.record++;
      }
      if (x.stopped) p.stopped.push(`${x.src}: ${x.stopped}`);
      for (const [c, v] of Object.entries(x.counts ?? {})) columns[c] = (columns[c] ?? 0) + v;
      for (const n of NAMES) {
        for (const s of ['corp', 'runner']) {
          const list = x.ms?.[n]?.[s] ?? [];
          add(side[n], s, list.reduce((a, b) => a + b, 0), list.length);
        }
      }
      // Corp decisions over 1 s on the base, paired step by step (play is identical, so the lists line up)
      const cb = x.ms?.base?.corp ?? [];
      for (let i = 0; i < cb.length; i++) {
        if (!(cb[i] > 1000)) continue;
        for (const n of NAMES) {
          over[n][0] += x.ms?.[n]?.corp?.[i] ?? 0;
          over[n][1]++;
        }
      }
      for (const n of NAMES) {
        for (const [k, v] of Object.entries(x.kinds?.[n] ?? {})) add((kinds[n] ??= {}), k, v.ms, v.n);
        for (const [k, v] of Object.entries(x.named?.[n] ?? {})) add((named[n] ??= {}), k, v.ms, v.n);
      }
    } else if (x.kind === 'error') errors.push(`${x.pool} ${x.src}: ${String(x.error).split('\n')[0]}`);
    else if (x.kind === 'totals') totals++;
  }
}
const pct = (a, b) => (b ? `${(((a - b) / b) * 100).toFixed(1)}%` : '-');
console.log(`## Files ${files.length}, totals lines ${totals}, errors ${errors.length}`);
for (const e of errors) console.log(`- error ${e}`);
console.log('\n## Play identical (branch and control against base, every column)');
for (const [k, p] of Object.entries(pools)) {
  console.log(`- ${k}: ${p.same} of ${p.n}${p.recordChecked ? `; base equal to its record (winner, cr, sc) ${p.record} of ${p.recordChecked}` : ''}`);
  for (const d of p.differ) console.log(`  - differs ${d}`);
  for (const s of p.stopped) console.log(`  - stopped ${s}`);
}
console.log('\n## Records compared (base tree, all pools)');
console.log('| column | records |\n|---|--:|');
for (const [c, v] of Object.entries(columns)) console.log(`| ${c} | ${v.toLocaleString('en-US')} |`);
const table = (title, acc) => {
  const keys = [...new Set(NAMES.flatMap(n => Object.keys(acc[n] ?? {})))].sort();
  if (!keys.length) return;
  console.log(`\n## ${title}\n| | n | base ms | branch ms | control ms | branch vs base | control vs base |\n|---|--:|--:|--:|--:|--:|--:|`);
  for (const k of keys) {
    const [b, r, c] = NAMES.map(n => acc[n]?.[k] ?? { ms: 0, n: 0 });
    console.log(`| ${k} | ${b.n.toLocaleString('en-US')} | ${Math.round(b.ms).toLocaleString('en-US')} | ${Math.round(r.ms).toLocaleString('en-US')} | ${Math.round(c.ms).toLocaleString('en-US')} | ${pct(r.ms, b.ms)} | ${pct(c.ms, b.ms)} |`);
  }
};
table('Time by side (every decision step)', side);
table('Time by side and kind (TIMES=1)', kinds);
table('Named entries, outermost call (TIMES=1)', named);
console.log('\n## Corp decisions over 1 s on the base, the same steps in each tree');
for (const n of NAMES) console.log(`- ${n}: ${over[n][1]} steps, ${Math.round(over[n][0]).toLocaleString('en-US')} ms`);
console.log(`- branch vs base ${pct(over.branch[0], over.base[0])}, control vs base ${pct(over.control[0], over.base[0])}`);
