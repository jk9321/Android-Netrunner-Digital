// Sums scripts/runner-reading-r0.ts output (one JSON line per deal): node scripts/runner-reading-r0-sum.mjs a.jsonl [b.jsonl ...]
import { readFileSync } from 'node:fs';

const deals = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const games = deals.length;
const pct = (n, d) => (d ? `${Math.round((n * 100) / d)}%` : '-');
const avg = (a, f) => (a.length ? (a.reduce((t, x) => t + f(x), 0) / a.length).toFixed(2) : '-');
const all = deals.flatMap(d => d.verdicts);
const holds = all.filter(v => v.holds);
const stolen = v => v.fate === 'stolenNext' || v.fate === 'stolenLater';
const row = (label, a) => `| ${label} | ${a.length} | ${a.filter(v => v.fate === 'scored').length} | ${a.filter(v => v.fate === 'stolenNext').length} | ${a.filter(v => v.fate === 'stolenLater').length} | ${a.filter(v => v.fate === 'other').length} | ${pct(a.filter(stolen).length, a.length)} |`;

console.log(`${games} deals, Normal v Normal, game 0 of each pairing; ${deals.reduce((t, d) => t + d.linesBegun, 0)} counted lines begun (scoreInTwo)`);
console.log(`Corp wins ${deals.filter(d => d.winner === 'corp').length} (${pct(deals.filter(d => d.winner === 'corp').length, games)})\n`);
console.log('## 1. Verdicts (one per agenda per Corp turn: its last install or advance into a remote that turn) and fate\n');
console.log('| verdict | n | scored | stolen next Runner turn | stolen later | other | stolen |');
console.log('|---|---|---|---|---|---|---|');
console.log(row('holds, on a counted line', holds.filter(v => v.line)));
console.log(row('holds, no counted line', holds.filter(v => !v.line)));
console.log(row('holds, all', holds));
console.log(row('does not hold', all.filter(v => !v.holds)));

const classed = holds.filter(v => v.cls);
const names = { a: '(a) breaker installed since the verdict', b: '(b) event played that turn', c: '(c) more Runner money than counted', d: '(d) Corp could not / did not rez', e: '(e) other (pricing)' };
console.log(`\n### How the Runner got in (latest holds verdict before each steal: ${classed.length})\n`);
console.log('| class | all | stolen next turn | on a line | sub-flags |');
console.log('|---|---|---|---|---|');
for (const k of Object.keys(names)) {
  const a = classed.filter(v => v.cls === k);
  let sub = '';
  if (k === 'd') sub = `could not (short at T) ${a.filter(v => !v.flags.holdsT && v.flags.holdsTRich).length}, did not ${a.filter(v => v.flags.holdsT || !v.flags.holdsTRich).length}`;
  if (k === 'c') sub = `budget up since V ${a.filter(v => v.flags.budgetUp).length}, run credits above T budget ${a.filter(v => v.flags.runRich).length}`;
  if (k === 'b') sub = `run event ${a.filter(v => v.flags.runEvent).length}`;
  if (k === 'e') sub = `held at T ${a.filter(v => v.flags.holdsT).length}, ice left unrezzed ${a.filter(v => v.flags.unrezzed).length}`;
  console.log(`| ${names[k]} | ${a.length} (${pct(a.length, classed.length)}) | ${a.filter(v => v.fate === 'stolenNext').length} | ${a.filter(v => v.line).length} | ${sub} |`);
}
const tally = (a, f) => {
  const m = new Map();
  for (const v of a) for (const t of f(v)) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m].sort((x, y) => y[1] - x[1]).map(([t, n]) => `${t} ${n}`).join(', ');
};
console.log('\n## 2. Class (a) and (b): the card, reach\'s odds at the verdict, seen\n');
for (const k of ['a', 'b']) {
  const a = classed.filter(v => v.cls === k);
  console.log(`- (${k}) ${a.length}: cards ${tally(a, v => [v.by ?? '?'])}`);
  console.log(`  seen in the grip at the verdict ${a.filter(v => v.bySeen).length}; certain (seen or empty stack) ${a.filter(v => v.needed?.some(x => x.certain)).length}`);
  const ps = a.filter(v => v.byP !== undefined);
  if (ps.length) console.log(`  reach's odds for that breaker type: mean ${avg(ps, v => v.byP)}; <0.25 ${ps.filter(v => v.byP < 0.25).length}, 0.25-0.5 ${ps.filter(v => v.byP >= 0.25 && v.byP < 0.5).length}, 0.5-0.75 ${ps.filter(v => v.byP >= 0.5 && v.byP < 0.75).length}, >=0.75 ${ps.filter(v => v.byP >= 0.75).length}`);
  console.log(`  pHold at the verdict: mean ${avg(a, v => v.pHold)}`);
}

