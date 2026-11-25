// R-14h fix, bar 6: last-credits-fix-reads.ts records summed, per game, branch beside base (paired by deal, mean ± SE),
// each leg's records against its g3 batch's deals.json (winner, cr, sc), the loss classes from those batches' alarms, and
// rev 4 item 5's tripwire (stayed broke losses; the Runner's trashes to 0-2 credits followed by a turn with no card
// played): beyond two standard errors up on the branch, it goes back to the coordinator.
//   node scripts/runner-rework/last-credits-fix-reads-sum.mjs <dir of shard stdout> <base deals.json> <branch deals.json>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [dir, baseDeals, branchDeals] = process.argv.slice(2);
const files = statSync(dir).isDirectory() ? readdirSync(dir, { recursive: true }).map(f => join(dir, String(f))).filter(f => statSync(f).isFile() && f.endsWith('.txt')) : [dir];
const games = { base: new Map(), branch: new Map() };
let errors = 0;
for (const f of files)
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    const r = JSON.parse(line);
    if (r.kind === 'game') games[r.leg].set(r.seed, r);
    if (r.kind === 'error') errors++;
  }
const recs = { base: baseDeals ? JSON.parse(readFileSync(baseDeals, 'utf8')) : [], branch: branchDeals ? JSON.parse(readFileSync(branchDeals, 'utf8')) : [] };
const p = (...x) => console.log(...x);
const f3 = x => (Number.isFinite(x) ? x.toFixed(3) : '-');
const seeds = [...games.base.keys()].filter(s => games.branch.has(s)).sort((a, b) => a - b);
p(`# R-14h fix bar 6: the Corp side's numbers per game, branch beside base\n`);
p(`Games: base ${games.base.size}, branch ${games.branch.size}, paired ${seeds.length}; errors ${errors}.`);
for (const leg of ['base', 'branch']) {
  const byseed = new Map(recs[leg].map(r => [r.seed, r]));
  const eq = [...games[leg].values()].filter(g => {
    const r = byseed.get(g.seed);
    return r && (r.winner ?? null) === g.winner && JSON.stringify(r.cr) === JSON.stringify(g.cr) && JSON.stringify(r.sc) === JSON.stringify(g.sc);
  }).length;
  p(`- ${leg}: ${eq} of ${games[leg].size} equal to the batch's records${recs[leg].length ? '' : ' (no records given)'}.`);
}
const paired = get => {
  const xs = seeds.map(s => get(games.branch.get(s), 'branch') - get(games.base.get(s), 'base'));
  const n = xs.length;
  const m = xs.reduce((a, x) => a + x, 0) / (n || 1);
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, n - 1));
  const mean = leg => seeds.reduce((a, s) => a + get(games[leg].get(s), leg), 0) / (n || 1);
  return { b: mean('base'), r: mean('branch'), m, se: sd / Math.sqrt(n || 1) };
};
const row = (name, get) => {
  const { b, r, m, se } = paired(get);
  p(`| ${name} | ${f3(b)} | ${f3(r)} | ${m >= 0 ? '+' : ''}${f3(m)} ± ${f3(se)}${Math.abs(m) > 2 * se && se > 0 ? ' (beyond 2 SE)' : ''} |`);
  return { m, se };
};
const keys = k => [...new Set(seeds.flatMap(s => [games.base.get(s), games.branch.get(s)].flatMap(g => Object.keys(g[k] ?? {}))))].sort();
const sum = o => Object.values(o ?? {}).reduce((a, x) => a + x, 0);
const head = () => (p(`| per game | base | branch | branch less base ± SE |`), p(`|---|---:|---:|---:|`));
p(`\n## Click draws by each side, by its credits before the draw\n`);
head();
for (const k of keys('draws')) row(`draws, ${k}`, g => g.draws?.[k] ?? 0);
p(`\n## The Corp\n`);
head();
row('operations played', g => sum(g.corpOps));
row('cards drawn by operations', g => sum(g.corpDrawOps));
row('credits gained', g => g.gained);
row('credits spent', g => g.spent);
for (const k of keys('fromHq')) row(`from HQ: ${k}`, g => g.fromHq?.[k] ?? 0);
for (const k of keys('rezzed')) row(`rezzed: ${k}`, g => g.rezzed?.[k] ?? 0);
p(`\nOperations by title (games summed, base / branch): ${keys('corpOps').map(k => `${k} ${seeds.reduce((a, s) => a + (games.base.get(s).corpOps?.[k] ?? 0), 0)} / ${seeds.reduce((a, s) => a + (games.branch.get(s).corpOps?.[k] ?? 0), 0)}`).join('; ')}.`);
p(`\n## The Runner\n`);
head();
for (const k of keys('installs')) row(`installed: ${k}`, g => g.installs?.[k] ?? 0);
for (const k of keys('trashAnswers')) row(`access answer: ${k}`, g => g.trashAnswers?.[k] ?? 0);
p(`\n## The tripwire (rev 4 item 5)\n`);
head();
const byseed = leg => new Map(recs[leg].map(r => [r.seed, r]));
const B = { base: byseed('base'), branch: byseed('branch') };
const broke = (g, leg) => {
  const r = B[leg].get(g.seed);
  return r && r.winner === 'runner' && (r.alarms ?? []).some(a => a.kind === 'Corp stayed broke') ? 1 : 0;
};
const stuck = (g, leg) => {
  const r = B[leg].get(g.seed);
  return r && r.winner === 'runner' && (r.alarms ?? []).some(a => a.kind === 'agenda stuck in HQ') ? 1 : 0;
};
const t1 = row('Corp losses with "stayed broke"', broke);
row('Corp losses with "agenda stuck in HQ"', stuck);
row('Runner trashes leaving it at 0-2 credits', g => g.trip.trashes);
const t2 = row('... then a Runner turn with no card played', g => g.trip.nextNoCard);
row('... then a Runner turn with a card played', g => g.trip.nextPlayed);
row('... then the game ended', g => g.trip.gameOver);
const up = t => t.m > 2 * t.se && t.se > 0;
p(`\nTripwire: ${up(t1) || up(t2) ? '**TRIPPED** (a class rose beyond 2 SE on the branch): back to the coordinator before the merge' : 'not tripped (neither class rose beyond 2 SE)'}.`);
