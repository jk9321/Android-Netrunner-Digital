// V-C item 4 (install prompts) count: sums the shards of scripts/stage-vc/install-prompt.ts (one JSON line per record).
//   node scripts/stage-vc/install-prompt-sum.mjs <dir with the shards' .txt files> [--list <file for the changed-decision lists>]
// Tables in the brief's order: stops, (a) changed decisions and the main-phase trace, (b) pairs, (d) time, (e) steals,
// (f) ties, the half-keep term, other chains, Runner decisions. (c), the suite, is summed by install-prompt-suite-sum.mjs.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const li = process.argv.indexOf('--list');
const LIST = li > 0 ? process.argv[li + 1] : null;
const files = d => readdirSync(d).flatMap(f => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : f.endsWith('.txt') ? [join(d, f)] : []));
const rows = [];
for (const f of files(dir))
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* a cut line */
    }
  }
const TREES = ['beta', 'control', 'chainCorp', 'chainOut', 'chainInstall'];
const ARMS = ['chainCorp', 'chainOut', 'chainInstall'];
const KINDS = ['self', 'humanRunner', 'humanCorp'];
const ix = t => TREES.indexOf(t);
const by = (xs, f) => xs.reduce((m, x) => ((m[f(x)] ??= []).push(x), m), {});
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const se = xs => (xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean(xs)) ** 2, 0) / (xs.length - 1) / xs.length) : NaN);
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '-');
const f3 = x => (Number.isFinite(x) ? x.toFixed(3) : '-');
const ms = xs => `${f2(mean(xs))} ± ${f2(se(xs))}`;
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};
const pkey = p => (p ? `${p.card ?? p.kind}:${p.step ?? ''}` : '-');
const p = (...a) => console.log(...a);
const lines = [];
const L = s => lines.push(s);

const g = rows.filter(r => r.kind === 'g');
const h = rows.filter(r => r.kind === 'h');
const d = rows.filter(r => r.kind === 'd');
const c = rows.filter(r => r.kind === 'c');
const games = { self: g.length, humanRunner: h.filter(x => x.sk === 'humanRunner').length, humanCorp: h.filter(x => x.sk === 'humanCorp').length };
// An install prompt: a Corp prompt where some answer leaves the same card's install step pending (any tree's record)
const isInst = x => x.c === 'corpPrompt' && Object.values(x.fb ?? {}).some(f => f.inst);
const deckOf = Object.fromEntries(g.map(x => [x.src, x.decks.split(' v ')[0]]));

p('## Stops and sources');
p(`deals ${g.length}, matching the g1 record ${g.filter(x => x.matchesBatch).length}; human files ${h.length} (humanRunner ${games.humanRunner}, humanCorp ${games.humanCorp}), stopped ${h.filter(x => x.stopped).length}`);
for (const x of g.filter(x => !x.matchesBatch)) p(`  NO MATCH ${x.src}`);
for (const x of h.filter(x => x.stopped)) p(`  stopped ${x.src}: ${x.stopped}`);
p(`decisions ${d.length}: ${KINDS.map(k => `${k} ${d.filter(x => x.sk === k).length}`).join(', ')}; fresh beta = source's own move (self): ${d.filter(x => x.sk === 'self' && x.fresh).length} of ${d.filter(x => x.sk === 'self').length}`);
p(`control unlike beta: ${d.filter(x => x.controlDiffers).length}; ask errors: ${d.filter(x => x.errors).length}${d.filter(x => x.errors).length ? ` (${[...new Set(d.filter(x => x.errors).flatMap(x => Object.entries(x.errors).map(([a, e]) => `${a}: ${e.slice(0, 60)}`)))].slice(0, 5).join('; ')})` : ''}`);
p(`Runner decisions changed: ${ARMS.map(a => `${a} ${d.filter(x => x.side === 'runner' && x.changed?.[a]).length}`).join(', ')}`);

