// R-105 step 0: sums step0.ts's tally lines (one per shard) into the tables of r105/step0.md.
//   node scripts/runner-rework/r105/step0-sum.mjs <step0 output files...>
import { readFileSync } from 'node:fs';

const t = {};
const deals = [];
for (const f of process.argv.slice(2)) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    const x = JSON.parse(line);
    if (x.kind === 'deal') deals.push(x);
    if (x.kind === 'tally') for (const [k, v] of Object.entries(x.tally)) t[k] = (t[k] ?? 0) + v;
  }
}
const g = k => t[k] ?? 0;
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
const n = x => Math.round(x).toLocaleString('en-US');
console.log(`deals: ${deals.map(d => `${d.seed} (T${d.T}, ${d.winner}, ${d.forced} forced)`).join(', ')}\n`);

console.log('## 1. updateHandKnowledge calls (branch tree bae7c82), top level and simulated\n');
console.log('| | top | simulated |\n|---|---|---|');
const row = (label, f) => console.log(`| ${label} | ${f('top')} | ${f('sim')} |`);
row('calls', s => n(g(`hand|${s}|calls`)));
for (const k of ['hq', 'grip', 'arcIds', 'open', 'openLoose', 'lists', 'rdMark']) row(`same/ok: ${k}`, s => pct(g(`hand|${s}|same|${k}`), g(`hand|${s}|calls`)));
row('**Archives walk** skipped', s => pct(g(`hand|${s}|arc|hit`), g(`hand|${s}|calls`)));
row('  walk changed a list', s => n(g(`hand|${s}|arc|changed`)));
row('  unsafe (skipped, walk changed)', s => n(g(`hand|${s}|arc|unsafe`)));
row('  missed, walk changed nothing', s => n(g(`hand|${s}|arc|missIdle`)));
row('  miss: faceDown differs', s => n(g(`hand|${s}|arc|why|faceDown differs`)));
row('  miss: list longer than Archives', s => n(g(`hand|${s}|arc|why|list longer than Archives`)));
for (const o of ['corp', 'runner']) {
  row(`**noteOpenArrivals ${o}** skipped`, s => pct(g(`hand|${s}|arrivals.${o}|hit`), g(`hand|${s}|calls`)));
  row('  walk changed a list / unsafe', s => `${n(g(`hand|${s}|arrivals.${o}|changed`))} / ${n(g(`hand|${s}|arrivals.${o}|unsafe`))}`);
}
row('**main walk**: both lists empty (today\'s return)', s => pct(g(`hand|${s}|main|empty`), g(`hand|${s}|calls`)));
row('  skipped by the conditions', s => pct(g(`hand|${s}|main|hit`), g(`hand|${s}|calls`)));
row('  walked (miss)', s => pct(g(`hand|${s}|main|miss`), g(`hand|${s}|calls`)));
row('  walk changed a list', s => n(g(`hand|${s}|main|changed`)));
row('  unsafe (skipped, walk changed)', s => n(g(`hand|${s}|main|unsafe`)));
row('  missed, walk changed nothing', s => n(g(`hand|${s}|main|missIdle`)));
for (const k of ['hq', 'grip', 'lists', 'rdMark', 'open']) row(`  miss, first failed: ${k}`, s => n(g(`hand|${s}|main|first|${k}`)));
for (const k of ['hq', 'grip', 'lists', 'rdMark', 'open', 'several']) row(`  miss, only failed: ${k}`, s => n(g(`hand|${s}|main|only|${k}`)));
row('  looser open test: skipped / unsafe', s => `${pct(g(`hand|${s}|main|looseHit`), g(`hand|${s}|calls`))} / ${n(g(`hand|${s}|main|looseUnsafe`))}`);
row('  per-owner condition (finding 11): skipped / unsafe', s => `${pct(g(`hand|${s}|main|perOwnerHit`), g(`hand|${s}|calls`))} / ${n(g(`hand|${s}|main|perOwnerUnsafe`))}`);
row('  per-owner with the looser open test: skipped / unsafe', s => `${pct(g(`hand|${s}|main|perOwnerLooseHit`), g(`hand|${s}|calls`))} / ${n(g(`hand|${s}|main|perOwnerLooseUnsafe`))}`);
row('**all three walks skipped**', s => pct(g(`hand|${s}|all3`) + 0, g(`hand|${s}|calls`)));
row('  with the looser open test', s => pct(g(`hand|${s}|all3loose`), g(`hand|${s}|calls`)));

