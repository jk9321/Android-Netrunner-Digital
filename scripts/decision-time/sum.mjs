// ai-decision-time: sums scripts/decision-time/measure.ts MODE=deals output.   node scripts/decision-time/sum.mjs deals-*.tsv
import { readFileSync } from 'node:fs';
const rows = [];
for (const f of process.argv.slice(2))
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const [src, i, kind, turn, ms, s, action] = line.split('\t');
    rows.push({ src, i, kind, turn, ms: Number(ms), s: JSON.parse(s), action });
  }
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');
const sum = (rs, k) => rs.reduce((n, r) => n + r.s[k], 0);
const report = (name, rs) => {
  const P = sum(rs, 'prices'), R = sum(rs, 'priceRig'), M = sum(rs, 'priceMs'), D = rs.reduce((n, r) => n + r.ms, 0);
  console.log(`${name}: ${rs.length} decisions, ${(D / 1000).toFixed(1)} s; tag-clock prices ${P} (${pct(M, D)} of decision time), inside holdRunnerTurn ${sum(rs, 'inHold')} (${pct(sum(rs, 'inHold'), P)})`);
  console.log(`  same-input repeats inside holdRunnerTurn: ${sum(rs, 'holdRepeat')} = ${pct(sum(rs, 'holdRepeat'), P)} of prices, ${pct(sum(rs, 'holdRepeatRig'), R)} of their rig values, ${pct(sum(rs, 'holdRepeatMs'), M)} of their time (${pct(sum(rs, 'holdRepeatMs'), D)} of decision time); unsafe ${sum(rs, 'unsafe')}`);
  console.log(`  upper bound (same whole board anywhere in the decision): ${sum(rs, 'contentRepeat')} = ${pct(sum(rs, 'contentRepeat'), P)} of prices, ${pct(sum(rs, 'contentRepeatRig'), R)} of rig values, ${pct(sum(rs, 'contentRepeatMs'), D)} of decision time`);
};
report('all Corp decisions', rows);
const slow = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 20);
report('20 slowest Corp decisions', slow);
for (const r of slow) console.log(`  ${r.src} #${r.i} ${r.kind} T${r.turn} ${r.ms.toFixed(0)} ms: prices ${r.s.prices}, hold ${r.s.inHold}, hold repeats ${r.s.holdRepeat} (${pct(r.s.holdRepeat, r.s.prices)}), whole-board repeats ${r.s.contentRepeat} (${pct(r.s.contentRepeat, r.s.prices)}), rig ${r.s.rig}`);
const planned = sum(rows, 'planned');
const by = {};
for (const r of rows) for (const [k, v] of Object.entries(r.s.overruledBy)) by[k] = (by[k] ?? 0) + v;
console.log(`look-ahead ran on ${planned} Corp decisions; money step fired ${sum(rows, 'money')} (action = planner's pick ${sum(rows, 'moneySame')}); tagFirst fired ${sum(rows, 'tagFirst')} (= planner's pick ${sum(rows, 'tagFirstSame')}); look-ahead overruled ${sum(rows, 'overruled')} ${JSON.stringify(by)}`);
