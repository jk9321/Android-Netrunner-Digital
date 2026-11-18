// Sums runner-money.ts (hold questions: `src` and `q` lines) and runner-money-fire.ts (Corp decisions: `d` lines) output.
//   node scripts/stage-d/runner-money-sum.mjs <files or dirs...>
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
const add = (o, k, n = 1) => (o[k] = (o[k] ?? 0) + n);
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');

const srcs = lines.filter(l => l.kind === 'src');
const qs = lines.filter(l => l.kind === 'q');
const ds = lines.filter(l => l.kind === 'd');
const errs = lines.filter(l => l.kind === 'error');

if (srcs.length) {
  const t = { questions: 0, distinct: 0, byGroup: {}, flips: {}, flipsInGroup: {}, ms: {}, known: {} };
  for (const s of srcs) {
    t.questions += s.questions;
    t.distinct += s.distinct;
    for (const [g, n] of Object.entries(s.byGroup)) add(t.byGroup, g, n);
    for (const [a, n] of Object.entries(s.flips)) add(t.flips, a, n);
    for (const [a, m] of Object.entries(s.flipsInGroup)) for (const [g, n] of Object.entries(m)) add((t.flipsInGroup[a] ??= {}), g, n);
    for (const [a, n] of Object.entries(s.ms)) add(t.ms, a, n);
    for (const [k, n] of Object.entries(s.known)) add(t.known, k, n);
  }
  console.log(`## Hold questions (${srcs.length} sources): ${t.questions} asked, ${t.distinct} distinct; errors ${errs.length}\n`);
  console.log('Distinct questions with a card of the group in play: ' + Object.entries(t.byGroup).map(([g, n]) => `${g} ${n} (${pct(n, t.distinct)})`).join(', '));
  console.log('Sources with the group in play: ' + Object.keys(t.byGroup).map(g => `${g} ${srcs.filter(s => s.byGroup[g]).length}`).join(', '));
  console.log('Unmodelled inventory cards in play (distinct questions): ' + (Object.entries(t.known).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'));
  console.log('\n| arm | flips (holds -> does not hold or back) | in its group | outside every group | sources |');
  console.log('|---|---|---|---|---|');
  const own = { counter: ['counter'], runBegin: ['runBegin'], saci: ['saci'], lightning: ['lightning'], arru: ['arru'], installed: ['counter', 'runBegin', 'saci', 'lightning', 'arru'], runBeginBound: ['runBegin'], arruBound: ['arru'], installedBound: ['counter', 'runBegin', 'saci', 'lightning', 'arru'], part1: ['counter', 'runBegin', 'saci', 'lightning'], f2max: ['f2'], f2odds: ['f2'] };
  for (const [a, n] of Object.entries(t.flips)) {
    const fig = t.flipsInGroup[a] ?? {};
    console.log(`| ${a} | ${n} | ${(own[a] ?? []).map(g => `${g} ${fig[g] ?? 0}`).join(', ')} | ${fig.none ?? 0} | ${srcs.filter(s => s.flips[a]).map(s => s.src.replace('human:', '').replace('.json', '')).join(' ')} |`);
  }
  console.log(`\nHold-count time in the watch (ms, each arm's count asked cold on a copy; beta's warm in play): ${Object.entries(t.ms).map(([a, v]) => `${a} ${v}`).join(', ')}`);
}

if (qs.length) {
  console.log(`\n## The fixed oracle on the kept questions (${qs.length}: every installed-arm flip, and up to MAXQ a source with an installed group in play)\n`);
  const arms = [...new Set(qs.flatMap(q => Object.keys(q.oracle?.labels ?? {})))];
  console.log('| count | agree | agree, other set | false holds | false does not hold | unknown | skipped |');
  console.log('|---|---|---|---|---|---|---|');
  for (const a of arms) {
    const c = {};
    for (const q of qs) add(c, q.oracle?.labels?.[a] ?? 'error');
    console.log(`| ${a} | ${c.agree ?? 0} | ${c['agree, other set'] ?? 0} | ${c['false holds'] ?? 0} | ${c['false does not hold'] ?? 0} | ${c.unknown ?? 0} | ${c.skipped ?? 0} |`);
  }
  console.log('\nOn each arm\'s own flips (beta label -> arm label):');
  for (const a of arms.filter(x => x !== 'beta')) {
    const c = {};
    for (const q of qs.filter(x => x.flips.includes(a))) add(c, `${q.oracle?.labels?.beta} -> ${q.oracle?.labels?.[a]}`);
    console.log(`- ${a}: ${Object.entries(c).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join('; ') || 'none'}`);
  }
  console.log('\nNew false "holds" by an arm (beta not false holds, the arm false holds), by position:');
  for (const a of arms.filter(x => x !== 'beta')) {
    const pos = {};
    for (const q of qs.filter(x => x.oracle?.labels?.[a] === 'false holds' && x.oracle?.labels?.beta !== 'false holds')) add(pos, `${q.src} ${q.server} T${q.turn} [${q.ice.join(', ')}]`);
    console.log(`- ${a}: ${Object.entries(pos).map(([k, n]) => `${n} ${k}`).join('; ') || 'none'}`);
  }
  console.log('\nFalse "holds" of beta that an arm turns right (by position):');
  for (const a of arms.filter(x => x !== 'beta')) {
    const pos = {};
    for (const q of qs.filter(x => x.oracle?.labels?.beta === 'false holds' && x.oracle?.labels?.[a] !== 'false holds')) add(pos, `${q.src} ${q.server} T${q.turn} [${q.ice.join(', ')}] -> ${q.oracle.labels[a]}`);
    console.log(`- ${a}: ${Object.entries(pos).map(([k, n]) => `${n} ${k}`).join('; ') || 'none'}`);
  }
  console.log('\nNew false "does not hold" by an arm (beta not false does not hold, the arm false does not hold), by position:');
  for (const a of arms.filter(x => x !== 'beta')) {
    const pos = {};
    for (const q of qs.filter(x => x.oracle?.labels?.[a] === 'false does not hold' && x.oracle?.labels?.beta !== 'false does not hold')) add(pos, `${q.src} ${q.server} T${q.turn} [${q.ice.join(', ')}] rig [${q.rig.join(', ')}]`);
    const total = Object.values(pos).reduce((n, x) => n + x, 0);
    console.log(`- ${a} (${total}): ${Object.entries(pos).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${n} ${k}`).join('; ') || 'none'}`);
  }
  console.log('\nBeta\'s false "holds" left by every arm, by position:');
  const pos = {};
  for (const q of qs.filter(x => x.oracle?.labels?.beta === 'false holds' && x.oracle?.labels?.installed === 'false holds' && (x.oracle?.labels?.installedBound ?? 'false holds') === 'false holds')) add(pos, `${q.src} ${q.server} T${q.turn} [${q.ice.join(', ')}] rig [${q.rig.join(', ')}]`);
  for (const [k, n] of Object.entries(pos).sort((a, b) => b[1] - a[1])) console.log(`- ${n} ${k}`);
}

if (ds.length) {
  const games = new Set(ds.map(d => d.src)).size;
  const arms = [...new Set(ds.flatMap(d => Object.keys(d.ms)))].filter(a => a !== 'beta');
  console.log(`\n## Corp decisions (${ds.length} in ${games} sources)\n`);
  const inGroup = {};
  for (const d of ds) for (const g of d.groups) add(inGroup, g);
  console.log('Decisions with a card of the group in play: ' + Object.entries(inGroup).map(([g, n]) => `${g} ${n} (${pct(n, ds.length)})`).join(', '));
  console.log('\n| arm | changed | a game | with its group in play | errors | time mean x | p95 x | over 2x at >= 0.5 s | +3 s or more | slowest arm decision |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  const own = { counter: 'counter', runBegin: 'runBegin', saci: 'saci', lightning: 'lightning', arru: 'arru', runBeginBound: 'runBegin', arruBound: 'arru', f2max: 'f2', f2odds: 'f2' };
  for (const a of arms) {
    const ch = ds.filter(d => d.changed.includes(a));
    const err = ds.filter(d => String(d.picks?.[a] ?? '').startsWith('error')).length;
    const ratios = ds.filter(d => d.ms.beta > 20).map(d => d.ms[a] / d.ms.beta).sort((x, y) => x - y);
    const mean = ratios.reduce((n, x) => n + x, 0) / Math.max(1, ratios.length);
    const p95 = ratios[Math.floor(0.95 * (ratios.length - 1))] ?? 0;
    const slow2 = ds.filter(d => d.ms.beta >= 500 && d.ms[a] > 2 * d.ms.beta);
    const slow3 = ds.filter(d => d.ms[a] - d.ms.beta >= 3000);
    const top = ds.reduce((m, d) => (d.ms[a] > (m?.ms[a] ?? -1) ? d : m), null);
    const g = a.startsWith('installed') || a === 'part1' ? ch.filter(d => d.groups.some(x => x !== 'f2')).length : ch.filter(d => d.groups.includes(own[a])).length;
    console.log(`| ${a} | ${ch.length} | ${(ch.length / games).toFixed(2)} | ${g} | ${err} | ${mean.toFixed(3)} | ${p95.toFixed(3)} | ${slow2.length}${slow2.length ? ` (${slow2.slice(0, 3).map(d => `${d.src}#${d.i} ${d.ms.beta}->${d.ms[a]}`).join(', ')})` : ''} | ${slow3.length} | ${top ? `${top.src}#${top.i} ${top.ms[a]} (beta ${top.ms.beta})` : '-'} |`);
  }
  console.log('\nChanged decisions by source:');
  for (const a of arms) {
    const by = {};
    for (const d of ds.filter(x => x.changed.includes(a))) add(by, d.src.replace('human:', '').replace('.json', ''));
    console.log(`- ${a}: ${Object.entries(by).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
  }
  // Continuations: R1 = the first Runner turn ended, C2 = the Corp turn ended after it
  const at = (c, who, k) => {
    const m = c.marks.filter(x => x.ended === who)[k];
    return m ?? c.end;
  };
  console.log('\n### Continuations (the arm\'s Corp against beta\'s Runner, from each changed decision; points gained since the decision)\n');
  console.log('| arm | changed with a continuation | Runner scores by its next turn: beta / arm | Runner points then: beta / arm | Corp scores by its turn after: beta / arm | Corp points then: beta / arm | game won by the Runner within two turns: beta / arm |');
  console.log('|---|---|---|---|---|---|---|');
  for (const a of arms) {
    const cs = ds.filter(d => d.cont?.[a]);
    if (!cs.length) continue;
    const runnerBy = (c, s) => at(c, 'runner', 0).runner - s.runner;
    const corpBy = (c, s) => at(c, 'corp', c.marks[0]?.ended === 'corp' ? 1 : 0).corp - s.corp;
    const sum = f => cs.reduce((n, d) => n + f(d), 0);
    const cnt = f => cs.filter(f).length;
    console.log(`| ${a} | ${cs.length} | ${cnt(d => runnerBy(d.cont.beta, d.cont.beta.start) > 0)} / ${cnt(d => runnerBy(d.cont[a], d.cont[a].start) > 0)} | ${sum(d => runnerBy(d.cont.beta, d.cont.beta.start))} / ${sum(d => runnerBy(d.cont[a], d.cont[a].start))} | ${cnt(d => corpBy(d.cont.beta, d.cont.beta.start) > 0)} / ${cnt(d => corpBy(d.cont[a], d.cont[a].start) > 0)} | ${sum(d => corpBy(d.cont.beta, d.cont.beta.start))} / ${sum(d => corpBy(d.cont[a], d.cont[a].start))} | ${cnt(d => d.cont.beta.winner === 'runner')} / ${cnt(d => d.cont[a].winner === 'runner')} |`);
  }
}
