// Sums scripts/hold-reentry/fire-count.ts output: node scripts/hold-reentry/fire-count-sum.mjs <dir or files...>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).flatMap(f => walk(join(p, f))) : p.endsWith('.txt') ? [p] : []);
const rows = process.argv.slice(2).flatMap(walk).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const games = new Set(rows.map(r => r.src)).size;
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sum = xs => xs.reduce((a, b) => a + b, 0);
const max = xs => xs.reduce((a, b) => Math.max(a, b), 0);
const pct = (a, b) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;
const by = (rs, f) => rs.filter(f).length;
console.log(`decisions ${rows.length} in ${games} games (deals ${new Set(rows.filter(r => r.src.startsWith('deal:')).map(r => r.src)).size}, human ${new Set(rows.filter(r => r.src.startsWith('human:')).map(r => r.src)).size})`);
const errors = rows.filter(r => r.picks && Object.values(r.picks).some(a => String(a).startsWith('error')));
console.log(`errors in a pick: ${errors.length}`);
for (const r of errors.slice(0, 10)) console.log('  ERROR', r.src, '#' + r.i, r.side, JSON.stringify(r.picks));
const capped = rows.filter(r => r.capped);
console.log(`beta decisions stopped at the cap: ${capped.length}`);
for (const r of capped) console.log('  CAPPED', r.src, '#' + r.i, r.side, 'T' + r.T, `beta ${r.ms.beta} ms (nesting at the cap: ${r.beta.turns} counts, depth ${r.beta.maxDepth}), c1 ${r.ms.c1} ms, c2 ${r.ms.c2} ms`);
const holdDiff = rows.filter(r => r.holdsEqual !== true);
console.log(`boards where c1 and c2 Holds differ (every server with ice, corpCredits Infinity / 0 / credits): ${holdDiff.length}`);
for (const r of holdDiff.slice(0, 5)) console.log('  HOLD', r.src, '#' + r.i, r.holdsEqual);

