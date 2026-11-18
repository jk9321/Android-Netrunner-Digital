// ai-make-room bar 4 to 6: sums make-room-fire.ts output (JSON lines, one file or a directory of *.txt).
//   node scripts/stage-d/make-room-sum.mjs <file or dir> [base deals.json] [this deals.json]
// Prints: sources seen; deals played twice (div): same, first changes by kind (at a make-room prompt / met one in the
// decision's search / neither = a STOP); the decisions asked at the source games (time): changed (at a make-room prompt,
// met one in the search, neither), errors; time of branch against control, self-play and human apart (sum ratio, median
// and p95 of per-decision ratios over decisions of 50 ms or more), and the stops (branch over 2x control on a decision
// of 0.5 s or more, or 3 s slower, after the retime). With the two deals.json, it also checks each played deal's record
// (winner, cr, sc) against the batch's.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [path, baseDeals, thisDeals] = process.argv.slice(2);
const files = statSync(path).isDirectory() ? readdirSync(path).filter(f => f.endsWith('.txt')).map(f => join(path, f)) : [path];
const rows = files.flatMap(f => readFileSync(f, 'utf8').split('\n')).filter(l => l.startsWith('{')).map(l => JSON.parse(l));
const by = k => rows.filter(r => r.kind === k);
const srcs = new Set(by('s').map(r => r.src));
console.log(`sources finished: ${srcs.size} (deals ${[...srcs].filter(s => s.startsWith('deal')).length}, human ${[...srcs].filter(s => s.startsWith('human')).length})`);

// div
const f = by('f');
const diff = f.filter(r => !r.same);
const kind = r => (r.makeRoom ? 'at' : r.look?.branch?.length || r.look?.base?.length ? 'search' : 'neither');
console.log(`\ndiv: ${f.length} deals played twice; ${f.length - diff.length} the same call for call; ${diff.length} with a first change: at a make-room prompt ${diff.filter(r => kind(r) === 'at').length}, met one in the decision's search ${diff.filter(r => kind(r) === 'search').length}, neither (STOP) ${diff.filter(r => kind(r) === 'neither').length}`);
for (const r of diff) console.log(`  ${r.src} #${r.at} T${r.T} ${r.side} ${r.fn} [${kind(r)}] ${r.makeRoom ?? (r.look?.branch ?? []).join('; ')}\n    base ${r.base}\n    branch ${r.branch}${r.sameState ? '' : '\n    (state differs at this call)'}${r.look?.again ? `\n    asked again fresh: base ${r.look.again.base} | branch ${r.look.again.branch}` : ''}`);
if (baseDeals && thisDeals) {
  const load = p => Object.fromEntries(JSON.parse(readFileSync(p, 'utf8')).map(d => [d.seed, d]));
  const [b, t] = [load(baseDeals), load(thisDeals)];
  const same = (x, y) => !!y && x.winner === y.winner && JSON.stringify(x.cr) === JSON.stringify(y.cr) && JSON.stringify(x.sc) === JSON.stringify(y.sc);
  const g = by('g').map(r => ({ seed: Number(r.src.split(':')[1]), ...r }));
  console.log(`  records: base tree = base batch ${g.filter(r => same(r.base, b[r.seed])).length} of ${g.length}; branch tree = this batch ${g.filter(r => same(r.branch, t[r.seed])).length} of ${g.length}`);
}

// time
const d = by('d');
const changed = d.filter(r => r.changed);
const ck = r => (r.makeRoom ? 'at' : r.look?.branch?.length || r.look?.base?.length ? 'search' : 'neither');
const errors = d.filter(r => [r.base, r.branch].some(a => String(a ?? '').startsWith('error')));
console.log(`\ntime: ${d.length} decisions asked (${d.filter(r => r.src.startsWith('deal')).length} self-play, ${d.filter(r => r.src.startsWith('human')).length} human); at a make-room prompt ${d.filter(r => r.makeRoom).length}; control answered unlike base ${d.filter(r => r.controlDiffers).length}; errors ${errors.length}`);
console.log(`changed (branch unlike base): ${changed.length}: at a make-room prompt ${changed.filter(r => ck(r) === 'at').length}, met one in the search ${changed.filter(r => ck(r) === 'search').length}, neither (STOP) ${changed.filter(r => ck(r) === 'neither').length}`);
for (const r of changed) console.log(`  ${r.src} #${r.i} T${r.T} ${r.side} ${r.fn} [${ck(r)}] ${r.makeRoom ?? (r.look?.branch ?? []).join('; ')}\n    base ${r.base}\n    branch ${r.branch}`);
const q = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
for (const [name, pick] of [['self-play', r => r.src.startsWith('deal')], ['human', r => r.src.startsWith('human')]]) {
  const xs = d.filter(pick);
  if (!xs.length) continue;
  const sum = k => xs.reduce((n, r) => n + r.ms[k], 0);
  const ratios = xs.filter(r => r.ms.control >= 50).map(r => r.ms.branch / r.ms.control);
  const baseRatios = xs.filter(r => r.ms.control >= 50).map(r => r.ms.base / r.ms.control);
  const stops = xs.filter(r => (r.ms.branch >= 500 && r.ms.branch > 2 * r.ms.control) || r.ms.branch > r.ms.control + 3000);
  console.log(`\n${name}: ${xs.length} decisions; total branch x${(sum('branch') / sum('control')).toFixed(3)} of control (base x${(sum('base') / sum('control')).toFixed(3)}); per decision of 50 ms+ (${ratios.length}): median x${q(ratios, 0.5).toFixed(3)}, p95 x${q(ratios, 0.95).toFixed(3)} (base median x${q(baseRatios, 0.5).toFixed(3)}, p95 x${q(baseRatios, 0.95).toFixed(3)}); retimed ${xs.filter(r => r.retimed).length}; stops after the retime ${stops.length}`);
  for (const r of stops) console.log(`  STOP ${r.src} #${r.i} T${r.T} ${r.side} ${r.fn}: branch ${r.ms.branch} control ${r.ms.control} ${r.retimed ?? ''}`);
}
const h = by('h');
console.log(`\nhuman replays: ${h.length}, stopped early ${h.filter(r => r.stopped).length}${h.filter(r => r.stopped).map(r => `\n  ${r.src}: ${r.stopped}`).join('')}`);
