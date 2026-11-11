// Sums scripts/rez-look.ts output (one JSON line per deal or report): per measure, firings per 100 games, points
// stolen on the flagged runs, the Corp's win rate in games with a firing against all games, and 3 examples each.
//   node scripts/rez-look-sum.mjs out-*.jsonl
import { readFileSync } from 'node:fs';
// Ice with an End the run subroutine (card text), for M3's split: paid through in credits, passed for no credits
// (clicks, a bypass), or ice whose toll is in another currency (damage, tags, a trashed card)
const etr = new Set();
for (const f of ['system-gateway', 'elevation', 'vantage-point', 'liberation']) {
  const j = JSON.parse(readFileSync(`src/data/${f}-cards.json`, 'utf8'));
  for (const c of Array.isArray(j) ? j : j.data) if (c.type_code === 'ice' && /end the run/i.test(c.stripped_text ?? '')) etr.add(c.title);
}
const rows = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)));
const games = rows.filter(r => r.seed !== undefined);
const n = games.length;
const corpWin = g => (g.length ? (100 * g.filter(r => r.winner === 'corp').length) / g.length : NaN);
const by = new Map();
for (const g of games) for (const h0 of g.hits) {
  // (older output: an M1b with an empty set, and M3 before its central/remote split)
  if (h0.m === 'M1b' && / needing 0$/.test(h0.note)) continue;
  let h = h0.m === 'M3' ? { ...h0, m: ['hq', 'rd', 'archives'].includes(h0.server) ? 'M3 central' : 'M3 remote' } : h0;
  if (h.m.startsWith('M3')) {
    const toll = Number(/toll (\d+)/.exec(h.note)?.[1] ?? 0);
    const ice = h.ice.replace(/ \(\d+\)$/, '');
    h = { ...h, m: `${h.m} ${!etr.has(ice) ? 'no-ETR tax' : toll > 0 ? 'ETR, paid in credits' : 'ETR, no credits'}` };
  }
  const e = by.get(h.m) ?? { hits: 0, stolen: 0, spent: 0, games: new Set(), ex: [] };
  e.spent += Number(/^rez (\d+)/.exec(h.note)?.[1] ?? 0);
  e.hits++;
  // Points once per run: two flagged ice on the same run count the steal once
  const runKey = `${g.seed}:${h.turn}:${h.server}`;
  e.runs ??= new Set();
  if (!e.runs.has(runKey)) e.stolen += h.stolen ?? 0;
  e.runs.add(runKey);
  e.games.add(g.seed);
  if (e.ex.length < 3) e.ex.push(`deal ${g.seed} T${h.turn} ${h.server} ${h.ice}: ${h.note}${h.stolen ? `; stolen ${h.stolen}` : ''}`);
  by.set(h.m, e);
}
console.log(`${n} games (Corp ${corpWin(games).toFixed(1)}%), ${games.reduce((t, g) => t + g.runs, 0)} runs, ${games.reduce((t, g) => t + g.rezWindows, 0)} approached-ice rez windows`);
console.log('| Measure | per 100 games | games | points stolen on those runs | Corp win in those games | rez credits per 100 games |');
console.log('|---|---|---|---|---|---|');
for (const [m, e] of [...by].sort()) {
  const gs = games.filter(g => e.games.has(g.seed));
  console.log(`| ${m} | ${((100 * e.hits) / n).toFixed(1)} | ${e.games.size} | ${e.stolen} | ${corpWin(gs).toFixed(0)}% | ${e.spent ? ((100 * e.spent) / n).toFixed(0) : ''} |`);
}
for (const [m, e] of [...by].sort()) {
  console.log(`\n${m}:`);
  for (const x of e.ex) console.log(`  - ${x}`);
}
