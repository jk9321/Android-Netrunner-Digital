// Sums hold-inputs-answers.ts output (bundle H, "Judged by", the recorded answers):
//   node scripts/review-fixes/hold-inputs-answers-sum.mjs <files or dirs...>
// Prints: sources and distinct questions by reader and horizon (the mid-run 'runnerTurn' questions apart); every changed
// answer by the commit where it first appears and its oracle label (false holds fixed, false does not hold fixed, false
// holds made = STOP, false does not hold made = list with its board, not decidable); the made ones in full; errors.
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
const srcs = lines.filter(l => l.kind === 'src');
const qs = lines.filter(l => l.kind === 'q');
const errs = lines.filter(l => l.kind === 'error');

const deals = srcs.filter(s => s.src.startsWith('deal:'));
const human = srcs.filter(s => s.src.startsWith('human:'));
console.log(`sources ${srcs.length} (deals ${deals.length}, human files ${human.length}); files read ${files.length}`);
const sum = xs => xs.reduce((a, b) => a + b, 0);
console.log(`distinct questions ${sum(srcs.map(s => s.distinct))} (over MAXQ, not asked: ${sum(srcs.map(s => s.over))}); asked of every tree ${sum(srcs.map(s => s.allAsked))}; changed ${sum(srcs.map(s => s.changed))}`);
const counts = {};
for (const s of srcs) for (const [k, n] of Object.entries(s.counts)) counts[k] = (counts[k] ?? 0) + n;
console.log('\n| reader:horizon | distinct | of them mid-run |');
console.log('|---|---|---|');
for (const k of Object.keys(counts).filter(k => !k.endsWith(':midRun')).sort()) console.log(`| ${k} | ${counts[k]} | ${counts[`${k}:midRun`] ?? 0} |`);

const origin = l => (l.src.startsWith('human:') ? 'human' : 'self-play');
console.log('\n## Changed answers by the commit where each change appears, and its label');
const by = {};
for (const l of qs)
  for (const c of l.changes) {
    const k = `${c.commit} | ${l.reader}:${l.when}${l.midRun ? ' (mid-run)' : ''} | ${c.label}`;
    by[k] ??= { 'self-play': 0, human: 0 };
    by[k][origin(l)]++;
  }
console.log('| commit | reader:horizon | label | self-play | human |');
console.log('|---|---|---|---|---|');
for (const [k, n] of Object.entries(by).sort()) console.log(`| ${k} | ${n['self-play']} | ${n.human} |`);

console.log('\n## Base to head, by label');
const fin = {};
for (const l of qs) {
  const k = `${l.reader}:${l.when} | ${l.final}`;
  fin[k] = (fin[k] ?? 0) + 1;
}
for (const [k, n] of Object.entries(fin).sort()) console.log(`  ${k}: ${n}`);

const made = qs.filter(l => l.changes.some(c => c.label.endsWith(' made')) || / made$/.test(l.final));
console.log(`\n## Made wrong (false holds made = STOP; false does not hold made = for a ruling): ${made.length}`);
for (const l of made)
  console.log(
    JSON.stringify({ key: l.key, src: l.src, reader: l.reader, when: l.when, args: l.args, midRun: l.midRun, turn: l.turn, active: l.active, phase: l.phase, rig: l.rig, truth: l.truth, changes: l.changes.map(c => ({ commit: c.commit, label: c.label })) }),
  );
if (errs.length) {
  console.log(`\nerrors: ${errs.length}`);
  const e = {};
  for (const x of errs) e[x.error] = (e[x.error] ?? 0) + 1;
  for (const [m, n] of Object.entries(e).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${n} x ${m}`);
}
const ms = srcs.map(s => s.ms).sort((a, b) => a - b);
if (ms.length) console.log(`\nper source: median ${ms[ms.length >> 1]} ms, max ${ms.at(-1)} ms`);
