// Sums scripts/stage-c/steal-shift.ts over two runs, paired by deal: node scripts/stage-c/steal-shift-sum.mjs <this dir> <base dir>
// Reads every JSON line of every file under each directory (the ai-script.yml shard outputs).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const load = dir => {
  const out = new Map();
  const walk = d => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else for (const line of readFileSync(p, 'utf8').split('\n')) if (line.startsWith('{"seed"')) { const r = JSON.parse(line); out.set(r.seed, r); }
    }
  };
  walk(dir);
  return out;
};
const [a, b] = [load(process.argv[2]), load(process.argv[3])];
const seeds = [...a.keys()].filter(s => b.has(s) && !a.get(s).crashed && !b.get(s).crashed).sort((x, y) => x - y);
const crashed = [...a.values(), ...b.values()].filter(r => r.crashed).length;
console.log(`steal-shift: ${seeds.length} deals paired (this ${a.size}, base ${b.size}, crashed ${crashed})`);

const row = (label, f, digits = 2) => {
  const xs = seeds.map(s => f(a.get(s))), ys = seeds.map(s => f(b.get(s)));
  const n = xs.length, mean = v => v.reduce((p, q) => p + q, 0) / v.length;
  const d = xs.map((x, i) => x - ys[i]), md = mean(d);
  const se = Math.sqrt(d.reduce((p, q) => p + (q - md) ** 2, 0) / (n - 1) / n);
  console.log(`  ${label.padEnd(44)} ${mean(xs).toFixed(digits).padStart(7)} / ${mean(ys).toFixed(digits).padStart(7)}   ${md >= 0 ? '+' : ''}${md.toFixed(digits)} ± ${se.toFixed(digits)}`);
};
const SERVERS = ['remote', 'hq', 'rd', 'archives'];
console.log('per game, this / base, paired diff ± SE');
console.log(' steals (count, then points), by server:');
for (const s of SERVERS) row(`steals from ${s}`, r => r.steals[s]?.n ?? 0);
for (const s of SERVERS) row(`points stolen from ${s}`, r => r.steals[s]?.points ?? 0);
console.log(' Runner accesses and successful runs (breaches), by server:');
for (const s of SERVERS) row(`cards accessed in ${s}`, r => r.access[s] ?? 0);
for (const s of SERVERS) row(`successful runs on ${s}`, r => r.breaches[s] ?? 0);
console.log(' the Corp:');
row('agendas installed (all)', r => r.agendaInstalls);
row('agendas installed in a remote (lossLog)', r => r.remoteAgendaInstalls);
row('agendas scored (SCORE_AGENDA)', r => r.scores);
row('advances', r => r.advances);
row('click draws', r => r.draws);
row('click credits', r => r.creditClicks);
row('remotes (avg over Corp turns)', r => r.board.remotes);
row('remotes with ice (avg over Corp turns)', r => r.board.icedRemotes);
row('ice in remotes (avg over Corp turns)', r => r.board.remoteIce);
row('turns with an agenda in HQ and no remote holding one', r => r.idleAgendaTurns);
row('agenda stuck in HQ alarms', r => r.stuck);
row('agendas left in HQ at the end', r => r.agendasInHQ);
row('agendas left in R&D at the end', r => r.agendasInRD);
for (const t of ['6', '12']) {
  const has = r => r.at[t] !== undefined;
  const both = seeds.filter(s => has(a.get(s)) && has(b.get(s)));
  console.log(` at turn ${t} (${both.length} deals that reached it on both sides):`);
  const keep = seeds.splice(0, seeds.length, ...both);
  row(`ice on HQ, turn ${t}`, r => r.at[t].hqIce);
  row(`ice on R&D, turn ${t}`, r => r.at[t].rdIce);
  row(`remotes with ice, turn ${t}`, r => r.at[t].remotesIced);
  row(`agendas in HQ, turn ${t}`, r => r.at[t].hqAgendas);
  seeds.splice(0, seeds.length, ...keep);
}
const lostThis = seeds.filter(s => a.get(s).winner === 'runner'), lostBase = seeds.filter(s => b.get(s).winner === 'runner');
const avg = (xs, f) => (xs.length ? xs.reduce((p, s) => p + f(s), 0) / xs.length : 0);
console.log(` Corp agenda points in Corp losses: ${avg(lostThis, s => a.get(s).corpScore).toFixed(2)} (${lostThis.length} losses) / ${avg(lostBase, s => b.get(s).corpScore).toFixed(2)} (${lostBase.length} losses)`);
const decked = seeds.filter(s => a.get(s).reason === 'corp decked');
const baseWon = decked.filter(s => b.get(s).winner === 'corp').length;
const baseDecked = seeds.filter(s => b.get(s).reason === 'corp decked');
console.log(` Corp decked: ${decked.length} this / ${baseDecked.length} base; of this batch's ${decked.length}, the base won ${baseWon} on the same deal, was decked on ${decked.filter(s => b.get(s).reason === 'corp decked').length}`);
console.log(`   click draws per game in the decked games: ${avg(decked, s => a.get(s).draws).toFixed(1)} this / ${avg(decked, s => b.get(s).draws).toFixed(1)} base`);
