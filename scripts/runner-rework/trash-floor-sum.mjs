// R-B O1a (brief netrunner-ai/runner-rework/briefs/o1a-trash-floor.md rev 1): sums the JSON lines of trash-floor.ts.
//   node scripts/runner-rework/trash-floor-sum.mjs out/*.txt > sum.md
// Pools apart (batch: the 221 deals of g1 45499791395; nrdb: the 110 of NRDB=1 g1 45503877309), never added together.
// MODE=fires   unit: one top-level decision (a GameRunner step that asks an agent) of the base tree's game, by side and
//              kind; a decision "has a fire" when a serverWorth call under it took the 0.5 floor with raw < 0.5, or read a
//              value carried from one (memo, the planner's kept line, the off-turn holder): classes in trash-floor.ts.
// MODE=lockstep  unit: one deal; at the first step whose columns differ, the base tree's fire classes at that step.
//   loose (the brief's bar 2 as written): the first differing decision has a fire of any class.
//   tight (step 0.3's fallback): a Runner decision whose OWN calls fired (class own, or a carried read at its own level:
//   memo:own, line:own, off:own), or a Corp decision whose reply fired (reply, memo:reply, line:reply, off:reply: the Corp
//   prices its options by the reply; it calls no serverWorth itself).
//   A deal whose first difference is not explained is a STOP under that form.
// MODE=play    unit: one g3 game, per leg (base, branch), paired by seed: the mean per game of each count, branch less
//              base with its standard error over the paired games. DEALS_BASE / DEALS_BRANCH (env): the g3 batches'
//              deals.json, to check each game's record (winner, cr, sc) and to read the loss summary's two trend classes
//              per game (its alarms "Corp stayed broke", "agenda stuck in HQ").
import { readFileSync, readdirSync } from 'node:fs';

const lines = [];
for (const f of process.argv.slice(2)) {
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    if (!l.startsWith('{')) continue;
    try {
      lines.push(JSON.parse(l));
    } catch {
      /* a cut line */
    }
  }
}
const titles = {};
for (const f of readdirSync('src/data').filter(f => f.endsWith('-cards.json'))) {
  const d = JSON.parse(readFileSync(`src/data/${f}`, 'utf8'));
  for (const c of Array.isArray(d) ? d : (d.data ?? [])) titles[c.code] = c.title;
}
const POOLS = ['batch', 'nrdb'];
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
const out = [];
const p = s => out.push(s);
const errs = lines.filter(x => x.kind === 'error');

