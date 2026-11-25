// R-14h fix, brief rev 4 item 2 (step 0.3's check, weighted and paired), from last-credits-fix-step0.ts records (`err`):
// per side and pool, once per decision, the held-worth error of each form (sum over the deck of |held at the form's money -
// held at the yardstick|), summed per deal, less today's credits' (T); mean and standard error over the pool's deals.
// A form is used only where it beats T beyond two standard errors in each pool (rev 4). Card counts of both errors,
// the other bands and the reads of one side's deck at the other side's decisions are reported beside, deciding nothing.
//   node scripts/runner-rework/last-credits-fix-check-sum.mjs <dir or files of shard stdout>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = process.argv.slice(2).flatMap(p => (statSync(p).isDirectory() ? readdirSync(p, { recursive: true }).map(f => join(p, String(f))).filter(f => statSync(f).isFile()) : [p]));
const decs = [];
const deals = [];
let errors = 0;
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
    else if (r.kind === 'error') errors++;
  }
const POOLS = ['batch', 'nrdb'];
const SIDES = ['runner', 'corp'];
const FORMS = ['T', 'none', 'k1', 'k2'];
const BANDS = ['0-2', '3-5', '6+'];
const band = c => (c <= 2 ? '0-2' : c <= 5 ? '3-5' : '6+');
const p = (...x) => console.log(...x);
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '-');
const RULE = { runner: 'k2', corp: 'k1' }; // rev 4 item 1: the forms from the rules

p(`# R-14h step 0.3, rev 4: the held-worth check\n`);
p(`Deals: ${deals.length} (${POOLS.map(q => `${q} ${deals.filter(d => d.pool === q).length}`).join(', ')}); equal to their batch records: ${deals.filter(d => d.recordSame).length}; errors: ${errors}.\n`);
// coverage: own top-level decisions that read their own deck 'later', with a deck and a next own turn, against those whose deck was caught on the decision's board
for (const q of POOLS)
  p(`Coverage ${q}: ${SIDES.map(s => {
    const want = decs.filter(d => d.pool === q && d.side === s && d.reads[`later|${s}`] && d.len?.[s] > 0 && d.peak !== null);
    const got = want.filter(d => d.err?.[s]);
    return `${s} ${got.length} of ${want.length}`;
  }).join(', ')} (own decisions reading their own deck 'later', a deck left and a next own turn; caught = the deck as its first 'later' read on a board of the decision with today's credits saw it).`);

function table(own, title) {
  p(`\n## ${title}\n`);
  for (const s of SIDES) {
    p(`### ${s}'s deck${own ? '' : ` (read at the ${s === 'runner' ? 'Corp' : 'Runner'}'s decisions)`}\n`);
    p(`| pool | band | decisions | N cards above today | mean E per decision ${FORMS.join(' / ')} | per deal, form less T: ${FORMS.slice(1).map(f => `${f} mean ± SE`).join(' | ')} | false payable ${FORMS.join('/')} | false unpayable ${FORMS.join('/')} |`);
    p(`|---|---|---:|---:|---|${FORMS.slice(1).map(() => '---').join('|')}|---|---|`);
    for (const q of POOLS)
      for (const b of BANDS) {
        const ds = decs.filter(d => d.pool === q && d.err?.[s] && d.err[s].own === own && band(d.err[s].credits) === b);
        const poolDeals = deals.filter(d => d.pool === q);
        const per = new Map(poolDeals.map(d => [d.seed, Object.fromEntries(FORMS.map(f => [f, 0]))]));
        for (const d of ds) {
          const row = per.get(d.seed);
          if (row) for (const f of FORMS) row[f] += d.err[s].E[f];
        }
        const diff = f => {
          const xs = [...per.values()].map(r => r[f] - r.T);
          const n = xs.length;
          const m = xs.reduce((a, x) => a + x, 0) / (n || 1);
          const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, n - 1));
          return { m, se: sd / Math.sqrt(n || 1) };
        };
        const sum = k => FORMS.map(f => ds.reduce((a, d) => a + d.err[s][k][f], 0)).join('/');
        const N = ds.reduce((a, d) => a + d.err[s].N, 0);
        const meanE = FORMS.map(f => f2(ds.reduce((a, d) => a + d.err[s].E[f], 0) / (ds.length || 1))).join(' / ');
        const cells = FORMS.slice(1).map(f => {
          const { m, se } = diff(f);
          return `${f2(m)} ± ${f2(se)}${ds.length && m < -2 * se ? ' (beats T)' : ''}`;
        });
        p(`| ${q} | ${b} | ${ds.length} | ${N} | ${meanE} | ${cells.join(' | ')} | ${sum('fp')} | ${sum('fu')} |`);
      }
    p('');
  }
}
table(true, "Each side's own decisions (rev 4: band 0-2 decides)");
p(`Per deal: the sum over the deal's decisions in that band (a deal with none counts 0), over all the pool's deals.\n`);
p(`## The rule (rev 4 item 2), band 0-2\n`);
for (const s of SIDES) {
  const f = RULE[s];
  const verdicts = POOLS.map(q => {
    const ds = decs.filter(d => d.pool === q && d.err?.[s]?.own && band(d.err[s].credits) === '0-2');
    const per = new Map(deals.filter(d => d.pool === q).map(d => [d.seed, 0]));
    for (const d of ds) if (per.has(d.seed)) per.set(d.seed, per.get(d.seed) + d.err[s].E[f] - d.err[s].E.T);
    const xs = [...per.values()];
    const n = xs.length;
    const m = xs.reduce((a, x) => a + x, 0) / (n || 1);
    const se = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, n - 1)) / Math.sqrt(n || 1);
    return { q, m, se, beats: m < -2 * se };
  });
  p(`- ${s}, form ${f}: ${verdicts.map(v => `${v.q} ${f2(v.m)} ± ${f2(v.se)}${v.beats ? ' beats T' : ' does not beat T'}`).join('; ')}: ${verdicts.every(v => v.beats) ? `**${f} passes**` : '**keeps today\'s credits**'}.`);
}
table(false, "Reads of one side's deck at the other side's decisions (reported apart, deciding nothing)");
