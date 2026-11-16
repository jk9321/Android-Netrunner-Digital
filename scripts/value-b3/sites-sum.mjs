// V-B B3 on (ruling 6a): sums the `sites` field of scripts/value-b1/fire-count.ts output. Per site, over every decision:
// root values both trees asked on the same board with the same arguments, how many differ, the largest difference, how
// many are over 2x or 10 credits, and the worst example. A site the step does not touch that differs needs a reason
// (it reads a touched owner); a touched site's moves over 2x or 10 credits need a copy that explains them.
//   node scripts/value-b3/sites-sum.mjs <files or dirs...> [--touched=a,b,c]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const args = process.argv.slice(2);
const touched = new Set((args.find(a => a.startsWith('--touched='))?.slice(10) ?? '').split(',').filter(Boolean));
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).forEach(f => walk(join(p, f))) : /\.(txt|jsonl)$/.test(p) && files.push(p));
args.filter(a => !a.startsWith('--')).forEach(walk);
const rows = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{"src"')).map(l => JSON.parse(l)));
const sum = {};
for (const r of rows)
  for (const [site, [n, d, max, over, ex]] of Object.entries(r.sites ?? {})) {
    const s = (sum[site] ??= { n: 0, d: 0, max: 0, over: 0, decisions: 0, ex: '' });
    s.n += n;
    s.d += d;
    s.over += over;
    if (d) s.decisions++;
    if (max > s.max) [s.max, s.ex] = [max, `${r.src} #${r.i} ${r.side}: ${ex}`];
  }
const line = ([site, s]) => `| ${site}${touched.has(site) ? ' (touched)' : ''} | ${s.n} | ${s.d} | ${s.decisions} | ${s.max} | ${s.over} | ${s.d ? s.ex.replace(/,undefined/g, '').replace(/\|/g, '/') : ''} |`;
console.log(`${rows.length} decisions; root values asked by both trees on the same board, per site\n`);
console.log('| site | compared | differ | decisions | largest |d| | over 2x or 10 | worst |\n|---|--:|--:|--:|--:|--:|---|');
for (const e of Object.entries(sum).sort((a, b) => b[1].d - a[1].d || b[1].n - a[1].n)) console.log(line(e));
