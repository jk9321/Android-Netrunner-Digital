// Sums scripts/steal-odds.ts shards: predicted steal chance vs stolen, per Runner turn an agenda sits installed.
import { readFileSync } from 'node:fs';
const all = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, 'utf8').trim().split('\n').pop()));
const pct = x => (100 * x).toFixed(1).padStart(5) + '%';
for (const [part, title] of [['bins', 'by predicted steal chance'], ['byIce', 'by ice on the server (rezzed/total)'], ['byAdvanced', 'by advancement counters (3 = 3+)'], ['hq', 'agendas in HQ (count, 3 = 3+): HQ run / stolen from HQ that turn']]) {
  const sum = {};
  for (const a of all) for (const [k, t] of Object.entries(a[part])) {
    const s = (sum[k] ??= { n: 0, predicted: 0, ran: 0, stolen: 0, guesses: {} });
    for (const f of ['n', 'predicted', 'ran', 'stolen']) s[f] += t[f];
    for (const [g, p] of Object.entries(t.guesses ?? {})) s.guesses[g] = (s.guesses[g] ?? 0) + p;
  }
  console.log(`\n${part === 'hq' ? 'HQ' : 'Agenda in a remote'}, ${title}:`);
  for (const [k, s] of Object.entries(sum).sort((a, b) => b[1].n - a[1].n)) {
    const pred = part === 'hq' ? '' : ` predicted ${pct(s.predicted / s.n)}`;
    const guesses = part === 'byIce' ? '  ' + Object.entries(s.guesses).map(([g, p]) => `${g} ${pct(p / s.n)}`).join(' ') : '';
    console.log(`  ${k.padEnd(9)} ${String(s.n).padStart(6)} turns:${pred}  ran ${pct(s.ran / s.n)}  stolen ${pct(s.stolen / s.n)}${guesses}`);
  }
}
const turns = all.reduce((n, a) => n + Object.values(a.bins).reduce((m, t) => m + t.n, 0), 0);
const brier = {};
for (const a of all) for (const [g, b] of Object.entries(a.brier ?? {})) brier[g] = (brier[g] ?? 0) + b;
console.log(`\nBrier score per agenda turn (lower is better): ${Object.entries(brier).map(([g, b]) => `${g} ${(b / turns).toFixed(4)}`).join(', ')}`);
