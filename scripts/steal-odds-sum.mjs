// Sums scripts/steal-odds.ts shards: predicted steal chance vs stolen, per Runner turn an agenda sits installed.
import { readFileSync } from 'node:fs';
const all = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, 'utf8').trim().split('\n').pop()));
const pct = x => (100 * x).toFixed(1).padStart(5) + '%';
for (const [part, title] of [['bins', 'by predicted steal chance'], ['byIce', 'by ice on the server (rezzed/total)'], ['byAdvanced', 'by advancement counters (3 = 3+)'], ['hq', 'agendas in HQ (count, 3 = 3+): HQ run / stolen from HQ that turn']]) {
  const sum = {};
  for (const a of all) for (const [k, t] of Object.entries(a[part])) {
    const s = (sum[k] ??= { n: 0, predicted: 0, ran: 0, stolen: 0 });
    for (const f of Object.keys(s)) s[f] += t[f];
  }
  console.log(`\n${part === 'hq' ? 'HQ' : 'Agenda in a remote'}, ${title}:`);
  for (const [k, s] of Object.entries(sum).sort((a, b) => b[1].n - a[1].n)) {
    const pred = part === 'hq' ? '' : ` predicted ${pct(s.predicted / s.n)}`;
    console.log(`  ${k.padEnd(9)} ${String(s.n).padStart(6)} turns:${pred}  ran ${pct(s.ran / s.n)}  stolen ${pct(s.stolen / s.n)}`);
  }
}
