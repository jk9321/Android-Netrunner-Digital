// Sums scripts/stage-d/game-end.ts output (Stage D item 4 step 1). Usage:
//   node scripts/stage-d/game-end-sum.mjs <dir or files...> [--list] [--losses] [--cont]
// Reads every *.txt under a directory (the ai-script artifact's out/), or the files given.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const paths = args.filter(a => !a.startsWith('--'));
const files = [];
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).forEach(f => walk(join(p, f))) : p.endsWith('.txt') && files.push(p));
paths.forEach(walk);

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
const of = k => rows.filter(r => r.kind === k);
const decisions = of('decision');
const ends = of('end');
const losses = of('loss');
const conts = of('cont');
const WHO = ['self', 'person-runner', 'person-corp'];
const games = Object.fromEntries(WHO.map(w => [w, ends.filter(e => e.who === w).length]));
const arms = [...new Set(decisions.flatMap(d => Object.keys(d.ms)))].filter(a => a !== 'base');
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : '-');
const per = (n, g) => (g ? (n / g).toFixed(2) : '-');

console.log(`files ${files.length}; decisions ${decisions.length}; games ${JSON.stringify(games)}; losses on points ${losses.length}; continuations ${conts.length}`);
console.log(`errors: ${decisions.filter(d => Object.values(d.picks).some(p => typeof p === 'string' && p.startsWith('error'))).length} decisions with an error pick`);

// 1. Decisions changed a game
console.log('\n## Decisions changed (a game), all decisions / where a server can end the game on one access');
console.log(`| arm | ${WHO.map(w => `${w} (${games[w]})`).join(' | ')} |`);
console.log(`|---|${WHO.map(() => '---').join('|')}|`);
for (const arm of arms) {
  const cells = WHO.map(w => {
    const ds = decisions.filter(d => d.who === w);
    const all = ds.filter(d => d.changed.includes(arm)).length;
    const at = ds.filter(d => d.changed.includes(arm) && d.ends.length).length;
    return `${all} (${per(all, games[w])}) / ${at} (${per(at, games[w])})`;
  });
  console.log(`| ${arm} | ${cells.join(' | ')} |`);
}
console.log('\nDecisions where some server can end the game on one access:', WHO.map(w => `${w} ${decisions.filter(d => d.who === w && d.ends.length).length} of ${decisions.filter(d => d.who === w).length}`).join('; '));
const endsBy = {};
for (const d of decisions.filter(d => d.ends.length)) for (const e of d.ends) {
  const k = e.id.startsWith('remote') ? 'remote' : e.id;
  endsBy[k] ??= { n: 0, holds: 0 };
  endsBy[k].n++;
  if (e.holds) endsBy[k].holds++;
}
console.log('  by server (decisions, of which it holds by the count):', JSON.stringify(endsBy));

// Time
console.log('\n## Time (decisions where base took 50 ms or more): mean of arm/base, and the sums');
for (const arm of arms) {
  const ds = decisions.filter(d => d.ms.base >= 50 && d.ms[arm] !== undefined);
  const r = ds.map(d => d.ms[arm] / d.ms.base);
  const sa = ds.reduce((n, d) => n + d.ms[arm], 0);
  const sb = ds.reduce((n, d) => n + d.ms.base, 0);
  console.log(`${arm}: mean ratio ${(r.reduce((a, b) => a + b, 0) / Math.max(1, r.length)).toFixed(3)} over ${ds.length}; sum ratio ${(sa / sb).toFixed(3)}`);
}

// Layers of the changed picks
console.log('\n## Changed decisions by phase and the base pick\'s layer');
for (const arm of arms) {
  const ch = decisions.filter(d => d.changed.includes(arm));
  const t = {};
  for (const d of ch) {
    const k = `${d.phase}:${d.layers.base ?? '-'}→${d.layers[arm] ?? '-'}`;
    t[k] = (t[k] ?? 0) + 1;
  }
  console.log(`${arm} (${ch.length}):`, JSON.stringify(t));
}

