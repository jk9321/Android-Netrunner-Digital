// Sums scripts/honest-order/fire-count.ts output: node scripts/honest-order/fire-count-sum.mjs <dir or files...>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const files = process.argv.slice(2).flatMap(p => (statSync(p).isDirectory() ? readdirSync(p).filter(f => f.endsWith('.txt')).map(f => join(p, f)) : [p]));
const rows = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const games = new Set(rows.map(r => r.src)).size;
const changed = rows.filter(r => r.changed);
const by = c => changed.filter(r => r.causes.includes(c)).length;
const none = changed.filter(r => !r.causes.length);
const only = c => changed.filter(r => r.causes.length === 1 && r.causes[0] === c).length;
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const part = pre => { const rs = rows.filter(r => r.src.startsWith(pre)); const ch = rs.filter(r => r.changed).length; return `${rs.length} decisions, ${ch} changed (${new Set(rs.map(r => r.src)).size} games)`; };
console.log(`decisions ${rows.length} in ${games} games; changed ${changed.length} (${(changed.length / Math.max(1, games)).toFixed(2)} a game)`);
console.log(`  deals: ${part('deal:')}; human: ${part('human:')}`);
console.log(`reproduced by R&D ${by('rd')} (only R&D ${only('rd')}), grip ${by('grip')} (only ${only('grip')}), rng ${by('rng')} (only ${only('rng')}); by none ${none.length}`);
for (const r of none.slice(0, 20)) console.log('  NONE', r.src, '#' + r.i, 'T' + r.T, r.real, '->', r.view);
const real = rows.map(r => r.msReal), view = rows.map(r => r.msView);
console.log(`time mean real ${mean(real).toFixed(0)} ms, view ${mean(view).toFixed(0)} ms (x${(mean(view) / mean(real)).toFixed(3)}); p95 ${q(real, 0.95)} vs ${q(view, 0.95)} (x${(q(view, 0.95) / q(real, 0.95)).toFixed(3)})`);
