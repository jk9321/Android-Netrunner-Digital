// ai-tag-loss-time: sums measure.ts bvalues / btrace output. For each resource, how often removing it moved another
// rig card's worth (today's copy difference less its own term, past 1e-9), by how much, and through which card's term.
//   node scripts/tag-loss-time/bycard-sum.mjs out/*.txt
import { readFileSync } from 'node:fs';

const rows = [];
for (const f of process.argv.slice(2))
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const r = JSON.parse(line);
      if (r.bycard) rows.push(r);
    } catch {
      /* cut line */
    }
  }
const fx = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const out = [];
const p = s => out.push(s);
for (const arm of [...new Set(rows.flatMap(r => Object.keys(r.bycard)))].filter(a => a !== 'base')) {
  const rs = rows.filter(r => r.bycard[arm]?.values);
  const v = k => rs.reduce((n, r) => n + r.bycard[arm].values[k], 0);
  p(`### Arm ${arm}: ${rs.length} decisions (${rs.filter(r => r.side === 'corp').length} Corp, ${rs.filter(r => r.side === 'runner').length} Runner)`);
  p(`Clocks compared ${v('n')}; per-turn loss differs past 1e-9 in ${v('turnBig')} (mean diff of all differing ${fx(v('turnSum') / Math.max(1, v('turnDiff')), 4)}, mean abs ${fx(v('turnAbs') / Math.max(1, v('turnDiff')), 4)}); tagsWorth differs past 1e-9 in ${v('worthBig')} (mean ${fx(v('worthSum') / Math.max(1, v('worthDiff')), 4)}, mean abs ${fx(v('worthAbs') / Math.max(1, v('worthDiff')), 4)}); non-finite ${v('nonFinite')}; decisions with a difference past 1e-9: ${rs.filter(r => r.bycard[arm].values.turnBig || r.bycard[arm].values.worthBig).length}.`);
  let big = null;
  for (const r of rs) {
    const l = r.bycard[arm].values.largest;
    if (l && (!big || l.d > big.l.d)) big = { r, l };
  }
  if (big) p(`Largest: ${fx(big.l.d, 4)} at ${big.r.src}#${big.r.i} T${big.r.T} (per turn ${fx(big.l.armTurn, 3)} B vs ${fx(big.l.todayTurn, 3)} today; worth ${fx(big.l.armWorth, 3)} vs ${fx(big.l.todayWorth, 3)}); terms B ${JSON.stringify(big.l.armTerms)} vs today ${JSON.stringify(big.l.todayTerms)}`);
  // by resource card
  const cards = {};
  for (const r of rs)
    for (const [card, c] of Object.entries(r.bycard[arm].cards ?? {})) {
      const a = (cards[card] ??= { n: 0, moved: 0, sum: 0, abs: 0, max: 0, own: 0, decisions: 0, parts: {} });
      a.n += c.n;
      a.moved += c.moved;
      a.sum += c.sum;
      a.abs += c.abs;
      a.own += c.ownSum;
      if (c.moved) a.decisions++;
      if (Math.abs(c.max) > Math.abs(a.max)) a.max = c.max;
      for (const [k, q] of Object.entries(c.parts)) {
        const b = (a.parts[k] ??= { n: 0, sum: 0, abs: 0 });
        b.n += q.n;
        b.sum += q.sum;
        b.abs += q.abs;
      }
    }
  p('\n| resource removed | copies priced | cross term past 1e-9 | in decisions | mean cross (today − own) | mean abs | largest | mean own term | through (card term: times, mean) |');
  p('|---|---|---|---|---|---|---|---|---|');
  for (const [card, a] of Object.entries(cards).sort((x, y) => y[1].abs - x[1].abs)) {
    const parts = Object.entries(a.parts).sort((x, y) => y[1].abs - x[1].abs).slice(0, 4).map(([k, q]) => `${k}: ${q.n}, ${fx(q.sum / q.n)}`).join('; ');
    p(`| ${card} | ${a.n} | ${a.moved} (${fx((100 * a.moved) / Math.max(1, a.n), 1)}%) | ${a.decisions} | ${fx(a.sum / Math.max(1, a.moved))} | ${fx(a.abs / Math.max(1, a.moved))} | ${fx(a.max)} | ${fx(a.own / Math.max(1, a.n))} | ${parts} |`);
  }
  // btrace: the listed decisions
  const traced = rs.filter(r => r.bycard.base);
  if (traced.length) {
    p('\n#### Changed picks, traced');
    for (const r of traced) {
      const b = r.bycard[arm];
      const top = Object.entries(b.cards ?? {}).filter(([, c]) => c.moved).sort((x, y) => y[1].abs - x[1].abs).slice(0, 3).map(([card, c]) => `${card} ${c.moved}/${c.n} copies, mean cross ${fx(c.sum / c.moved)} via ${Object.entries(c.parts).sort((x, y) => y[1].abs - x[1].abs).slice(0, 2).map(([k, q]) => `${k} ${fx(q.sum / q.n)}`).join(', ')}`).join(' | ');
      const dir = b.values.worthDiff ? (b.values.worthSum > 0 ? 'B prices tags HIGHER' : 'B prices tags LOWER') : 'no tag worth differs';
      p(`- ${r.src}#${r.i} ${r.side} T${r.T}: base ${r.bycard.base.a} → B ${b.a}. ${dir} (worth differs in ${b.values.worthBig} of ${b.values.n} clocks, mean ${fx(b.values.worthSum / Math.max(1, b.values.worthDiff), 3)}). Cross terms: ${top || 'none past 1e-9'}`);
    }
  }
}
console.log(out.join('\n'));
