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
    for (const [code, v] of Object.entries(j.held)) { const h = (held[code] ??= [0, 0, 0, 0, 0, 0, 0, 0]); v.forEach((x, i) => (h[i] = (h[i] ?? 0) + x)); }
  }
}
const min = Number(process.env.MIN ?? 15);
const pct = x => `${(100 * x).toFixed(0)}%`.padStart(4);
const rows = Object.entries(held)
  .map(([code, [t, h, hc, n = 0, nn = 0, size = 0, lost = 0]]) => ({ code, ...(titles[code] ?? { title: code, side: '?', type: '?', set: '?' }), t, h, hc, n, nn, size, lost }))
  .filter(r => r.t >= min)
  .sort((a, b) => (process.env.SORT === 'never' ? b.nn / Math.max(1, b.n) - a.nn / Math.max(1, a.n) : b.hc / b.t - a.hc / a.t));
console.log(`${games} games: Corp ${(100 * corpWins / Math.max(1, games)).toFixed(1)}%${crashed ? `, ${crashed} crashed` : ''}`);
for (const side of ['corp', 'runner']) {
  const all = Object.entries(held).filter(([code]) => titles[code]?.side === side).map(([, v]) => v);
  const t = all.reduce((n, v) => n + v[0], 0);
  const n = all.reduce((x, v) => x + (v[3] ?? 0), 0);
  const sum = i => all.reduce((x, v) => x + (v[i] ?? 0), 0);
  if (n) console.log(`${side}: ${(100 * sum(4) / n).toFixed(0)}% of copies that were ever playable were never played (holding for later is fine; never is the miss): ${(100 * sum(5) / n).toFixed(0)}% discarded to hand size, ${(100 * sum(6) / n).toFixed(0)}% lost to damage or effects, ${(100 * sum(7) / n).toFixed(0)}% still in hand at the end`);
  if (t) console.log(`${side}: held ${(100 * all.reduce((n, v) => n + v[1], 0) / t).toFixed(0)}% of playable card-turns, ${(100 * all.reduce((n, v) => n + v[2], 0) / t).toFixed(0)}% while clicking for credits (the side's baseline)`);
}
console.log(`Cards playable on at least ${min} turns, most held while clicking for credits first.`);
console.log('"held" = still unplayed at the end of a turn it started playable; "held, clicked for credit" = of those, the turns the side clicked for a credit.');
console.log('Traps and upgrades waiting for their moment are expected high; anything else over about 30% needs a look.\n');
console.log(`${'side'.padEnd(7)}${'set'.padEnd(15)}${'type'.padEnd(10)}${'card'.padEnd(40)}${'playable'.padStart(9)}${'held'.padStart(6)}  held, clicked for credit  never played (copies)`);
for (const r of rows) console.log(`${r.side.padEnd(7)}${r.set.padEnd(15)}${r.type.padEnd(10)}${`${r.title} (${r.code})`.slice(0, 39).padEnd(40)}${String(r.t).padStart(9)}${pct(r.h / r.t).padStart(6)}  ${pct(r.hc / r.t)}                     ${r.n ? `${pct(r.nn / r.n)} of ${r.n} (to hand size ${pct(r.size / r.n)}, lost ${pct(r.lost / r.n)})` : '-'}`);
