// Prints the Corp loss breakdown from scripts/corp-losses.ts shards (see corp-losses.sh).
import { readFileSync } from 'node:fs';

const games = process.argv.slice(2).flatMap(f => {
  const lines = readFileSync(f, 'utf8').trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
});
const pct = (x, n) => `${((100 * x) / Math.max(n, 1)).toFixed(1)}%`;
const count = (list, key) => list.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map());
const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
const avg = (list, f) => (sum(list, f) / Math.max(list.length, 1)).toFixed(1);
const show = (title, map, n) => {
  console.log(title);
  for (const [k, v] of [...map].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v} (${pct(v, n)})`);
};

const n = games.length;
const losses = games.filter(g => g.winner === 'runner');
const wins = games.filter(g => g.winner === 'corp');
console.log(`${n} games: Corp ${pct(wins.length, n)}, Runner ${pct(losses.length, n)}`);
show('How games end:', count(games, g => `${g.winner} ${g.reason}`), n);

// Where the Runner's points come from in Corp losses
const steals = losses.flatMap(g => g.steals);
const points = steals.reduce((m, s) => m.set(s.from, (m.get(s.from) ?? 0) + s.points), new Map());
show('Runner points in Corp losses, by server:', points, sum(steals, s => s.points));

const remote = steals.filter(s => s.from === 'remote');
console.log(`Remote steals (${remote.length}):`);
show('  by ice on the server (rezzed/total):', count(remote, s => `${s.rezzedIce}/${s.ice}`), remote.length);
console.log(`  already scoreable when stolen: ${remote.filter(s => s.scoreable).length}`);
console.log(`  advanced at least once: ${remote.filter(s => s.advanced > 0).length}`);
console.log(`  Corp credits when stolen: avg ${avg(remote, s => s.corpCredits)}`);

const hq = steals.filter(s => s.from === 'hq');
console.log(`HQ steals (${hq.length}): avg ${avg(hq, s => s.hqAgendas)} agendas in a ${avg(hq, s => s.hqSize)}-card HQ, ice avg ${avg(hq, s => s.ice)} (${avg(hq, s => s.rezzedIce)} rezzed)`);
const rd = steals.filter(s => s.from === 'rd');
console.log(`R&D steals (${rd.length}): ice avg ${avg(rd, s => s.ice)} (${avg(rd, s => s.rezzedIce)} rezzed)`);

console.log('Corp losses:');
console.log(`  Corp score at loss: avg ${avg(losses, g => g.corpScore)}; at 5+: ${losses.filter(g => g.corpScore >= 5).length}`);
console.log(`  game length: avg ${avg(losses, g => g.turns)} turns (Corp wins ${avg(wins, g => g.turns)})`);
console.log(`  turns with an agenda in HQ and none in a remote: avg ${avg(losses, g => g.idleAgendaTurns)} (Corp wins ${avg(wins, g => g.idleAgendaTurns)})`);
console.log(`  agendas still in HQ at the end: avg ${avg(losses, g => g.agendasInHQ)}`);
show('  most stolen agendas:', count(steals, s => s.title), steals.length);

if (process.env.DETAIL) {
  const decks = new Map();
  for (const g of games) {
    const d = decks.get(g.corpDeck) ?? { n: 0, w: 0 };
    d.n++;
    d.w += g.winner === 'corp' ? 1 : 0;
    decks.set(g.corpDeck, d);
  }
  for (const [name, d] of decks) console.log(`  corp ${name}: ${pct(d.w, d.n)} of ${d.n}`);
}
