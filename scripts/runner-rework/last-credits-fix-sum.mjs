// R-14h fix, step 0 sums (last-credits-fix-step0.ts records): reach per site, fires per form, the money forms' flips
// against the peak of the next own turn, per side, pool and band of today's credits.
//   node scripts/runner-rework/last-credits-fix-sum.mjs <dir or files of shard stdout>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = process.argv.slice(2).flatMap(p => (statSync(p).isDirectory() ? readdirSync(p, { recursive: true }).map(f => join(p, String(f))).filter(f => statSync(f).isFile()) : [p]));
const decs = [];
const deals = [];
const errors = [];
for (const f of files)
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.kind === 'dec') decs.push(r);
    else if (r.kind === 'deal') deals.push(r);
    else if (r.kind === 'error') errors.push(r);
  }
const FORMS = ['none', 'k1', 'k2'];
const POOLS = ['batch', 'nrdb'];
const SIDES = ['runner', 'corp'];
const band = c => (c <= 2 ? '0-2' : c <= 5 ? '3-5' : '6+');
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-');
const p = (...x) => console.log(...x);

p(`# R-14h fix step 0 sums\n`);
p(`Deals: ${deals.length} (${POOLS.map(q => `${q} ${deals.filter(d => d.pool === q).length}`).join(', ')}); equal to their batch records: ${deals.filter(d => d.recordSame).length}; errors: ${errors.length}. Top-level decisions: ${decs.length}.`);
for (const d of deals.filter(d => !d.recordSame)) p(`- NOT equal to its record: ${d.pool} ${d.seed}`);
for (const e of errors.slice(0, 5)) p(`- error ${e.pool} ${e.seed}: ${String(e.error).split('\n')[0]}`);

// 0.1 reach
p(`\n## 0.1 Reach: top-level decisions that reach each call (any board of the decision), by pool and deciding side\n`);
p(`| site | deck | class | batch R | batch C | nrdb R | nrdb C | calls (all) |`);
p(`|---|---|---|---:|---:|---:|---:|---:|`);
const reach = new Map();
for (const d of decs)
  for (const [k, n] of Object.entries(d.sites)) {
    const r = reach.get(k) ?? { calls: 0 };
    const c = `${d.pool}|${d.side}`;
    r[c] = (r[c] ?? 0) + 1;
    r.calls += n;
    reach.set(k, r);
  }
for (const [k, r] of [...reach].sort((a, b) => a[0].localeCompare(b[0]))) {
  const [site, deck, when] = k.split('|');
  p(`| \`${site}\` | ${deck} | ${when} | ${r['batch|runner'] ?? 0} | ${r['batch|corp'] ?? 0} | ${r['nrdb|runner'] ?? 0} | ${r['nrdb|corp'] ?? 0} | ${r.calls} |`);
}
const all = (q, s) => decs.filter(d => d.pool === q && d.side === s).length;
p(`\nAll decisions: ${POOLS.map(q => SIDES.map(s => `${q} ${s} ${all(q, s)}`).join(', ')).join('; ')}.`);

// 0.2 fires
p(`\n## 0.2 Fires: decisions with a \`'later'\` read whose value moves by more than 0.001 under each form (any deck), by deciding side and kind\n`);
const kinds = [...new Set(decs.map(d => d.dk))].sort();
p(`| pool | side | kind | decisions | ${FORMS.map(f => `fires ${f}`).join(' | ')} |`);
p(`|---|---|---|---:|${FORMS.map(() => '---:').join('|')}|`);
for (const q of POOLS)
  for (const s of SIDES)
    for (const k of [...kinds, 'all']) {
      const ds = decs.filter(d => d.pool === q && d.side === s && (k === 'all' || d.dk === k));
      if (!ds.length) continue;
      const cells = FORMS.map(f => {
        const n = ds.filter(d => Object.keys(d.fires).some(x => x.startsWith(`${f}|later|`))).length;
        return `${n} (${pct(n, ds.length)})`;
      });
      p(`| ${q} | ${s} | ${k} | ${ds.length} | ${cells.join(' | ')} |`);
    }
