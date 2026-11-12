// Sums scripts/money-m0.ts output (money step M0 tables): node scripts/money-m0-sum.mjs a.jsonl [b.jsonl ...]
import { readFileSync } from 'node:fs';

const deals = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const n = deals.length;
const avg = (xs, f) => (xs.length ? (xs.reduce((t, x) => t + f(x), 0) / xs.length).toFixed(2) : '-');
const pct = (k, m) => (m ? `${Math.round((k * 100) / m)}%` : '-');
console.log(`${n} games`);

// 1. The income line
const turns = deals.flatMap(d => d.turns.filter(t => t.netted !== undefined).map(t => ({ ...t, won: d.winner === 'corp' })));
const row = (label, ts) =>
  console.log(`  ${label.padEnd(30)} ${String(ts.length).padStart(5)} turns: best ${avg(ts, t => t.best)}, netted ${avg(ts, t => t.netted)}, gap ${avg(ts, t => t.best - t.netted)}; with hosted credits owned: best ${avg(ts, t => t.bestStock)}, netted ${avg(ts, t => t.nettedStock)}, gap ${avg(ts, t => t.bestStock - t.nettedStock)}`);
console.log('\n1. Income line (credits at turn end + known turn-start income; the gap = best line - netted)');
row('all', turns);
for (const [l, f] of [['wins', t => t.won], ['losses', t => !t.won], ['turns 1-5', t => t.turn <= 5], ['turns 6-12', t => t.turn >= 6 && t.turn <= 12], ['no counted line held', t => !t.held], ['counted line held', t => t.held], ['no line, turns 1-5', t => !t.held && t.turn <= 5], ['no line, turns 6-12', t => !t.held && t.turn >= 6 && t.turn <= 12]])
  row(l, turns.filter(f));
const kinds = {};
for (const t of turns) for (const [k, v] of Object.entries(t.clicks)) kinds[k] = (kinds[k] ?? 0) + v;
const total = Object.values(kinds).reduce((a, b) => a + b, 0);
console.log(`  clicks by kind (all turns): ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / turns.length).toFixed(2)}/turn (${pct(v, total)})`).join(', ')}`);
const gapTurns = turns.filter(t => !t.held && t.best - t.netted >= 2);
const gk = {};
for (const t of gapTurns) for (const [k, v] of Object.entries(t.clicks)) gk[k] = (gk[k] ?? 0) + v;
const gt = Object.values(gk).reduce((a, b) => a + b, 0);
console.log(`  turns with no line and a gap of 2+: ${gapTurns.length} (${pct(gapTurns.length, turns.filter(t => !t.held).length)}); their clicks went on: ${Object.entries(gk).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, gt)}`).join(', ')}`);
const fates = {};
for (const t of gapTurns) for (const f of t.fates) (fates[f.kind] ??= {})[f.fate] = (fates[f.kind]?.[f.fate] ?? 0) + 1;
console.log(`  their fates: ${Object.entries(fates).map(([k, v]) => `${k}: ${Object.entries(v).map(([f, c]) => `${f} ${c}`).join(' / ')}`).join('; ')}`);
const moves = {};
for (const t of gapTurns) for (const m of t.bestMoves) moves[m.split(':')[0]] = (moves[m.split(':')[0]] ?? 0) + 1;
console.log(`  the best line's moves on those turns: ${Object.entries(moves).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);

// 2. Econ operations
const ops = deals.flatMap(d => d.ops);
console.log('\n2. Econ operations');
console.log(`  ${(ops.length / n).toFixed(2)} per game seen; Corp turns in HQ ${avg(ops, o => o.inHq)}, of which playable ${avg(ops, o => o.playable)}, one click for a credit short ${avg(ops, o => o.short)}; played ${pct(ops.filter(o => o.used !== undefined).length, ops.length)}`);
console.log(`  playable turns spent in HQ without being played: ${(ops.reduce((t, o) => t + Math.max(0, o.playable - (o.used !== undefined ? 1 : 0)), 0) / n).toFixed(2)} per game`);
console.log(`  clicks for a credit taken while an econ operation was playable: ${(deals.reduce((t, d) => t + d.creditWhilePlayable, 0) / n).toFixed(2)} per game`);

// 3. Never used
const never = deals.flatMap(d => d.never);
const why = {};
for (const e of never) why[e.why] = (why[e.why] ?? 0) + 1;
console.log(`\n3. Econ cards never used: ${(never.length / n).toFixed(2)} per game: ${Object.entries(why).map(([k, v]) => `${k} ${(v / n).toFixed(2)}`).join(', ')}`);
const byType = {};
for (const e of never) byType[e.type] = (byType[e.type] ?? 0) + 1;
console.log(`  by type: ${Object.entries(byType).map(([k, v]) => `${k} ${(v / n).toFixed(2)}`).join(', ')}`);

// 4. Econ assets
const assets = deals.flatMap(d => d.assets);
const rezzed = assets.filter(a => a.rezzedAt !== undefined);
console.log(`\n4. Econ installs (assets/upgrades): ${(assets.length / n).toFixed(2)} per game; rezzed ${pct(rezzed.length, assets.length)}, turns from install to rez ${avg(rezzed, a => a.rezzedAt - a.installed)}`);
console.log(`  rezzed: rez paid ${avg(rezzed, a => a.rezPaid)}, credits back ${avg(rezzed, a => a.back)}, paid back (back >= rez) ${pct(rezzed.filter(a => a.back >= a.rezPaid).length, rezzed.length)}`);
const trashed = assets.filter(a => a.trashed);
console.log(`  trashed by the Runner ${pct(trashed.length, assets.length)} (bare ${trashed.filter(a => !a.trashed.iced).length}, behind ice ${trashed.filter(a => a.trashed.iced).length}); printed trash cost ${avg(trashed, a => a.trashed.trashCost)}; credits back before the trash ${avg(trashed, a => a.back)} against rez ${avg(trashed, a => a.rezPaid)}`);
const titles = {};
for (const a of rezzed) (titles[a.title] ??= []).push(a);
console.log(`  by title (rezzed): ${Object.entries(titles).sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([t, as]) => `${t} ${as.length}: rez ${avg(as, a => a.rezPaid)} back ${avg(as, a => a.back)} trashed ${pct(as.filter(a => a.trashed).length, as.length)}`).join('; ')}`);

// 5. Abilities
console.log(`\n5. Corp turns with an econ ability legal and none used: ${(deals.reduce((t, d) => t + d.abilityUnused, 0) / n).toFixed(2)} per game`);

// 6. Draws on turns 1-5
const draws = deals.flatMap(d => d.draws);
console.log(`\n6. Optional draws on turns 1-5: ${(draws.length / n).toFixed(2)} per game; at each, ice in HQ ${avg(draws, x => x.hqIce)}, econ cards in HQ ${avg(draws, x => x.hqEcon)}; HQ held neither ${pct(draws.filter(x => !x.hqIce && !x.hqEcon).length, draws.length)}`);