console.log('\n== Nesting on beta (depth taken at holdRunnerTurn entry) ==');
for (const side of ['corp', 'runner']) {
  const rs = rows.filter(r => r.side === side && !r.capped);
  const nested = rs.filter(r => r.beta.maxDepth >= 2);
  console.log(`${side}: ${rs.length} decisions; with a hold count ${by(rs, r => r.beta.turns > 0)}; nested (depth 2+) ${nested.length} (${pct(nested.length, rs.length)}), depth 3 ${by(rs, r => r.beta.maxDepth === 3)}, 4+ ${by(rs, r => r.beta.maxDepth >= 4)}`);
  console.log(`  hold counts started ${sum(rs.map(r => r.beta.turns))}: at depth 2 ${sum(rs.map(r => r.beta.d2))}, depth 3 ${sum(rs.map(r => r.beta.d3))}, depth 4+ ${sum(rs.map(r => r.beta.d4))}`);
  const ms = sum(rs.map(r => r.ms.beta)), deep = sum(rs.map(r => r.beta.msDeep));
  console.log(`  time at depth 2+: ${(deep / 1000).toFixed(1)} s of ${(ms / 1000).toFixed(1)} s (${pct(deep, ms)}); in nested decisions mean ${mean(nested.map(r => r.beta.msDeep)).toFixed(0)} ms of ${mean(nested.map(r => r.ms.beta)).toFixed(0)} ms`);
  console.log(`  rez windows (holdThisRun) ${sum(rs.map(r => r.beta.runs))}, hold counts opened inside one ${sum(rs.map(r => r.beta.turnInRun))}, rez-window time ${(sum(rs.map(r => r.beta.msRun)) / 1000).toFixed(1)} s`);
  const routes = {};
  for (const r of rs) for (const [k, v] of Object.entries(r.beta.routes)) routes[k] = (routes[k] ?? 0) + v;
  const edge = k => (k.startsWith('NO OUTER') ? 'no outer frame' : k.split(' < ').slice(0, 5).join(' < '));
  const edges = {};
  for (const [k, v] of Object.entries(routes)) edges[edge(k)] = (edges[edge(k)] ?? 0) + v;
  console.log('  closing edges (sampled nested counts, innermost frames):');
  for (const [k, v] of Object.entries(edges).sort((a, b) => b[1] - a[1])) console.log(`    ${v}  ${k}`);
  console.log('  top routes:');
  for (const [k, v] of Object.entries(routes).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${v}  ${k}`);
}

console.log('\n== Fire count ==');
const g = r => (r.guarded1 === 0 ? '0' : '1+');
for (const side of ['corp', 'runner']) {
  const rs = rows.filter(r => r.side === side);
  const ok = rs.filter(r => !r.capped);
  const ch1 = ok.filter(r => r.ch1), ch2 = rs.filter(r => r.ch2);
  console.log(`\n${side}: ${rs.length} decisions; guarded reads (c1) 0: ${by(rs, r => g(r) === '0')}, 1+: ${by(rs, r => g(r) === '1+')}`);
  console.log(`  commit 1 vs beta: ${ch1.length} changed (${(ch1.length / Math.max(1, games)).toFixed(3)} a game); with 0 guarded reads ${by(ch1, r => g(r) === '0')}, with 1+ ${by(ch1, r => g(r) === '1+')}`);
  for (const r of ch1) {
    const a = r.audit1;
    const why = g(r) === '1+' ? `guarded ${r.guarded1}` : a && (a.beta.mismatches || a.c1.mismatches) ? `0 guarded, audit mismatches beta ${a.beta.mismatches} c1 ${a.c1.mismatches} (cache side effect)` : '0 guarded, NO audit mismatch: STOP';
    console.log(`    ${r.src} #${r.i} T${r.T} ${r.kind}: ${why}; audited picks ${a ? (a.beta.a === a.c1.a ? 'same' : 'differ') : '-'}; ${r.picks.beta} -> ${r.picks.c1}`);
  }
  console.log(`  commit 2 vs commit 1: ${ch2.length} changed`);
  for (const r of ch2) {
    const a = r.audit2;
    console.log(`    ${r.src} #${r.i} T${r.T} ${r.kind}: audit mismatches c1 ${a?.c1.mismatches} c2 ${a?.c2.mismatches}; audited picks ${a ? (a.c1.a === a.c2.a ? 'same' : 'differ') : '-'}; ${r.picks.c1} -> ${r.picks.c2}`);
  }
  for (const arm of ['beta', 'c1', 'c2']) {
    const t = ok.map(r => r.ms[arm]);
    console.log(`  time ${arm.padEnd(4)} mean ${mean(t).toFixed(1)} ms, p95 ${q(t, 0.95)}, max ${max(t)}; rez sets priced ${sum(ok.map(r => r.sets[arm]))}; deck prices worked out ${sum(ok.map(r => r.priced[arm]))}`);
  }
  const t = arm => mean(ok.map(r => r.ms[arm]));
  const p = arm => q(ok.map(r => r.ms[arm]), 0.95);
  console.log(`  ratios: c1/beta mean x${(t('c1') / t('beta')).toFixed(3)} p95 x${(p('c1') / p('beta')).toFixed(3)}; c2/c1 mean x${(t('c2') / t('c1')).toFixed(3)} p95 x${(p('c2') / p('c1')).toFixed(3)}; c2/beta mean x${(t('c2') / t('beta')).toFixed(3)} p95 x${(p('c2') / p('beta')).toFixed(3)}`);
  const n1 = ok.filter(r => r.beta.maxDepth >= 2);
  if (n1.length) console.log(`  nested on beta (${n1.length}): mean beta ${mean(n1.map(r => r.ms.beta)).toFixed(0)} ms, c1 ${mean(n1.map(r => r.ms.c1)).toFixed(0)}, c2 ${mean(n1.map(r => r.ms.c2)).toFixed(0)}; deepest c1 ${max(rs.map(r => r.depth1))}, c2 ${max(rs.map(r => r.depth2))}`);
}
