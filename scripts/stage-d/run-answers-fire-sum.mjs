// Sums scripts/stage-d/run-answers-fire.ts output: node scripts/stage-d/run-answers-fire-sum.mjs <dir or files...>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).flatMap(f => walk(join(p, f))) : p.endsWith('.txt') ? [p] : []);
const lines = process.argv.slice(2).flatMap(walk).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const D = lines.filter(l => l.kind === 'd');
const S = lines.filter(l => l.kind === 'src');
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const f2 = x => x.toFixed(3);
const groups = { self: s => s.startsWith('deal:'), human: s => s.startsWith('human:') };
console.log(`sources ${S.length} (deals ${S.filter(s => groups.self(s.src)).length}, human ${S.filter(s => groups.human(s.src)).length}); decisions ${D.length}`);
for (const [g, is] of Object.entries(groups)) {
  const n = S.filter(s => is(s.src)).length || 1;
  console.log(`\n## ${g} (${n} games)`);
  for (const side of ['corp', 'runner']) {
    const rs = D.filter(d => is(d.src) && d.side === side);
    const b = rs.map(d => d.ms[0]);
    const h = rs.map(d => d.ms[1]);
    const changed = rs.filter(d => d.changed);
    console.log(`${side}: ${rs.length} decisions; time beta ${(b.reduce((a, x) => a + x, 0) / 1000).toFixed(1)} s, here ${(h.reduce((a, x) => a + x, 0) / 1000).toFixed(1)} s: mean x${f2(mean(h) / mean(b))}, p95 x${f2(q(h, 0.95) / q(b, 0.95))} (beta p95 ${q(b, 0.95).toFixed(0)} ms, here ${q(h, 0.95).toFixed(0)} ms), max ${Math.max(0, ...b).toFixed(0)} -> ${Math.max(0, ...h).toFixed(0)} ms`);
    const slow = rs.filter(d => d.ms[0] >= 500 && d.ms[1] > 2 * d.ms[0]);
    console.log(`  decisions of 0.5 s or more on beta over 2x here: ${slow.length}${slow.length ? ': ' + slow.slice(0, 8).map(d => `${d.src}#${d.i} ${d.ms[0]}->${d.ms[1]}`).join(', ') : ''}`);
    const asked = rs.reduce((a, d) => a + d.run.asked, 0), decided = rs.reduce((a, d) => a + d.run.decided, 0), stands = rs.reduce((a, d) => a + d.run.stands, 0), searched = rs.reduce((a, d) => a + d.run.searched, 0);
    console.log(`  run term inside (here): asked ${asked} (${(asked / n).toFixed(1)} a game), decided ${decided} (${(decided / n).toFixed(1)} a game); run-stand verdicts ${stands}, searched ${searched}`);
    console.log(`  changed ${changed.length} (${(changed.length / n).toFixed(2)} a game): top-level Corp prompt in a run ${changed.filter(d => d.inRun).length}; with the run term deciding inside ${changed.filter(d => d.run.decided > 0).length}; neither ${changed.filter(d => !d.inRun && d.run.decided === 0).length}`);
    for (const d of changed) console.log(`  - ${d.src} #${d.i} T${d.T} ${d.m}${d.inRun ? ' [run prompt]' : ''} ${d.card ?? ''} ${d.server ?? ''} decided ${d.run.decided} | beta ${d.picks.beta.slice(0, 140)} | here ${d.picks.here.slice(0, 140)}`);
  }
}
const errs = D.filter(d => (d.picks?.here ?? '').startsWith('error') || (d.picks?.beta ?? '').startsWith('error'));
console.log(`\nerrors: ${errs.length}`);
for (const d of errs.slice(0, 10)) console.log(`  ${d.src} #${d.i} ${JSON.stringify(d.picks)}`);
