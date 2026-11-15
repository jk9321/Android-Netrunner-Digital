// Stage C7: sums scripts/stage-c/leave-one-out.ts output (JSON lines in any number of files).
//   node scripts/stage-c/leave-one-out-sum.mjs out/*.txt
import { readFileSync } from 'node:fs';

const rows = [];
for (const f of process.argv.slice(2)) for (const line of readFileSync(f, 'utf8').split('\n')) if (line.startsWith('{"src"')) rows.push(JSON.parse(line));
const arms = {};
for (const r of rows) {
  for (const a of r.fired) (arms[a] ??= { fired: 0, changed: 0, human: 0, examples: [] }).fired++;
  for (const [a, move] of Object.entries(r.changed)) {
    const t = arms[a];
    t.changed++;
    if (r.src.startsWith('human:')) t.human++;
    if (t.examples.length < 5) t.examples.push(`${r.src} T${r.T} c${r.clicks} $${r.credits}: ${r.base} -> ${move}`);
  }
}
const oldFires = {};
for (const r of rows) for (const k of r.old ?? []) oldFires[k] = (oldFires[k] ?? 0) + 1;
console.log(`old rules' own fire tests on the same decisions: ${JSON.stringify(oldFires)}`);
console.log(`${rows.length} decisions (${rows.filter(r => r.src.startsWith('human:')).length} human)`);
console.log('| rule | decisions it applied | decisions it changed | of them human |');
console.log('|---|---|---|---|');
for (const [a, t] of Object.entries(arms).sort((x, y) => y[1].changed - x[1].changed)) console.log(`| ${a} | ${t.fired} | ${t.changed} | ${t.human} |`);
for (const [a, t] of Object.entries(arms)) if (t.examples.length) console.log(`\n${a}:\n  ${t.examples.join('\n  ')}`);
