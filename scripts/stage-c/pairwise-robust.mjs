// Step 4 Stage C, C0: each pair's reading under the three availability conventions of scripts/stage-c/pairwise.ts
// (legal, playable by the ranking, the line's own condition), and the pairs whose reading does not depend on it.
//   node scripts/stage-c/pairwise-robust.mjs pairs-*.json
import { readFileSync } from 'node:fs';
const conv = { legal: 'counts', playable: 'finite', above0: 'positive', condition: 'cond' };
const sum = Object.fromEntries(Object.values(conv).map(k => [k, {}]));
for (const f of process.argv.slice(2)) {
  const o = JSON.parse(readFileSync(f, 'utf8').trim().split('\n').pop());
  for (const k of Object.values(conv)) for (const [p, v] of Object.entries(o[k] ?? {})) sum[k][p] = (sum[k][p] ?? 0) + v;
}
const read = (c, a, b) => {
  const x = c[`${a}>${b}`] ?? 0, y = c[`${b}>${a}`] ?? 0, n = x + y, sh = n ? x / n : 0;
  return { n, sh, w: n >= 20 && sh >= 0.55 ? a : n >= 20 && sh <= 0.45 ? b : null };
};
const L = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const rows = ['| Pair | legal | playable | above 0 | own condition (primary) | Robust |', '|---|---|---|---|---|---|'];
const robust = {};
for (const a of L) for (const b of L) if (a < b) {
  const r = Object.fromEntries(Object.entries(conv).map(([n, k]) => [n, read(sum[k], a, b)]));
  const cell = x => (x.n ? `${x.w ? `${x.w}>${x.w === a ? b : a}` : 'und.'} ${Math.round(100 * x.sh)}% of ${x.n}` : '-');
  const ws = Object.values(r).map(x => x.w).filter(Boolean);
  const rob = r.condition.w && ws.every(w => w === r.condition.w) ? `${r.condition.w} over ${r.condition.w === a ? b : a}` : r.condition.w ? 'primary only, flips' : ws.length && ws.every(w => w === ws[0]) ? `(${ws[0]} over ${ws[0] === a ? b : a}, not primary)` : ws.length ? 'flips' : 'undetermined';
  if (r.condition.w && ws.every(w => w === r.condition.w)) robust[`${a}-${b}`] = r.condition.w;
  rows.push(`| ${a}-${b} | ${cell(r.legal)} | ${cell(r.playable)} | ${cell(r.above0)} | ${cell(r.condition)} | ${rob} |`);
}
console.log(rows.join('\n'));
console.log('\nRobust pairs: ' + Object.entries(robust).map(([p, w]) => `${w} over ${p.split('-').find(x => +x !== w)}`).join(', '));
