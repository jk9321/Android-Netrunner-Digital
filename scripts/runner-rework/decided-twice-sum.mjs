// R-B B2 log of "decided twice" (brief b2-decided-twice-log.md rev 0): sums the JSON lines of decided-twice.ts.
//   node scripts/runner-rework/decided-twice-sum.mjs out/*.txt > sum.md
// Every count is per pool (batch, nrdb, issues; never added together) and per unit (a run; a forced run for the reverse).
// The O3 rule's two numbers are over the T2 runs of batch and nrdb together, the issue pins read apart.
import { readFileSync } from 'node:fs';

const lines = [];
for (const f of process.argv.slice(2)) {
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    if (!l.startsWith('{')) continue;
    try {
      lines.push(JSON.parse(l));
    } catch {
      /* a cut line */
    }
  }
}
const POOLS = ['batch', 'nrdb', 'issues'];
const CLASSES = ['H', 'T3', 'T2', 'T1', 'T4', 'P', 'A', 'O', 'U'];
const runs = lines.filter(x => x.kind === 'run');
const revs = lines.filter(x => x.kind === 'rev');
const games = lines.filter(x => x.kind === 'g');
const errs = lines.filter(x => x.kind === 'err');
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
const seedOf = r => Number(String(r.src).split(':')[1] ?? 0);
const order = (a, b) => String(a.src).localeCompare(String(b.src), undefined, { numeric: true }) || a.T - b.T || a.n - b.n;
const shown = n => (n < 10 ? `${n} (not shown)` : String(n));
const out = [];
const p = s => out.push(s);

p('# Decided twice: sums');
p('');
p(`Games: ${POOLS.map(pool => `${pool} ${games.filter(g => g.pool === pool).length}`).join(', ')}; deals matching the batch record (winner, cr, sc): batch ${games.filter(g => g.pool === 'batch' && g.matchesBatch).length}, nrdb ${games.filter(g => g.pool === 'nrdb' && g.matchesBatch).length}. Errors: ${errs.length}.`);
const notMatch = games.filter(g => (g.pool === 'batch' || g.pool === 'nrdb') && !g.matchesBatch);
if (notMatch.length) p(`**STOP: source games that do not match the batch: ${notMatch.map(g => g.src).join(', ')}**`);
if (games.some(g => g.plainSame === false)) p(`**STOP: hooked tree differs from plain src: ${games.filter(g => g.plainSame === false).map(g => `${g.src}@${g.firstDiff}`).join(', ')}**`);
const scoreOff = runs.filter(r => r.s0 && r.s0.score !== r.s0.hookScore);
p(`S0 parts are the ranking's own call (the hooked tree's record). Check beside it: runScore re-asked on the eval tree (caches cleared) equals the ranking's score on ${runs.filter(r => r.s0).length - scoreOff.length} of ${runs.filter(r => r.s0).length} priced runs; same reason on ${runs.filter(r => r.s0 && r.s0.reason === r.s0.evalReason).length}.`);
p('');

p('## Classes per pool (unit: a run started by the deciding Runner at the top level)');
p('');
p(`| pool | runs | ${CLASSES.join(' | ')} |`);
p(`|---|---:|${CLASSES.map(() => '---:').join('|')}|`);
for (const pool of POOLS) {
  const rs = runs.filter(r => r.pool === pool);
  p(`| ${pool} | ${rs.length} | ${CLASSES.map(c => rs.filter(r => r.cls === c).length).join(' | ')} |`);
}
p('');
p('H split (H1: ended on a card facedown at S0; H2: a card facedown at S0, rezzed in the run, took credits or clicks first):');
for (const pool of POOLS) {
  const rs = runs.filter(r => r.pool === pool && r.cls === 'H');
  p(`- ${pool}: H1 ${rs.filter(r => r.sub === 'H1').length}, H2 ${rs.filter(r => r.sub === 'H2').length}`);
}
p('');

