// Sums race-calibration shard files (the JSON `race-calibration.ts self` prints) and prints its tables. Plain JS so the
// batch workflow's summary job (no npm install) runs it: script=race-calibration finds it by name.
//   node scripts/race-calibration-sum.mjs out/*.json
import { readFileSync } from 'node:fs';

export const fresh = () => ({ games: 0, turns: 0, byScore: {}, byCorpScore: {}, byRate: {}, parts: {}, corp: {} });

export function sum(files) {
  const all = fresh();
  for (const file of files) {
    let s;
    try { s = JSON.parse(readFileSync(file, 'utf8').trim().split('\n').pop()); } catch { continue; }
    if (!s || typeof s.turns !== 'number') continue;
    all.games += s.games;
    all.turns += s.turns;
    for (const t of ['byScore', 'byCorpScore', 'byRate', 'corp']) {
      for (const [k, v] of Object.entries(s[t] ?? {})) {
        const a = (all[t][k] ??= Object.fromEntries(Object.keys(v).map(f => [f, 0])));
        for (const f of Object.keys(v)) a[f] += v[f];
      }
    }
    for (const [k, v] of Object.entries(s.parts ?? {})) all.parts[k] = (all.parts[k] ?? 0) + v;
  }
  return all;
}

export function print(stats) {
  const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : ' - ');
  console.log(`${stats.games} games, ${stats.turns} Runner turns`);
  console.log('\nRunner points per turn: the clock\'s runnerRate at the turn\'s start vs taken (next turn; next 3 turns, per turn)');
  console.log('state           turns  predicted  observed  obs/pred | 3-turn pred  obs  obs/pred | wait cost/turn: 1/turnsLeft  clock');
  const row = (k, c) => console.log(`${k.padEnd(15)} ${String(c.n).padStart(5)}  ${f(c.predicted / c.n, 3).padStart(9)}  ${f(c.observed / c.n, 3).padStart(8)}  ${f(c.observed / c.predicted).padStart(8)} | ${f(c.predicted3 / c.turns3, 3).padStart(11)}  ${f(c.observed3 / c.turns3, 3)}  ${f(c.observed3 / c.predicted3)} | ${f((c.lateStep ?? 0) / c.n, 3).padStart(11)}  ${f((c.openStep ?? 0) / c.n, 3)}`);
  for (const k of Object.keys(stats.byScore).sort()) row(k, stats.byScore[k]);
  for (const k of Object.keys(stats.byCorpScore).sort()) row(k, stats.byCorpScore[k]);
  console.log('\nBy predicted rate (calibration curve)');
  for (const k of ['<0.1', '0.1-0.3', '0.3-0.6', '0.6-1', '1+']) if (stats.byRate[k]) row(k, stats.byRate[k]);
  const total = Object.values(stats.parts).reduce((n, v) => n + v, 0);
  console.log(`\nPredicted points by server kind: ${Object.entries(stats.parts).map(([k, v]) => `${k} ${f(v / Math.max(1, stats.turns), 3)} (${f((100 * v) / Math.max(1e-9, total), 0)}%)`).join(', ')}`);
  console.log('\nCorp points per Corp turn by its score (the measured corpRate): next turn, next 3 turns per turn');
  for (const k of Object.keys(stats.corp).sort((a, b) => a - b)) {
    const c = stats.corp[k];
    console.log(`corp ${k}: ${String(c.n).padStart(5)} turns  next ${f(c.next / c.n, 3)}  3-turn ${f(c.points / c.turns, 3)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) print(sum(process.argv.slice(2)));
