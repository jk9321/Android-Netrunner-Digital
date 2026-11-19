// Stage D found row 59 count: sums the shards of scripts/stage-d/prompt-chain.ts (one JSON line per record).
//   node scripts/stage-d/prompt-chain-sum.mjs <dir with the shards' .txt files> [--list]
// Tables: sources, A2 (the fallback's chains, by card and source kind, per game), B (each arm's changed decisions by
// class, the class of A1 apart, the pairs, the time against control top level and inside the planner), stops.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const LIST = process.argv.includes('--list');
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
const TREES = ['beta', 'control', 'chainRun', 'chainCorp', 'chainRunFb'];
const ARMS = ['chainRun', 'chainCorp', 'chainRunFb'];
const KINDS = ['self', 'humanRunner', 'humanCorp'];
// A1's mark: Corp prompts whose same-side follow-up step carries a cost of the Corp (prompt-chain-inventory.ts)
const COST = new Set(['30050:approach', '36062:ice']);
const by = (xs, f) => xs.reduce((m, x) => ((m[f(x)] ??= []).push(x), m), {});
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const se = xs => (xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean(xs)) ** 2, 0) / (xs.length - 1) / xs.length) : NaN);
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '-');
const f3 = x => (Number.isFinite(x) ? x.toFixed(3) : '-');
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};
const kindOfSrc = r => r.sk ?? (r.src?.startsWith('deal:') ? 'self' : '?');
const pkey = p => (p ? `${p.code ?? p.kind}:${p.step ?? ''}` : '-');

const g = rows.filter(r => r.kind === 'g');
const h = rows.filter(r => r.kind === 'h');
const d = rows.filter(r => r.kind === 'd');
const c = rows.filter(r => r.kind === 'c');
const games = { self: g.length, humanRunner: h.filter(x => x.sk === 'humanRunner').length, humanCorp: h.filter(x => x.sk === 'humanCorp').length };

console.log('## Sources');
console.log(`deals ${g.length}, matching the batch's record ${g.filter(x => x.matchesBatch).length}; human files ${h.length} (humanRunner ${games.humanRunner}, humanCorp ${games.humanCorp}), stopped ${h.filter(x => x.stopped).length}`);
for (const x of g.filter(x => !x.matchesBatch)) console.log(`  NO MATCH ${x.src}`);
for (const x of h.filter(x => x.stopped)) console.log(`  stopped ${x.src}: ${x.stopped}`);
console.log(`decisions ${d.length}: ${KINDS.map(k => `${k} ${d.filter(x => x.sk === k).length}`).join(', ')}; fresh beta = source's own move (self): ${d.filter(x => x.sk === 'self' && x.fresh).length} of ${d.filter(x => x.sk === 'self').length}`);
const errs = d.filter(x => x.errors);
console.log(`errors in asks: ${errs.length}${errs.length ? ` (${[...new Set(errs.flatMap(x => Object.entries(x.errors).map(([t, e]) => `${t}: ${e.slice(0, 60)}`)))].slice(0, 5).join(' | ')})` : ''}`);

console.log('\n## Stops');
const ctl = d.filter(x => x.controlDiffers);
console.log(`control differs from beta: ${ctl.length}${ctl.length ? ` (${ctl.slice(0, 8).map(x => `${x.src} #${x.i} ${x.c}`).join(', ')})` : ''}`);
for (const arm of ARMS) {
  const rp = d.filter(x => x.side === 'runner' && x.changed?.[arm]);
  console.log(`${arm}: Runner decisions changed ${rp.length} (prompts ${rp.filter(x => x.c === 'runnerPrompt').length}, main ${rp.filter(x => x.c === 'runnerMain').length}, off-turn ${rp.filter(x => x.c === 'runnerOff').length})`);
}

