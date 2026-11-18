// Sums oracle-rescore.ts output: comparison 44200015527's dumped boards, each count's label before and after the
// oracle's fixes (row 56), by count (`walk`: the trash walk of ai-hold-trash 3e8f4ad; `beta`: beta da1c93e), with the
// boards whose truth moved and the Ansel 1.0 boards apart.
//   node scripts/stage-d/oracle-rescore-sum.mjs <files or dirs...>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = process.argv.slice(2).flatMap(p => (statSync(p).isDirectory() ? walk(p) : [p]));
function walk(d) {
  return readdirSync(d).flatMap(f => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.txt') ? [p] : [];
  });
}
const rows = files.flatMap(f => readFileSync(f, 'utf8').split('\n')).filter(l => l.startsWith('{')).map(l => JSON.parse(l));
console.log(`boards re-asked: ${rows.length} (flips ${rows.filter(r => r.flip).length}, non-flip disagreements ${rows.filter(r => !r.flip).length})\n`);

const tr = (r, k) => `${r.before[k]} -> ${r.after[k]}`;
for (const [name, k] of [['walk (ai-hold-trash 3e8f4ad)', 'label'], ['beta (da1c93e)', 'oldLabel']]) {
  for (const flip of [true, false]) {
    const set = rows.filter(r => !!r.flip === flip);
    const c = {};
    for (const r of set) c[tr(r, k)] = (c[tr(r, k)] ?? 0) + 1;
    console.log(`### ${name}, ${flip ? 'flips' : 'sampled non-flips'} (${set.length})`);
    for (const [t, n] of Object.entries(c).sort((a, b) => b[1] - a[1])) console.log(`- ${t}: ${n}`);
    console.log();
  }
}
const truth = {};
for (const r of rows) {
  const t = `${r.before.truth} -> ${r.after.truth}`;
  truth[t] = (truth[t] ?? 0) + 1;
}
console.log('### the oracle\'s truth, before -> after (true: holds, null: unknown)');
for (const [t, n] of Object.entries(truth).sort((a, b) => b[1] - a[1])) console.log(`- ${t}: ${n}`);
const moved = rows.filter(r => r.before.truth !== r.after.truth && r.after.truth !== null && r.before.truth !== null);
const pos = {};
for (const r of moved) {
  const p = `${r.src} ${r.server} T${r.turn} [${r.ice.join(', ')}]${r.ansel ? ' (Ansel)' : ''}: ${r.before.truth} -> ${r.after.truth}`;
  pos[p] = (pos[p] ?? 0) + 1;
}
console.log(`\n### decided truths that moved, by position (${moved.length})`);
for (const [p, n] of Object.entries(pos).sort((a, b) => b[1] - a[1])) console.log(`- ${n} ${p}`);
const ansel = rows.filter(r => r.ansel);
const ac = {};
for (const r of ansel) ac[`walk ${tr(r, 'label')} | beta ${tr(r, 'oldLabel')}`] = (ac[`walk ${tr(r, 'label')} | beta ${tr(r, 'oldLabel')}`] ?? 0) + 1;
console.log(`\n### boards with Ansel 1.0 on the server (${ansel.length})`);
for (const [t, n] of Object.entries(ac).sort((a, b) => b[1] - a[1])) console.log(`- ${t}: ${n}`);
console.log(`\nwork: median ${rows.map(r => r.work).sort((a, b) => a - b)[rows.length >> 1]}, unknown after ${rows.filter(r => r.after.truth === null).length}, skipped ${rows.filter(r => r.after.skipped).length}`);
