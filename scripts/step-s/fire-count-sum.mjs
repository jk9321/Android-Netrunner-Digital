// Step S-1: sums scripts/step-s/fire-count.ts output (JSON lines in any number of files).
//   node scripts/step-s/fire-count-sum.mjs out/*.txt
import { readFileSync } from 'node:fs';

const rows = [];
for (const f of process.argv.slice(2)) for (const line of readFileSync(f, 'utf8').split('\n')) if (line.startsWith('{"src"')) rows.push(JSON.parse(line));
const games = new Set(rows.map(r => r.src)).size;
const human = rows.filter(r => r.src.startsWith('human:'));
const controls = rows.filter(r => r.control !== undefined && r.control !== null);
const noisy = controls.filter(r => r.control);
console.log(`${rows.length} decisions in ${games} games (${human.length} decisions in human games); control: ${noisy.length} of ${controls.length} decided twice differed`);
const errors = rows.filter(r => r.base.startsWith('ERROR') || Object.values(r.changed).some(m => m.startsWith('ERROR')));
if (errors.length) console.log(`ERRORS: ${errors.length} decisions (first: ${errors[0].src} #${errors[0].i})`);
const fams = {};
for (const r of rows) {
  for (const f of r.read) (fams[f] ??= { read: 0, changed: 0, human: 0, ms: 0, base: 0, max: 0, games: new Set(), examples: [] }).read++;
  for (const [f, ms] of Object.entries(r.ms)) {
    const t = fams[f];
    t.ms += ms;
    t.base += r.baseMs;
    t.max = Math.max(t.max, ms);
  }
  for (const [f, move] of Object.entries(r.changed)) {
    const t = fams[f];
    t.changed++;
    t.games.add(r.src);
    if (r.src.startsWith('human:')) t.human++;
    if (t.examples.length < 4) t.examples.push(`${r.src} #${r.i} T${r.T}: ${r.base} -> ${move}`);
  }
}
console.log('| family | decisions that read it | decisions changed | per game | of them human | time off / on | worst ms off |');
console.log('|---|---|---|---|---|---|---|');
for (const [f, t] of Object.entries(fams).sort((x, y) => y[1].changed - x[1].changed))
  console.log(`| ${f} | ${t.read} | ${t.changed} | ${(t.changed / games).toFixed(1)} | ${t.human} | ${t.base ? (t.ms / t.base).toFixed(2) : '-'}x | ${t.max} |`);
for (const [f, t] of Object.entries(fams)) if (t.examples.length) console.log(`\n${f}:\n  ${t.examples.join('\n  ')}`);
