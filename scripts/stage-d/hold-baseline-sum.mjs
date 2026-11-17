// Sums hold-baseline.ts output (brief rev 2, 4.2): node scripts/stage-d/hold-baseline-sum.mjs <files or dirs...>
// Prints the baseline table: per horizon, agreements, false "holds", false "does not hold", unknown, skipped; each
// disagreement by the board families (the rows of the brief's section 2 that could explain it), "none" when no family
// is on the board (to be read); the one-run "holds" a second run beats (retries); the moved boards; time.
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
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
const LABELS = ['agree', 'agree, other set', 'false holds', 'false does not hold', 'unknown', 'skipped', 'error'];

console.log(`questions ${lines.length} from ${new Set(lines.map(l => l.src)).size} sources (${files.length} files)\n`);
for (const when of ['runnerTurn', 'thisRun']) {
  const qs = lines.filter(l => l.when === when);
  if (!qs.length) continue;
  const asked = qs.filter(l => l.label !== 'skipped' && l.label !== 'error');
  console.log(`## ${when}: ${qs.length} questions (${asked.length} asked of the oracle; ${qs.filter(l => l.moved).length} on a board moved to the Corp's end of turn)`);
  console.log('| answer | count holds | count does not | all | share of asked |');
  console.log('|---|---|---|---|---|');
  for (const label of LABELS) {
    const xs = qs.filter(l => l.label === label);
    if (!xs.length) continue;
    const h = xs.filter(l => l.count?.holds).length;
    console.log(`| ${label} | ${h} | ${xs.length - h} | ${xs.length} | ${label === 'skipped' || label === 'error' ? '-' : pct(xs.length, asked.length)} |`);
  }
  for (const label of ['false holds', 'false does not hold']) {
    const xs = qs.filter(l => l.label === label);
    if (!xs.length) continue;
    console.log(`\n${label} by family (a board may show several; "only" = the one family on the board):`);
    const fam = {};
    for (const l of xs) {
      const f = l.families.length ? l.families : ['none'];
      for (const x of f) {
        fam[x] ??= { any: 0, only: 0 };
        fam[x].any++;
        if (f.length === 1) fam[x].only++;
      }
    }
    for (const [f, n] of Object.entries(fam).sort((a, b) => b[1].any - a[1].any)) console.log(`  ${f}: ${n.any} (only ${n.only})`);
  }
  const retry = qs.filter(l => l.oracle?.retryGetsIn === true);
  if (retry.length) console.log(`\noracle "holds" for one run that a second run in the turn beats: ${retry.length} (count holds in ${retry.filter(l => l.count?.holds).length})`);
  const ms = asked.map(l => l.ms).sort((a, b) => a - b);
  if (ms.length) console.log(`oracle time per question: median ${ms[ms.length >> 1]} ms, p95 ${ms[Math.floor(ms.length * 0.95)]} ms, max ${ms.at(-1)} ms`);
  console.log('');
}
const err = lines.filter(l => l.label === 'error');
if (err.length) console.log(`errors: ${err.length}; first: ${err[0].error}`);
const skipped = {};
for (const l of lines.filter(l => l.label === 'skipped')) skipped[l.oracle?.skipped] = (skipped[l.oracle?.skipped] ?? 0) + 1;
if (Object.keys(skipped).length) console.log('skipped:', JSON.stringify(skipped));
