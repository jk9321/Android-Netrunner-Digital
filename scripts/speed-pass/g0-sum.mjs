// Speed pass G0 summary: node scripts/speed-pass/g0-sum.mjs <dir with out/*.txt>
// First differences and errors (deals and human files), G's counts summed over the shards (hits by maker>caller, misses
// by caller, held boards per top-level step as a histogram, the largest, the sampled re-execute audit, asks with no
// anchor), the five deals with the most boards held, and valueLoops by chain per tree (base, branch with G, control).
// Time by kind: scripts/speed-pass/time-sum.mjs on the same directory.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.argv[2], 'out');
const g = { hits: {}, miss: {}, heldHist: {}, heldPeak: 0, heldTotal: 0, tops: 0, audited: 0, auditBad: 0, auditFirst: [], noAnchor: 0 };
const deals = [];
const loops = {};
let n = { deal: 0, human: 0 };
let diffs = 0;
const errors = [];
const add = (to, from) => {
  for (const [k, v] of Object.entries(from ?? {})) to[k] = (to[k] ?? 0) + v;
};
for (const f of readdirSync(dir).filter(f => f.endsWith('.txt'))) {
  for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.kind === 'deal') {
      n.deal++;
      if (o.diff) diffs++, errors.push(`diff ${o.pool} ${o.seed} step ${o.diff.step}`);
    } else if (o.kind === 'human') {
      n.human++;
      if (o.diffs) diffs += o.diffs, errors.push(`diff ${o.src}`);
      for (const e of o.errors ?? []) errors.push(`${o.src}: ${e}`);
    } else if (o.kind === 'error') errors.push(`error ${o.pool} ${o.seed}: ${(o.error ?? '').slice(0, 160)}`);
    else if (o.kind === 'g0deal') deals.push(o);
    else if (o.kind === 'g0') {
      add(g.hits, o.hits);
      add(g.miss, o.miss);
      add(g.heldHist, o.heldHist);
      g.heldPeak = Math.max(g.heldPeak, o.heldPeak);
      for (const k of ['heldTotal', 'tops', 'audited', 'auditBad', 'noAnchor']) g[k] += o[k] ?? 0;
      if (o.auditFirst) g.auditFirst.push(o.auditFirst);
    } else if (o.kind === 'g0loops') for (const [tree, m] of Object.entries(o.trees)) add((loops[tree] ??= {}), m);
  }
}
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
console.log(`deals ${n.deal}, human files ${n.human}, first differences ${diffs}, errors ${errors.length}${errors.length ? `: ${errors.slice(0, 6).join('; ')}` : ''}`);
console.log(`G asks: ${sum(g.hits)} hits, ${sum(g.miss)} misses (${((100 * sum(g.hits)) / (sum(g.hits) + sum(g.miss))).toFixed(1)}% hit); no anchor ${g.noAnchor}`);
console.log(`  hits by maker>caller: ${Object.entries(g.hits).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`  misses by caller: ${Object.entries(g.miss).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`  sampled re-execute audit: ${g.audited} checked, ${g.auditBad} differ${g.auditFirst.length ? ` (${g.auditFirst.slice(0, 3).join('; ')})` : ''}`);
console.log(`held per top-level step: ${g.tops} steps, mean ${(g.heldTotal / Math.max(1, g.tops)).toFixed(1)}, largest ${g.heldPeak}`);
console.log(`  histogram (up to): ${Object.entries(g.heldHist).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
console.log(`  most held: ${deals.sort((a, b) => b.heldPeak - a.heldPeak).slice(0, 5).map(d => `${d.id} ${d.heldPeak}`).join(', ')}`);
const trees = Object.keys(loops);
const chains = [...new Set(trees.flatMap(t => Object.keys(loops[t])))];
const differ = chains.filter(c => new Set(trees.map(t => loops[t][c] ?? 0)).size > 1);
console.log(`valueLoops: ${chains.length} chains over ${trees.join('/')}; ${differ.length} differ${differ.length ? `: ${differ.slice(0, 5).map(c => `${c} ${trees.map(t => loops[t][c] ?? 0).join('/')}`).join('; ')}` : ''}`);