console.log('\n## 2. copyPlain per executeAction call: objects and arrays copied, by path (simulated calls; top level in brackets)\n');
const calls = (tree, s) => g(`copy|${tree}|${s}|calls`);
const per = (tree, s, p) => g(`copy|${tree}|${s}|obj|${p}`) / (calls(tree, s) || 1);
const paths = new Set(Object.keys(t).filter(k => k.startsWith('copy|') && k.includes('|obj|')).map(k => k.split('|obj|')[1]));
const KN = ['corp.knownToRunner', 'corp.rdKnownToRunner', 'corp.archKnownToRunner', 'corp.rdKnownToCorp', 'runner.knownToCorp'];
const total = (tree, s, only) => [...paths].filter(p => !only || only(p)).reduce((a, p) => a + per(tree, s, p), 0);
console.log(`calls: base ${n(calls('base', 'sim'))} sim + ${n(calls('base', 'top'))} top; branch ${n(calls('branch', 'sim'))} sim + ${n(calls('branch', 'top'))} top`);
console.log(`copyPlain time (performance.now around the call): base ${n(g('copy|base|sim|ms') + g('copy|base|top|ms'))} ms, branch ${n(g('copy|branch|sim|ms') + g('copy|branch|top|ms'))} ms; per call ${((g('copy|base|sim|ms') + g('copy|base|top|ms')) * 1000 / (calls('base', 'sim') + calls('base', 'top'))).toFixed(1)} µs / ${((g('copy|branch|sim|ms') + g('copy|branch|top|ms')) * 1000 / (calls('branch', 'sim') + calls('branch', 'top'))).toFixed(1)} µs\n`);
console.log('| path | base | branch | branch - base | share of the rise |\n|---|---|---|---|---|');
const rise = total('branch', 'sim') - total('base', 'sim');
const line = (label, f) => {
  const [b, r] = [f('base', 'sim'), f('branch', 'sim')];
  const [bt, rt] = [f('base', 'top'), f('branch', 'top')];
  console.log(`| ${label} | ${b.toFixed(1)} (${bt.toFixed(1)}) | ${r.toFixed(1)} (${rt.toFixed(1)}) | ${(r - b).toFixed(1)} (${(rt - bt).toFixed(1)}) | ${pct(r - b, rise)} |`);
};
line('**all**', (tr, s) => total(tr, s));
for (const p of KN) line(p, (tr, s) => per(tr, s, p));
line('the five knowledge lists', (tr, s) => total(tr, s, p => KN.includes(p)));
line('everything else', (tr, s) => total(tr, s, p => !KN.includes(p)));
const others = [...paths].filter(p => !KN.includes(p)).sort((a, b) => Math.abs(per('branch', 'sim', b) - per('base', 'sim', b)) - Math.abs(per('branch', 'sim', a) - per('base', 'sim', a)));
for (const p of others.slice(0, 8)) line(`  ${p}`, (tr, s) => per(tr, s, p));
const big = [...paths].sort((a, b) => per('base', 'sim', b) - per('base', 'sim', a)).slice(0, 6);
console.log(`\nlargest paths (base, sim, per call): ${big.map(p => `${p} ${per('base', 'sim', p).toFixed(0)}`).join(', ')}`);