console.log('\n## A2: prompts answered by the fallback at the top level (beta tree), where an answer continues the same card\'s chain');
const fb = d.filter(x => x.fb);
for (const side of ['corp', 'runner']) {
  console.log(`\n### ${side} prompts`);
  console.log('| card:step | identity | kind | fallback prompts | an answer continues | one-step tie | tie that separates on the settled board | pick changes |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  const s = fb.filter(x => x.fb.side === side);
  const cards = by(s, x => `${x.fb.code}:${x.fb.step}`);
  const keys = Object.keys(cards).filter(k => cards[k].some(x => x.fb.cont)).sort((a, b) => cards[b].length - cards[a].length);
  for (const k of keys)
    for (const kind of KINDS) {
      const xs = cards[k].filter(x => x.sk === kind);
      if (!xs.length) continue;
      const card = xs.find(x => x.p?.card)?.p.card ?? '';
      console.log(`| ${k} ${card}${COST.has(k) ? ' (A1 cost)' : ''} | ${xs[0].fb.identity ? 'yes' : ''} | ${kind} | ${xs.length} | ${xs.filter(x => x.fb.cont).length} | ${xs.filter(x => x.fb.cont && x.fb.oneTie).length} | ${xs.filter(x => x.fb.separates).length} | ${xs.filter(x => x.fb.pickChanges).length} |`);
    }
  const other = s.filter(x => !keys.includes(`${x.fb.code}:${x.fb.step}`));
  console.log(`(fallback prompts with no continuing answer: ${KINDS.map(k => `${k} ${other.filter(x => x.sk === k).length}`).join(', ')})`);
  for (const kind of KINDS) {
    const n = games[kind] || 1;
    const ch = s.filter(x => x.sk === kind && x.fb.pickChanges);
    console.log(`${kind}: pick changes ${ch.length} (${f3(ch.length / n)} a game), of which A1 cost ${ch.filter(x => COST.has(`${x.fb.code}:${x.fb.step}`)).length}, in a run ${ch.filter(x => x.fb.run).length}`);
  }
}
const sub56 = fb.filter(x => x.sk === 'self' && x.fb.code === '30050' && x.fb.step === 'approach' && (Number(x.src.slice(5)) - 1001) % 40 === 0);
console.log(`\nAnoetic Void approach on the 56 deals of run 44233565160 (seeds 1001+40k): prompts ${sub56.length}, pick changes ${sub56.filter(x => x.fb.pickChanges).length} (${[...new Set(sub56.filter(x => x.fb.pickChanges).map(x => `${x.src.slice(5)} T${x.T}`))].join(', ')})`);
const anoAll = fb.filter(x => x.fb.code === '30050' && x.fb.step === 'approach');
console.log(`Anoetic Void approach, all: ${KINDS.map(k => `${k} ${anoAll.filter(x => x.sk === k).length} prompts / ${anoAll.filter(x => x.sk === k && x.fb.pickChanges).length} change`).join('; ')}; run term ties reaching the fallback (runLen > 1): ${anoAll.filter(x => x.fb.runLen > 1).length}`);

console.log('\n### A2 per game (self-play, pick changes by game)');
const pg = by(fb.filter(x => x.sk === 'self' && x.fb.pickChanges), x => x.src);
const hist = by(g, x => (pg[x.src] ?? []).length);
console.log(Object.keys(hist).sort((a, b) => a - b).map(k => `${k} changes: ${hist[k].length} games`).join('; '));
if (LIST) for (const [src, xs] of Object.entries(pg)) console.log(`  ${src}: ${xs.map(x => `T${x.T} ${x.fb.code}:${x.fb.step}`).join(', ')}`);

console.log('\n### A3 trace on the pick changes: the answers, the one-step and settled scores, the settled board');
const pcs = fb.filter(x => x.fb.pickChanges);
const listed = by(pcs, x => `${x.fb.code}:${x.fb.step}`);
for (const [k, xs] of Object.entries(listed)) {
  const offered = [...new Set(xs.map(x => x.fb.opts.map(o => o.a).join(' / ')))].slice(0, 3);
  const gap = xs.map(x => x.fb.opts[x.fb.pickSet].set - x.fb.opts[x.fb.pickOne].set);
  console.log(`- ${k} ${xs[0].p?.card ?? ''}: ${xs.length} changes; offered ${offered.join(' | ')}; one-step tie in ${xs.filter(x => x.fb.oneTie).length}; settled gain of the new pick over the old, mean ${f2(mean(gap))} (min ${f2(Math.min(...gap))}); the old pick's settled board: Corp credits -${f2(mean(xs.map(x => x.fb.opts[x.fb.pickOne].cr1 - x.fb.opts[x.fb.pickOne].board.cr)))}, HQ -${f2(mean(xs.map(x => x.fb.opts[x.fb.pickOne].hq1 - x.fb.opts[x.fb.pickOne].board.hq)))}`);
}

console.log('\n## B: decisions changed against the beta copy');
const cls = x => (x.c === 'corpPrompt' ? (COST.has(pkey(x.p)) ? 'corpPrompt (A1 cost)' : 'corpPrompt (other)') : x.c);
for (const arm of ARMS) {
  console.log(`\n### ${arm}`);
  console.log('| kind | games | corpPrompt (A1 cost) | a game | corpPrompt (other) | corpMain | corpRez | runner | all |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const kind of KINDS) {
    const xs = d.filter(x => x.sk === kind && x.changed?.[arm]);
    const n = games[kind];
    const ct = k => xs.filter(x => cls(x) === k).length;
    console.log(`| ${kind} | ${n} | ${ct('corpPrompt (A1 cost)')} | ${f3(ct('corpPrompt (A1 cost)') / n)} | ${ct('corpPrompt (other)')} | ${ct('corpMain')} | ${ct('corpRez')} | ${xs.filter(x => x.side === 'runner').length} | ${xs.length} (${f3(xs.length / n)} a game) |`);
  }
  const other = d.filter(x => x.changed?.[arm] && x.c === 'corpPrompt' && !COST.has(pkey(x.p)));
  if (other.length) console.log(`other Corp prompts changed: ${Object.entries(by(other, x => `${pkey(x.p)} ${x.p?.card ?? ''}${x.p?.run ? ' (run)' : ''}`)).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
  const main = d.filter(x => x.changed?.[arm] && x.c === 'corpMain');
  if (main.length) console.log(`corpMain changes, beta -> arm (top 12): ${Object.entries(by(main, x => `${x.beta} -> ${x.changed[arm]}`)).sort((a, b) => b[1].length - a[1].length).slice(0, 12).map(([k, v]) => `${k} (${v.length})`).join('; ')}`);
}

console.log('\n## B: paired continuations (arm answer a, beta answer b; to the end of the game by GameRunner, beta both sides)');
const pairRow = xs => {
  const ok = xs.filter(x => !x.ca.err && !x.cb.err);
  const dp = ok.map(x => x.ca.cs - x.cb.cs);
  const ds = ok.map(x => x.ca.rs - x.cb.rs);
  const dcr = ok.filter(x => x.ca.turnEnd && x.cb.turnEnd).map(x => x.ca.turnEnd.cr - x.cb.turnEnd.cr);
  const dhq = ok.filter(x => x.ca.turnEnd && x.cb.turnEnd).map(x => x.ca.turnEnd.hq - x.cb.turnEnd.hq);
  return `| ${ok.length} | ${ok.filter(x => x.ca.winner === 'corp').length} / ${ok.filter(x => x.cb.winner === 'corp').length} | ${f2(mean(dp))} ± ${f2(se(dp))} | ${f2(mean(ds))} ± ${f2(se(ds))} | ${f2(mean(dcr))} | ${f2(mean(dhq))} | ${xs.length - ok.length} |`;
};
for (const arm of ARMS) {
  console.log(`\n### ${arm}`);
  console.log('| subset | kind | pairs | Corp wins a / b | Corp points a-b ± SE | Runner points (stolen) a-b ± SE | Corp credits at turn end a-b | HQ at turn end a-b | errors |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const xs = c.filter(x => x.arm === arm);
  const subsets = { 'all decisions': () => true, 'Corp prompts': x => x.c === 'corpPrompt', 'A1 cost prompts': x => x.c === 'corpPrompt' && COST.has(pkey(x.p)), 'Corp main': x => x.c === 'corpMain' };
  for (const [name, f] of Object.entries(subsets)) {
    const ys = xs.filter(f);
    if (!ys.length) continue;
    console.log(`| ${name} | all | ${pairRow(ys).slice(2)}`);
    for (const kind of KINDS) if (ys.some(x => x.sk === kind)) console.log(`| ${name} | ${kind} | ${pairRow(ys.filter(x => x.sk === kind)).slice(2)}`);
  }
}

console.log('\n## B: every changed Corp prompt, with its run (a = arm, b = beta)');
const runTxt = r => (r ? `${r.breach ? 'breach' : 'no breach'}${r.stolen ? `, stole ${r.stolen}` : ''}${r.rootTrashed.length ? `, trashed ${r.rootTrashed.join('+')}` : ''}, Runner ${r.rcr >= 0 ? '+' : ''}${r.rcr} cr, Corp ${r.ccr >= 0 ? '+' : ''}${r.ccr} cr${r.hqGone.length ? `, HQ out: ${r.hqGone.join('+')}` : ''}` : 'no run');
const seen = new Set();
for (const x of c.filter(x => x.c === 'corpPrompt')) {
  const id = `${x.src}#${x.i}:${x.a}`;
  const arms = c.filter(y => `${y.src}#${y.i}:${y.a}` === id).map(y => y.arm);
  if (seen.has(id)) continue;
  seen.add(id);
  console.log(`- ${x.src} #${x.i} T${x.T} [${x.sk}] ${x.p?.card} ${x.p?.step} on ${x.p?.server} (root ${x.root ?? '-'}), arms ${arms.join('/')}: a ${x.a} -> ${runTxt(x.ca.run)}; turn end ${x.ca.turnEnd?.cr} cr / ${x.ca.turnEnd?.hq} HQ; ${x.ca.winner} ${x.ca.cs}-${x.ca.rs}. b ${x.b} -> ${runTxt(x.cb.run)}; turn end ${x.cb.turnEnd?.cr} cr / ${x.cb.turnEnd?.hq} HQ; ${x.cb.winner} ${x.cb.cs}-${x.cb.rs}`);
}
const capped = ARMS.map(arm => `${arm} ${d.filter(x => x.changed?.[arm]).length - c.filter(x => x.arm === arm).length}`);
console.log(`(changed decisions without a pair: past the cap or an action missing: ${capped.join(', ')})`);

console.log('\n## B: time against control (sum of the arm over sum of control; p95 ratio; decisions over 2x of control at 0.5 s or more)');
console.log('| arm | kind | class | decisions | mean ratio | p95 ratio | over 2x at >= 0.5 s | fallback calls a decision (control / arm) | chains followed a decision |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
const ix = t => TREES.indexOf(t);
const groups = { 'top level (prompts)': x => x.c === 'corpPrompt' || x.c === 'runnerPrompt', 'inside the planner (main)': x => x.c === 'corpMain' || x.c === 'runnerMain', 'Corp main': x => x.c === 'corpMain', 'Runner main': x => x.c === 'runnerMain', all: () => true };
for (const arm of ['beta', ...ARMS])
  for (const kind of KINDS)
    for (const [gname, f] of Object.entries(groups)) {
      const xs = d.filter(x => x.sk === kind && f(x));
      if (!xs.length) continue;
      const a = xs.map(x => x.ms[ix(arm)]);
      const k = xs.map(x => x.ms[ix('control')]);
      const ratio = a.reduce((s, v) => s + v, 0) / k.reduce((s, v) => s + v, 0);
      const p95 = pct(a, 0.95) / pct(k, 0.95);
      const over = xs.filter(x => x.ms[ix('control')] >= 500 && x.ms[ix(arm)] > 2 * x.ms[ix('control')]).length;
      const stop = ratio > 1.05 || p95 > 1.15 || over > 0 ? ' STOP' : '';
      console.log(`| ${arm} | ${kind} | ${gname} | ${xs.length} | ${f3(ratio)}${stop} | ${f3(p95)} | ${over} | ${f2(mean(xs.map(x => x.calls[ix('control')])))} / ${f2(mean(xs.map(x => x.calls[ix(arm)])))} | ${f2(mean(xs.map(x => x.fol[ix(arm)])))} |`);
    }
