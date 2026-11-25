// F108 build bar 6: sums scripts/tag-owner/owner-reads.ts output (every shard's stdout, JSON lines), base beside branch.
//   node scripts/tag-owner/owner-reads-sum.mjs <dir with the shards' .txt files> [base deals.json] [branch deals.json]
// With the two g3 batches' deals.json, each leg's games are checked against its batch (winner, cr, sc) and the batches'
// loss classes (Corp stayed broke, agenda stuck in HQ) are read per game.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [dir, baseDeals, branchDeals] = process.argv.slice(2);
const files = [];
const walk = d => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.txt')) files.push(p);
  }
};
walk(dir);
const rows = [];
for (const f of files)
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* a cut line */
    }
  }
const games = rows.filter(r => r.kind === 'game');
const errors = rows.filter(r => r.kind === 'error');
const legs = ['base', 'branch'];
const add = (t, o, n = 1) => {
  for (const [k, v] of Object.entries(o ?? {})) t[k] = (t[k] ?? 0) + v * n;
};
const top = (t, n = 12) =>
  Object.entries(t)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
const per = (x, n) => (n ? (x / n).toFixed(3) : '-');
const batch = { base: baseDeals, branch: branchDeals };
const S = {};
for (const leg of legs) {
  const gs = games.filter(g => g.leg === leg);
  const s = { n: gs.length, took: {}, tookBy: {}, cleared: {}, held: 0, heldGames: 0, tagTrash: {}, chances: 0, taken: 0, ops: {}, bp: {}, b1001i: 0, b1001r: 0, runs: 0, runsIce: 0, match: null, broke: null, stuck: null };
  for (const g of gs) {
    add(s.took, g.took);
    add(s.tookBy, g.tookBy);
    add(s.cleared, g.cleared);
    s.held += g.heldAtEnd;
    if (g.heldAtEnd > 0) s.heldGames++;
    add(s.tagTrash, g.tagTrash);
    s.chances += g.chances;
    s.taken += g.chancesTaken;
    add(s.ops, g.opsTagged);
    for (const b of g.bp) {
      const k = `mode ${b.mode}`;
      const e = (s.bp[k] ??= { plays: 0, credits: 0, tags: 0, resources: 0 });
      e.plays++;
      e.credits += b.credits;
      e.tags += b.tags;
      e.resources += b.resources;
    }
    s.b1001i += g.b1001Installed;
    s.b1001r += g.b1001Rezzed;
    s.runs += g.runs;
    s.runsIce += g.runsIceTag;
  }
  if (batch[leg]) {
    const recs = new Map(JSON.parse(readFileSync(batch[leg], 'utf8')).map(d => [d.seed, d]));
    s.match = gs.filter(g => {
      const d = recs.get(g.seed);
      return d && d.winner === g.winner && JSON.stringify(d.cr) === JSON.stringify(g.cr) && JSON.stringify(d.sc) === JSON.stringify(g.sc);
    }).length;
    s.broke = [...recs.values()].filter(d => d.alarms?.some(a => a.kind === 'Corp stayed broke')).length;
    s.stuck = [...recs.values()].filter(d => d.alarms?.some(a => a.kind === 'agenda stuck in HQ')).length;
    s.recs = recs.size;
  }
  S[leg] = s;
}
const row = (label, f) => console.log(`| ${label} | ${legs.map(l => f(S[l])).join(' | ')} |`);
console.log(`| per game (games) | base (${S.base.n}) | branch (${S.branch.n}) |`);
console.log('|---|--:|--:|');
row('record equal to its g3 batch (winner, cr, sc)', s => (s.match === null ? '-' : `${s.match} of ${s.n}`));
for (const k of ['ice', 'corp', 'runner', 'access', 'trash']) row(`tags taken: ${k}`, s => per(s.took[k] ?? 0, s.n));
row('tags taken: all', s => per(Object.values(s.took).reduce((a, b) => a + b, 0), s.n));
row('tags cleared: the Runner basic action', s => per(s.cleared['runner basic action'] ?? 0, s.n));
row('tags cleared: a Runner card', s => per(Object.entries(s.cleared).filter(([k]) => k.startsWith('runner ') && k !== 'runner basic action').reduce((a, [, v]) => a + v, 0), s.n));
row('tags cleared: by the Corp (its own cards)', s => per(Object.entries(s.cleared).filter(([k]) => k.startsWith('corp ')).reduce((a, [, v]) => a + v, 0), s.n));
row('tags held at the end (games holding any)', s => `${per(s.held, s.n)} (${s.heldGames})`);
row('resources trashed by the tag action', s => per(Object.values(s.tagTrash).reduce((a, b) => a + b, 0), s.n));
row('chances to trash (taken)', s => `${per(s.chances, s.n)} (${s.taken})`);
row('Corp operations played while tagged', s => per(Object.values(s.ops).reduce((a, b) => a + b, 0), s.n));
row('B-1001 installed / rezzed', s => `${s.b1001i} / ${s.b1001r}`);
row('Runner runs; runs where ice gave a tag', s => `${per(s.runs, s.n)}; ${per(s.runsIce, s.n)}`);
row('loss classes in the batch: stayed broke / stuck in HQ (games)', s => (s.broke === null ? '-' : `${s.broke} / ${s.stuck}`));
for (const leg of legs) {
  const s = S[leg];
  console.log(`\n${leg}:`);
  console.log(`  tags by source and card: ${top(s.tookBy, 16)}`);
  console.log(`  cleared by: ${top(s.cleared)}`);
  console.log(`  the Corp's own removals by card: ${top(Object.fromEntries(Object.entries(s.cleared).filter(([k]) => k.startsWith('corp '))))}`);
  console.log(`  tag-action trashes by resource: ${top(s.tagTrash)}`);
  console.log(`  operations played while tagged: ${top(s.ops, 16)}`);
  console.log(`  Bigger Picture by mode: ${JSON.stringify(s.bp)}`);
}
console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log(`  ${e.leg} ${e.seed} ${String(e.error).slice(0, 200)}`);
console.log(`shards reporting: ${rows.filter(r => r.kind === 's').length}`);