console.log('\n## 3. Ruling 4: turnPlanner.ts runnerDecisionView `marks` line (branch tree)\n');
console.log('| deciding (top-level step) | top steps | marks calls | calls per step | ms | µs per call | avg chars |\n|---|---|---|---|---|---|---|');
const sides = new Set(Object.keys(t).filter(k => k.startsWith('dec|')).map(k => k.slice(4)));
let [ac, am] = [0, 0];
for (const s of [...sides].sort()) {
  const c = g(`marks|${s}|calls`), ms = g(`marks|${s}|ms`);
  ac += c;
  am += ms;
  console.log(`| ${s} | ${n(g(`dec|${s}`))} | ${n(c)} | ${(c / (g(`dec|${s}`) || 1)).toFixed(1)} | ${ms.toFixed(0)} | ${c ? ((ms * 1000) / c).toFixed(2) : '-'} | ${c ? (g(`marks|${s}|len`) / c).toFixed(0) : '-'} |`);
}
console.log(`| all | | ${n(ac)} | | ${am.toFixed(0)} | ${ac ? ((am * 1000) / ac).toFixed(2) : '-'} | |`);

if (Object.keys(t).some(k => k.startsWith('exec|'))) {
  console.log('\n## 4. executeAction calls and time by the top-level step\'s decision kind (inclusive; upkeep = updateRdKnowledge + updateHandKnowledge)\n');
  const kinds = [...new Set(Object.keys(t).filter(k => k.startsWith('exec|')).map(k => k.split('|').slice(2, -1).join('|')))].sort();
  console.log('step time (the top-level step, everything in it): ' + kinds.map(k => `${k} ${n(g(`step|base|${k}`))} / ${n(g(`step|branch|${k}`))} ms (${pct(g(`step|branch|${k}`) - g(`step|base|${k}`), g(`step|base|${k}`))})`).join('; ') + '\n');
  console.log('| deciding | calls base | calls branch | calls +% | exec ms base | exec ms branch | exec +% | µs/call base | µs/call branch | rd ms base / branch | hand ms base / branch |\n|---|---|---|---|---|---|---|---|---|---|---|');
  const sum = { cb: 0, cr: 0, eb: 0, er: 0, rb: 0, rr: 0, hb: 0, hr: 0 };
  const r = (k, a, b) => console.log(`| ${k} | ${n(a.c)} | ${n(b.c)} | ${pct(b.c - a.c, a.c)} | ${n(a.e)} | ${n(b.e)} | ${pct(b.e - a.e, a.e)} | ${((a.e * 1000) / (a.c || 1)).toFixed(1)} | ${((b.e * 1000) / (b.c || 1)).toFixed(1)} | ${n(a.rd)} / ${n(b.rd)} | ${n(a.h)} / ${n(b.h)} |`);
  const of = (tree, k) => ({ c: g(`exec|${tree}|${k}|calls`), e: g(`time|${tree}|${k}|exec`), rd: g(`time|${tree}|${k}|rd`), h: g(`time|${tree}|${k}|hand`) });
  for (const k of kinds) {
    const [a, b] = [of('base', k), of('branch', k)];
    r(k, a, b);
    sum.cb += a.c; sum.cr += b.c; sum.eb += a.e; sum.er += b.e; sum.rb += a.rd; sum.rr += b.rd; sum.hb += a.h; sum.hr += b.h;
  }
  r('**all**', { c: sum.cb, e: sum.eb, rd: sum.rb, h: sum.hb }, { c: sum.cr, e: sum.er, rd: sum.rr, h: sum.hr });
}

if (Object.keys(t).some(k => k.startsWith('where|'))) {
  console.log('\n## 5. executeAction calls by the GameRunner scopes they are inside (T = the top-level game; T alone = the deciding agent\'s own simulation or the step itself)\n');
  const rows = new Map();
  for (const [k, v] of Object.entries(t)) {
    if (!k.startsWith('where|')) continue;
    const [, tree, side, kind, path] = k.split('|');
    const id = `${side}|${kind} ${path}`;
    const r = rows.get(id) ?? { base: 0, branch: 0 };
    r[tree] += v;
    rows.set(id, r);
  }
  console.log('| deciding, scopes | base | branch | branch - base |\n|---|---|---|---|');
  for (const [id, r] of [...rows].sort((a, b) => Math.abs(b[1].branch - b[1].base) - Math.abs(a[1].branch - a[1].base)).slice(0, 12)) console.log(`| ${id} | ${n(r.base)} | ${n(r.branch)} | ${n(r.branch - r.base)} (${pct(r.branch - r.base, r.base)}) |`);
}
