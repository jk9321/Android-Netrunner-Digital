// Sums scripts/card-usage.ts shards and prints the cards the AI holds while it could play them.
//   node scripts/card-usage-sum.mjs out/*.json   (MIN=<turns> sets the least turns playable shown, default 15)
import { readFileSync } from 'node:fs';

const titles = {};
for (const set of ['system-gateway', 'elevation', 'vantage-point', 'liberation']) {
  const raw = JSON.parse(readFileSync(`src/data/${set}-cards.json`, 'utf8'));
  for (const c of Array.isArray(raw) ? raw : raw.data ?? Object.values(raw)) if (c?.code) titles[c.code] = { title: c.title, side: c.side_code, type: c.type_code, set };
}
let games = 0, corpWins = 0, crashed = 0;
const held = {};
for (const file of process.argv.slice(2)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    const j = JSON.parse(line);
    games += j.games; corpWins += j.corpWins; crashed += j.crashed;
    for (const [code, v] of Object.entries(j.held)) { const h = (held[code] ??= [0, 0, 0]); v.forEach((x, i) => (h[i] += x)); }
  }
}
const min = Number(process.env.MIN ?? 15);
const pct = x => `${(100 * x).toFixed(0)}%`.padStart(4);
const rows = Object.entries(held)
  .map(([code, [t, h, hc]]) => ({ code, ...(titles[code] ?? { title: code, side: '?', type: '?', set: '?' }), t, h, hc }))
  .filter(r => r.t >= min)
  .sort((a, b) => b.hc / b.t - a.hc / a.t);
console.log(`${games} games: Corp ${(100 * corpWins / Math.max(1, games)).toFixed(1)}%${crashed ? `, ${crashed} crashed` : ''}`);
console.log(`Cards playable on at least ${min} turns, most held while clicking for credits first.`);
console.log('"held" = still unplayed at the end of a turn it started playable; "held, clicked for credit" = of those, the turns the side clicked for a credit.');
console.log('Traps and upgrades waiting for their moment are expected high; anything else over about 30% needs a look.\n');
console.log(`${'side'.padEnd(7)}${'set'.padEnd(15)}${'type'.padEnd(10)}${'card'.padEnd(40)}${'playable'.padStart(9)}${'held'.padStart(6)}  held, clicked for credit`);
for (const r of rows) console.log(`${r.side.padEnd(7)}${r.set.padEnd(15)}${r.type.padEnd(10)}${`${r.title} (${r.code})`.slice(0, 39).padEnd(40)}${String(r.t).padStart(9)}${pct(r.h / r.t).padStart(6)}  ${pct(r.hc / r.t)}`);
