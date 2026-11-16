// ai-prompt-time: sums scripts/prompt-time-cases.ts output (every shard's stdout).
//   node scripts/prompt-time-sum.mjs head/*.txt [-- base/*.txt]
// Per card and route: prompts, answers equal to beta's route (rebuilt), and the time of each; the cases that differ; Spin
// Doctor uses (with and without an agenda in Archives, by turn); Corp decision time per source. With a base after `--`,
// the Spin Doctor and time lines are shown for both.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const cut = args.indexOf('--');
const read = files => files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const head = read(cut < 0 ? args : args.slice(0, cut));
const base = cut < 0 ? null : read(args.slice(cut + 1));

const cases = head.filter(r => r.kind === 'case');
const by = {};
for (const c of cases) {
  const k = `${c.code}:${c.step} ${c.route} (beta: ${c.oldRoute})`;
  const r = (by[k] ??= { n: 0, same: 0, ms: [], oldMs: [], differ: [] });
  r.n++;
  if (c.same) r.same++;
  else r.differ.push(c);
  r.ms.push(c.ms);
  r.oldMs.push(c.oldMs);
}
console.log('## Prompts on a changed route (head played vs beta route rebuilt)');
for (const [k, r] of Object.entries(by)) {
  const mean = xs => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  console.log(`${k}: ${r.n} prompts, ${r.same} same answer, ${r.n - r.same} differ; decision ms mean ${mean(r.ms)} max ${Math.max(...r.ms)}; beta route alone ms mean ${mean(r.oldMs)} max ${Math.max(...r.oldMs)}`);
  for (const c of r.differ) console.log(`  ${c.src} #${c.i} T${c.T} n${c.n}: head [${c.played.join(', ')}] beta [${c.old.join(', ')}]`);
}
console.log('\n## Family prompts: candidates by keep (agendas marked), chosen');
for (const c of cases.filter(c => c.route === 'family')) {
  const list = [...c.candidates].sort((a, b) => (b.type === 'agenda') - (a.type === 'agenda') || b.points - a.points || b.keep - a.keep);
  console.log(`${c.src} #${c.i} T${c.T} ${c.code} max ${c.max}: chosen [${c.played.join(', ')}] beta [${c.old.join(', ')}]\n    ${list.map(x => `${x.title}${x.type === 'agenda' ? ` (agenda ${x.points})` : ` (${x.type})`} ${x.keep}`).join('; ')}`);
}
const fires = rows => {
  const f = rows.filter(r => r.kind === 'fire');
  return `${f.length} uses (${f.filter(r => r.archivesAgendas > 0).length} with an agenda in Archives, ${f.filter(r => r.archivesAgendas === 0).length} without); turns ${f.map(r => `${r.src.replace(/^deal:|^human:/, '')}T${r.T}/${r.archives}${r.archivesAgendas ? 'A' : ''}`).join(' ')}`;
};
console.log(`\n## Spin Doctor ability\nhead: ${fires(head)}`);
if (base) console.log(`base: ${fires(base)}`);
const time = rows => {
  const d = rows.filter(r => r.kind === 'deal');
  const ms = d.reduce((a, r) => a + r.ms, 0);
  return `${d.length} sources, ${d.reduce((a, r) => a + r.decisions, 0)} Corp decisions, ${Math.round(ms / 1000)} s`;
};
console.log(`\n## Corp decision time\nhead: ${time(head)}`);
if (base) {
  console.log(`base: ${time(base)}`);
  const bm = new Map(base.filter(r => r.kind === 'deal').map(r => [r.src, r]));
  for (const r of head.filter(r => r.kind === 'deal')) {
    const b = bm.get(r.src);
    if (b && Math.abs(b.ms - r.ms) > 30000) console.log(`  ${r.src}: base ${Math.round(b.ms / 1000)} s, head ${Math.round(r.ms / 1000)} s`);
  }
}
