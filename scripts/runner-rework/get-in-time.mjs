// Runner rework R0 count 3, step 0: the timed sample. Reads get-in.ts output (JSON lines, any number of files) and
// prints the script time per measured Runner turn by part and source kind, and the decision time per tree.
//   node scripts/runner-rework/get-in-time.mjs out/*.jsonl
import { readFileSync } from 'node:fs';

const rows = process.argv
  .slice(2)
  .flatMap(f => readFileSync(f, 'utf8').split('\n'))
  .filter(l => l.startsWith('{'))
  .map(l => JSON.parse(l));
const kindOf = src => (src.startsWith('deal:') ? 'self' : null);
const skOf = new Map();
for (const r of rows) if (r.kind === 'h') skOf.set(r.src, r.sk);
const sk = src => kindOf(src) ?? skOf.get(src) ?? '?';

const by = {};
for (const s of rows.filter(r => r.kind === 's')) {
  const k = sk(s.src);
  const b = (by[k] ??= { sources: 0, turns: 0, qs: 0, ms: 0, t: {} });
  b.sources++;
  b.turns += s.turns;
  b.qs += s.qs;
  b.ms += s.ms;
  for (const [p, v] of Object.entries(s.timing)) b.t[p] = (b.t[p] ?? 0) + v;
}
const games = rows.filter(r => r.kind === 'g');
const allTurns = rows.filter(r => r.kind === 'turn');
console.log('source games:', games.map(g => `${g.src} match=${g.matchesBatch} T=${g.T}`).join('; '));
for (const [k, b] of Object.entries(by)) {
  const ownTurns = allTurns.filter(t => sk(t.src) === k).length;
  console.log(`\n== ${k}: ${b.sources} sources, ${b.turns} measured Runner turns (of ${ownTurns} recorded), ${b.qs} decisions, ${(b.ms / 1000).toFixed(0)} s wall`);
  const per = v => (v / Math.max(1, b.turns) / 1000).toFixed(2);
  for (const [p, v] of Object.entries(b.t).sort()) console.log(`  ${p.padEnd(18)} ${(v / 1000).toFixed(1).padStart(8)} s  ${per(v).padStart(7)} s/turn`);
}
// decision time per tree (mean, p95) over planned decisions
const qs = rows.filter(r => r.kind === 'q');
const trees = [...new Set(qs.flatMap(q => Object.keys(q.res)))];
console.log('\n== decision ms per tree (all decisions / planned only): mean, p95, max; picks changed vs control');
for (const t of trees) {
  const all = qs.map(q => q.res[t]?.ms).filter(x => x != null).sort((a, b) => a - b);
  const pl = qs.filter(q => q.res[t]?.planned).map(q => q.res[t].ms).sort((a, b) => a - b);
  const st = a => (a.length ? `${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(0)} / ${a[Math.floor(0.95 * (a.length - 1))]} / ${a[a.length - 1]}` : '-');
  const ch = qs.filter(q => q.res[t] && q.res[t].a !== q.res.control.a).length;
  console.log(`  ${t.padEnd(16)} n=${all.length} all ${st(all)}   planned n=${pl.length} ${st(pl)}   changed ${ch}`);
}
const cs = rows.filter(r => r.kind === 'c');
console.log(`\ncontinuation pairs: ${cs.length}`);