p(`\nBy site (decisions where that site's \`'later'\` read fired), form k1 / k2 / none:\n`);
const bySite = new Map();
for (const d of decs)
  for (const x of Object.keys(d.fires)) {
    const [f, when, deck, site] = x.split('|');
    if (when !== 'later') continue;
    const key = `${site}|${deck}`;
    const r = bySite.get(key) ?? {};
    r[`${d.pool}|${f}`] = (r[`${d.pool}|${f}`] ?? 0) + 1;
    bySite.set(key, r);
  }
p(`| site | deck | batch k1/k2/none | nrdb k1/k2/none |`);
p(`|---|---|---|---|`);
for (const [k, r] of [...bySite].sort()) {
  const [site, deck] = k.split('|');
  p(`| \`${site}\` | ${deck} | ${['k1', 'k2', 'none'].map(f => r[`batch|${f}`] ?? 0).join(' / ')} | ${['k1', 'k2', 'none'].map(f => r[`nrdb|${f}`] ?? 0).join(' / ')} |`);
}
p(`\n(\`'now'\` reads that WOULD move if classed \`'later'\`, k1, decisions: ${POOLS.map(q => `${q} ${decs.filter(d => d.pool === q && Object.keys(d.fires).some(x => x.startsWith('k1|now|'))).length}`).join(', ')}: the reach a wrong class would have.)`);

// 0.3 money
p(`\n## 0.3 Which money: the cards each form flips (cost above today's credits, within the form's money) on the decider's own deck at its own top-level decisions that read its own deck \`'later'\`, against the peak credits it held during its next own turn\n`);
p(`"over" = flipped and above that peak (the form called it payable; the side never held its cost on that turn). Rule (brief step 0.3): per side, the form with the most money whose over share in band 0-2 is at most 1 in 5 in BOTH pools; under 10 flipped in a pool and band = "not shown".\n`);
for (const s of SIDES) {
  p(`### ${s}\n`);
  p(`| pool | band | decisions | ${FORMS.map(f => `${f} flipped / over (share)`).join(' | ')} |`);
  p(`|---|---|---:|${FORMS.map(() => '---').join('|')}|`);
  for (const q of POOLS)
    for (const b of ['0-2', '3-5', '6+', 'all']) {
      const ds = decs.filter(d => d.pool === q && d.side === s && d.peak !== null && d.reads[`later|${s}`] && (b === 'all' || band(d.credits) === b));
      const cells = FORMS.map(f => {
        let n = 0;
        let o = 0;
        for (const d of ds)
          for (const c of d.flips[f]) {
            n++;
            if (c > d.peak) o++;
          }
        return `${n} / ${o} (${n < 10 ? 'not shown' : pct(o, n)})`;
      });
      p(`| ${q} | ${b} | ${ds.length} | ${cells.join(' | ')} |`);
    }
  p('');
}
p(`Money beside today's credits (mean over the same decisions, band 0-2): ${SIDES.map(s => POOLS.map(q => {
  const ds = decs.filter(d => d.pool === q && d.side === s && d.peak !== null && d.reads[`later|${s}`] && band(d.credits) === '0-2');
  const m = f => (ds.reduce((n, d) => n + d.money[f] - d.credits, 0) / (ds.length || 1)).toFixed(2);
  return `${s} ${q}: none +${m('none')}, k1 +${m('k1')}, k2 +${m('k2')}, peak +${(ds.reduce((n, d) => n + d.peak - d.credits, 0) / (ds.length || 1)).toFixed(2)}`;
}).join('; ')).join('; ')}.`);
const ms = deals.map(d => d.ms).sort((a, b) => a - b);
p(`\nDeal time (hooked tree, ms): median ${ms[Math.floor(ms.length / 2)]}, max ${ms[ms.length - 1]}.`);
