// B4 step 0: sums step0.ts's lines (brief runner-rework/briefs/b4-hidden-zones.md rev 1a). Measurement only.
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
  console.log(`${p}: ${gs.length} games; matches batch ${match}/${gs.filter(g => g.matchesBatch !== null).length}; shadow ok ${gs.filter(g => g.wOk).length}; decisions ${gs.reduce((n, g) => n + g.decisions, 0)}; shuffles ${gs.reduce((n, g) => n + (g.shuffles ?? 0), 0)}; ms ${gs.reduce((n, g) => n + g.ms, 0)}`);
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
  const keys = [...a.keys()].filter(k => !k.endsWith('|changed') && !k.startsWith('capped') && !k.startsWith('ctrlMismatch') && !k.startsWith('eligible|') && !k.startsWith('dH:')).sort();
  for (const k of keys) {
    const ch = a.get(`${k}|changed`) ?? 0;
    const t = ms.get(k) ?? 0;
    const c = ms.get(k.startsWith('ctrl|') ? k : `ctrl@${k}`) ?? 0;
    const mm = k.startsWith('ctrl|') ? ` mismatch with played ${a.get(`ctrlMismatch|${k.slice(5)}`) ?? 0}` : '';
    console.log(`  ${k}: eligible ${a.get(`eligible|${k}`) ?? '-'}, asked ${a.get(k)}, changed ${ch} (${f2(ch / n)} a game)${mm}; ms ${Math.round(t)} vs control ${Math.round(c)} (${c ? ((100 * (t - c)) / c).toFixed(1) : '-'}%)`);
  }
  for (const k of [...a.keys()].filter(k => k.startsWith('capped') || k.startsWith('dH:')).sort()) console.log(`  ${k}: ${a.get(k)}`);
}

// ---- part 2: shuffled R&D marks (W)
const q = (xs, f) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(f * xs.length))] : NaN);
const dist = xs => !xs.length ? 'n 0' : `n ${xs.length}; p10 ${f2(q(xs, 0.1))}, p50 ${f2(q(xs, 0.5))}, p90 ${f2(q(xs, 0.9))}; min ${f2(Math.min(...xs))}, max ${f2(Math.max(...xs))}`;
console.log('\n## Shuffled R&D marks (one line per mark: turns lived, Runner decisions, share of them truly in R&D)');
for (const p of pools) {
  const ls = by('life').filter(l => l.pool === p);
  const ended = new Map();
  for (const l of ls) add(ended, String(l.endedBy).split(':')[0]);
  console.log(`### ${p}: ${ls.length} marks in ${new Set(ls.map(l => l.src)).size} games; turns ${dist(ls.map(l => l.turns))}; decisions ${dist(ls.map(l => l.decisions))}; truly in R&D ${dist(ls.filter(l => l.decisions).map(l => l.truthInRd / l.decisions))}; ended ${[...ended].map(([k, v]) => `${k} ${v}`).join(', ')}`);
}

// ---- part 2 (rev 1a): pooled odds against marks-aware odds
console.log('\n## Pooled agendaOdds against marks-aware odds (Runner main boards with live marks; differences, no threshold)');
for (const p of pools) {
  const rows = by('od').filter(r => r.pool === p).flatMap(r => r.rows);
  if (!rows.length) continue;
  const col = (i, j) => rows.map(r => r[i] - r[j]);
  console.log(`### ${p} (${rows.length} boards)`);
  console.log(`  hqAware - pooled:     ${dist(col(2, 0))}`);
  console.log(`  hqAware - hqToday:    ${dist(col(2, 1))}`);
  console.log(`  rdTopAware - pooled:  ${dist(col(3, 0))}`);
  console.log(`  poolAware - pooled:   ${dist(col(4, 0))}`);
}

// ---- part 3: root kinds (B4b), distinct (game, turn, server)
console.log('\n## Root kinds (Runner main boards): distinct (game, turn, server) by case');
const cps = by('cp');
for (const p of [...new Set(cps.map(r => poolOf(r.src)))]) {
  const byCase = new Map();
  for (const r of cps.filter(r => poolOf(r.src) === p))
    for (const sv of r.servers)
      for (const c of sv.cases) {
        const e = byCase.get(c) ?? { boards: new Set(), games: new Set(), runs: 0, dv: [], dOdds: [], today: [] };
        const k = `${r.src}|T${r.T}|${sv.sid}`;
        if (e.boards.has(k)) continue;
        e.boards.add(k);
        e.games.add(r.src);
        if (sv.runsHere) e.runs++;
        const u = sv.under[c];
        e.today.push(sv.today.value);
        if (typeof u?.value === 'number' && typeof sv.today.value === 'number') e.dv.push(u.value - sv.today.value);
        if (u) sv.today.odds.forEach((o, i) => typeof o === 'number' && typeof u.odds[i] === 'number' && e.dOdds.push(u.odds[i] - o));
        byCase.set(c, e);
      }
  console.log(`### ${p}`);
  for (const [c, e] of [...byCase].sort()) console.log(`  ${c}: ${e.boards.size} boards in ${e.games.size} games (${[...e.games].slice(0, 6).join(', ')}); runs made there ${e.runs}; today's serverValue ${dist(e.today)}; change ${dist(e.dv)}; odds change ${dist(e.dOdds)}`);
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
