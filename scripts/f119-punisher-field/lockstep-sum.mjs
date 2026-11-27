// F119-S bars (b) and (c): the sum of scripts/f119-punisher-field/lockstep.ts's shards.
//   node scripts/f119-punisher-field/lockstep-sum.mjs <dir or files...>
// Bar (b): every deal played to its end with no step where leg, base and control differ (a stop names the step), and the
// base's record against the g1 base run (recordSame, reported). Bar (c): time per caller kind, leg against base, with
// control against base as the noise of the same run; within 5% passes.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = process.argv.slice(2).flatMap(p => (statSync(p).isDirectory() ? walk(p) : [p]));
function walk(d) {
  return readdirSync(d).flatMap(f => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(txt|log|out|jsonl)$/.test(f) || !f.includes('.') ? [p] : [];
  });
}
const deals = [];
const errors = [];
const shards = new Set();
for (const f of files)
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const at = line.indexOf('{"kind":');
    if (at < 0) continue;
    let x;
    try {
      x = JSON.parse(line.slice(at));
    } catch {
      continue;
    }
    if (x.kind === 'deal') deals.push(x);
    else if (x.kind === 'error') errors.push(x);
    else if (x.kind === 's') shards.add(x.shard);
  }
const byPool = {};
for (const d of deals) (byPool[d.pool] ??= []).push(d);
console.log(`shards done ${shards.size}; deals ${deals.length}; errors ${errors.length}`);
for (const [pool, ds] of Object.entries(byPool)) {
  const stops = ds.filter(d => d.stop);
  console.log(`${pool}: deals ${ds.length}, stops ${stops.length} (leg ${stops.filter(d => d.stop.legDiffers).length}, control ${stops.filter(d => d.stop.controlDiffers).length}), recordSame ${ds.filter(d => d.recordSame).length}/${ds.length}, decisions ${ds.reduce((n, d) => n + d.decisions, 0)}, inner Runner answers ${ds.reduce((n, d) => n + d.inner, 0)}`);
  for (const d of stops) console.log(`  STOP seed ${d.seed} step ${d.stop.step} T${d.stop.T} ${d.stop.side}:${d.stop.kind} tags ${d.stop.tags} leg ${d.stop.leg.act} | base ${d.stop.base.act}`);
}
for (const e of errors) console.log(`  ERROR ${e.pool} ${e.seed}: ${e.error.split('\n')[0]}`);
const time = { leg: {}, base: {}, control: {} };
for (const d of deals) for (const t of Object.keys(time)) for (const [k, v] of Object.entries(d.ms[t] ?? {})) if (!k.startsWith('n ')) time[t][k] = (time[t][k] ?? 0) + v;
const n = {};
for (const d of deals) for (const [k, v] of Object.entries(d.ms.leg ?? {})) if (k.startsWith('n ')) n[k.slice(2)] = (n[k.slice(2)] ?? 0) + v;
console.log('\ntime per caller kind (ms total; leg/base and control/base)');
const kinds = Object.keys(time.base).sort();
let worst = 0;
for (const k of kinds) {
  const lb = time.leg[k] / time.base[k];
  const cb = time.control[k] / time.base[k];
  if (time.base[k] > 1000) worst = Math.max(worst, Math.abs(lb - 1));
  console.log(`  ${k.padEnd(14)} n ${String(n[k] ?? 0).padStart(7)}  base ${Math.round(time.base[k]).toString().padStart(9)}  leg/base ${lb.toFixed(3)}  control/base ${cb.toFixed(3)}`);
}
const tot = t => Object.values(time[t]).reduce((a, b) => a + b, 0);
console.log(`  all            leg/base ${(tot('leg') / tot('base')).toFixed(3)}  control/base ${(tot('control') / tot('base')).toFixed(3)}`);
console.log(`\nbar (b): ${deals.some(d => d.stop) || errors.length ? 'STOP' : 'pass'} (0 first differences on ${deals.length} deals)`);
console.log(`bar (c): largest |leg/base - 1| over kinds with > 1 s of base time ${(worst * 100).toFixed(1)}% (within 5% passes)`);
