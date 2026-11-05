// Sums scripts/card-payoff.ts shards: what each installed Runner card got, next to the model's forecast at its install.
//   node scripts/card-payoff-sum.mjs out/*.json   (MIN=<installs> sets the least installs shown, default 10)
import { readFileSync } from 'node:fs';

const titles = {};
for (const set of ['system-gateway', 'elevation', 'vantage-point', 'liberation']) {
  const raw = JSON.parse(readFileSync(`src/data/${set}-cards.json`, 'utf8'));
  for (const c of Array.isArray(raw) ? raw : raw.data ?? Object.values(raw)) if (c?.code) titles[c.code] = { title: c.title, type: c.type_code };
}
let games = 0, crashed = 0;
const payoff = {};
for (const file of process.argv.slice(2)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    const j = JSON.parse(line);
    games += j.games; crashed += j.crashed;
    for (const [code, v] of Object.entries(j.payoff)) { const p = (payoff[code] ??= Array(11).fill(0)); v.forEach((x, i) => (p[i] += x)); }
  }
}
const min = Number(process.env.MIN ?? 10);
const all = Array(11).fill(0);
for (const v of Object.values(payoff)) v.forEach((x, i) => (all[i] += x));
const f = (x, d = 1) => x.toFixed(d).padStart(6);
console.log(`${games} games${crashed ? `, ${crashed} crashed` : ''}: ${all[0]} Runner installs`);
console.log('Per install, forecast (at the install) / actual. "turns" = Runner turns it stayed installed; runs = successful runs while it was.');
console.log(`All installs: turns ${f(all[1] / all[0])} / ${f(all[2] / all[0])}   successful runs ${f(all[3] / all[0])} / ${f(all[4] / all[0])}   HQ ${f(all[5] / all[0])} / ${f(all[6] / all[0])}   R&D ${f(all[7] / all[0])} / ${f(all[8] / all[0])}\n`);
console.log(`${'card'.padEnd(36)}${'type'.padEnd(10)}${'installs'.padStart(9)}  turns f/a     runs f/a      HQ f/a       R&D f/a    credits given  board worth forecast`);
const rows = Object.entries(payoff).filter(([, v]) => v[0] >= min).sort((a, b) => b[1][0] - a[1][0]);
for (const [code, v] of rows) {
  const n = v[0], t = titles[code] ?? { title: code, type: '?' };
  console.log(`${`${t.title} (${code})`.slice(0, 35).padEnd(36)}${t.type.padEnd(10)}${String(n).padStart(9)}  ${f(v[1] / n)}/${f(v[2] / n)}  ${f(v[3] / n)}/${f(v[4] / n)}  ${f(v[5] / n)}/${f(v[6] / n)}  ${f(v[7] / n)}/${f(v[8] / n)}  ${f(v[9] / n)}         ${f(v[10] / n)}`);
}
