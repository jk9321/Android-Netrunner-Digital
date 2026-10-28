// Sums scripts/pace.ts shards and prints the PACE averages: node scripts/pace-sum.mjs pace-*.json
import { readFileSync } from 'node:fs';
const all = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, 'utf8').trim().split('\n').pop()));
const sum = key => all.reduce((n, s) => n + s[key], 0);
const turns = sum('runnerTurns');
const servers = {};
for (const k of ['hq', 'rd', 'archives', 'remote']) servers[k] = all.reduce((t, s) => ({ runs: t.runs + s.servers[k].runs, successful: t.successful + s.servers[k].successful }), { runs: 0, successful: 0 });
const runs = Object.values(servers).reduce((n, v) => n + v.runs, 0);
const ok = Object.values(servers).reduce((n, v) => n + v.successful, 0);
const pct = x => (100 * x).toFixed(1) + '%';
console.log(`${sum('games')} games, ${turns} Runner turns`);
console.log(`runs a turn: ${(runs / turns).toFixed(2)}; success: ${pct(ok / runs)}`);
for (const [k, v] of Object.entries(servers)) console.log(`  ${k}: ${pct(v.runs / runs)} of runs, success ${pct(v.successful / Math.max(1, v.runs))}`);
console.log(`advanced agenda in a remote: run that turn ${pct(sum('agendaRemoteRun') / Math.max(1, sum('agendaRemoteTurns')))} (${sum('agendaRemoteTurns')} turns)`);
console.log(`R&D share of runs with Conduit: ${pct(sum('conduitRdRuns') / Math.max(1, sum('conduitRuns')))} (${sum('conduitRuns')} runs)`);
console.log(`agendas scored or stolen a Runner turn: ${(sum('agendaEvents') / turns).toFixed(2)}; ice rezzed a turn: ${(sum('rezzes') / turns).toFixed(2)}`);
