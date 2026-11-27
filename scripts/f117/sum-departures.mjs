// F117 departures count summary (ruling-redteam.md "Mercia stop" condition 4, "Departures red team" and "chanceBoards
// deviation" condition 3): reads count.ts MODE=step0 JSONL (out/*.txt) and prints, Corp and Runner apart, time per
// side:kind, prompt rows by bucket (chance departure, chosen departure, arrival, neither) with answers changed by source,
// the chance bucket's time by side and prompt kind, and bar 12's "no arrival and no departure, no change" list.
//   node scripts/f117/sum-departures.mjs <dir with out/*.txt>
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const files = readdirSync(join(dir, 'out')).filter(f => f.endsWith('.txt'));
const time = {};
const buckets = {};
const errors = [];
let deals = 0;
const control = [];
const chanceRows = [];
const add = (m, k, f) => f((m[k] ??= {}));
for (const f of files)
  for (const line of readFileSync(join(dir, 'out', f), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.kind === 'error') errors.push(`${o.pool} ${o.seed}`);
    if (o.kind !== 'deal') continue;
    deals++;
    for (const [tree, kinds] of Object.entries(o.ms ?? {})) for (const [k, v] of Object.entries(kinds)) add(time, k, t => { t[tree] = (t[tree] ?? 0) + v.ms; t.n = (t.n ?? 0) + (tree === 'branch' ? v.n : 0); });
    for (const r of o.rows ?? []) {
      const b = r.departureChance ? 'chance' : r.departurePossible ? 'chosen' : r.arrivalPossible ? 'arrival' : 'neither';
      add(buckets, `${r.side} ${b}`, x => {
        x.rows = (x.rows ?? 0) + 1;
        x.differ = (x.differ ?? 0) + (r.differ ? 1 : 0);
        if (r.differ) (x.src ??= {})[`${r.src} ${r.title ?? ''}`] = ((x.src ??= {})[`${r.src} ${r.title ?? ''}`] ?? 0) + 1;
        if (r.ms) for (const tree of ['base', 'branch']) x[`ms_${tree}`] = (x[`ms_${tree}`] ?? 0) + (r.ms[tree] ?? 0);
        if (b === 'chance' && r.ms) add(x, 'byKind', y => add(y, r.pk, z => { z.n = (z.n ?? 0) + 1; z.base = (z.base ?? 0) + (r.ms.base ?? 0); z.branch = (z.branch ?? 0) + (r.ms.branch ?? 0); }));
      });
      if (b === 'neither' && r.differ) control.push(`${o.pool}:${o.seed}:${r.step} ${r.side} ${r.src} ${r.title ?? ''} (chain ${r.chain ? 'yes' : 'no'})`);
      if (b === 'chance' && r.differ) chanceRows.push(`${o.pool}:${o.seed}:${r.step} T${r.T} ${r.side} ${r.src} ${r.title ?? ''}`);
    }
  }
const r3 = x => Math.round(x * 1000) / 1000;
console.log(`deals ${deals}, errors ${errors.length}${errors.length ? `: ${errors.join(', ')}` : ''}`);
console.log('\n## Time per side:kind (branch / base, decisions)');
for (const [k, t] of Object.entries(time).sort()) console.log(`${k}: base ${Math.round(t.base / 1000)} s, branch ${Math.round(t.branch / 1000)} s, ratio ${r3(t.branch / t.base)}, n ${t.n}`);
console.log('\n## Prompt rows by bucket');
for (const [k, x] of Object.entries(buckets).sort()) {
  console.log(`${k}: rows ${x.rows}, changed ${x.differ}; time base ${Math.round((x.ms_base ?? 0) / 1000)} s, branch ${Math.round((x.ms_branch ?? 0) / 1000)} s (ratio ${r3((x.ms_branch ?? 0) / (x.ms_base || 1))})`);
  for (const [s, n] of Object.entries(x.src ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`    ${n}  ${s}`);
  for (const [pk, z] of Object.entries(x.byKind ?? {})) console.log(`    chance ${pk}: n ${z.n}, base ${Math.round(z.base)} ms, branch ${Math.round(z.branch)} ms, ratio ${r3(z.branch / (z.base || 1))}`);
}
console.log(`\n## Bar 12 control: no arrival, no departure, changed (${control.length})`);
for (const c of control.slice(0, 60)) console.log(`  ${c}`);
console.log(`\n## Chance rows changed (${chanceRows.length})`);
for (const c of chanceRows.slice(0, 80)) console.log(`  ${c}`);
