// Sums hold-baseline.ts COMPARE=1 output (brief rev 2, section 7: the oracle on recorded states, before and after):
//   node scripts/stage-d/hold-walk-compare-sum.mjs <files or dirs...>
// Per horizon, on the flips (every question where the walk and the count as on beta answer `holds` differently) and on
// the sampled non-flips: each count against the oracle's whole-turn truth (retries on), in 4.2's layout; the flips by
// the board families (the rows of the brief's section 2); entries that changed; time.
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

function table(qs, title) {
  const asked = qs.filter(l => l.label !== 'skipped' && l.label !== 'error');
  console.log(`### ${title}: ${qs.length} questions (${qs.filter(l => l.moved).length} moved to the Corp's end of turn)`);
  console.log('| answer | beta: holds | beta: does not | beta all | walk: holds | walk: does not | walk all |');
  console.log('|---|---|---|---|---|---|---|');
  for (const label of LABELS) {
    const b = qs.filter(l => (l.oldLabel ?? l.label) === label);
    const w = qs.filter(l => l.label === label);
    if (!b.length && !w.length) continue;
    const bh = b.filter(l => l.old?.holds).length;
    const wh = w.filter(l => l.count?.holds).length;
    const share = n => (label === 'skipped' || label === 'error' ? '' : ` (${pct(n, asked.length)})`);
    console.log(`| ${label} | ${bh} | ${b.length - bh} | ${b.length}${share(b.length)} | ${wh} | ${w.length - wh} | ${w.length}${share(w.length)} |`);
  }
  const falseShare = (key, holdsKey) => {
    const settled = qs.filter(l => ['agree', 'agree, other set', 'false holds', 'false does not hold'].includes(l[key]));
    const h = settled.filter(l => l[holdsKey].holds);
    const n = settled.filter(l => !l[holdsKey].holds);
    return `"holds" false ${pct(h.filter(l => l[key] === 'false holds').length, h.length)} of ${h.length}; "does not hold" false ${pct(n.filter(l => l[key] === 'false does not hold').length, n.length)} of ${n.length}`;
  };
  console.log(`beta: ${falseShare('oldLabel', 'old')}`);
  console.log(`walk: ${falseShare('label', 'count')}\n`);
}

function families(qs, title) {
  const fam = {};
  for (const l of qs) {
    const f = l.families.length ? l.families : ['none'];
    for (const x of f) {
      fam[x] ??= { any: 0, only: 0 };
      fam[x].any++;
      if (f.length === 1) fam[x].only++;
    }
  }
  console.log(`${title}: ${Object.entries(fam).sort((a, b) => b[1].any - a[1].any).map(([f, n]) => `${f} ${n.any} (only ${n.only})`).join(', ') || 'none'}`);
}

/**
 * The bar's family clause (bars/stage-d-hold-walk.md: "false holds down, and no family up"): per board family, the
 * questions each count gets wrong each way, beta beside the walk, on the flips and the sampled non-flips together and
 * apart. A question counts in every family it shows; "only" counts the questions with that one family.
 */
function crossTable(qs, title) {
  const rows = {};
  const add = (f, part, l) => {
    const r = (rows[f] ??= { n: 0, only: 0, flips: { bh: 0, bn: 0, wh: 0, wn: 0 }, rest: { bh: 0, bn: 0, wh: 0, wn: 0 } });
    const c = r[part];
    if (l.oldLabel === 'false holds') c.bh++;
    if (l.oldLabel === 'false does not hold') c.bn++;
    if (l.label === 'false holds') c.wh++;
    if (l.label === 'false does not hold') c.wn++;
  };
  for (const l of qs) {
    const f = l.families.length ? l.families : ['none'];
    for (const x of f) {
      add(x, l.flip ? 'flips' : 'rest', l);
      rows[x].n++;
      if (f.length === 1) rows[x].only++;
    }
  }
  const sum = (r, k) => r.flips[k] + r.rest[k];
  const cell = (b, w) => `${b} / ${w}${w > b ? ' **up**' : ''}`;
  console.log(`#### ${title}: false answers by family, beta / walk (flips + sampled non-flips; "up" where the walk is wrong more often)`);
  console.log('| family | questions (only) | false holds | false does not hold | flips: false holds | flips: false does not | non-flips: false holds | non-flips: false does not |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const [f, r] of Object.entries(rows).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`| ${f} | ${r.n} (${r.only}) | ${cell(sum(r, 'bh'), sum(r, 'wh'))} | ${cell(sum(r, 'bn'), sum(r, 'wn'))} | ${cell(r.flips.bh, r.flips.wh)} | ${cell(r.flips.bn, r.flips.wn)} | ${cell(r.rest.bh, r.rest.wh)} | ${cell(r.rest.bn, r.rest.wn)} |`);
  }
  console.log('');
}

console.log(`questions ${lines.length} from ${new Set(lines.map(l => l.src)).size} sources (${files.length} files)\n`);
for (const when of ['runnerTurn', 'thisRun']) {
  const qs = lines.filter(l => l.when === when && l.old);
  if (!qs.length) continue;
  console.log(`## ${when}`);
  const flips = qs.filter(l => l.flip);
  table(flips, 'flips');
  const toHold = flips.filter(l => l.count?.holds);
  const toOpen = flips.filter(l => !l.count?.holds);
  console.log(`flips to "holds" ${toHold.length} (right ${toHold.filter(l => l.label === 'agree' || l.label === 'agree, other set').length}, wrong ${toHold.filter(l => l.label === 'false holds').length}); to "does not hold" ${toOpen.length} (right ${toOpen.filter(l => l.label === 'agree').length}, wrong ${toOpen.filter(l => l.label === 'false does not hold').length})`);
  families(toHold, 'flips to "holds", by family');
  families(toOpen, 'flips to "does not hold", by family');
  families(flips.filter(l => l.label === 'false holds' || l.label === 'false does not hold'), 'flips the walk gets wrong, by family');
  console.log('');
  table(qs.filter(l => !l.flip), 'sampled non-flips');
  crossTable(qs, when);
  const ent = qs.filter(l => !l.count.holds && !l.old.holds && l.count.entries !== l.old.entries);
  if (ent.length) console.log(`entries changed on ${ent.length} of ${qs.filter(l => !l.count.holds && !l.old.holds).length} questions both answer "does not hold" (fewer ${ent.filter(l => l.count.entries < l.old.entries).length}, more ${ent.filter(l => l.count.entries > l.old.entries).length})`);
  const ms = qs.filter(l => l.label !== 'skipped').map(l => l.ms).sort((a, b) => a - b);
  if (ms.length) console.log(`oracle time per question: median ${ms[ms.length >> 1]} ms, p95 ${ms[Math.floor(ms.length * 0.95)]} ms, max ${ms.at(-1)} ms`);
  console.log('');
}
const err = lines.filter(l => l.label === 'error');
if (err.length) console.log(`errors: ${err.length}; first: ${err[0].error}`);
