// Pairs scripts/money-w2-probe.ts runs: the base (no switch) and the arm (PLAN_OFF=+drawQueue) at the same draw decisions.
//   node scripts/money-w2-probe-sum.mjs base.jsonl arm.jsonl [game:seed:turn ...]
import { readFileSync } from 'node:fs';

const load = f => new Map(readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).flatMap(r => r.draws.map(d => [`${r.game}:${r.seed}:${d.turn}:${d.index}`, { ...d, game: r.game, seed: r.seed }])));
const base = load(process.argv[2]);
const arm = load(process.argv[3]);
const pins = process.argv.slice(4);
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-');
const f = x => (Number.isFinite(x) ? x.toFixed(2) : '-');
const margin = d => (d.draw !== null && d.other ? d.draw - d.other.value : NaN);
const rows = [...base].filter(([k]) => arm.has(k)).map(([k, b]) => ({ k, b, a: arm.get(k) }));
console.log(`draw decisions paired: ${rows.length}`);
const groups = [
  ['near-tie (base margin under 1)', r => margin(r.b) < 1],
  ['margin 1 to 3', r => margin(r.b) >= 1 && margin(r.b) < 3],
  ['margin 3 or more', r => margin(r.b) >= 3],
  ['no other candidate', r => !Number.isFinite(margin(r.b))],
];
for (const [label, test] of groups) {
  const x = rows.filter(test);
  const baseDraw = x.filter(r => r.b.pick === 'draw');
  const flips = baseDraw.filter(r => r.a.pick !== 'draw');
  const to = Object.entries(Object.groupBy(flips, r => r.a.pick ?? 'none')).map(([k, v]) => `${k} ${v.length}`).join(', ');
  const dv = x.filter(r => r.b.draw !== null && r.a.draw !== null).map(r => r.a.draw - r.b.draw);
  console.log(`  ${label.padEnd(32)} ${String(x.length).padStart(4)} | base fresh search draws ${pct(baseDraw.length, x.length)}, arm moves ${pct(flips.length, baseDraw.length)} of those off the draw (${to}) | draw value change mean ${f(dv.reduce((s, y) => s + y, 0) / dv.length)}`);
}
const all = rows.filter(r => r.b.pick === 'draw');
console.log(`  all: base draws ${all.length}, arm draws ${all.filter(r => r.a.pick === 'draw').length}`);
for (const p of pins) {
  const [game, seed, turn] = p.split(':');
  for (const r of rows.filter(x => x.b.game === game && String(x.b.seed) === seed && String(x.b.turn) === turn)) {
    console.log(`\npin ${game} seed ${seed} T${turn} clicks ${r.b.clicks} credits ${r.b.credits}`);
    for (const [w, d] of [['base', r.b], ['arm', r.a]]) console.log(`  ${w.padEnd(4)} pick ${d.pick}, draw ${f(d.draw)}, best other ${d.other ? `${d.other.cls} ${f(d.other.value)}` : '-'}`);
  }
}
