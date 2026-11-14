// Sums threat-calibration shard files (the JSON `threat-calibration.ts self` prints) and prints its tables. Plain
// JS so the batch workflow's summary job (no npm install) runs it: script=threat-calibration finds it by name.
//   node scripts/threat-calibration-sum.mjs out/*.json
import { readFileSync } from 'node:fs';

const KINDS = ['hq', 'rd', 'archives', 'remote'];
const cell = () => ({ turns: 0, predicted: 0, ran: 0, p1: 0, p1ran: 0, p0: 0, p0ran: 0 });
const fresh = () => ({ games: 0, turns: 0, runs: 0, predictedRuns: 0, kinds: Object.fromEntries(KINDS.map(k => [k, cell()])), facedown: cell(), agendaRemote: cell(), unrezzed: {}, steals: {} });

export function sum(files) {
  const all = fresh();
  for (const file of files) {
    let s;
    try { s = JSON.parse(readFileSync(file, 'utf8').trim().split('\n').pop()); } catch { continue; }
    if (!s || typeof s.turns !== 'number') continue;
    for (const k of ['games', 'turns', 'runs', 'predictedRuns']) all[k] += s[k];
    const merge = (a, b) => Object.keys(a).forEach(k => (a[k] += b?.[k] ?? 0));
    for (const k of KINDS) merge(all.kinds[k], s.kinds[k]);
    merge(all.facedown, s.facedown);
    merge(all.agendaRemote, s.agendaRemote);
    for (const [k, v] of Object.entries(s.unrezzed ?? {})) { const a = (all.unrezzed[k] ??= { runs: 0, successful: 0 }); a.runs += v.runs; a.successful += v.successful; }
    for (const [k, v] of Object.entries(s.steals ?? {})) { const a = (all.steals[k] ??= { n: 0, predicted: 0, run: 0, pass: 0, stolen: 0, brier: 0 }); Object.keys(a).forEach(f => (a[f] += v[f])); }
  }
  return all;
}

export function print(stats) {
  const f = (x, d = 2) => x.toFixed(d);
  const r = (a, b) => (b ? f(a / b) : ' -  ');
  console.log(`${stats.games} games, ${stats.turns} Runner turns`);
  console.log(`runs a turn: observed ${r(stats.runs, stats.turns)}, predicted ${r(stats.predictedRuns, stats.turns)}`);
  console.log('server        turns  observed  predicted   |  P=1 turns  ran   |  P=0 turns  ran');
  const row = (name, c) =>
    console.log(`${name.padEnd(13)} ${String(c.turns).padStart(5)}  ${r(c.ran, c.turns).padStart(8)}  ${r(c.predicted, c.turns).padStart(9)}   |  ${String(c.p1).padStart(9)}  ${r(c.p1ran, c.p1)}  |  ${String(c.p0).padStart(9)}  ${r(c.p0ran, c.p0)}`);
  for (const k of KINDS) row(k === 'remote' ? 'any remote' : k, stats.kinds[k]);
  row('facedown arc', stats.facedown);
  row('agenda rem.', stats.agendaRemote);
  console.log('\nruns on all-unrezzed ice (turn start): successful / runs, per-layer pass = share^(1/layers)');
  for (const [k, v] of Object.entries(stats.unrezzed).sort()) console.log(`  ${k.padEnd(34)} ${String(v.successful).padStart(4)}/${String(v.runs).padEnd(4)} ${r(v.successful, v.runs)}  per layer ${f((v.successful / v.runs) ** (1 / Number(k.match(/(\d+) unrezzed/)[1])))}`);
  const tally = xs => xs.reduce((a, v) => ({ runs: a.runs + v.runs, successful: a.successful + v.successful }), { runs: 0, successful: 0 });
  const all = tally(Object.values(stats.unrezzed));
  const one = tally(Object.entries(stats.unrezzed).filter(([k]) => / 1 unrezzed/.test(k)).map(([, v]) => v));
  console.log(`  all: ${all.successful}/${all.runs}; one layer: ${one.successful}/${one.runs} ${r(one.successful, one.runs)}`);
  console.log('\nagenda remotes by rezzed/total ice: turns, predicted steals (stealOdds), threat runs, sum passOdds, stolen, stolen/predicted, Brier');
  for (const [k, v] of Object.entries(stats.steals).sort()) console.log(`  ${k.padEnd(5)} ${String(v.n).padStart(5)}  pred ${f(v.predicted, 1).padStart(6)}  runs ${f(v.run, 0).padStart(4)}  pass ${f(v.pass, 1).padStart(6)}  stolen ${String(v.stolen).padStart(4)}  ratio ${r(v.stolen, v.predicted)}  brier ${r(v.brier, v.n)}`);
  const t = Object.values(stats.steals).reduce((a, v) => ({ n: a.n + v.n, predicted: a.predicted + v.predicted, stolen: a.stolen + v.stolen, brier: a.brier + v.brier }), { n: 0, predicted: 0, stolen: 0, brier: 0 });
  console.log(`  all   ${String(t.n).padStart(5)}  pred ${f(t.predicted, 1).padStart(6)}  stolen ${t.stolen}  brier ${r(t.brier, t.n)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) print(sum(process.argv.slice(2)));
