// Summarizes scripts/click-asset-trace.ts output: click assets per copy, Jeff against the Corp AI, by card.
//   node scripts/click-asset-trace-sum.mjs click.jsonl [more.jsonl ...]
import { readFileSync } from 'node:fs';

const rows = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
const groups = { jeff: rows.filter(r => r.who === 'jeff'), 'ai (Jeff decks)': rows.filter(r => r.who === 'ai' && r.game !== 'deal'), 'ai (deals)': rows.filter(r => r.game === 'deal') };
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-');
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

for (const [g, rs] of Object.entries(groups)) console.log(`${g}: ${rs.length} games`);
const titles = [...new Set(rows.flatMap(r => r.copies.map(c => c.title)))].sort();
for (const t of titles) {
  console.log(`\n${t}`);
  for (const [g, rs] of Object.entries(groups)) {
    const cs = rs.flatMap(r => r.copies.filter(c => c.title === t));
    if (!cs.length) continue;
    const rez = cs.filter(c => c.rezzed !== undefined);
    const byRunner = cs.filter(c => c.trashed?.byRunner);
    const leftAtTrash = byRunner.map(c => c.left);
    const atEnd = cs.filter(c => !c.trashed);
    const idle = cs.flatMap(c => c.idle);
    const idleRez = idle.filter(x => x.rezzed);
    const idleTurns = cs.map(c => new Set(c.idle.map(x => x.turn)).size);
    console.log(`  ${g.padEnd(16)} n ${String(cs.length).padStart(3)} | rezzed ${pct(rez.length, cs.length)} | uses ${f(mean(cs.map(c => c.uses)))} (clicks ${f(mean(cs.map(c => c.clicks)))}), credits ${f(mean(cs.map(c => c.credits)))} a copy`);
    console.log(`  ${''.padEnd(16)} trashed by the Runner ${pct(byRunner.length, cs.length)}, counters left then ${f(mean(leftAtTrash))} | in play at the end ${atEnd.length}, counters left ${f(mean(atEnd.map(c => c.left)))} | left by the Corp (own trash/HQ) ${cs.length - byRunner.length - atEnd.length}`);
    console.log(`  ${''.padEnd(16)} idle clicks (draw/credit while usable) ${f(mean(cs.map(c => c.idle.length)))} a copy (rezzed ${idleRez.length}, rez-then-use ${idle.length - idleRez.length}; draw ${idle.filter(x => x.took === 'DRAW_CARD').length}, credit ${idle.filter(x => x.took === 'GAIN_CREDIT').length}), on ${f(mean(idleTurns))} turns`);
  }
}
