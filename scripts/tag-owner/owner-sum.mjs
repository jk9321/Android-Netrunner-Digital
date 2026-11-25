// F108 build: sums scripts/tag-owner/owner-lockstep.ts output (every shard's stdout, JSON lines).
//   node scripts/tag-owner/owner-sum.mjs <dir with the shards' .txt files>
// lockstep: per leg and pool, deals, deals that STOP (leg or control differs from ownerOnce5) with the first, errors;
//   base's first difference against the leg (deals, by side:kind, decision index median); time by side:kind, leg and
//   base against control.
// report: per pool, decisions, the share where vs differs from ctl by side:kind (and tagged), the ask's own noise
//   (ctl against the playing agent), the value-changing fires by class; with VS=ownerOnce every difference listed by kind,
//   tags and B-1001.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const files = [];
const walk = d => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.txt')) files.push(p);
  }
};
walk(dir);
const rows = [];
for (const f of files)
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* a cut line */
    }
  }
const inc = (t, k, n = 1) => (t[k] = (t[k] ?? 0) + n);
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(2)}%` : '-');
const errors = rows.filter(r => r.kind === 'error');
const deals = rows.filter(r => r.kind === 'deal');
if (deals.length) {
  const by = {};
  for (const d of deals) (by[`${d.leg} ${d.pool}`] ??= []).push(d);
  console.log('## lockstep');
  console.log('| leg | pool | deals | stop | base differs | base same to end | decisions |');
  console.log('|---|---|--:|--:|--:|--:|--:|');
  for (const [k, ds] of Object.entries(by).sort()) {
    const [leg, pool] = k.split(' ');
    console.log(`| ${leg} | ${pool} | ${ds.length} | ${ds.filter(d => d.stop).length} | ${ds.filter(d => d.baseDiff).length} | ${ds.filter(d => d.baseSameToEnd).length} | ${ds.reduce((n, d) => n + d.decisions, 0)} |`);
  }
  for (const d of deals.filter(d => d.stop).slice(0, 40)) console.log(`STOP ${d.leg} ${d.pool}:${d.seed} decision ${d.stop.decision} T${d.stop.T} ${d.stop.side}:${d.stop.kind} tags ${d.stop.tags} leg ${d.stop.leg.act.slice(0, 90)} | ownerOnce5 ${d.stop.ownerOnce5.act.slice(0, 90)} | control same as ownerOnce5: ${d.stop.control.act === d.stop.ownerOnce5.act && d.stop.control.inner === d.stop.ownerOnce5.inner}`);
  // base's first difference (branch leg only)
  const bd = deals.filter(d => d.leg === 'branch' && d.baseDiff);
  if (bd.length) {
    const where = {};
    for (const d of bd) inc(where, `${d.pool} ${d.baseDiff.side}:${d.baseDiff.kind}${d.baseDiff.tags > 0 ? ' tagged' : ''}`);
    const share = bd.map(d => d.baseDiff.decision / Math.max(1, d.decisions)).sort((a, b) => a - b);
    console.log(`\nbase's first difference (branch leg): ${bd.length} deals; where: ${JSON.stringify(where)}; at decision share median ${share[Math.floor(share.length / 2)].toFixed(3)}; T median ${bd.map(d => d.baseDiff.T).sort((a, b) => a - b)[Math.floor(bd.length / 2)]}`);
  }
  // time, branch leg: over the steps played alike
  for (const leg of [...new Set(deals.map(d => d.leg))]) {
    const ms = {};
    for (const d of deals.filter(d => d.leg === leg)) for (const [tree, t] of Object.entries(d.ms)) for (const [k, v] of Object.entries(t)) if (!k.startsWith('n ')) inc(ms, `${tree} ${k}`, v);
    const kinds = [...new Set(Object.keys(ms).map(k => k.split(' ')[1]))].sort();
    console.log(`\ntime, leg ${leg} (s): ` + kinds.map(k => `${k} leg ${((ms[`leg ${k}`] ?? 0) / 1000).toFixed(1)} / control ${((ms[`control ${k}`] ?? 0) / 1000).toFixed(1)} / base ${((ms[`base ${k}`] ?? 0) / 1000).toFixed(1)} / ownerOnce5 ${((ms[`ownerOnce5 ${k}`] ?? 0) / 1000).toFixed(1)} (leg/control ${((ms[`leg ${k}`] ?? 0) / (ms[`control ${k}`] || 1)).toFixed(3)})`).join('; '));
    const tot = t => Object.entries(ms).filter(([k]) => k.startsWith(`${t} `)).reduce((n, [, v]) => n + v, 0);
    console.log(`  all: leg/control ${(tot('leg') / tot('control')).toFixed(3)}, ownerOnce5/control ${(tot('ownerOnce5') / tot('control')).toFixed(3)}, base/control ${(tot('base') / tot('control')).toFixed(3)}`);
  }
}
const reps = rows.filter(r => r.kind === 'report');
if (reps.length) {
  console.log('\n## report');
  for (const pool of [...new Set(reps.map(r => r.pool))]) {
    const c = {};
    let n = 0;
    for (const r of reps.filter(r => r.pool === pool)) {
      n += r.decisions;
      for (const [k, v] of Object.entries(r.counts)) inc(c, k, v);
    }
    const kinds = [...new Set(Object.keys(c).filter(k => k.startsWith('n ') && !k.endsWith('tagged')).map(k => k.slice(2)))].sort();
    console.log(`\n${pool}: ${reps.filter(r => r.pool === pool).length} deals, ${n} decisions; differ ${c['differ'] ?? Object.entries(c).filter(([k]) => /^differ [^ ]+$/.test(k)).reduce((m, [, v]) => m + v, 0)} (${pct(Object.entries(c).filter(([k]) => /^differ [^ ]+$/.test(k)).reduce((m, [, v]) => m + v, 0), n)})`);
    console.log('| side:kind | decisions | tagged | differ | differ tagged | ctl noise | any fire | perTurn | payoutWait | evaluate | b1001 | fire and differ |');
    console.log('|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|');
    for (const k of kinds) {
      const g = x => c[x] ?? 0;
      console.log(`| ${k} | ${g(`n ${k}`)} | ${g(`n ${k} tagged`)} | ${g(`differ ${k}`)} (${pct(g(`differ ${k}`), g(`n ${k}`))}) | ${g(`differ ${k} tagged`)} | ${g(`ctlNoise ${k}`)} | ${g(`fire ${k}`)} (${pct(g(`fire ${k}`), g(`n ${k}`))}) | ${g(`fire perTurn ${k}`)} | ${g(`fire payoutWait ${k}`)} | ${g(`fire evaluate ${k}`)} | ${g(`fire b1001 ${k}`)} | ${g(`fireDiffer ${k}`)} |`);
    }
  }
  const diffs = rows.filter(r => r.kind === 'diff');
  if (diffs.length) {
    const t = {};
    for (const d of diffs) inc(t, `${d.pool} ${d.k} tags ${d.tags > 0 ? '>0' : '0'} b1001 ${d.b1001.length ? d.b1001.join('+') : 'none'}`);
    console.log('\ndifferences (vs against ctl), by pool, side:kind, tags, B-1001:');
    for (const [k, v] of Object.entries(t).sort()) console.log(`  ${k}: ${v}`);
    for (const d of diffs.slice(0, 30)) console.log(`  ${d.pool}:${d.seed} T${d.T} ${d.k} tags ${d.tags} b1001 [${d.b1001}] vs ${d.vs.slice(0, 80)} | ctl ${d.ctl.slice(0, 80)}`);
  }
}
console.log(`\nerrors: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log(`  ${e.pool}:${e.seed} ${String(e.error).slice(0, 200)}`);
const s = rows.filter(r => r.kind === 's');
console.log(`shards reporting: ${s.length}`);
