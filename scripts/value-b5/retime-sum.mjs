// B5 re-time: sums of scripts/value-b5/retime.ts. node scripts/value-b5/retime-sum.mjs <out files or dirs>
// Time per caller kind (seconds over the games), branch against base and ctl against base, each ratio with its by-game
// jackknife error; the bar (brief 2026-11-27): every kind within 5% of beta beyond its spread, read here as
// branch/base - 1 - se <= 0.05. Then tag clock prices per decision by view (the 2.5x read of b5-fire-count.md) and the
// decisions that move against base. Sets: all games, by pool, and the games whose Runner deck holds one of the six cards.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).forEach(f => walk(join(p, f))) : /\.(txt|jsonl)$/.test(p) && files.push(p));
process.argv.slice(2).forEach(walk);
const rows = [];
for (const f of files) for (const l of readFileSync(f, 'utf8').split('\n')) if (l.startsWith('{')) try { rows.push(JSON.parse(l)); } catch {}
const T = rows.filter(r => r.kind === 'time');
const errs = rows.filter(r => r.kind === 'err');
const sum = a => a.reduce((n, v) => n + v, 0);
const mean = a => sum(a) / a.length;
const f3 = x => (Number.isFinite(x) ? x.toFixed(3) : String(x));
function ratio(games, a, b) {
  const v = sum(games.map(a)) / sum(games.map(b));
  if (games.length < 2) return { v, se: NaN };
  const loo = games.map((_, i) => sum(games.filter((_, j) => j !== i).map(a)) / sum(games.filter((_, j) => j !== i).map(b)));
  const m = mean(loo);
  return { v, se: Math.sqrt(((games.length - 1) / games.length) * sum(loo.map(x => (x - m) ** 2))) };
}
const say = s => console.log(s);
say(`# B5 re-time: ${T.length} games (${[...new Set(T.map(r => r.pool))].map(p => `${p} ${T.filter(r => r.pool === p).length}`).join(', ')}), ${errs.length} errors, ${sum(T.map(r => r.decisions))} decisions`);
for (const e of errs) say(`  error ${e.pool}:${e.seed}: ${String(e.error).slice(0, 300)}`);
const sets = {
  all: () => true,
  batch: r => r.pool === 'batch',
  nrdb: r => r.pool === 'nrdb',
  'six held (Runner deck holds one of the six)': r => (r.six ?? []).length > 0,
  'six not held': r => !(r.six ?? []).length,
};
let fails = [];
for (const [name, keep] of Object.entries(sets)) {
  const G = T.filter(keep);
  if (!G.length) continue;
  say(`\n## ${name}: ${G.length} games, ${sum(G.map(r => r.decisions))} decisions`);
  const kinds = [...new Set(G.flatMap(r => Object.keys(r.n)))].sort();
  const ms = (r, a, k) => r.ms[`${a} ${k}`] ?? 0;
  say('  caller: decisions | base / ctl / branch s | branch/base ± se | ctl/base ± se | bar | clock prices a decision base -> branch (corp view; runner view) | moved ctl, branch');
  const tot = { base: 0, ctl: 0, branch: 0 };
  for (const k of [...kinds, 'ALL']) {
    const kk = k === 'ALL' ? kinds : [k];
    const g = G.filter(r => kk.some(x => (r.n[x] ?? 0) > 0));
    const t = (r, a) => sum(kk.map(x => ms(r, a, x)));
    const n = sum(G.map(r => sum(kk.map(x => r.n[x] ?? 0))));
    const s = a => sum(G.map(r => t(r, a))) / 1000;
    const br = ratio(g, r => t(r, 'branch'), r => t(r, 'base'));
    const cb = ratio(g, r => t(r, 'ctl'), r => t(r, 'base'));
    const ok = br.v - 1 - (Number.isFinite(br.se) ? br.se : 0) <= 0.05;
    if (!ok && name === 'all') fails.push(k);
    const cl = (a, v) => sum(G.map(r => sum(kk.map(x => r.clock?.[`${a} ${x} ${v}`] ?? 0)))) / Math.max(1, n);
    const clms = (a, v) => sum(G.map(r => sum(kk.map(x => r.clock?.[`${a} ${x} ${v}ms`] ?? 0))));
    const cnt = (a, v) => sum(G.map(r => sum(kk.map(x => r.clock?.[`${a} ${x} ${v}`] ?? 0))));
    const each = (a, v) => (cnt(a, v) ? (clms(a, v) / cnt(a, v)).toFixed(3) : '-');
    const x = v => (cl('base', v) ? (cl('branch', v) / cl('base', v)).toFixed(2) : '-');
    const mv = a => sum(G.map(r => sum(kk.map(x => r.differ?.[`${a} ${x}`] ?? 0))));
    const hasFull = G.some(r => Object.keys(r.ms).some(m => m.startsWith('full ')));
    const fr = hasFull ? ratio(g, r => t(r, 'full'), r => t(r, 'base')) : null;
    say(`  ${k}: ${n} | ${['base', 'ctl', 'branch'].map(a => s(a).toFixed(1)).join(' / ')} | ${f3(br.v)} ± ${f3(br.se)} | ${f3(cb.v)} ± ${f3(cb.se)} | ${ok ? 'ok' : 'OVER'} | corp ${cl('base', 'corp').toFixed(2)} -> ${cl('branch', 'corp').toFixed(2)} (x${x('corp')}, ${each('base', 'corp')} -> ${each('branch', 'corp')} ms each); runner ${cl('base', 'runner').toFixed(2)} -> ${cl('branch', 'runner').toFixed(2)} (x${x('runner')}, ${each('base', 'runner')} -> ${each('branch', 'runner')} ms each) | ${mv('ctl')}, ${mv('branch')}${hasFull ? ` | full/base ${f3(fr.v)} ± ${f3(fr.se)}, clock runner full ${cl('full', 'runner').toFixed(2)}; moved full ${mv('full')}, branch vs full ${mv('branchVsFull')}` : ''}`);
    if (k === 'ALL') Object.keys(tot).forEach(a => (tot[a] = s(a)));
  }
}
say('\n## Games');
for (const r of T) say(`  ${r.pool}:${r.seed} ${r.corpDeck} v ${r.runnerDeck} [${(r.six ?? []).join(', ')}] ${r.decisions} decisions, T${r.T}, ${r.winner}, ${(r.wall / 1000).toFixed(0)} s; moved ${JSON.stringify(r.differ)}${r.first?.branch ? `; first branch move ${JSON.stringify(r.first.branch)}` : ''}`);
say(`\nBar (all games, every caller kind): ${fails.length ? 'OVER on ' + fails.join(', ') : 'every kind within 5% beyond its spread'}`);
