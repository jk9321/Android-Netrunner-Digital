// Sums corp-owed/tags.ts output (MODE=tagn and MODE=could). Usage: node scripts/corp-owed/sum-tags.mjs <dir or files...>
// tagn: per unit, the n-th tag's realized worth at horizon h = mean over seeds of (took(n) - took(n-1)) summed over the
// first h Corp turns (the reads are running totals), took = trash + punish - spent (the Corp's own credits spent taking it); beside it the clock's price
// of the n-th tag (Corp view). Reported by tag count n (capped at 3), pool and Corp deck: clock minus realized, mean ± SE.
// could: per row where the Corp could trash and did not, trash minus chose at R1 and R2 (evC, the Corp's view) and at
// game end on the sample (Corp win 1, loss 0).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = process.argv.slice(2).flatMap(p => (statSync(p).isDirectory() ? readdirSync(p).filter(f => /\.(txt|jsonl|log)$/.test(f)).map(f => join(p, f)) : [p]));
const rows = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
const ms = xs => { const n = xs.length; if (!n) return { n, m: NaN, se: NaN }; const m = xs.reduce((a, b) => a + b, 0) / n; const v = n > 1 ? xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1) : 0; return { n, m, se: Math.sqrt(v / n) }; };
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const fmt = s => `${f2(s.m)} ± ${f2(s.se)} (${s.n})`;
const num = x => (x === 'Inf' ? Infinity : x === '-Inf' ? -Infinity : Number(x));
const took = r => num(r.trash) + num(r.punish) - num(r.spent);

const errs = rows.filter(r => r.kind === 'err' || (r.kind === 'u' && (r.legs ?? r.rows ?? []).some(x => x.error)));
console.log(`rows ${rows.length}; units ${rows.filter(r => r.kind === 'u').length}; errors ${errs.length}; shards done ${rows.filter(r => r.kind === 's').length}\n`);

const tagn = rows.filter(r => r.kind === 'u' && r.mode === 'tagn');
if (tagn.length) {
  const groups = new Map();
  const add = (key, v) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(v); };
  for (const u of tagn) {
    const n = u.board.tags;
    const nk = Math.min(n, 3);
    const clock = num(u.beside.clock.corp[nk - 1]);
    const legs = u.legs.filter(l => !l.error);
    if (!legs.length || !Number.isFinite(clock)) continue;
    const real = [1, 2, 3].map(h => legs.reduce((a, l) => a + took(l.n.reads[h - 1]) - took(l.less.reads[h - 1]), 0) / legs.length); // reads are running totals
    const ev = legs.reduce((a, l) => a + (num(l.n.reads.at(-1)?.at?.evC) - num(l.less.reads.at(-1)?.at?.evC)), 0) / legs.length;
    const v = { clock, real, ev };
    for (const key of [`all|n=${nk}`, `${u.pool}|n=${nk}`, `${u.pool}|${u.corpDeck}|n=${nk}`]) add(key, v);
  }
  console.log('## tagn: the n-th tag, clock (Corp view) against realized (trash + punish - spent, n less n-1)\n');
  console.log('| group | units | clock | realized h1 | realized h2 | realized h3 | clock - realized h3 | evC at h3, n less n-1 |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const [k, vs] of [...groups].sort((a, b) => (a[0].split('|').length - b[0].split('|').length) || a[0].localeCompare(b[0]))) {
    if (vs.length < 3 && k.split('|').length > 2) continue;
    console.log(`| ${k} | ${vs.length} | ${fmt(ms(vs.map(v => v.clock)))} | ${fmt(ms(vs.map(v => v.real[0])))} | ${fmt(ms(vs.map(v => v.real[1])))} | ${fmt(ms(vs.map(v => v.real[2])))} | ${fmt(ms(vs.map(v => v.clock - v.real[2])))} | ${fmt(ms(vs.filter(v => Number.isFinite(v.ev)).map(v => v.ev)))} |`);
  }
  console.log('');
}

const could = rows.filter(r => r.kind === 'u' && r.mode === 'could');
if (could.length) {
  const all = could.flatMap(u => u.rows.filter(r => !r.error).map(r => ({ ...r, pool: u.pool, deck: u.corpDeck })));
  const kept = all.filter(r => r.could && r.trashed === 0 && r.trash && !r.trash.error);
  console.log(`## could: ${all.length} legs; Corp could trash in ${all.filter(r => r.could).length}; trashed ${all.filter(r => r.could && r.trashed > 0).length}; did not ${kept.length}\n`);
  const insteadKind = new Map();
  for (const r of kept) { const k = (r.instead ?? []).map(a => String(a).split(/[ :(]/)[0]).filter(Boolean).slice(0, 4).join(',') || '(nothing)'; insteadKind.set(k, (insteadKind.get(k) ?? 0) + 1); }
  console.log('What it did instead (first four actions, by kind): ' + [...insteadKind].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k} ${n}`).join('; ') + '\n');
  const d = (r, at) => num(r.trash[at]?.evC) - num(r.chose[at]?.evC);
  console.log('| group | legs | trash - chose, evC at R1 | at R2 | perTurnCorp (clock) | best resource worth | game end legs | Corp wins, trash | Corp wins, chose |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  const byPool = new Map([['all', kept]]);
  for (const r of kept) { if (!byPool.has(r.pool)) byPool.set(r.pool, []); byPool.get(r.pool).push(r); }
  for (const [k, rs] of byPool) {
    const e = rs.filter(r => r.trash.end && r.chose.end);
    const w = (r, m) => (r[m].end.w === 'corp' ? 1 : 0);
    console.log(`| ${k} | ${rs.length} | ${fmt(ms(rs.map(r => d(r, 'r1')).filter(Number.isFinite)))} | ${fmt(ms(rs.map(r => d(r, 'r2')).filter(Number.isFinite)))} | ${fmt(ms(rs.map(r => num(r.clock?.perTurnCorp)).filter(Number.isFinite)))} | ${fmt(ms(rs.map(r => num(r.best?.worth)).filter(Number.isFinite)))} | ${e.length} | ${f2(e.reduce((a, r) => a + w(r, 'trash'), 0) / (e.length || 1))} | ${f2(e.reduce((a, r) => a + w(r, 'chose'), 0) / (e.length || 1))} |`);
  }
  const zero = kept.filter(r => num(r.clock?.perTurnCorp) === 0).length;
  console.log(`\nLegs where the clock's own perTurnCorp is 0 (the clock does not count a trash there): ${zero} of ${kept.length}`);
}
