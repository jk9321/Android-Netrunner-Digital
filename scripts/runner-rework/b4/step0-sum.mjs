// B4 step 0: sums step0.ts's lines (brief runner-rework/briefs/b4-hidden-zones.md rev 0). Measurement only.
//   node scripts/runner-rework/b4/step0-sum.mjs <dir or files of step0.ts stdout> [--sites] [--changes]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const files = args
  .filter(a => !a.startsWith('--'))
  .flatMap(p => (statSync(p).isDirectory() ? readdirSync(p, { recursive: true }).map(f => join(p, f)).filter(f => /\.(jsonl|txt|out|log)$/.test(f) && statSync(f).isFile()) : [p]));
const lines = [];
for (const f of files)
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    if (!l.startsWith('{')) continue;
    try {
      lines.push(JSON.parse(l));
    } catch {
      /* not a record */
    }
  }
const by = k => lines.filter(x => x.kind === k);
const poolOf = src => src.split(':')[0];
const add = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
const f2 = x => (Number.isFinite(x) ? x.toFixed(3) : String(x));

// ---- games
const games = by('g');
const pools = [...new Set(games.map(g => g.pool))];
console.log('## Games');
for (const p of pools) {
  const gs = games.filter(g => g.pool === p);
  const match = gs.filter(g => g.matchesBatch === true).length;
  console.log(`${p}: ${gs.length} games; matches batch ${match}/${gs.filter(g => g.matchesBatch !== null).length}; shadow ok ${gs.filter(g => g.wOk).length}; decisions ${gs.reduce((n, g) => n + g.decisions, 0)}; boards asked ${gs.reduce((n, g) => n + g.boards, 0)}; ms ${gs.reduce((n, g) => n + g.ms, 0)}`);
}
const errs = by('err');
console.log(`errors: ${errs.length}`);
for (const e of errs.slice(0, 10)) console.log('  ', JSON.stringify(e).slice(0, 300));
const shards = by('s');
console.log(`shards: ${shards.length}, sources ${shards.reduce((n, s) => n + s.sources, 0)}`);

// ---- part 2: the marks gap
console.log('\n## Marks gap (per pool; sums over the Runner decisions)');
for (const p of pools) {
  const m = new Map();
  const gamesWith = new Map();
  for (const r of by('mk').filter(r => r.pool === p)) {
    for (const [k, v] of Object.entries(r.mk)) {
      add(m, k, v);
      add(gamesWith, k);
    }
  }
  const n = games.filter(g => g.pool === p).length;
  console.log(`### ${p} (${n} games, ${m.get('runnerDecisions') ?? 0} Runner decisions)`);
  for (const [k, v] of [...m].sort()) console.log(`  ${k}: ${v} (${gamesWith.get(k)} games; ${f2(v / n)} a game)`);
}

// ---- asks and changes
console.log('\n## Asks and changes (arm | side | kind: asked, changed, a game; control mismatch)');
for (const p of pools) {
  const a = new Map();
  const ms = new Map();
  for (const r of by('ask').filter(r => r.pool === p)) {
    for (const [k, v] of Object.entries(r.asks)) add(a, k, v);
    for (const [k, v] of Object.entries(r.ms)) add(ms, k, v);
  }
  const n = games.filter(g => g.pool === p).length;
  console.log(`### ${p} (${n} games)`);
  const keys = [...a.keys()].filter(k => !k.endsWith('|changed') && !k.startsWith('capped') && !k.startsWith('ctrlMismatch')).sort();
  for (const k of keys) {
    const ch = a.get(`${k}|changed`) ?? 0;
    const t = ms.get(k) ?? 0;
    const c = ms.get(k.startsWith('ctrl|') ? k : `ctrl@${k}`) ?? 0;
    const mm = k.startsWith('ctrl|') ? ` mismatch with played ${a.get(`ctrlMismatch|${k.slice(5)}`) ?? 0}` : '';
    console.log(`  ${k}: asked ${a.get(k)}, changed ${ch} (${f2(ch / n)} a game)${mm}; ms ${Math.round(t)} vs control ${Math.round(c)} (${c ? ((100 * (t - c)) / c).toFixed(1) : '-'}%)`);
  }
  for (const k of [...a.keys()].filter(k => k.startsWith('capped')).sort()) console.log(`  ${k}: ${a.get(k)}`);
}

// ---- part 3: #66b classes
console.log('\n## R-13 (#66b) boards (Runner main decisions, no run): distinct (game, turn, server)');
const r13 = by('r13');
for (const p of [...new Set(r13.map(r => poolOf(r.src)))]) {
  const boards = new Map();
  for (const r of r13.filter(r => poolOf(r.src) === p))
    for (const sv of r.servers) {
      const cls = [...new Set(sv.odds.map(o => o.cls))].join('');
      const k = `${r.src}|T${r.T}|${sv.sid}`;
      const b = boards.get(k) ?? { cls, n: 0, runs: 0, today: sv.value, ra: sv.ra?.value, rb: sv.rb?.value, odds: sv.odds, raOdds: sv.ra?.odds, rbOdds: sv.rb?.odds, src: r.src };
      b.n++;
      if (sv.runsHere) b.runs++;
      boards.set(k, b);
    }
  const byCls = new Map();
  for (const b of boards.values()) {
    const e = byCls.get(b.cls) ?? { boards: 0, games: new Set(), runs: 0, dv: [], dOdds: [] };
    e.boards++;
    e.games.add(b.src);
    e.runs += b.runs;
    const arm = b.ra ?? b.rb;
    if (typeof arm === 'number' && typeof b.today === 'number') e.dv.push(arm - b.today);
    const ao = b.raOdds ?? b.rbOdds;
    if (ao) b.odds.forEach((o, i) => typeof o.odds === 'number' && e.dOdds.push(ao[i].odds - o.odds));
    byCls.set(b.cls, e);
  }
  console.log(`### ${p}`);
  const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  for (const [cls, e] of [...byCls].sort()) console.log(`  class ${cls}: ${e.boards} boards in ${e.games.size} games; runs made there ${e.runs}; mean odds change ${f2(mean(e.dOdds))}; mean serverValue change ${f2(mean(e.dv))} (min ${f2(Math.min(...e.dv))})`);
}

// ---- sites
if (flags.has('--sites')) {
  console.log('\n## Hidden-zone gains and losses seen (zone | in/out | other place | seen?), with the top labels');
  const m = new Map();
  const lab = new Map();
  for (const r of by('site'))
    for (const [k, v] of Object.entries(r.sites)) {
      const [z, dir, other, seen, ...label] = k.split('|');
      const kk = `${z}|${dir}|${other}|${seen}`;
      add(m, kk, v);
      const l = lab.get(kk) ?? new Map();
      add(l, label.join('|'), v);
      lab.set(kk, l);
    }
  for (const [k, v] of [...m].sort())
    console.log(
      `  ${k}: ${v}   ${[...lab.get(k)]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([l, n]) => `${l} ${n}`)
        .join('; ')}`
    );
}

// ---- changes
if (flags.has('--changes')) {
  console.log('\n## Changed decisions');
  for (const c of by('ch')) console.log(`  ${c.src} T${c.T} #${c.n} ${c.arm} ${c.side} ${c.decision}: ctrl ${c.ctrl} -> ${c.arm_a}${c.ctrl !== c.played ? ` (played ${c.played})` : ''}  ${JSON.stringify(c.ctx).slice(0, 300)}`);
}