console.log('\n## 3. Reach\'s chance the server holds (pHold, its cases priced by holdCost) by fate, holds verdicts\n');
const bins = [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 0.999], [0.999, 1.01]];
console.log('| fate | n | mean pHold | <0.25 | 0.25-0.5 | 0.5-0.75 | 0.75-0.999 | 1 |');
console.log('|---|---|---|---|---|---|---|---|');
for (const [label, f] of [['scored', v => v.fate === 'scored'], ['stolen next turn', v => v.fate === 'stolenNext'], ['stolen later', v => v.fate === 'stolenLater'], ['other', v => v.fate === 'other']]) {
  const a = holds.filter(f);
  console.log(`| ${label} | ${a.length} | ${avg(a, v => v.pHold)} | ${bins.map(([lo, hi]) => a.filter(v => v.pHold >= lo && v.pHold < hi).length).join(' | ')} |`);
}
console.log('\nStolen share (next turn / at all) by pHold bin:');
for (const [lo, hi] of bins) {
  const a = holds.filter(v => v.pHold >= lo && v.pHold < hi);
  console.log(`- pHold ${lo}-${hi > 1 ? 1 : hi}: ${a.length} verdicts, stolen next turn ${pct(a.filter(v => v.fate === 'stolenNext').length, a.length)}, stolen at all ${pct(a.filter(stolen).length, a.length)}, scored ${pct(a.filter(v => v.fate === 'scored').length, a.length)}`);
}

console.log('\n## 4. Holds verdicts that flip to "does not hold against the list", by Corp turn\n');
const flips = { '(i) seen': v => v.flipSeen, '(ii) any pool breaker': v => v.flipAny, '(ii+e) breaker or run event': v => v.flipAnyEvent, '(iii) pHold < 0.5': v => v.pHold < 0.5 };
console.log(`| turn | holds | ${Object.keys(flips).join(' | ')} |`);
console.log(`|---|---|${Object.keys(flips).map(() => '---').join('|')}|`);
const turnRows = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 99]];
for (const [lo, hi] of [...turnRows, [1, 6], [1, 99]]) {
  const a = holds.filter(v => v.turn >= lo && v.turn <= hi);
  const label = lo === hi ? `T${lo}` : hi === 99 && lo === 7 ? 'T7+' : hi === 6 ? 'T1-T6' : 'all';
  console.log(`| ${label} | ${a.length} | ${Object.values(flips).map(f => `${a.filter(f).length} (${pct(a.filter(f).length, a.length)})`).join(' | ')} |`);
}
console.log('\nFate of flipped vs kept holds verdicts (would refusing them lose more than it wins: stolen vs scored):\n');
console.log('| rule | flipped n | flipped scored | flipped stolen next | flipped stolen at all | kept n | kept scored | kept stolen next | kept stolen at all |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const [name, f] of Object.entries(flips)) {
  const y = holds.filter(f), n = holds.filter(v => !f(v));
  const s = a => `${a.length} | ${pct(a.filter(v => v.fate === 'scored').length, a.length)} | ${pct(a.filter(v => v.fate === 'stolenNext').length, a.length)} | ${pct(a.filter(stolen).length, a.length)}`;
  console.log(`| ${name} | ${s(y)} | ${s(n)} |`);
}
console.log(`\nBreakers that flip (ii): ${tally(holds.filter(v => v.flipAny), v => v.anyBy)}`);

console.log('\n## 5. Corp actions on a server whose root holds a card the Runner has accessed\n');
const acc = deals.flatMap(d => d.onAccessed);
console.log(`advances ${acc.filter(x => x.kind === 'advance').length} (${tally(acc.filter(x => x.kind === 'advance'), x => [x.type])}), ice installs ${acc.filter(x => x.kind === 'ice').length} (${tally(acc.filter(x => x.kind === 'ice'), x => [x.type])}); per 100 games ${((acc.length * 100) / games).toFixed(1)}`);
console.log(`titles: ${tally(acc, x => [x.title]).split(', ').slice(0, 12).join(', ')}`);
