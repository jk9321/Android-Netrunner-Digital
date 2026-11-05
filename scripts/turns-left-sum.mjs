// Sums scripts/turns-left.ts shards: the turns each side really had left, by score and by turn, next to turnsLeft's forecast.
//   node scripts/turns-left-sum.mjs out/*.json
import { readFileSync } from 'node:fs';

let games = 0, crashed = 0, unfinished = 0;
const cells = {};
for (const file of process.argv.slice(2)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    const j = JSON.parse(line);
    games += j.games; crashed += j.crashed; unfinished += j.unfinished;
    for (const [k, v] of Object.entries(j.cells)) { const c = (cells[k] ??= [0, 0, 0, 0]); v.forEach((x, i) => (c[i] += x)); }
  }
}
console.log(`${games} finished games${crashed ? `, ${crashed} crashed` : ''}${unfinished ? `, ${unfinished} unfinished (left out)` : ''}`);
const group = (name, keyOf) => {
  const g = {};
  for (const [k, v] of Object.entries(cells)) {
    const [side, corp, runner, own] = k.split('|');
    const key = keyOf({ side, corp: +corp, runner: +runner, own: +own });
    if (key === null) continue;
    const c = (g[key] ??= [0, 0, 0, 0]);
    v.forEach((x, i) => (c[i] += x));
  }
  console.log(`\nBy ${name}: samples, turns really left (mean, sd), turnsLeft forecast (mean)`);
  for (const [key, [n, sum, f, sq]] of Object.entries(g).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    const mean = sum / n;
    console.log(`  ${key.padEnd(24)}${String(n).padStart(7)}  ${mean.toFixed(2).padStart(6)} ±${Math.sqrt(Math.max(0, sq / n - mean * mean)).toFixed(1).padStart(4)}   ${(f / n).toFixed(2).padStart(6)}`);
  }
};
group('side and higher score', c => `${c.side} max ${Math.max(c.corp, c.runner)}`);
group('side and total score', c => `${c.side} total ${c.corp + c.runner}`);
group('side and own turn', c => `${c.side} turn ${String(c.own).padStart(2)}`);
group('side, higher score and own turn (<=12)', c => (c.own <= 12 ? `${c.side} max ${Math.max(c.corp, c.runner)} t${String(c.own).padStart(2)}` : null));
