#!/usr/bin/env node
/**
 * Sums scripts/stage-d/place-open.ts output (brief stage-d/item5-placement/brief.md section 3).
 *    node scripts/stage-d/place-open-sum.mjs <dir or files> [--list] [--cont] [--ledger] [--back] [--play]
 * Reads every line that parses as JSON with a `kind`, in every file under <dir> (recursively).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const paths = args.filter(a => !a.startsWith('--'));
const files = [];
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).forEach(f => walk(join(p, f))) : files.push(p));
paths.forEach(walk);
const recs = [];
for (const f of files) {
  if (!/\.(txt|jsonl|out)$/.test(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const r = JSON.parse(line);
      if (r.kind) recs.push(r);
    } catch {}
  }
}
const by = k => recs.filter(r => r.kind === k);
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const group = (xs, fn) => xs.reduce((m, x) => ((m[fn(x)] ??= []).push(x), m), {});
const games = by('game');
const deckOf = {};
for (const g of games) if (g.arm === 'base' && g.corpId) deckOf[g.src] = g.corpId;
const whoGames = Object.fromEntries(Object.entries(group(games.filter(g => g.arm === 'base'), g => g.who)).map(([w, gs]) => [w, gs.length]));
const errors = by('error');
console.log(`records ${recs.length}; games (base) ${JSON.stringify(whoGames)}; errors ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log('  error', e.k, e.message);

// ---------------------------------------------------------------------------------------- 1. decisions changed
const dec = by('decision');
const arms = [...new Set(dec.flatMap(d => Object.keys(d.ms ?? {})))].filter(a => a !== 'base');
const pickErr = dec.filter(d => Object.values(d.picks ?? {}).some(p => String(p).startsWith('error')));
console.log(`\n## Decisions asked: ${dec.length} (main ${dec.filter(d => d.phase === 'main').length}, prompt ${dec.filter(d => d.phase === 'prompt').length}); error picks ${pickErr.length}`);
for (const e of pickErr.slice(0, 5)) console.log('  ', e.src, e.i, JSON.stringify(e.picks).slice(0, 300));
const whos = ['self', 'person-runner', 'person-corp'];
console.log('arm | ' + whos.map(w => `${w} (${whoGames[w] ?? 0})`).join(' | ') + ' | fires (rule2 / c2 asked where it moved)');
for (const arm of arms) {
  const cells = whos.map(w => {
    const n = dec.filter(d => d.who === w && d.changed.includes(arm)).length;
    return `${n} (${f2(n / (whoGames[w] || 1))})`;
  });
  const fires = dec.filter(d => (d.fire?.[arm] ?? 0) > 0).length;
  const c2 = Object.entries(group(dec.filter(d => d.c2?.[arm]), d => d.c2[arm])).map(([k, v]) => `${k} ${v.length}`).join(', ');
  console.log(`${arm} | ${cells.join(' | ')} | ${fires}${c2 ? ` / ${c2}` : ''}`);
}
console.log('\nby Corp deck (self + person-runner; changed decisions per game):');
const deckRows = group(dec.filter(d => d.who !== 'person-corp'), d => deckOf[d.src] ?? '?');
for (const [deck, ds] of Object.entries(deckRows)) {
  const n = new Set(ds.map(d => d.src)).size;
  console.log(`  ${deck} (${n} games): ` + arms.map(a => `${a} ${ds.filter(d => d.changed.includes(a)).length}`).join(', '));
}

// time
console.log('\n## Time (decisions where base took over 50 ms): mean ratio of sums, median of ratios; hold asks ratio of sums');
const slow = dec.filter(d => (d.ms?.base ?? 0) > 50);
for (const arm of arms) {
  const sa = slow.reduce((n, d) => n + d.ms[arm], 0);
  const sb = slow.reduce((n, d) => n + d.ms.base, 0);
  const ratios = slow.map(d => d.ms[arm] / d.ms.base).sort((a, b) => a - b);
  const qa = dec.reduce((n, d) => n + (d.asks?.[arm] ?? 0), 0);
  const qb = dec.reduce((n, d) => n + (d.asks?.base ?? 0), 0);
  const fired = dec.filter(d => (d.fire?.[arm] ?? 0) > 0 || d.c2?.[arm]);
  const fa = fired.reduce((n, d) => n + d.ms[arm], 0) / Math.max(1, fired.reduce((n, d) => n + d.ms.base, 0));
  console.log(`  ${arm}: mean ${f2(sa / sb)}x, median ${f2(ratios[Math.floor(ratios.length / 2)])}x (${slow.length}), where it fires ${f2(fa)}x (${fired.length}); hold asks ${f2(qa / qb)}x (${qa} vs ${qb})`);
}

if (flags.has('--list')) {
  console.log('\n## Changed decisions');
  for (const arm of arms) {
    const ds = dec.filter(d => d.changed.includes(arm));
    console.log(`\n### ${arm} (${ds.length})`);
    for (const d of ds) console.log(`  ${d.src} #${d.i} T${d.T} [${d.who}] ${d.corp}cr ${d.clicks}cl score ${d.score}: base ${d.picks.base} (${d.layers?.base ?? ''}) | ${arm} ${d.picks[arm]} (${d.layers?.[arm] ?? ''})`);
  }
}

// ---------------------------------------------------------------------------------------- 2. continuations
if (flags.has('--cont')) {
  console.log('\n## Continuations of changed main-phase decisions (servers at the Corp turn end: holds; Runner next turn: runs)');
  const conts = group(by('cont'), c => `${c.src}#${c.i}`);
  for (const arm of arms) {
    let more = 0, fewer = 0, same = 0, stealB = 0, stealA = 0, trashB = 0, trashA = 0, n = 0;
    const lines = [];
    for (const [k, cs] of Object.entries(conts)) {
      const b = cs.find(c => c.arm === 'base');
      const a = cs.find(c => c.arm === arm);
      if (!a || !b || !Array.isArray(a.servers) || !Array.isArray(b.servers)) continue;
      n++;
      const held = s => s.filter(v => v.holds).length;
      const d = held(a.servers) - held(b.servers);
      if (d > 0) more++;
      else if (d < 0) fewer++;
      else same++;
      const pts = c => c.runs.reduce((m, r) => m + (r.pts || 0), 0);
      const tr = c => c.runs.reduce((m, r) => m + (r.trashed || 0), 0);
      stealB += pts(b);
      stealA += pts(a);
      trashB += tr(b);
      trashA += tr(a);
      const fmt = c => c.servers.map(v => `${v.id}${v.holds ? '+' : '-'}${v.ice}`).join(' ');
      lines.push(`  ${k} T${a.T}: base [${b.moves.join('; ')}] -> ${fmt(b)}; runs ${b.runs.map(r => `${r.server}${r.pts ? ` ${r.pts}pt` : ''}${r.trashed ? ' trash' : ''}`).join(',') || '-'}${b.winner ? ` WIN ${b.winner}` : ''}\n      ${arm} [${a.moves.join('; ')}] -> ${fmt(a)}; runs ${a.runs.map(r => `${r.server}${r.pts ? ` ${r.pts}pt` : ''}${r.trashed ? ' trash' : ''}`).join(',') || '-'}${a.winner ? ` WIN ${a.winner}` : ''}`);
    }
    console.log(`\n### ${arm}: ${n} continuations; staked servers holding at the turn end: more ${more}, fewer ${fewer}, same ${same}; points stolen next turn base ${stealB} vs ${stealA}; assets trashed ${trashB} vs ${trashA}`);
    if (flags.has('--list')) lines.forEach(l => console.log(l));
  }
}

// ---------------------------------------------------------------------------------------- 3. the ice ledger
const ice = by('ice').filter(r => r.life);
const ledger = (rows, title) => {
  const n = rows.length;
  if (!n) return;
  const improves = r => r.was && ((r.now.holds && !r.was.holds) || (!r.now.holds && r.now.entries < r.was.entries));
  const neverMet = rows.filter(r => r.life.met === 0);
  const spent = neverMet.reduce((m, r) => m + r.install + r.life.rezPaid, 0);
  console.log(`\n### ${title}: ${n} ice installs`);
  console.log(`  reason: ${Object.entries(group(rows, r => r.reason)).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
  console.log(`  line: ${Object.entries(group(rows, r => r.line ?? 'none')).map(([k, v]) => `${k}${v[0].behind ? '' : ''} ${v.length}`).join(', ')}; behind ${rows.filter(r => r.behind).length}`);
  console.log(`  server: ${Object.entries(group(rows, r => r.serverKind)).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
  const nochange = rows.filter(r => r.was && !improves(r));
  console.log(`  count at the Runner's next turn: improves ${rows.filter(improves).length} (comes to hold ${rows.filter(r => r.was && r.now.holds && !r.was.holds).length}), changes nothing ${nochange.length} (${Object.entries(group(nochange, r => r.serverKind)).map(([k, v]) => `${k} ${v.length}`).join(', ')}), new remote ${rows.filter(r => !r.was).length} (holds at once ${rows.filter(r => !r.was && r.now.holds).length})`);
  console.log(`  by the game's end: rezzed ${pct(rows.filter(r => r.life.rezzed).length, n)}, met ${pct(n - neverMet.length, n)}, stopped a run ${rows.filter(r => r.life.stopped > 0).length} ice / ${rows.reduce((m, r) => m + r.life.stopped, 0)} runs, passed ${rows.reduce((m, r) => m + r.life.passed, 0)} times, tax ${rows.reduce((m, r) => m + r.life.tax, 0)} cr`);
  console.log(`  never met: ${neverMet.length} (${Object.entries(group(neverMet, r => r.serverKind)).map(([k, v]) => `${k} ${v.length}`).join(', ')}); spent on them ${neverMet.length} clicks, ${spent} credits (install ${neverMet.reduce((m, r) => m + r.install, 0)}, rez ${neverMet.reduce((m, r) => m + r.life.rezPaid, 0)})`);
  // where else: a central that did not hold, with its stake, when the ice changed no count where it went
  const open = nochange.filter(r => ['hq', 'rd'].some(c => r.centrals?.[c] && !r.centrals[c].holds && r.server !== c));
  console.log(`  of the no-change installs, ${open.length} went elsewhere while a central did not hold (HQ open ${open.filter(r => r.server !== 'hq' && !r.centrals.hq.holds).length}, R&D open ${open.filter(r => r.server !== 'rd' && !r.centrals.rd.holds).length})`);
};
console.log('\n## The ice ledger');
for (const w of whos) ledger(ice.filter(r => r.arm === 'base' && r.who === w), `base, ${w}`);
if (flags.has('--ledger')) {
  console.log('\nby Corp deck (base, self + person-runner):');
  for (const [deck, rows] of Object.entries(group(ice.filter(r => r.arm === 'base' && r.who !== 'person-corp'), r => deckOf[r.src] ?? '?'))) ledger(rows, deck);
}
// HQ ice at turn ends while a staked server is open
const turns = by('turn').filter(t => Array.isArray(t.servers));
for (const w of whos) {
  const ts = turns.filter(t => t.arm === 'base' && t.who === w);
  const open = ts.filter(t => t.hqIce > 0 && t.servers.some(v => !v.holds && v.loss > 0));
  console.log(`  ${w}: Runner turns starting with ice in HQ while an agenda-staked server does not hold: ${open.length} of ${ts.length}`);
}
const endIce = games.filter(g => g.arm === 'base');
console.log(`  games ending with ice in HQ: ${endIce.filter(g => g.hqIceAtEnd > 0).length} of ${endIce.length} (${endIce.reduce((m, g) => m + g.hqIceAtEnd, 0)} ice)`);

const assets = by('asset');
console.log(`\n## Asset installs (base): ${assets.filter(r => r.arm === 'base').length}`);
for (const w of whos) {
  const rs = assets.filter(r => r.arm === 'base' && r.who === w);
  if (!rs.length) continue;
  console.log(`  ${w}: ${rs.length}; reason ${Object.entries(group(rs, r => r.reason)).map(([k, v]) => `${k} ${v.length}`).join(', ')}; into ${Object.entries(group(rs, r => r.serverKind)).map(([k, v]) => `${k} ${v.length}`).join(', ')}; behind ice that holds ${rs.filter(r => r.now.holds).length}, behind ice that does not ${rs.filter(r => !r.now.holds && r.serverKind !== 'new' && r.was).length}, bare new ${rs.filter(r => r.serverKind === 'new').length}`);
}

// ---------------------------------------------------------------------------------------- 4. losses and asset breaches read backwards
const losses = by('loss');
console.log('\n## Losses on agenda points (base), read backwards');
for (const w of whos) {
  const ls = losses.filter(l => l.arm === 'base' && l.who === w);
  if (!ls.length) continue;
  const bc = ls.filter(l => l.cls === 'bc');
  const b = bc.filter(l => l.back && !l.back.error);
  console.log(`  ${w}: ${ls.length} (a ${ls.filter(l => l.cls === 'a').length}, b/c ${bc.length}, n ${ls.filter(l => l.cls === 'n').length}); of b/c: re-placing its ice holds ${b.filter(l => l.back.latest !== null).length} (turns back: ${b.filter(l => l.back.latest !== null).map(l => l.back.back).sort((x, y) => x - y).join(',')}); with the money unbounded ${b.filter(l => l.back.freeLatest !== null).length}; missing: ${Object.entries(group(b.filter(l => l.back.missing), l => l.back.missing)).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
  console.log(`     by server: ${Object.entries(group(bc, l => l.serverKind)).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
}
if (flags.has('--back')) {
  for (const l of losses.filter(x => x.arm === 'base' && x.cls === 'bc')) {
    const b = l.back ?? {};
    console.log(`  ${l.src} T${l.T} ${l.server} (corp turn ${l.corpTurn}, ice ${l.ice}, need ${l.hold?.need} budget ${l.hold?.budget}, corp ${l.corp}cr): latest ${b.latest} back ${b.back} free ${b.freeLatest} missing ${b.missing} hqIce ${b.hqIce}; tests ${JSON.stringify(b.tests ?? []).slice(0, 400)}`);
  }
}
const ab = by('abreach');
console.log('\n## Asset breaches (base)');
for (const w of whos) {
  const xs = ab.filter(x => x.arm === 'base' && x.who === w);
  if (!xs.length) continue;
  const open = xs.filter(x => x.hold && !x.hold.holds && x.worth > 0);
  const bk = open.filter(x => x.back && !x.back.error);
  console.log(`  ${w}: ${xs.length} breaches (trashed ${xs.filter(x => x.trashed).length}; behind ice ${xs.filter(x => x.ice > 0).length}; the server held at the turn start ${xs.filter(x => x.hold?.holds).length}); worth > 0 and open ${open.length}: re-placing ice holds ${bk.filter(x => x.back.latest !== null).length}, unbounded money ${bk.filter(x => x.back.freeLatest !== null).length}, missing ${Object.entries(group(bk.filter(x => x.back.missing), x => x.back.missing)).map(([k, v]) => `${k} ${v.length}`).join(', ')}; worth of those trashed: median ${f2(open.filter(x => x.trashed).map(x => x.worth).sort((a, b) => a - b)[Math.floor(open.filter(x => x.trashed).length / 2)] ?? 0)}`);
}

// ---------------------------------------------------------------------------------------- 5. played out (56 deals per arm)
const playArms = [...new Set(games.filter(g => g.who === 'self').map(g => g.arm))];
console.log('\n## Played out (self-play deals, each arm its own tree)');
console.log('arm | games | Corp wins | staked holds at Runner turn start: HQ / R&D / remote:agenda / remote:asset | points stolen a game: HQ / R&D / remote / archives | asset trashes a game | ice never met | first score turn (median) | Corp points from remotes a game');
for (const arm of playArms) {
  const gs = games.filter(g => g.who === 'self' && g.arm === arm);
  const ts = turns.filter(t => t.who === 'self' && t.arm === arm);
  const share = k => {
    const vs = ts.flatMap(t => t.servers.filter(v => v.kind === k));
    return `${pct(vs.filter(v => v.holds).length, vs.length)}`;
  };
  const rs = by('run').filter(r => r.who === 'self' && r.arm === arm);
  const pts = k => f2(rs.filter(r => (k === 'remote' ? r.serverKind.startsWith('remote') : r.serverKind === k)).reduce((m, r) => m + r.pts, 0) / (gs.length || 1));
  const trash = f2(rs.reduce((m, r) => m + (r.trashed || 0), 0) / (gs.length || 1));
  const iceA = ice.filter(r => r.who === 'self' && r.arm === arm);
  const first = gs.map(g => g.scores?.[0]?.T ?? 99).sort((a, b) => a - b)[Math.floor(gs.length / 2)];
  const remotePts = f2(gs.reduce((m, g) => m + (g.scores ?? []).filter(s => s.server.startsWith('remote')).reduce((n, s) => n + s.pts, 0), 0) / (gs.length || 1));
  console.log(`${arm} | ${gs.length} | ${gs.filter(g => g.winner === 'corp').length} | ${share('hq')} / ${share('rd')} / ${share('remote:agenda')} / ${share('remote:asset')} | ${pts('hq')} / ${pts('rd')} / ${pts('remote')} / ${pts('archives')} | ${trash} | ${iceA.filter(r => r.life.met === 0).length} of ${iceA.length} | ${first} | ${remotePts}`);
}
if (flags.has('--play')) {
  console.log('\nWins by deal (base vs arm; corp=C runner=R):');
  const base = Object.fromEntries(games.filter(g => g.who === 'self' && g.arm === 'base').map(g => [g.src, g.winner]));
  for (const arm of playArms.filter(a => a !== 'base')) {
    const gs = games.filter(g => g.who === 'self' && g.arm === arm);
    const flips = gs.filter(g => base[g.src] && base[g.src] !== g.winner);
    console.log(`  ${arm}: ${flips.length} deals differ: ${flips.map(g => `${g.src.replace('deal:', '')} ${base[g.src]?.[0]}->${g.winner?.[0]}`).join(', ')}`);
  }
  // Stall check (spec P5): agendas in HQ at the rule-2 install and two Corp turns later
  for (const arm of playArms.filter(a => a !== 'base')) {
    const fires = ice.filter(r => r.who === 'self' && r.arm === arm && r.reason === 'rule2');
    if (!fires.length) continue;
    const later = fires.map(r => turns.find(t => t.src === r.src && t.arm === arm && t.T === r.T + 2)?.hqAgendas).filter(x => x !== undefined);
    console.log(`  stall ${arm}: ${fires.length} rule-2 installs (${Object.entries(group(fires, r => r.server)).map(([k, v]) => `${k} ${v.length}`).join(', ')}); agendas in HQ at the install ${f2(fires.reduce((m, r) => m + r.hqAgendas, 0) / fires.length)}, two Corp turns later ${f2(later.reduce((m, x) => m + x, 0) / (later.length || 1))}`);
  }
}