p('\n## (a) Changed Corp decisions against beta');
p('| arm | kind | games | install prompts | a game | other Corp prompts | Corp main IN | Corp main OUTSIDE | Corp rez | all Corp | a game |');
p('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const arm of ARMS)
  for (const kind of KINDS) {
    const xs = d.filter(x => x.sk === kind && x.side === 'corp' && x.changed?.[arm]);
    const n = games[kind];
    const inst = xs.filter(isInst).length;
    const oth = xs.filter(x => x.c === 'corpPrompt' && !isInst(x)).length;
    const mi = xs.filter(x => x.c === 'corpMain' && x.trace?.[arm]?.cls === 'IN').length;
    const mo = xs.filter(x => x.c === 'corpMain' && x.trace?.[arm]?.cls !== 'IN').length;
    p(`| ${arm} | ${kind} | ${n} | ${inst} | ${f3(inst / n)} | ${oth} | ${mi} | ${mo} | ${xs.filter(x => x.c === 'corpRez').length} | ${xs.length} | ${f3(xs.length / n)} |`);
  }
p('\nChanged Corp prompts by card and step (all kinds; i = install prompt):');
for (const arm of ARMS) {
  const xs = d.filter(x => x.c === 'corpPrompt' && x.changed?.[arm]);
  p(`- ${arm}: ${Object.entries(by(xs, x => `${pkey(x.p)}${isInst(x) ? ' (i)' : ''}${x.p?.run ? ' (run)' : ''}`)).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k} ${v.length}`).join(', ') || 'none'}`);
}
p('\nMain-phase trace (changed Corp main decisions; IN = the chosen or the replaced line holds a chain only the arm follows):');
for (const arm of ARMS) {
  const xs = d.filter(x => x.c === 'corpMain' && x.changed?.[arm]);
  const out = xs.filter(x => x.trace?.[arm]?.cls !== 'IN');
  const all = d.filter(x => x.side === 'corp' && x.changed?.[arm]).length;
  p(`- ${arm}: ${xs.length} changed, IN ${xs.length - out.length}, OUTSIDE ${out.length} (${f3(out.length / Math.max(1, all))} of its ${all} changed Corp decisions); no planner record ${xs.filter(x => !x.trace?.[arm]?.planner).length}`);
  for (const x of out) p(`    OUTSIDE ${x.src} #${x.i} T${x.T} [${x.sk}] ${x.beta} -> ${x.changed[arm]} (wide follows in the ask ${x.trace?.[arm]?.wide}, candidates with one ${x.trace?.[arm]?.anyWide ?? '-'})`);
}

p('\n## (b) Pairs (a = the arm\'s answer, b = beta\'s; then beta both sides to the end)');
const adj = r => (r.winner === 'corp' ? Math.max(r.cs, 7) : r.cs);
const cols = x => ({ win: (x.ca.winner === 'corp' ? 1 : 0) - (x.cb.winner === 'corp' ? 1 : 0), adj: adj(x.ca) - adj(x.cb), st2: x.ca.rs2 - x.cb.rs2, stEnd: x.ca.rs - x.cb.rs });
const pairRow = (name, xs) => {
  const ok = xs.filter(x => !x.ca.err && !x.cb.err);
  const v = ok.map(cols);
  return `| ${name} | ${ok.length} | ${ok.filter(x => x.ca.winner === 'corp').length} / ${ok.filter(x => x.cb.winner === 'corp').length} (${ms(v.map(y => y.win))}) | ${ms(v.map(y => y.adj))} | ${ms(v.map(y => y.st2))} | ${ms(v.map(y => y.stEnd))} | ${xs.length - ok.length} |`;
};
for (const arm of ARMS) {
  p(`\n### ${arm}`);
  p('| set | pairs | Corp wins a / b (a-b ± SE) | win-adjusted Corp points a-b ± SE | stolen within two turn pairs a-b ± SE | stolen at the end a-b ± SE | errors |');
  p('| --- | --- | --- | --- | --- | --- | --- |');
  const xs = c.filter(x => x.arm === arm);
  const sets = { 'all pairs': () => true, 'install picks alone': x => x.inst, 'other Corp prompts': x => x.c === 'corpPrompt' && !x.inst, 'Corp main': x => x.c === 'corpMain' };
  for (const [name, f] of Object.entries(sets)) {
    const ys = xs.filter(f);
    if (!ys.length) continue;
    p(pairRow(name, ys));
    for (const kind of KINDS) if (ys.some(x => x.sk === kind)) p(pairRow(`${name}, ${kind}`, ys.filter(x => x.sk === kind)));
  }
  p(`(changed Corp decisions without a pair, past the cap of 8 a source or an action missing: ${d.filter(x => x.side === 'corp' && x.changed?.[arm]).length - xs.length})`);
}