// 2. Losses
console.log('\n## Losses on agenda points (the Corp\'s last turn before the winning access)');
for (const w of WHO) {
  const ls = losses.filter(l => l.who === w);
  const c = k => ls.filter(l => l.class === k).length;
  console.log(`${w}: games ${games[w]}, Runner wins on points ${ls.length}; a (held by the count) ${c('a')}, b (a move would have held) ${c('b')}, c (no move held) ${c('c')}, n (not one access at the turn end) ${c('n')}`);
  const byServer = {};
  for (const l of ls) byServer[l.server?.startsWith('remote') ? 'remote' : l.server] = (byServer[l.server?.startsWith('remote') ? 'remote' : l.server] ?? 0) + 1;
  console.log(`   by server ${JSON.stringify(byServer)}; multi-access wins ${ls.filter(l => l.extra > 0).length}`);
}
console.log('\nReplays of the losing turn (a, b and c losses): the server holds at the turn end, per tree');
for (const cls of ['a', 'b', 'c']) {
  const ls = losses.filter(l => l.class === cls);
  if (!ls.length) continue;
  const cells = ['base', ...arms].map(arm => `${arm} ${ls.filter(l => l.replay?.[arm]?.held?.[l.server]?.holds).length}`);
  console.log(`  ${cls} (${ls.length}): ${cells.join(', ')}`);
}

if (flags.has('--losses')) {
  console.log('\n## Every loss');
  for (const l of losses) {
    console.log(`\n${l.src} (${l.who}) T${l.T}: through ${l.server} (+${l.runPts}, extra accesses ${l.extra}); Corp turn ${l.corpTurn}, score ${JSON.stringify(l.scoreAtEnd)}, ends at start ${l.endsAtStart} / end ${l.endsAtEnd} (pts ${l.ptsAtEnd}); ice ${l.ice} (unrezzed ${l.unrezzed}); hold ${JSON.stringify(l.hold)}; credits ${JSON.stringify(l.corp)}; class ${l.class}`);
    if (l.holdingMoves?.length) console.log(`  holding moves: ${l.holdingMoves.join('; ')}`);
    console.log(`  Corp's moves: ${(l.corpMoves ?? []).map(m => `${m.a}${m.layer ? ` [${m.layer}]` : ''}`).join(', ')}`);
    for (const [arm, r] of Object.entries(l.replay ?? {})) console.log(`  replay ${arm}: ${JSON.stringify(r.held)} ← ${r.moves.join(', ')}`);
  }
}

if (flags.has('--list')) {
  console.log('\n## Every changed decision');
  for (const d of decisions.filter(d => d.changed.length)) {
    console.log(`\n${d.src} (${d.who}) #${d.i} T${d.T} ${d.phase} Corp ${d.corp}cr ${d.clicks}cl score ${JSON.stringify(d.score)} ends ${JSON.stringify(d.ends)}`);
    console.log(`  base: ${d.picks.base} [${d.layers.base ?? '-'}]`);
    for (const arm of d.changed) console.log(`  ${arm}: ${d.picks[arm]} [${d.layers[arm] ?? '-'}]`);
    for (const c of conts.filter(c => c.src === d.src && c.i === d.i)) console.log(`    cont ${c.arm}: held ${JSON.stringify(c.held)} | moves ${c.moves.join(', ')} | runs ${JSON.stringify(c.runs)} | winner ${c.winner}`);
  }
}

if (flags.has('--cont')) {
  console.log('\n## Continuations: does the ends-server hold at the Corp turn end; does the Runner win next turn');
  const by = {};
  for (const c of conts) {
    const k = c.arm;
    by[k] ??= { n: 0, held: 0, runnerWins: 0, servers: 0 };
    by[k].n++;
    const hs = Object.values(c.held).filter(Boolean);
    by[k].servers += hs.length;
    by[k].held += hs.filter(h => h.holds).length;
    if (c.winner === 'runner') by[k].runnerWins++;
  }
  console.log(JSON.stringify(by, null, 1));
}
