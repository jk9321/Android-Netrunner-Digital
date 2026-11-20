// Sums hold-inputs-time.ts output (bundle H, "Judged by", time): node scripts/review-fixes/hold-inputs-time-sum.mjs <files or dirs...>
// Per group (all; self-play; human, AI side; Corp decisions; Knickknack decks; Audrey decks): decisions, mean time and
// p95 of each tree, head/control and base/control (the control's noise beside it), against the bar (mean <= 1.05x,
// p95 <= 1.15x). Then every decision where head took over 2x control and at least 0.5 s, with its re-asks.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = process.argv.slice(2).flatMap(p => (statSync(p).isDirectory() ? walk(p) : [p]));
function walk(d) {
  return readdirSync(d).flatMap(f => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.txt') ? [p] : [];
  });
}
const lines = files.flatMap(f => readFileSync(f, 'utf8').split('\n')).filter(l => l.startsWith('{')).map(l => JSON.parse(l));
const ds = lines.filter(l => l.kind === 'd');
const games = lines.filter(l => l.kind === 'g');
const humans = lines.filter(l => l.kind === 'h');
console.log(`decisions ${ds.length}; deals ${games.length} (matching the batch record ${games.filter(g => g.matchesBatch).length}); human files ${humans.length} (stopped ${humans.filter(h => h.stopped).length})`);
console.log(`base answer unlike control's (same code): ${ds.filter(d => d.baseControl).length}; head answer unlike base's: ${ds.filter(d => d.headDiffers).length}`);

const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const p95 = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] ?? 0;
};
const f = (x, n = 2) => x.toFixed(n);
const groups = [
  ['all', () => true],
  ['self-play', d => d.sk === 'self'],
  ['self-play, Corp', d => d.sk === 'self' && d.side === 'corp'],
  ['human, AI side', d => d.sk !== 'self' && d.who === 'ai'],
  ['human, all', d => d.sk !== 'self'],
  ['human, Corp (AI or person)', d => d.sk !== 'self' && d.side === 'corp'],
  ['Knickknack decks', d => d.knick],
  ['Knickknack decks, Corp', d => d.knick && d.side === 'corp'],
  ['Audrey decks', d => d.audrey],
  ['Audrey decks, Corp', d => d.audrey && d.side === 'corp'],
];
console.log('\n| group | decisions | mean ms base / control / head | head/control mean | base/control mean | p95 ms base / control / head | head/control p95 | base/control p95 | bar |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const [name, pick] of groups) {
  const xs = ds.filter(pick);
  if (!xs.length) continue;
  const m = [0, 1, 2].map(i => mean(xs.map(d => d.ms[i])));
  const p = [0, 1, 2].map(i => p95(xs.map(d => d.ms[i])));
  const ok = m[2] / m[1] <= 1.05 && p[2] / p[1] <= 1.15;
  console.log(`| ${name} | ${xs.length} | ${m.map(x => f(x, 1)).join(' / ')} | ${f(m[2] / m[1])} | ${f(m[0] / m[1])} | ${p.map(x => f(x, 1)).join(' / ')} | ${f(p[2] / p[1])} | ${f(p[0] / p[1])} | ${ok ? 'met' : 'NOT met'} |`);
}
const slow = ds.filter(d => d.re);
console.log(`\ndecisions where head took over 2x control and at least 0.5 s: ${slow.length}`);
for (const d of slow) {
  const all = [d.ms, ...d.re];
  const med = i => [...all.map(x => x[i])].sort((a, b) => a - b)[1];
  const still = med(2) > 2 * med(1) && med(2) >= 500;
  console.log(`  ${d.src} T${d.T} ${d.side} ${d.c}${d.knick ? ' knick' : ''}${d.audrey ? ' audrey' : ''}: ${all.map(x => x.map(y => Math.round(y)).join('/')).join(', ')} (medians base/control/head ${[0, 1, 2].map(i => Math.round(med(i))).join('/')}${still ? ', STILL over 2x' : ''})`);
}
