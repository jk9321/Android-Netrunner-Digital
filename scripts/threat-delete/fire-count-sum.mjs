// Sums scripts/threat-delete/fire-count.ts shard outputs (one JSON line per decision; other lines ignored). Plain JS so
// the ai-script workflow's summary job runs it.   node scripts/threat-delete/fire-count-sum.mjs out/*.txt
import { readFileSync } from 'node:fs';

const rows = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split('\n')).filter(l => l.startsWith('{"src"')).map(l => JSON.parse(l));
const games = new Set(rows.map(r => r.src)).size;
const out = { decisions: rows.length, games, bySide: {}, changed: {}, sorts: {}, differs: {}, ms: {} };
for (const r of rows) {
  const side = r.side;
  out.bySide[side] = (out.bySide[side] ?? 0) + 1;
  if (r.changed) {
    out.changed[side] = (out.changed[side] ?? 0) + 1;
    const k = `${side} ${r.sort}`;
    out.sorts[k] = (out.sorts[k] ?? 0) + 1;
  }
  for (const [arm, d] of Object.entries(r.differs ?? {})) if (d) out.differs[`${side} ${arm}`] = (out.differs[`${side} ${arm}`] ?? 0) + 1;
  for (const [arm, ms] of Object.entries(r.ms)) (out.ms[`${side} ${arm}`] ??= []).push(ms);
}
const p95 = xs => xs.slice().sort((a, b) => a - b)[Math.floor(0.95 * (xs.length - 1))];
for (const [k, xs] of Object.entries(out.ms)) out.ms[k] = { mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1), p95: p95(xs) };
out.perGame = Object.fromEntries(Object.entries(out.changed).map(([side, n]) => [side, +(n / games).toFixed(3)]));
console.log(JSON.stringify(out, null, 1));
const changed = rows.filter(r => r.changed);
if (changed.length) console.log(changed.slice(0, 40).map(r => `${r.src} #${r.i} ${r.side} T${r.T} ${r.kind} ${r.sort}: ${r.ref} -> ${r.branch}`).join('\n'));
