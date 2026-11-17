// ai-breaker-guard-key phase 2: sums build-check.ts output (fire count and time, branch against beta).
//   node scripts/breaker-guard-key/build-check-sum.mjs out/*.txt
import { readFileSync } from 'node:fs';

const lines = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const fx = lines.filter(l => l.src.startsWith('fixture:'));
const all = lines.filter(l => !l.src.startsWith('fixture:'));
const games = rows => new Set(rows.map(l => l.src)).size;
const q = (xs, f) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(f * xs.length))];
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const f3 = x => x.toFixed(3);
console.log(`Decisions ${all.length} in ${games(all)} games (${games(all.filter(l => l.src.startsWith('deal:')))} local deals, ${games(all.filter(l => l.src.startsWith('human:')))} of Jeff's games), plus ${fx.length} saved decisions. Errors: ${lines.filter(l => l.errors).length}.`);
console.log('');
console.log('| side | decisions | changed | per game | mean ms beta / branch | ratio | p95 beta / branch | ratio | max beta / branch | deck prices beta / branch |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const side of ['corp', 'runner']) {
  const rows = all.filter(l => l.side === side);
  const b = rows.map(l => l.ms.beta);
  const k = rows.map(l => l.ms.branch);
  const ch = rows.filter(l => l.changed).length;
  const pr = arm => rows.reduce((n, l) => n + l.priced[arm], 0);
  console.log(`| ${side} | ${rows.length} | ${ch} | ${f3(ch / games(all))} | ${mean(b).toFixed(1)} / ${mean(k).toFixed(1)} | ${f3(mean(k) / mean(b))} | ${q(b, 0.95)} / ${q(k, 0.95)} | ${f3(q(k, 0.95) / q(b, 0.95))} | ${Math.max(...b)} / ${Math.max(...k)} | ${pr('beta')} / ${pr('branch')} |`);
}
console.log('');
for (const l of fx) {
  const b = q([l.ms.beta].flat(), 0.5);
  const k = q([l.ms.branch].flat(), 0.5);
  console.log(`- ${l.src} ${l.side} T${l.T}: median ${b} / ${k} ms (x${f3(k / b)}), reps ${JSON.stringify(l.ms)}, changed ${l.changed}`);
}
const changed = lines.filter(l => l.changed);
if (changed.length) {
  console.log('\nChanged picks:');
  for (const l of changed) console.log(`- ${l.src}#${l.i} ${l.side} ${l.kind} T${l.T}: ${JSON.stringify(l.picks)} again ${JSON.stringify(l.again)}`);
}
