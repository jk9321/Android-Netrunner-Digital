// Summarizes scripts/money-w1.ts output: why the Corp AI picks a draw click (turns 1-10).
//   node scripts/money-w1-sum.mjs w1.jsonl
import { readFileSync } from 'node:fs';

const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const ai = rows.filter(r => r.who === 'ai');
const jeff = rows.filter(r => r.who === 'jeff');
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-');
const count = (xs, k) => Object.entries(Object.groupBy(xs, k)).map(([x, v]) => [x, v.length]).sort((a, b) => b[1] - a[1]);
const draws = ai.flatMap(r => r.draws.map(d => ({ ...d, game: r.game, seed: r.seed })));
const used = d => d.drawn?.usedBy !== undefined && d.drawn.usedBy <= d.turn + 2;

console.log(`AI games ${ai.length}, draw clicks ${draws.length} (${f(draws.length / ai.length)}/game); Jeff games ${jeff.length}, draw clicks ${f(mean(jeff.map(r => r.draws)))}/game\n`);

console.log('Where the draw came from');
for (const [k, v] of count(draws, d => d.source)) console.log(`  ${k.padEnd(8)} ${v} (${pct(v, draws.length)})`);
const fresh = draws.filter(d => d.source !== 'search');
console.log(`  remembered-line / rule draws, a fresh search here picks: ${count(fresh, d => d.freshPick ?? 'no search').map(([k, v]) => `${k} ${pct(v, fresh.length)}`).join(', ')}`);

console.log('\nThe planner\'s values at the draw (search draws: the search that picked it; others: the fresh search)');
const scored = draws.filter(d => d.drawValue !== undefined && d.bestOther);
const margin = d => d.drawValue - d.bestOther.value;
const ms = scored.map(margin).sort((a, b) => a - b);
console.log(`  draws with a non-draw candidate beside them: ${scored.length}; draw minus best other: median ${f(ms[Math.floor(ms.length / 2)])}, under 1: ${pct(ms.filter(x => x < 1).length, ms.length)}, under 3: ${pct(ms.filter(x => x < 3).length, ms.length)}, negative (fresh search prefers the other): ${pct(ms.filter(x => x < 0).length, ms.length)}`);
console.log(`  best other by class: ${count(scored, d => d.bestOther.cls).map(([k, v]) => `${k} ${pct(v, scored.length)}`).join(', ')}`);
for (const [cls] of count(scored, d => d.bestOther.cls)) {
  const x = scored.filter(d => d.bestOther.cls === cls);
  console.log(`    ${cls.padEnd(22)} n ${String(x.length).padStart(3)}, margin mean ${f(mean(x.map(margin)))}, scoreInTwo would veto ${pct(x.filter(d => d.bestOther.vetoed).length, x.length)}, moneyPick would take the click ${pct(x.filter(d => d.bestOther.money).length, x.length)}`);
}
const missing = draws.filter(d => d.missing && Object.keys(d.missing).length);
console.log(`  draws where the rule ranking had a class the planner never played out: ${pct(missing.length, draws.length)} (${count(missing.flatMap(d => Object.keys(d.missing).map(k => ({ k }))), x => x.k).map(([k, v]) => `${k} ${v}`).join(', ')})`);
console.log(`  the draw's place in the rule ranking: ${count(draws, d => String(Math.min(d.rankOfDraw, 4))).sort().map(([k, v]) => `${k === '4' ? '4+' : k} ${pct(v, draws.length)}`).join(', ')}`);

console.log('\nWhat a draw is priced at, and the deck-average cache');
console.log(`  drawWorth at the draw: mean ${f(mean(draws.map(d => d.drawWorth)))} (min ${f(Math.min(...draws.map(d => d.drawWorth)))}, max ${f(Math.max(...draws.map(d => d.drawWorth)))})`);
const hits = draws.reduce((n, d) => n + d.hits, 0);
const stale = draws.reduce((n, d) => n + d.stale, 0);
const onStale = draws.filter(d => d.stale > 0);
console.log(`  cache hits during draw decisions ${hits}, stale ${stale} (${pct(stale, hits)}); draws whose decision took a stale hit ${pct(onStale.length, draws.length)}`);
console.log(`  drawn card used by T+2: stale-hit draws ${pct(onStale.filter(used).length, onStale.length)}, others ${pct(draws.filter(d => d.stale === 0).filter(used).length, draws.filter(d => d.stale === 0).length)}`);

console.log('\nThe drawn card by T+2 (installed or played)');
console.log(`  all ${pct(draws.filter(used).length, draws.length)}; ${count(draws.filter(d => d.drawn), d => d.drawn.type).map(([k, v]) => `${k} ${pct(draws.filter(d => d.drawn?.type === k && used(d)).length, v)} of ${v}`).join(', ')}`);

const show = (label, test) => {
  const x = draws.filter(test);
  console.log(`\n${label}: ${x.length} draws, used by T+2 ${pct(x.filter(used).length, x.length)}, sources ${count(x, d => d.source).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  best other: ${count(x.filter(d => d.bestOther), d => d.bestOther.cls).map(([k, v]) => `${k} ${v}`).join(', ')}; margin mean ${f(mean(x.filter(d => d.bestOther && d.drawValue !== undefined).map(margin)))}`);
  for (const d of x.slice(0, 6)) console.log(`    ${d.game} seed ${d.seed} T${d.turn} clicks ${d.clicks} credits ${d.credits} ${d.position}: ${d.source}${d.freshPick ? ` (fresh: ${d.freshPick})` : ''}, draw ${f(d.drawValue)} vs ${d.bestOther ? `${d.bestOther.cls} ${f(d.bestOther.value)}` : '-'}, drew ${d.drawn?.type ?? '?'}${used(d) ? ' used' : ' sat'}`);
};
show('Pattern (a): playable ice, 9+ credits', d => /(^|\+)ice/.test(d.position) && d.position.endsWith('9+cr'));
show('Pattern (b): only agendas playable, 3-5 credits', d => d.position === 'agendas only 3-5cr');

console.log('\nAgendas installed in an "only agendas playable" position, and what became of them (turns 1-10 installs, fate at the end of the replay)');
for (const [w, rs] of [['jeff', jeff], ['ai', ai]]) {
  const all = rs.flatMap(r => r.agendas);
  const only = all.filter(a => a.position.startsWith('agendas only'));
  const fates = xs => count(xs, a => a.fate).map(([k, v]) => `${k} ${pct(v, xs.length)}`).join(', ');
  console.log(`  ${w.padEnd(5)} only-agendas installs ${only.length} (3-5cr ${only.filter(a => a.position.endsWith('3-5cr')).length}): ${fates(only)} | all agenda installs ${all.length}: ${fates(all)}`);
}
