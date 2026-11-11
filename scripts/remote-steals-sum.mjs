// Sums scripts/remote-steals-look.ts output (one JSON line per deal): node scripts/remote-steals-sum.mjs r0.jsonl r1.jsonl ...
import { readFileSync } from 'node:fs';

const deals = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const games = deals.length;
const all = deals.flatMap(d => d.steals.map(s => ({ ...s, seed: d.seed, corp: d.corp, runner: d.runner, winner: d.winner })));
const per100 = n => ((n * 100) / games).toFixed(1);
const mean = xs => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '-');
const count = (xs, f) => xs.filter(f).length;

function table(rows, head) {
  const out = [`| ${head} | steals/100 | points | counters lost | Corp credits at install | money: could not afford / could afford / no HQ ice |`, '|---|---|---|---|---|---|'];
  for (const cls of ['A', 'B', 'C']) {
    const xs = rows.filter(s => s.cls === cls);
    out.push(`| ${cls} | ${per100(xs.length)} (${xs.length}) | ${xs.reduce((a, s) => a + s.points, 0)} | ${xs.reduce((a, s) => a + s.counters, 0)} | ${mean(xs.filter(s => s.installCredits >= 0).map(s => s.installCredits))} | ${count(xs, s => s.money === 'could not afford')} / ${count(xs, s => s.money === 'could afford')} / ${count(xs, s => s.money === 'no ice in HQ')} |`);
  }
  return out.join('\n');
}

const full = all.filter(s => s.ice > 0 && s.rezzed === s.ice);
const some = all.filter(s => s.ice > 0 && s.rezzed < s.ice);
const bare = all.filter(s => s.ice === 0);
console.log(`games ${games}, remote steals ${all.length} (${per100(all.length)}/100): all ice rezzed ${full.length}, some unrezzed ${some.length}, no ice ${bare.length}`);
console.log(`by ice rezzed/total: ${Object.entries(all.reduce((m, s) => ((m[`${s.rezzed}/${s.ice}`] = (m[`${s.rezzed}/${s.ice}`] ?? 0) + 1), m), {})).sort().map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log('\nAll ice rezzed:\n' + table(full, 'class'));
console.log('\nSome ice unrezzed:\n' + table(some, 'class'));
console.log('\nNo ice:\n' + table(bare, 'class'));
console.log('\ncount at install (all steals): ' + JSON.stringify(all.reduce((m, s) => ((m[`${s.cls}:${s.countAtInstall}`] = (m[`${s.cls}:${s.countAtInstall}`] ?? 0) + 1), m), {})));
const a = all.filter(s => s.cls === 'A');
console.log('\nClass A, why the line broke: ' + JSON.stringify(a.reduce((m, s) => ((m[s.why] = (m[s.why] ?? 0) + 1), m), {})));
const gainKinds = {};
for (const s of a) for (const [k, v] of Object.entries(s.gains)) {
  const kind = k.startsWith('during run') ? 'during run' : k.split(' ')[0];
  gainKinds[kind] = (gainKinds[kind] ?? 0) + v;
}
console.log('Class A, Runner credits gained that turn by source: ' + JSON.stringify(gainKinds));
console.log(`Class A, breaker/rig installed that turn: ${count(a, s => s.installedThisTurn.length)}; ran elsewhere first: ${count(a, s => s.runsBefore.length)}; clicks spent in the run: ${count(a, s => s.clicksAtRun > s.clicksAfter)}`);
console.log(`Class A, budget vs need at turn start (mean): ${mean(a.map(s => s.budget))} vs ${mean(a.filter(s => s.needStart !== 'BLOCK').map(s => s.needStart))} (BLOCK ${count(a, s => s.needStart === 'BLOCK')})`);
const ex = cls => all.filter(s => s.cls === cls && s.ice > 0 && s.rezzed === s.ice).slice(0, 3).map(s => `seed ${s.seed} T${s.turn} ${s.corp} v ${s.runner}: ${s.agenda} (${s.counters} ctr) on ${s.server} ${s.rezzed}/${s.ice} rezzed; install T${s.installTurn} with ${s.installCredits} cr, count at install ${s.countAtInstall}; budget ${s.budget}, need ${s.needStart}->${s.needAtRun}, Runner ${s.creditsAtStart} cr at start, ${s.creditsAtRun} at run, ${s.creditsAfter} after; gains ${JSON.stringify(s.gains)}${s.installedThisTurn.length ? `; installed ${s.installedThisTurn.join(', ')}` : ''}${s.runsBefore.length ? `; ran ${s.runsBefore.join(', ')} first` : ''}; HQ ice ${s.hqIce}, Corp ${s.corpCreditsAtRunnerStart} cr (${s.money})${s.why ? `; ${s.why}` : ''}`);
for (const cls of ['A', 'B', 'C']) console.log(`\nExamples ${cls}:\n- ` + ex(cls).join('\n- '));
