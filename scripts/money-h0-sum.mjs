// Summarizes scripts/money-h0.ts output: Jeff's Corp games against the Corp AI on the same decks, per Corp turn 1-10.
//   node scripts/money-h0-sum.mjs h0.jsonl
import { readFileSync } from 'node:fs';

const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const who = w => rows.filter(r => r.who === w);
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const sum = o => Object.values(o ?? {}).reduce((x, y) => x + y, 0);
const sides = ['jeff', 'ai'];

console.log(`games: Jeff ${who('jeff').length} (Corp won ${who('jeff').filter(r => r.winner === 'corp').length}), AI ${who('ai').length}\n`);

console.log('Per Corp turn (mean over games that reached the turn): credits at start | income | spend | ice installed/rezzed at start');
console.log('turn | Jeff start inc spend ice/rez | AI start inc spend ice/rez');
for (let t = 0; t < 10; t++) {
  const cells = sides.map(w => {
    const ts = who(w).map(r => r.ledger[t]).filter(Boolean);
    return `${f(mean(ts.map(x => x.start ?? NaN).filter(Number.isFinite)), 1)} ${f(mean(ts.map(x => sum(x.income))), 1)} ${f(mean(ts.map(x => sum(x.spend))), 1)} ${f(mean(ts.map(x => x.ice)), 1)}/${f(mean(ts.map(x => x.iceRezzed)), 1)}`;
  });
  console.log(`T${t + 1}   | ${cells[0]} | ${cells[1]}`);
}

const upTo = (r, n, key) => {
  const out = {};
  for (const x of r.ledger.slice(0, n)) for (const [k, v] of Object.entries(x?.[key] ?? {})) out[k] = (out[k] ?? 0) + v;
  return out;
};
for (const [key, label] of [['clicks', 'Clicks by kind'], ['income', 'Income by source'], ['spend', 'Spending by kind']]) {
  for (const n of [5, 10]) {
    console.log(`\n${label}, cumulative by T${n} (per game, games that reached T${n})`);
    const per = Object.fromEntries(sides.map(w => [w, who(w).filter(r => r.ledger.length >= n).map(r => upTo(r, n, key))]));
    const kinds = [...new Set(sides.flatMap(w => per[w].flatMap(o => Object.keys(o))))];
    const avg = (w, k) => mean(per[w].map(o => o[k] ?? 0));
    kinds.sort((a, b) => avg('jeff', b) + avg('ai', b) - avg('jeff', a) - avg('ai', a));
    console.log(`  ${'kind'.padEnd(22)} Jeff    AI      diff   (games ${per.jeff.length} / ${per.ai.length})`);
    for (const k of kinds) console.log(`  ${k.padEnd(22)} ${f(avg('jeff', k)).padStart(5)}  ${f(avg('ai', k)).padStart(5)}  ${f(avg('jeff', k) - avg('ai', k)).padStart(6)}`);
    console.log(`  ${'total'.padEnd(22)} ${f(mean(per.jeff.map(sum))).padStart(5)}  ${f(mean(per.ai.map(sum))).padStart(5)}`);
  }
}

console.log('\nEcon operations and agendas by T10 (per game)');
for (const w of sides) {
  const r = who(w);
  const played = r.map(x => x.econPlayed.filter(e => e.turn <= 10));
  console.log(
    `  ${w.padEnd(5)} econ ops played ${f(mean(played.map(p => p.length)))}, sat in HQ ${f(mean(played.flat().map(e => e.sat)))} turns on average, econ discarded ${f(mean(r.map(x => x.econDiscarded)))} (whole game) | agendas installed ${f(mean(r.map(x => x.agendasInstalled.filter(t => t <= 10).length)))}, scored ${f(mean(r.map(x => x.agendasScored.filter(t => t <= 10).length)))}`
  );
}
