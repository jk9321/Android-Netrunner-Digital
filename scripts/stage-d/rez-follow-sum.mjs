// Stage D rez-follow, the sum of rez-follow.ts's shard outputs (brief: netrunner-ai/stage-d/rez-follow/brief.md).
//   node scripts/stage-d/rez-follow-sum.mjs <g1 deals.json> out/*.txt > sum.md
// Sources apart everywhere: self-play (the local deals), human Runner (the old AI Corp's games: its rez answers are
// recorded, beta is asked at the same board), human Corp (a person's rez answers, reported as what a person did).
import { existsSync, readFileSync } from 'node:fs';

const [dealsFile, ...files] = process.argv.slice(2);
const lines = files.flatMap(f => readFileSync(f, 'utf8').split('\n')).filter(l => l.startsWith('{')).map(l => JSON.parse(l));
const by = k => lines.filter(x => x.kind === k);
const aiOf = new Map();
const group = src => {
  if (src.startsWith('deal:')) return 'self-play';
  if (!aiOf.has(src)) {
    const f = `tests/fixtures/human-games/${src.slice(6)}`;
    aiOf.set(src, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).config.ai : '?');
  }
  return aiOf.get(src) === 'corp' ? 'human Runner' : 'human Corp';
};
const GROUPS = ['self-play', 'human Runner', 'human Corp'];
const out = [];
const p = s => out.push(s);
const count = (xs, f) => {
  const m = new Map();
  for (const x of xs) {
    const k = f(x);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
};
const fmt = m => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '-';

// ---------------------------------------------------------------- identity
const g1 = new Map(JSON.parse(readFileSync(dealsFile, 'utf8')).map(d => [`deal:${d.seed}`, d]));
const ps = by('p');
const differ = ps.filter(x => {
  const d = g1.get(x.src);
  return !d || JSON.stringify(d.cr) !== JSON.stringify(x.cr) || JSON.stringify(d.sc) !== JSON.stringify(x.sc) || d.winner !== x.winner;
});
p(`# rez-follow sums\n\nSources: ${ps.length} local deals, ${new Set(by('d').filter(x => !x.src.startsWith('deal:')).map(x => x.src)).size} human games with a Corp decision.`);
p(`Identity: local deals whose Corp credits and score at each Corp turn start and winner differ from the g1 batch's deals.json: ${differ.length}${differ.length ? ` (${differ.map(x => x.src).join(', ')})` : ''}.\n`);

// ---------------------------------------------------------------- fire
const ds = by('d');
const trees = Object.keys(ds[0]?.ms ?? {});
const arms = trees.filter(t => t !== 'beta');
p('## Fire count (decisions where the copy differs from the beta copy)\n');
p(`| tree | source | Corp decisions | rez windows | changed | of them rez windows | per game | errors |`);
p('|---|---|---|---|---|---|---|---|');
for (const t of arms)
  for (const g of GROUPS) {
    const d = ds.filter(x => group(x.src) === g);
    const ch = d.filter(x => x.changed.includes(t));
    const games = new Set(d.map(x => x.src)).size || 1;
    const err = d.filter(x => String(x.picks?.[t]).startsWith('error')).length;
    p(`| ${t} | ${g} | ${d.length} | ${d.filter(x => x.dk === 'rez').length} | ${ch.length} | ${ch.filter(x => x.dk === 'rez').length} | ${(ch.length / games).toFixed(2)} | ${err} |`);
  }
p(`\nErrors in the beta copy: ${ds.filter(x => String(x.picks?.beta).startsWith('error')).length}. Window facts whose derived rule disagrees with countedRez: ${ds.filter(x => x.facts && !x.facts.derivedOk).length}.\n`);

// ---------------------------------------------------------------- Q2
const wins = ds.filter(x => x.facts);
const runs = by('r');
const winRun = new Map();
for (const r of runs) for (const w of r.wins) winRun.set(`${r.src}#${w.i}`, { r, w });
const betaRez = x => String(x.picks.beta).includes('REZ_CARD');
const outcome = x => winRun.get(`${x.src}#${x.i}`)?.r.outcome ?? '?';
const actual = x => winRun.get(`${x.src}#${x.i}`)?.w.actual ?? '?';
p('## Q2. Every approach-ice rez window the Corp is asked at (unrezzed approached ice)\n');
p('| source | windows | beta rezzes | rezStops(further) | rezStops(alone) | rule (all windows) |');
p('|---|---|---|---|---|---|');
for (const g of GROUPS) {
  const w = wins.filter(x => group(x.src) === g);
  p(`| ${g} | ${w.length} | ${w.filter(betaRez).length} | ${w.filter(x => x.facts.stopsT).length} | ${w.filter(x => x.facts.stopsF).length} | ${fmt(count(w, x => x.facts.rule))} |`);
}
p('\n### Table A: the count with the set further in says this rez stops the run (rezStops further) and beta passes\n');
p('Outcome is the run on the record (human games: after the recorded answer, column "recorded").\n');
p('| source | server kind | rule that answered | windows | recorded answer rez / pass | run ended / got in / stolen |');
p('|---|---|---|---|---|---|');
for (const g of GROUPS) {
  const a = wins.filter(x => group(x.src) === g && x.facts.stopsT && !betaRez(x));
  const keys = count(a, x => `${x.sk}|${x.facts.rule}${x.facts.counted === null && x.facts.gain !== null ? (Number(x.facts.gain) > 0 ? ' (model +)' : ' (model -)') : ''}`);
  for (const [k, v] of [...keys].sort((x, y) => y[1] - x[1])) {
    const [sk, rule] = k.split('|');
    const rows = a.filter(x => `${x.sk}|${x.facts.rule}${x.facts.counted === null && x.facts.gain !== null ? (Number(x.facts.gain) > 0 ? ' (model +)' : ' (model -)') : ''}` === k);
    const o = count(rows, outcome);
    p(`| ${g} | ${sk} | ${rule} | ${v} | ${rows.filter(x => actual(x) === 'rez').length} / ${rows.filter(x => actual(x) === 'pass').length} | ${o.get('ended') ?? 0} / ${o.get('in') ?? 0} / ${o.get('stolen') ?? 0} |`);
  }
  if (!a.length) p(`| ${g} | - | - | 0 | - | - |`);
}
const aList = wins.filter(x => x.facts.stopsT && !betaRez(x) && x.sk === 'root-agenda');
p(`\nRoot-agenda windows of table A (${aList.length}): ${aList.map(x => `${x.src} T${x.T} #${x.i} ${x.ice.title} (${x.facts.rule}, alone ${x.facts.stopsF}, gain ${x.facts.gain}; ${outcome(x)})`).join('; ')}\n`);
p('### Table B: beta rezzes, and no set stops the run (the count with the ice and without it both say the Runner gets in)\n');
p('| source | server kind | rule | windows | toll paid (credits spent at it) | run ended at it | tags | nothing | run got in / stolen |');
p('|---|---|---|---|---|---|---|---|---|');
for (const g of GROUPS) {
  const b = wins.filter(x => group(x.src) === g && betaRez(x) && !x.facts.withIt.holds && !x.facts.without.holds);
  const keys = count(b, x => `${x.sk}|${x.facts.rule}`);
  for (const [k, v] of [...keys].sort((x, y) => y[1] - x[1])) {
    const rows = b.filter(x => `${x.sk}|${x.facts.rule}` === k);
    const ww = rows.map(x => winRun.get(`${x.src}#${x.i}`)?.w).filter(Boolean);
    const toll = ww.filter(w => w.actual === 'rez' && w.spent > 0).length;
    const ended = ww.filter(w => w.actual === 'rez' && w.endedHere).length;
    const tags = ww.filter(w => w.actual === 'rez' && w.tags > 0).length;
    const nothing = ww.filter(w => w.actual === 'rez' && !(w.spent > 0) && !w.endedHere && !(w.tags > 0)).length;
    const o = count(rows, outcome);
    const [sk, rule] = k.split('|');
    p(`| ${g} | ${sk} | ${rule} | ${v} | ${toll} | ${ended} | ${tags} | ${nothing} | ${o.get('in') ?? 0} / ${o.get('stolen') ?? 0} |`);
  }
}
p('\n(toll / ended / tags / nothing count only the windows where the record rezzed too.)\n');
const stops = runs.filter(r => r.stopCheck?.length);
p(`### Table C: runs where a set the count said stops the run was rezzed in full and the Runner still got in: ${stops.length}\n`);
for (const r of stops) p(`- ${r.src} T${r.T} ${r.server} (${r.sk}) ${r.outcome}: sets ${JSON.stringify(r.stopCheck)}; windows ${JSON.stringify(r.wins.map(w => [w.i, w.code, w.actual, w.facts?.rule, w.spent]))}`);

// ---------------------------------------------------------------- arms: continuations
p('\n## Q3. The arms\n');
const R = (c, n) => {
  const m = c.marks.filter(x => x.ended === 'runner')[n - 1];
  return m ? { corp: m.corp - c.start.corp, runner: m.runner - c.start.runner } : { corp: c.end.corp - c.start.corp, runner: c.end.runner - c.start.runner };
};
for (const t of arms.filter(a => a !== 'control')) {
  p(`### ${t}\n`);
  p('| source | changed (rez / action) | with continuation | Corp by R2 beta / arm | Runner by R2 beta / arm | two-turn net | game end Corp beta / arm | game end Runner beta / arm | Corp wins beta / arm | R1 Corp credits beta / arm | R1 under the keep: arm only / beta only |');
  p('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const g of GROUPS) {
    const ch = ds.filter(x => group(x.src) === g && x.changed.includes(t));
    const c = ch.filter(x => x.cont?.[t] && x.cont?.beta);
    let cb = 0, ca = 0, rb = 0, ra = 0, eb = 0, ea = 0, erb = 0, era = 0, wb = 0, wa = 0, crb = 0, cra = 0, armOnly = 0, betaOnly = 0;
    for (const x of c) {
      const b = x.cont.beta, a = x.cont[t];
      cb += R(b, 2).corp; ca += R(a, 2).corp; rb += R(b, 2).runner; ra += R(a, 2).runner;
      eb += b.end.corp; ea += a.end.corp; erb += b.end.runner; era += a.end.runner;
      wb += b.winner === 'corp' ? 1 : 0; wa += a.winner === 'corp' ? 1 : 0;
      const m1b = b.marks.find(m => m.ended === 'runner'), m1a = a.marks.find(m => m.ended === 'runner');
      crb += m1b?.credits ?? 0; cra += m1a?.credits ?? 0;
      const under = m => m && typeof m.keep === 'number' && m.credits < m.keep;
      if (under(m1a) && !under(m1b)) armOnly++;
      if (under(m1b) && !under(m1a)) betaOnly++;
    }
    p(`| ${g}${c.length < 10 && g !== 'self-play' ? ' (under 10)' : ''} | ${ch.length} (${ch.filter(x => x.dk === 'rez').length} / ${ch.filter(x => x.dk !== 'rez').length}) | ${c.length} | ${cb} / ${ca} | ${rb} / ${ra} | **${ca - cb - (ra - rb)}** | ${eb} / ${ea} | ${erb} / ${era} | ${wb} / ${wa} | ${crb} / ${cra} | ${armOnly} / ${betaOnly} |`);
  }
  const ch = ds.filter(x => x.changed.includes(t));
  p(`\nChanged decisions of ${t}:`);
  for (const x of ch) {
    const b = x.cont?.beta, a = x.cont?.[t];
    const r2 = b && a ? `R2 Corp ${R(b, 2).corp}/${R(a, 2).corp} Runner ${R(b, 2).runner}/${R(a, 2).runner}; end ${b.end.corp}-${b.end.runner} ${b.winner} / ${a.end.corp}-${a.end.runner} ${a.winner}; R1 credits ${b.marks.find(m => m.ended === 'runner')?.credits}(keep ${b.marks.find(m => m.ended === 'runner')?.keep}) / ${a.marks.find(m => m.ended === 'runner')?.credits}(keep ${a.marks.find(m => m.ended === 'runner')?.keep})` : 'no continuation';
    p(`- ${x.src} T${x.T} #${x.i} ${x.dk}${x.ice ? ` ${x.server} (${x.sk}) ${x.ice.title} pos ${x.ice.pos}/${x.ice.of}, rule ${x.facts.rule}, stops further ${x.facts.stopsT} alone ${x.facts.stopsF}, Corp ${x.corpCredits} Runner ${x.runnerCredits}, run on the record ${outcome(x)}` : ''}${x.recorded ? `, recorded ${x.recorded.includes('REZ') ? 'rez' : 'pass'}` : ''}: ${r2}`);
  }
  p('');
}

// ---------------------------------------------------------------- exposures
p('## The exposures, played from the Runner turn start\n');
p(`| exposure | ${['beta', ...arms.filter(a => a !== 'control')].join(' | ')} |`);
p(`|---|${arms.filter(a => a !== 'control').concat(['beta']).map(() => '---').join('|')}|`);
for (const x of by('x')) p(`| ${x.src} T${x.T} ${x.server} | ${['beta', ...arms.filter(a => a !== 'control')].map(t => `${x[t].stolen.length ? 'stolen' : 'not stolen'} (rezzed ${x[t].rezzed.join(' ') || 'none'}; Corp ${x[t].corpCredits}${x[t].switchedAt != null ? `; own answer from move ${x[t].switchedAt}` : ''})`).join(' | ')} |`);

// ---------------------------------------------------------------- time
p('\n## Time against the control copy (medians of 3 at the stops)\n');
p('| tree | source | total x control | rez windows x control | p95 x control | stop: over 2x of a control decision of 0.5 s or more | stop: 3 s or more slower |');
p('|---|---|---|---|---|---|---|');
const q = (xs, f) => [...xs].sort((a, b) => a - b)[Math.floor(f * (xs.length - 1))] ?? 0;
for (const t of trees.filter(x => x !== 'control'))
  for (const g of ['self-play', 'human']) {
    const d = ds.filter(x => (g === 'self-play' ? group(x.src) === 'self-play' : group(x.src) !== 'self-play'));
    const sum = (xs, k) => xs.reduce((n, x) => n + x.ms[k], 0);
    const rz = d.filter(x => x.dk === 'rez');
    const s2 = d.filter(x => x.ms.control >= 500 && x.ms[t] > 2 * x.ms.control);
    const s3 = d.filter(x => x.ms[t] > x.ms.control + 3000);
    p(`| ${t} | ${g} | ${(sum(d, t) / sum(d, 'control')).toFixed(3)} | ${(sum(rz, t) / sum(rz, 'control')).toFixed(3)} | ${(q(d.map(x => x.ms[t]), 0.95) / q(d.map(x => x.ms.control), 0.95)).toFixed(3)} | ${s2.length}${s2.length ? ` (${s2.map(x => `${x.src} #${x.i} ${x.ms.control}->${x.ms[t]}`).join(', ')})` : ''} | ${s3.length}${s3.length ? ` (${s3.map(x => `${x.src} #${x.i} ${x.ms.control}->${x.ms[t]}`).join(', ')})` : ''} |`);
  }
console.log(out.join('\n'));