// ------------------------------------------------------------------------------------------------ fires
const fires = lines.filter(x => x.mode === 'fires' && x.kind === 'deal');
if (fires.length) {
  p('# O1a step 0.1: the floor\'s fires on the base tree');
  p('');
  p(`Deals: ${POOLS.map(pool => `${pool} ${fires.filter(d => d.pool === pool).length}`).join(', ')}; equal to the batch record (winner, cr, sc): ${POOLS.map(pool => `${pool} ${fires.filter(d => d.pool === pool && d.recordSame).length}`).join(', ')}. Errors: ${errs.filter(e => e.mode === 'fires').length}.`);
  const bad = fires.filter(d => !d.recordSame);
  if (bad.length) p(`**STOP: source games that do not match the batch record: ${bad.map(d => `${d.pool}:${d.seed}`).join(', ')}**`);
  p('');
  for (const pool of POOLS) {
    const ds = fires.filter(d => d.pool === pool);
    if (!ds.length) continue;
    const rows = {};
    const cls = {};
    for (const d of ds) {
      for (const [k, r] of Object.entries(d.by)) {
        const row = (rows[k] ??= { n: 0, fired: 0, deals: 0 });
        row.n += r.n;
        row.fired += r.fired;
        if (r.fired) row.deals++;
        for (const [c, n] of Object.entries(r.cls)) {
          (cls[k] ??= {})[c] = (cls[k]?.[c] ?? 0) + n;
        }
      }
    }
    const all = Object.values(rows).reduce((a, r) => ({ n: a.n + r.n, fired: a.fired + r.fired }), { n: 0, fired: 0 });
    const dealsFired = ds.filter(d => Object.values(d.by).some(r => r.fired)).length;
    p(`## ${pool}: ${ds.length} deals, ${dealsFired} with a fire (${pct(dealsFired, ds.length)}); ${all.fired} of ${all.n} decisions have a fire (${pct(all.fired, all.n)})`);
    p('');
    p('| side:kind | decisions | with a fire | share | deals with one | by class (decisions; a decision can have several) |');
    p('|---|---:|---:|---:|---:|---|');
    for (const k of Object.keys(rows).sort()) {
      const r = rows[k];
      const c = Object.entries(cls[k] ?? {}).sort((a, b) => b[1] - a[1]).map(([x, n]) => `${x} ${n}`).join(', ');
      p(`| ${k} | ${r.n} | ${r.fired} | ${pct(r.fired, r.n)} | ${r.deals} | ${c || '-'} |`);
    }
    p('');
    // The decisions with a fire, by card (a decision counts once for each card that fired in it)
    const cards = {};
    const cardDeals = {};
    for (const d of ds) for (const [c, n] of Object.entries(d.cards)) {
      cards[c] = (cards[c] ?? 0) + n;
      cardDeals[c] = (cardDeals[c] ?? 0) + 1;
    }
    p(`By card (decisions with a fire of that card; deals): ${Object.entries(cards).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${titles[c] ?? c} ${n} (${cardDeals[c]})`).join(', ') || 'none'}.`);
    // Deals where most decisions have a fire (red team finding 3)
    const heavy = ds.map(d => {
      const t = Object.values(d.by).reduce((a, r) => ({ n: a.n + r.n, f: a.f + r.fired }), { n: 0, f: 0 });
      return { seed: d.seed, share: t.n ? t.f / t.n : 0, first: d.firstFire };
    });
    const over = s => heavy.filter(h => h.share >= s).length;
    p(`Deals by their share of decisions with a fire: 0% ${heavy.filter(h => h.share === 0).length}, under 25% ${heavy.filter(h => h.share > 0 && h.share < 0.25).length}, 25-50% ${over(0.25) - over(0.5)}, 50% or more ${over(0.5)}.`);
    const firstT = heavy.filter(h => h.first).map(h => h.first.T).sort((a, b) => a - b);
    if (firstT.length) p(`Turn of the first fire in a deal: median T${firstT[Math.floor(firstT.length / 2)]} (first quartile T${firstT[Math.floor(firstT.length / 4)]}, last T${firstT[firstT.length - 1]}).`);
    p('');
  }
}

// ------------------------------------------------------------------------------------------------ lockstep
const lock = lines.filter(x => x.mode === 'lockstep' && x.kind === 'deal');
if (lock.length) {
  p('# O1a lockstep: where play changes against the base');
  p('');
  const own = new Set(['own', 'memo:own', 'line:own', 'off:own']);
  const reply = new Set(['reply', 'memo:reply', 'line:reply', 'off:reply']);
  const loose = d => d.diff.fires.length > 0;
  const tight = d => (d.diff.side === 'runner' ? d.diff.fires.some(c => own.has(c)) : d.diff.fires.some(c => reply.has(c)));
  const legs = [...new Set(lock.map(d => d.leg))];
  for (const leg of legs) {
    p(`## leg ${leg}${leg === 'branch' ? ' (this checkout against the base)' : ' (a planted fault on a copy of the base: every difference is the fault\'s)'}`);
    p('');
    p(`Errors: ${errs.filter(e => e.mode === 'lockstep' && e.leg === leg).length}. Control against base: ${lock.filter(d => d.leg === leg && d.diff && d.diff.controlCols.length).length} deals differ (must be 0).`);
    p('');
    p('| pool | deals | differ | first difference at a decision with a fire (loose) | STOP loose | with the decision\'s own options fired (tight) | STOP tight | first differs by side:kind |');
    p('|---|---:|---:|---:|---:|---:|---:|---|');
    for (const pool of POOLS) {
      const ds = lock.filter(d => d.leg === leg && d.pool === pool);
      if (!ds.length) continue;
      const diff = ds.filter(d => d.diff);
      const kinds = {};
      for (const d of diff) kinds[`${d.diff.side}:${d.diff.kind}`] = (kinds[`${d.diff.side}:${d.diff.kind}`] ?? 0) + 1;
      p(`| ${pool} | ${ds.length} | ${diff.length} | ${diff.filter(loose).length} | ${diff.filter(d => !loose(d)).length} | ${diff.filter(tight).length} | ${diff.filter(d => !tight(d)).length} | ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')} |`);
    }
    p('');
    const stops = lock.filter(d => d.leg === leg && d.diff && !tight(d));
    if (stops.length) {
      p(`Deals not explained under the tight form (${stops.length}; "loose" says whether the loose form explains it):`);
      for (const d of stops.slice(0, 60)) p(`- ${d.pool}:${d.seed} step ${d.diff.step} T${d.diff.T} ${d.diff.side}:${d.diff.kind} columns ${d.diff.branchCols.join(',')} fires [${d.diff.fires.join(', ')}] ${loose(d) ? 'loose: explained' : 'loose: STOP'}`);
      if (stops.length > 60) p(`- ... ${stops.length - 60} more`);
      p('');
    }
    const fired = lock.filter(d => d.leg === leg && d.diff && loose(d));
    const byCls = {};
    for (const d of fired) for (const c of d.diff.fires) byCls[c] = (byCls[c] ?? 0) + 1;
    const byCard = {};
    for (const d of fired) for (const c of d.diff.cards ?? []) byCard[c] = (byCard[c] ?? 0) + 1;
    p(`First differences with a fire, by class: ${Object.entries(byCls).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ') || 'none'}; by card: ${Object.entries(byCard).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${titles[c] ?? c} ${n}`).join(', ') || 'none'}.`);
    p(`Steps before the first difference with a fire on the base tree: ${lock.filter(d => d.leg === leg).reduce((n, d) => n + (d.firedSteps ?? 0), 0)} (fires that changed no record).`);
    const times = lines.filter(x => x.mode === 'lockstep' && x.kind === 'time' && x.leg === leg);
    const sum = n => times.reduce((a, t) => ({ corp: a.corp + t.ms[n].corp, runner: a.runner + t.ms[n].runner }), { corp: 0, runner: 0 });
    if (times.length) {
      const [b, br, c] = ['base', 'branch', 'control'].map(sum);
      const r = (x, y) => (y ? `${((x / y - 1) * 100).toFixed(1)}%` : '-');
      p(`Time over the steps the three trees play alike (ms; corp / runner / both): base ${b.corp} / ${b.runner}, branch ${br.corp} / ${br.runner}, control ${c.corp} / ${c.runner}; branch against control ${r(br.corp, c.corp)} / ${r(br.runner, c.runner)} / ${r(br.corp + br.runner, c.corp + c.runner)}; base against control ${r(b.corp + b.runner, c.corp + c.runner)} (identical trees).`);
    }
    p('');
  }
}

// ------------------------------------------------------------------------------------------------ play
const plays = lines.filter(x => x.mode === 'play' && x.kind === 'game');
if (plays.length) {
  p('# O1a bar 6: the Corp side\'s numbers, per g3 game, branch beside base');
  p('');
  const by = { base: new Map(), branch: new Map() };
  for (const g of plays) by[g.leg]?.set(g.seed, g);
  const deals = {};
  for (const leg of ['base', 'branch']) {
    const f = process.env[`DEALS_${leg.toUpperCase()}`];
    if (f) deals[leg] = new Map(JSON.parse(readFileSync(f, 'utf8')).map(d => [d.seed, d]));
  }
  const same = (g, d) => d && (g.winner ?? null) === (d.winner ?? null) && JSON.stringify(g.cr) === JSON.stringify(d.cr) && JSON.stringify(g.sc) === JSON.stringify(d.sc);
  for (const leg of ['base', 'branch']) {
    if (!deals[leg]) continue;
    const games = [...by[leg].values()];
    const bad = games.filter(g => !same(g, deals[leg].get(g.seed)));
    p(`${leg}: ${games.length} games, equal to the g3 batch's record: ${games.length - bad.length}${bad.length ? ` (**differ: ${bad.slice(0, 20).map(g => g.seed).join(', ')}**)` : ''}.`);
  }
  const seeds = [...by.base.keys()].filter(s => by.branch.has(s)).sort((a, b) => a - b);
  p(`Paired games: ${seeds.length}. Errors: ${errs.filter(e => e.mode === 'play').length}.`);
  p('');
  const alarm = (leg, seed, kind) => (deals[leg]?.get(seed)?.alarms ?? []).filter(a => a.kind === kind).length;
  const counts = [
    ['Runner runs', g => g.runs.hq + g.runs.rd + g.runs.archives + g.runs.remote],
    ['  on HQ', g => g.runs.hq],
    ['  on R&D', g => g.runs.rd],
    ['  on Archives', g => g.runs.archives],
    ['  on remotes', g => g.runs.remote],
    ['  on remotes with no unrezzed root card', g => g.bareRemoteRuns],
    ['agenda points stolen', g => Object.values(g.stolen).reduce((a, b) => a + b, 0)],
    ['  from HQ', g => g.stolen.hq],
    ['  from R&D', g => g.stolen.rd],
    ['  from Archives', g => g.stolen.archives],
    ['  from remotes', g => g.stolen.remote],
    ['assets and upgrades the Runner trashed', g => (g.trashed.asset ?? 0) + (g.trashed.upgrade ?? 0)],
    ['  assets', g => g.trashed.asset ?? 0],
    ['  upgrades', g => g.trashed.upgrade ?? 0],
    ['  offered (accessed, a trash cost)', g => (g.offered.asset ?? 0) + (g.offered.upgrade ?? 0)],
    ['Corp credits gained', g => g.gained],
    ['Corp win (points or flatline)', g => (g.winner === 'corp' ? 1 : 0)],
    ['game length (turns)', g => g.T],
  ];
  const trend = [
    ['Corp stayed broke (alarms, per game)', (leg, g) => alarm(leg, g.seed, 'Corp stayed broke')],
    ['agenda stuck in HQ (alarms, per game)', (leg, g) => alarm(leg, g.seed, 'agenda stuck in HQ')],
  ];
  const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const se = xs => {
    const m = mean(xs);
    return xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1) / xs.length) : 0;
  };
  const f = x => (Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));
  p('| per game | base | branch | branch - base (± SE, paired) |');
  p('|---|---:|---:|---:|');
  const row = (name, get) => {
    const b = seeds.map(s => get('base', by.base.get(s)));
    const r = seeds.map(s => get('branch', by.branch.get(s)));
    const d = seeds.map((_, i) => r[i] - b[i]);
    p(`| ${name} | ${f(mean(b))} | ${f(mean(r))} | ${mean(d) >= 0 ? '+' : ''}${f(mean(d))} ± ${f(se(d))} |`);
  };
  for (const [name, get] of counts) row(name, (_leg, g) => get(g));
  if (deals.base && deals.branch) for (const [name, get] of trend) row(name, get);
  p('');
  p(`Games that differ in record between the legs: ${seeds.filter(s => JSON.stringify([by.base.get(s).winner, by.base.get(s).cr, by.base.get(s).sc]) !== JSON.stringify([by.branch.get(s).winner, by.branch.get(s).cr, by.branch.get(s).sc])).length} of ${seeds.length}; winner moved to the Corp ${seeds.filter(s => by.base.get(s).winner !== 'corp' && by.branch.get(s).winner === 'corp').length}, to the Runner ${seeds.filter(s => by.base.get(s).winner === 'corp' && by.branch.get(s).winner !== 'corp').length}.`);
  p('');
}
if (errs.length) {
  p('## Errors');
  for (const e of errs.slice(0, 10)) p(`- ${e.mode} ${e.leg} ${e.pool}:${e.seed}: ${String(e.error).split('\n')[0]}`);
}
console.log(out.join('\n'));
