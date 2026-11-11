// Sums scripts/placement-g0.ts output (one JSON line per deal): node scripts/placement-g0-sum.mjs file.jsonl
import { readFileSync } from 'node:fs';

const deals = readFileSync(process.argv[2], 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
const games = deals.length;
const per100 = n => ((n * 100) / games).toFixed(1);
const pct = (n, d) => (d ? `${Math.round((n * 100) / d)}%` : '-');
console.log(`${games} games`);
for (const kind of ['install', 'advance']) {
  const e = deals.flatMap(d => d.events).filter(x => x.kind === kind);
  const n = e.length;
  const c = f => e.filter(f).length;
  console.log(`\n${kind === 'install' ? 'B/C installs (agenda into a remote, no counted line for it)' : 'B advances (agenda advanced, no counted line)'}: ${n} (${per100(n)} per 100 games)`);
  console.log(`  target remote holds by count: ${c(x => x.target)} (${pct(c(x => x.target), n)})`);
  console.log(`  another open remote holds: ${c(x => x.anyRemote)} (${pct(c(x => x.anyRemote), n)})`);
  console.log(`  a counted line existed instead: scoreNow ${c(x => x.line === 'scoreNow')}, scoreInTwo ${c(x => x.line === 'scoreInTwo')}`);
  console.log(`  HQ holds by count: ${c(x => x.hq)} (${pct(c(x => x.hq), n)})`);
  console.log(`  safer place by count: HQ ${c(x => !x.target)} (${pct(c(x => !x.target), n)}; target payable, so stolen for certain if run), remote ${c(x => x.target && !x.hq)}, both hold ${c(x => x.target && x.hq)}`);
  const pay = e.filter(x => !x.target);
  const avg = (a, f) => (a.length ? (a.reduce((t, x) => t + f(x), 0) / a.length).toFixed(1) : '-');
  console.log(`  where HQ was the safer place: HQ held ${pct(pay.filter(x => x.hq).length, pay.length)}, cards in HQ ${avg(pay, x => x.hqSize + 1)} on average, other agendas there ${avg(pay, x => x.hqAgendas)}`);
  console.log(`  one ice from HQ makes a remote hold (G3): existing remote ${c(x => x.g3 === 'existing')}, new remote ${c(x => x.g3 === 'new')}, none ${c(x => x.g3 === 'none')}; of none: only with more credits ${c(x => x.g3 === 'none' && x.g3Money)}, no ice in HQ ${c(x => x.g3 === 'none' && x.hqIce === 0)}`);
  console.log(`  fate: stolen ${c(x => x.fate === 'stolen')} (from a remote ${c(x => x.stolenFrom === 'remote')}, HQ ${c(x => x.stolenFrom === 'hq')}), scored ${c(x => x.fate === 'scored')}, other ${c(x => x.fate === 'other')}`);
}
const hqTurns = deals.reduce((t, d) => t + d.hqTurns, 0);
const hqStolen = deals.reduce((t, d) => t + d.hqStolen2, 0);
console.log(`\nAgendas kept in HQ at a Corp turn start: ${hqTurns} agenda-turns (${per100(hqTurns)} per 100 games); stolen from HQ within the next 2 Runner turns: ${hqStolen} (${pct(hqStolen, hqTurns)})`);
