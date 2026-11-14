// Sums scripts/run-odds.ts shards: runs by server, the model's pass odds and the real success rate, next to PACE.
//   node scripts/run-odds-sum.mjs out/*.json
import { readFileSync } from 'node:fs';

let games = 0, crashed = 0, turns = 0;
const runs = {}, asked = {};
for (const file of process.argv.slice(2)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    const j = JSON.parse(line);
    games += j.games; crashed += j.crashed; turns += j.turns;
    for (const [k, v] of Object.entries(j.runs)) { const r = (runs[k] ??= [0, 0, 0]); v.forEach((x, i) => (r[i] += x)); }
    for (const [k, v] of Object.entries(j.asked)) { const a = (asked[k] ??= [0, 0]); v.forEach((x, i) => (a[i] += x)); }
  }
}
const total = Object.values(runs).reduce((n, v) => n + v[0], 0);
const PACE = { hq: 0.27, rd: 0.2, archives: 0.15, remote: 0.39 };
console.log(`${games} games${crashed ? `, ${crashed} crashed` : ''}: ${turns} Runner turns, ${total} runs = ${(total / turns).toFixed(2)} a turn (PACE.runs 1.2)`);
console.log('\nserver     runs  share (PACE)   pass odds forecast at the run   succeeded   odds at turn start (every turn)');
for (const k of ['hq', 'rd', 'archives', 'remote']) {
  const [n = 0, odds = 0, ok = 0] = runs[k] ?? [];
  const a = asked[k];
  console.log(`${k.padEnd(9)}${String(n).padStart(6)}  ${(n / total).toFixed(2).padStart(5)} (${PACE[k].toFixed(2)})   ${(odds / Math.max(1, n)).toFixed(2).padStart(26)}   ${(ok / Math.max(1, n)).toFixed(2).padStart(9)}   ${a ? (a[1] / a[0]).toFixed(2).padStart(10) : '-'}`);
}
const ok = Object.values(runs).reduce((n, v) => n + v[2], 0);
console.log(`\nall runs succeeded ${(ok / total).toFixed(2)} (PACE.success 0.8); successful runs a Runner turn ${(ok / turns).toFixed(2)}`);
