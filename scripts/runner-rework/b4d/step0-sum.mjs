// B4d step 0 sum (brief b4d-rb-fixes.md rev 2): reads the JSON lines of b4/lockstep.ts CHAIN=... PICKS=1 FOLLOW=1
// FRUITLESS=1 (one pair per fix commit) from every .txt under a folder and prints, per pair: deals, record matches, first
// differences, the changed picks by side | kind (the Corp's apart: a Corp pick that changes is the look-ahead's or the
// reply's), value-only differences, the reader fires, the fruitless remote runs (base game) and the time by tree.
//   node scripts/runner-rework/b4d/step0-sum.mjs <folder>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const files = [];
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.txt')) files.push(p); } };
walk(dir);
const P = {};
const get = pair => (P[pair] ??= { deals: 0, recordSame: 0, diffs: [], changed: {}, same: {}, fires: {}, fruit: { runs: 0, nothing: 0, nothingChanged: 0, ex: [] }, errors: [], ms: { base: {}, branch: {}, control: {} }, changedEx: [] });
const add = (o, k, n = 1) => (o[k] = (o[k] ?? 0) + n);
for (const f of files)
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let x;
    try { x = JSON.parse(line); } catch { continue; }
    const p = get(x.pair ?? 'none');
    if (x.kind === 'error') p.errors.push(`${x.seed ?? ''} ${String(x.error).slice(0, 200)}`);
    if (x.kind === 'time') for (const t of ['base', 'branch', 'control']) for (const [k, v] of Object.entries(x.ms?.[t] ?? {})) add(p.ms[t], k, v);
    if (x.kind !== 'deal') continue;
    p.deals++;
    if (x.recordSame) p.recordSame++;
    if (x.diff) p.diffs.push({ seed: x.seed, ...x.diff });
    for (const c of x.changed ?? []) {
      add(p.changed, `${c.side}|${c.kind}`);
      if (p.changedEx.length < 12) p.changedEx.push({ seed: x.seed, T: c.T, side: c.side, kind: c.kind, fires: c.firesAt, picks: c.picks });
    }
    for (const c of x.same ?? []) add(p.same, `${c.side}|${c.kind}`);
    for (const [k, v] of Object.entries(x.fires ?? {})) add(p.fires, k, v);
    for (const r of x.fruit ?? []) {
      p.fruit.runs++;
      if (!r.gained) {
        p.fruit.nothing++;
        if (r.changed) p.fruit.nothingChanged++;
        if (p.fruit.ex.length < 6) p.fruit.ex.push(`${x.seed} T${r.T} ${r.server}`);
      }
    }
  }
const pct = (a, b) => (b ? `${(((a - b) / b) * 100).toFixed(1)}%` : 'n/a');
for (const [pair, p] of Object.entries(P)) {
  console.log(`\n## pair ${pair}: ${p.deals} deals, ${p.recordSame} match the batch record, ${p.diffs.length} first differences, ${p.errors.length} errors`);
  console.log(`changed picks: ${JSON.stringify(p.changed)}`);
  console.log(`value-only differences (same pick): ${JSON.stringify(p.same)}`);
  console.log(`fires: ${JSON.stringify(p.fires)}`);
  console.log(`fruitless remote runs on a fully known root (base game): ${p.fruit.nothing} of ${p.fruit.runs} such runs; at a changed pick ${p.fruit.nothingChanged}; e.g. ${p.fruit.ex.join(', ')}`);
  for (const t of ['branch', 'control']) console.log(`time ${t} vs base: ${Object.keys(p.ms.base).sort().map(k => `${k} ${pct(p.ms[t][k] ?? 0, p.ms.base[k])}`).join(', ')}`);
  for (const d of p.diffs.slice(0, 6)) console.log(`  diff ${JSON.stringify(d).slice(0, 300)}`);
  for (const c of p.changedEx) console.log(`  changed ${JSON.stringify(c).slice(0, 300)}`);
  for (const e of p.errors.slice(0, 4)) console.log(`  error ${e}`);
}
