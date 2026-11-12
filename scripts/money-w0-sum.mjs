// Summarizes scripts/money-w0.ts output: the Corp's draw clicks, Jeff against the AI on the same decks, turns 1-10.
//   node scripts/money-w0-sum.mjs w0.jsonl
import { readFileSync } from 'node:fs';

const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const sides = ['jeff', 'ai'];
const who = w => rows.filter(r => r.who === w);
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-');
const n = (o, k) => o?.[k] ?? 0;
const nonAgenda = o => n(o, 'ice') + n(o, 'econ') + n(o, 'other');

console.log(`games: Jeff ${who('jeff').length}, AI ${who('ai').length}\n`);

console.log('Draw clicks per game, by Corp turn (mandatory draw not counted)');
console.log(`turn  ${sides.map(w => w.padStart(6)).join(' ')}`);
for (let t = 1; t <= 10; t++) console.log(`T${String(t).padEnd(4)} ${sides.map(w => f(mean(who(w).map(r => r.clicks.filter(c => c.turn === t && c.kind === 'draw').length))).padStart(6)).join(' ')}`);
console.log(`total ${sides.map(w => f(mean(who(w).map(r => r.clicks.filter(c => c.kind === 'draw').length))).padStart(6)).join(' ')}`);

// The position a click was taken in
const shape = c => {
  const p = c.playable;
  const bare = c.remotes.filter(i => i === 0).length;
  return {
    credits: c.credits,
    clicksLeft: c.clicksLeft,
    hq: Object.values(c.hq).reduce((x, y) => x + y, 0),
    'playable ice': n(p, 'ice'),
    'playable econ': n(p, 'econ'),
    'playable other': n(p, 'other'),
    'agendas in HQ': n(c.hq, 'agenda'),
    'nothing but agendas playable': nonAgenda(p) === 0 ? 1 : 0,
    'ice on HQ': c.hqIce,
    'ice on R&D': c.rdIce,
    'remotes with a root': c.remotes.length,
    'bare remotes with a root': bare,
    'R&D size': c.rd,
  };
};
console.log('\nPosition at the click (means): draw clicks against all clicks');
const keys = Object.keys(shape({ playable: {}, hq: {}, remotes: [] }));
console.log(`  ${''.padEnd(30)} ${'Jeff draw'.padStart(9)} ${'Jeff all'.padStart(9)} ${'AI draw'.padStart(9)} ${'AI all'.padStart(9)}`);
const all = Object.fromEntries(sides.map(w => [w, who(w).flatMap(r => r.clicks).map(c => ({ ...c, s: shape(c) }))]));
for (const k of keys) {
  const cell = (w, d) => f(mean(all[w].filter(c => !d || c.kind === 'draw').map(c => c.s[k]))).padStart(9);
  console.log(`  ${k.padEnd(30)} ${cell('jeff', 1)} ${cell('jeff', 0)} ${cell('ai', 1)} ${cell('ai', 0)}`);
}

// Position classes: what the Corp could do instead of drawing
const cls = c => {
  const p = c.playable;
  const what = [n(p, 'ice') ? 'ice' : '', n(p, 'econ') ? 'econ' : '', n(p, 'other') ? 'other' : ''].filter(Boolean).join('+') || (n(p, 'agenda') ? 'agendas only' : 'nothing');
  const money = c.credits <= 2 ? '0-2cr' : c.credits <= 5 ? '3-5cr' : c.credits <= 8 ? '6-8cr' : '9+cr';
  return `${what.padEnd(16)} ${money}`;
};
console.log('\nPositions the AI drew in, and what each side did with clicks in that kind of position');
console.log('(class = cards in HQ legal to install or play now, by kind, and credits; share of that class\'s clicks)');
const byClass = Object.fromEntries(sides.map(w => [w, {}]));
for (const w of sides) for (const c of all[w]) (byClass[w][cls(c)] ??= []).push(c);
const aiDraws = all.ai.filter(c => c.kind === 'draw');
const classes = Object.entries(Object.groupBy(aiDraws, cls)).sort((a, b) => b[1].length - a[1].length);
for (const [k, draws] of classes.slice(0, 12)) {
  const top = w => {
    const cs = byClass[w][k] ?? [];
    const kinds = Object.entries(Object.groupBy(cs, c => c.kind)).map(([x, v]) => [x, v.length]).sort((a, b) => b[1] - a[1]);
    return `${String(cs.length).padStart(4)} clicks: ${kinds.slice(0, 4).map(([x, v]) => `${x} ${pct(v, cs.length)}`).join(', ')}`;
  };
  console.log(`  ${k}  AI draws ${String(draws.length).padStart(4)} (${pct(draws.length, aiDraws.length)} of AI draws)`);
  console.log(`      Jeff ${top('jeff')}`);
  console.log(`      AI   ${top('ai')}`);
}

console.log('\nWhat the drawn card was, and when it left HQ');
for (const w of sides) {
  const d = who(w).flatMap(r => r.drawn);
  const types = Object.entries(Object.groupBy(d, x => x.type)).map(([k, v]) => `${k} ${pct(v.length, d.length)}`).join(', ');
  const same = d.filter(x => x.left === x.turn).length;
  const next = d.filter(x => x.left === x.turn + 1).length;
  const later = d.filter(x => x.left !== undefined && x.left > x.turn + 1).length;
  const held = d.filter(x => x.left === undefined).length;
  const how = Object.entries(Object.groupBy(d.filter(x => x.how), x => x.how)).map(([k, v]) => `${k} ${pct(v.length, d.length)}`).join(', ');
  console.log(`  ${w.padEnd(5)} ${d.length} cards (${f(d.length / who(w).length)}/game): ${types}`);
  console.log(`        left HQ the same turn ${pct(same, d.length)}, next turn ${pct(next, d.length)}, later ${pct(later, d.length)}, still in HQ ${pct(held, d.length)} | ${how}`);
  for (const t of ['ice', 'econ', 'other', 'agenda']) {
    const x = d.filter(y => y.type === t);
    if (x.length) console.log(`        ${t.padEnd(7)} used the same turn ${pct(x.filter(y => y.left === y.turn && (y.how === 'installed' || y.how === 'played')).length, x.length)}, by next turn ${pct(x.filter(y => y.left !== undefined && y.left <= y.turn + 1 && (y.how === 'installed' || y.how === 'played')).length, x.length)}`);
  }
}