p('## T2 (clicks) and the O3 rule');
p('');
const t2self = runs.filter(r => (r.pool === 'batch' || r.pool === 'nrdb') && r.cls === 'T2');
const k = rs => `${rs.filter(r => r.detail.K).length} of ${rs.length} (${pct(rs.filter(r => r.detail.K).length, rs.length)})`;
const kp = rs => `${rs.filter(r => r.detail.Kplan).length} of ${rs.length} (${pct(rs.filter(r => r.detail.Kplan).length, rs.length)})`;
p(`Self-play pools together (batch + nrdb), T2 runs: ${shown(t2self.length)}.`);
p(`- **K as written** (bioroidClicks of the server's ice > the clicks after the run's own click): yes on ${k(t2self)}.`);
p(`- Kplan beside it (the clicks of the ice the price took by clicks > the same clicks): yes on ${kp(t2self)}.`);
for (const pool of ['batch', 'nrdb']) {
  const rs = runs.filter(r => r.pool === pool && r.cls === 'T2');
  p(`- ${pool}: T2 ${shown(rs.length)}; K yes ${rs.filter(r => r.detail.K).length}; Kplan yes ${rs.filter(r => r.detail.Kplan).length}; ended by jack-out ${rs.filter(r => r.detail.end === 'jack').length}, by a subroutine ${rs.filter(r => r.detail.end === 'sub').length}`);
}
const pins = runs.filter(r => r.pool === 'issues' && r.cls === 'T2');
p(`- Issue pins (read apart; evidence, not a rate): ${pins.map(r => `${r.src} ${r.server} K ${r.detail.K ? 'yes' : 'no'} / Kplan ${r.detail.Kplan ? 'yes' : 'no'} (bioroidClicks ${r.detail.bioroidClicks}, planned ${r.detail.plannedClicks}, clicks after the run's click ${r.detail.clicksAfterRunClick})`).join('; ') || 'none'}.`);
p('');

p('## T1 (credits), split by what differed at S0');
p('');
p('| pool | T1 | (i) known vs sum of iceCreditNeed | (ii) budget vs availableCredits | (i) and (ii) | (iii) both agree |');
p('|---|---:|---:|---:|---:|---:|');
for (const pool of POOLS) {
  const rs = runs.filter(r => r.pool === pool && r.cls === 'T1');
  p(`| ${pool} | ${rs.length} | ${rs.filter(r => r.sub === 'i').length} | ${rs.filter(r => r.sub === 'ii').length} | ${rs.filter(r => r.sub === 'i+ii').length} | ${rs.filter(r => r.sub === 'iii').length} |`);
}
p('');
p('(iii): what took the credits (every credit loss in the run not on a priced credit break), counted by label:');
for (const pool of POOLS) {
  const counts = new Map();
  for (const r of runs.filter(x => x.pool === pool && x.cls === 'T1' && x.sub === 'iii')) for (const t of new Set((r.detail.took ?? []).map(x => x.replace(/ -?\d+$/, '')))) counts.set(t, (counts.get(t) ?? 0) + 1);
  p(`- ${pool}: ${[...counts].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t, n]) => `${t} ${n}`).join('; ') || 'none'}`);
}
p('');

p('## T3 (its own prompt answer) and T4 (a trash priced and not made)');
p('');
for (const pool of POOLS) {
  const t3 = runs.filter(r => r.pool === pool && r.cls === 'T3');
  const t4 = runs.filter(r => r.pool === pool && r.cls === 'T4');
  const byCard = new Map();
  for (const r of t3) byCard.set(r.detail.card, (byCard.get(r.detail.card) ?? 0) + 1);
  p(`- ${pool}: T3 ${shown(t3.length)} (the price was damage, owner O2: ${t3.filter(r => r.detail.damage).length}; by card: ${[...byCard].map(([c, n]) => `${c} ${n}`).join(', ') || '-'})`);
  p(`  T4 ${shown(t4.length)}: disagreed before the run (the access answer on the priced path already keeps) ${t4.filter(r => r.sub === 'disagreedBefore').length} (${pct(t4.filter(r => r.sub === 'disagreedBefore').length, t4.length)}), changed in the run ${t4.filter(r => r.sub === 'changedInRun').length}, could not pay at the access ${t4.filter(r => r.sub === 'couldNotPay').length}`);
}
p('');

p('## P (the path differs and the run got in), by pair');
p('');
for (const pool of POOLS) {
  const counts = new Map();
  for (const r of runs.filter(x => x.pool === pool && x.cls === 'P')) for (const pr of r.detail.pairs) counts.set(pr, (counts.get(pr) ?? 0) + 1);
  p(`- ${pool}: ${[...counts].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', ') || 'none'}`);
}
p('');
p('## O (not in the brief\'s classes: a run that did not get in for none of the listed reasons), by end and price');
for (const pool of POOLS) {
  const counts = new Map();
  for (const r of runs.filter(x => x.pool === pool && x.cls === 'O')) counts.set(r.sub, (counts.get(r.sub) ?? 0) + 1);
  p(`- ${pool}: ${[...counts].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', ') || 'none'}`);
}
p(`U (a run with no price found at its decision): ${POOLS.map(pool => `${pool} ${runs.filter(r => r.pool === pool && r.cls === 'U').length}`).join(', ')}`);
p('');

p('## The reverse (unit: a run priced out for a payability reason at the first main decision of a Runner turn, forced on a copy)');
p('');
p('| pool | reason | forced | reached the breach | share |');
p('|---|---|---:|---:|---:|');
for (const pool of POOLS) {
  for (const reason of ['known>budget', 'BLOCK', 'noSurvivablePrices', 'noApproach']) {
    const rs = revs.filter(r => r.pool === pool && r.reason === reason && r.forced);
    if (!rs.length) continue;
    const got = rs.filter(r => r.breached);
    p(`| ${pool} | ${reason} | ${rs.length} | ${got.length} | ${pct(got.length, rs.length)} |`);
  }
}
p('');
p(`Not forced (value <= 0 or no server): ${POOLS.map(pool => `${pool} ${revs.filter(r => r.pool === pool && !r.forced).length}`).join(', ')}. Forced runs that failed to run: ${revs.filter(r => r.err).length}.`);
for (const pool of ['batch', 'nrdb']) {
  const got = revs.filter(r => r.pool === pool && r.forced && r.atBreach);
  if (!got.length) continue;
  const avg = f => (got.reduce((n, r) => n + r.atBreach[f], 0) / got.length).toFixed(2);
  p(`- ${pool}: arrived at the breach with credits ${avg('credits')}, clicks ${avg('clicks')}, grip ${avg('grip')} on average (${got.length} runs)`);
}
p('');

p('## Records: the first five of each class with at least five (by deal and turn, not chosen)');
for (const pool of POOLS) {
  for (const c of CLASSES) {
    const rs = runs.filter(r => r.pool === pool && r.cls === c).sort(order);
    if (rs.length < 5 || c === 'A') continue;
    p('');
    p(`### ${pool} ${c}`);
    for (const r of rs.slice(0, 5)) {
      const ice = (r.s0?.ice ?? []).map(i => `${i.t}${i.rezzed ? '' : '(facedown)'}:${i.way}`).join(' > ');
      p(`- ${r.src} T${r.T} ${r.server} (${r.how}) ${r.sub ?? ''}: score ${r.s0?.score}, budget ${r.s0?.budget}, known ${r.s0?.known}, sumNeed ${r.s0?.sumNeed}, avail ${r.s0?.avail}, clicks ${r.s0?.clicksS0}; ice (inner first) ${ice || 'none'}; end ${r.end?.kind}${r.end?.t ? ' ' + r.end.t : ''}; ${JSON.stringify(r.detail ?? {}).slice(0, 400)}`);
    }
  }
}
p('');
const tm = {};
for (const s of lines.filter(x => x.kind === 's')) for (const [k2, v] of Object.entries(s.timing)) tm[k2] = (tm[k2] ?? 0) + v;
p(`Time (ms, all shards): ${Object.entries(tm).map(([k2, v]) => `${k2} ${v}`).join(', ')}; shards ${lines.filter(x => x.kind === 's').length}.`);
console.log(out.join('\n'));
void seedOf;