p('\n## (d) Time against control (self-play and human; mean = sum of the arm over sum of control; p95 of the per-decision ratio; over 2x)');
p('| tree | kind | decisions | mean | p95 per-decision ratio | over 2x (any) | over 2x at control >= 0.5 s | fallback calls a decision (control / tree) | chains followed a decision (wide) |');
p('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const arm of ['beta', ...ARMS])
  for (const kind of KINDS) {
    const xs = d.filter(x => x.sk === kind);
    if (!xs.length) continue;
    const a = xs.map(x => x.ms[ix(arm)]);
    const k = xs.map(x => x.ms[ix('control')]);
    const ratio = a.reduce((s, v) => s + v, 0) / k.reduce((s, v) => s + v, 0);
    const per = xs.filter(x => x.ms[ix('control')] > 0).map(x => x.ms[ix(arm)] / x.ms[ix('control')]);
    const over = xs.filter(x => x.ms[ix(arm)] > 2 * x.ms[ix('control')] && x.ms[ix('control')] >= 1).length;
    const over5 = xs.filter(x => x.ms[ix('control')] >= 500 && x.ms[ix(arm)] > 2 * x.ms[ix('control')]).length;
    p(`| ${arm} | ${kind} | ${xs.length} | ${f3(ratio)} | ${f3(pct(per, 0.95))} | ${over} | ${over5} | ${f2(mean(xs.map(x => x.calls[ix('control')])))} / ${f2(mean(xs.map(x => x.calls[ix(arm)])))} | ${f2(mean(xs.map(x => x.fol[ix(arm)])))} (${f2(mean(xs.map(x => x.wide?.[ix(arm)] ?? 0)))}) |`);
  }
p('(over 2x (any): decisions of 1 ms or more on control)');
p('\nBy deck (self-play, Corp deck; mean ratio of each tree to control):');
p(`| Corp deck | decisions | ${['beta', ...ARMS].join(' | ')} |`);
p(`| --- | --- | ${['beta', ...ARMS].map(() => '---').join(' | ')} |`);
const sd = d.filter(x => x.sk === 'self');
for (const [deck, xs] of Object.entries(by(sd, x => x.deck ?? deckOf[x.src] ?? '?')).sort()) {
  const k = xs.reduce((s, x) => s + x.ms[ix('control')], 0);
  p(`| ${deck} | ${xs.length} | ${['beta', ...ARMS].map(a => f3(xs.reduce((s, x) => s + x.ms[ix(a)], 0) / k)).join(' | ')} |`);
}

p('\n## (e) Steals: the arm\'s line lets more points be stolen than beta\'s');
for (const arm of ARMS) {
  const xs = c.filter(x => x.arm === arm && !x.ca.err && !x.cb.err);
  const run = xs.filter(x => (x.ca.run?.stolen ?? 0) > (x.cb.run?.stolen ?? 0));
  const two = xs.filter(x => x.ca.rs2 > x.cb.rs2);
  p(`- ${arm}: in the run under way ${run.length}; within two turn pairs ${two.length} (against ${xs.filter(x => x.ca.rs2 < x.cb.rs2).length} the other way)`);
  for (const x of two) p(`    ${x.src} #${x.i} T${x.T} [${x.sk}] ${x.c} ${x.p ? pkey(x.p) : ''}: a ${x.a} (stolen ${x.ca.rs2 - x.rs0} by T+2, run ${x.ca.run?.stolen ?? '-'}) | b ${x.b} (stolen ${x.cb.rs2 - x.rs0}, run ${x.cb.run?.stolen ?? '-'})${run.includes(x) ? ' RUN' : ''}`);
}

p('\n## (f) Report only');
const pr = d.filter(x => x.c === 'corpPrompt' && x.fb);
p('Install pick steps answered by the fallback at the top level (an answer leaves the install step pending): ties of the top two, and boards where the half-keep term\'s difference between the top two is larger than their gap');
p('| tree | kind | install pick steps | top two level | half-keep decides |');
p('| --- | --- | --- | --- | --- |');
for (const t of TREES)
  for (const kind of KINDS) {
    const xs = pr.filter(x => x.sk === kind && x.fb[t]?.inst);
    if (!xs.length) continue;
    p(`| ${t} | ${kind} | ${xs.length} | ${xs.filter(x => x.fb[t].tie).length} | ${xs.filter(x => x.fb[t].hkDecides).length} |`);
  }
p('\nChanged Corp prompts that are not install prompts (listed apart):');
for (const arm of ARMS) {
  const xs = d.filter(x => x.c === 'corpPrompt' && x.changed?.[arm] && !isInst(x));
  p(`- ${arm}: ${xs.length}${xs.length ? `: ${Object.entries(by(xs, x => pkey(x.p))).map(([k, v]) => `${k} ${v.length}`).join(', ')}` : ''}`);
}

if (LIST) {
  L('# Every changed decision (a = the arm, b = beta)\n');
  const runTxt = r => (r ? `${r.breach ? 'breach' : 'no breach'}${r.stolen ? `, stole ${r.stolen}` : ''}${r.rootTrashed.length ? `, trashed ${r.rootTrashed.join('+')}` : ''}${r.hqGone.length ? `, HQ out ${r.hqGone.join('+')}` : ''}` : 'no run');
  const pairs = new Map(c.map(x => [`${x.src}#${x.i}:${x.arm}`, x]));
  for (const arm of ARMS) {
    L(`\n## ${arm}\n`);
    for (const x of d.filter(y => y.changed?.[arm])) {
      const q = pairs.get(`${x.src}#${x.i}:${arm}`);
      const tr = x.trace?.[arm] ? ` trace ${x.trace[arm].cls}` : '';
      const pair = q ? ` | pair: a ${q.ca.winner ?? '-'} ${q.ca.cs}-${q.ca.rs} (T+2 ${q.ca.cs2}-${q.ca.rs2}; ${runTxt(q.ca.run)}) b ${q.cb.winner ?? '-'} ${q.cb.cs}-${q.cb.rs} (T+2 ${q.cb.cs2}-${q.cb.rs2}; ${runTxt(q.cb.run)})` : '';
      L(`- ${x.src} #${x.i} T${x.T} [${x.sk}${x.deck ? `, ${x.deck}` : ''}] ${x.c}${x.p ? ` ${pkey(x.p)}${isInst(x) ? ' (install)' : ''}${x.p.run ? ' (run)' : ''}` : ''}${x.root ? ` root ${x.root}` : ''}: b ${x.beta} -> a ${x.changed[arm]}${tr}${pair}`);
    }
  }
  writeFileSync(LIST, lines.join('\n') + '\n');
}
