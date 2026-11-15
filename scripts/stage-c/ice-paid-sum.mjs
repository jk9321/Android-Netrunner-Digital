// Sums scripts/stage-c/ice-paid.ts: node scripts/stage-c/ice-paid-sum.mjs <files...>
// Rows are split by source (batch: the g3 batch's deals; deal: the 56 local deals; human: the human games).
import { readFileSync } from 'node:fs';

const rows = [];
for (const f of process.argv.slice(2)) for (const l of readFileSync(f, 'utf8').split('\n')) if (l.startsWith('{"src"')) rows.push(JSON.parse(l));
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
const mean = xs => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '-');
const groups = { 'the g3 batch deals': r => r.src.startsWith('batch:'), 'recorded: local deals': r => r.src.startsWith('deal:'), 'recorded: human games': r => r.src.startsWith('human') };
for (const [name, test] of Object.entries(groups)) {
  const g = rows.filter(test);
  if (!g.length) continue;
  console.log(`\n## ${name}: ${g.length} Corp main-phase decisions at Corp turns 1 to 3`);
  for (const T of [1, 2, 3]) {
    const t = g.filter(r => r.T === T);
    const withIce = t.filter(r => r.ice.length);
    const ice = t.flatMap(r => r.ice);
    console.log(`\n### turn ${T}: ${t.length} decisions, ${withIce.length} with an ice candidate; credits mean ${mean(t.map(r => r.credits))}, keep mean ${mean(t.map(r => r.keep))}, keep > 0 at ${pct(t.filter(r => r.keep > 0).length, t.length)}`);
    console.log('| destination | ice candidates | pass icePaidAt | fail (behind) | of the fails: credits / keep / rez cost (means) |');
    console.log('|---|---|---|---|---|');
    for (const d of ['hq', 'rd', 'archives', 'remote', 'new']) {
      const x = ice.filter(i => i.dest === d);
      if (!x.length) continue;
      const fails = t.flatMap(r => r.ice.filter(i => i.dest === d && !i.paid).map(i => ({ r, i })));
      console.log(`| ${d} | ${x.length} | ${x.filter(i => i.paid).length} | ${x.filter(i => !i.paid).length} (${pct(x.filter(i => !i.paid).length, x.length)}) | ${mean(fails.map(f => f.r.credits))} / ${mean(fails.map(f => f.r.keep))} / ${mean(fails.map(f => f.i.cost))} |`);
    }
    const bb = t.filter(r => r.behindBareCentral);
    console.log(`- decisions with a behind (unpaid) ice for a bare HQ or R&D: ${bb.length}; the Corp then took line 7 (draw or credit) in ${bb.filter(r => r.line7).length} (${pct(bb.filter(r => r.line7).length, bb.length)}); installed ice in ${bb.filter(r => /^INSTALL_CARD/.test(r.chosen) && r.ice.some(i => r.chosen.startsWith('INSTALL_CARD ' + i.title))).length}`);
    const pb = t.filter(r => r.passedBareCentral);
    console.log(`- decisions with a paid ice for a bare HQ or R&D: ${pb.length}; the Corp then took line 7 in ${pb.filter(r => r.line7).length}, installed ice in ${pb.filter(r => r.ice.some(i => r.chosen.startsWith('INSTALL_CARD ' + i.title))).length}`);
  }
  console.log(`\nAll three turns: ${g.flatMap(r => r.ice).length} ice candidates, ${g.flatMap(r => r.ice).filter(i => !i.paid).length} fail icePaidAt; decisions with keep > 0: ${pct(g.filter(r => r.keep > 0).length, g.length)}`);
}
