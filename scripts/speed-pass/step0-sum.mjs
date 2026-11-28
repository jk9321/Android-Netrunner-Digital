// AI speed pass step 0 summary (brief netrunner-ai/speed-pass/brief.md rev 1 section 4): reads scripts/speed-pass/step0.ts
// JSONL (out/*.txt, one file per shard) and prints, by side:kind, the decision time, the timers (outermost, and the tag
// clock's and arrivalTerms' insides), lever B's copy misses by memo name, lever D's repeats, the content repeats and the
// hold cache, with each row's share of its kind's decision time.
//   node scripts/speed-pass/step0-sum.mjs <dir with out/*.txt> [--json out.json]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const files = readdirSync(join(dir, 'out')).filter(f => f.endsWith('.txt'));
const kinds = {};
const timers = {};
const reps = {};
const B = {};
const content = {};
const makers = {};
const exec = {};
const over = { corp: { n: 0, ms: 0 }, runner: { n: 0, ms: 0 } };
const errors = [];
const calib = [];
let deals = 0;
let chainUsedMax = 0;
const addArr = (a, b) => b.map((x, i) => (a?.[i] ?? 0) + x);
for (const f of files)
  for (const line of readFileSync(join(dir, 'out', f), 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.kind === 'calib') calib.push(o.timerMsPerCall);
    if (o.kind === 'error') errors.push(`${o.pool} ${o.seed}: ${o.error?.slice(0, 120)}`);
    if (o.kind !== 'deal') continue;
    deals++;
    if (o.error) errors.push(`${o.pool} ${o.seed}: ${o.error}`);
    chainUsedMax = Math.max(chainUsedMax, o.chainUsed ?? 0);
    for (const s of ['corp', 'runner']) {
      over[s].n += o.over1s?.[s]?.n ?? 0;
      over[s].ms += o.over1s?.[s]?.ms ?? 0;
    }
    for (const [k, v] of Object.entries(o.ms ?? {})) {
      const x = (kinds[k] ??= { n: 0, ms: 0, asked: 0, searched: 0 });
      for (const f2 of ['n', 'ms', 'asked', 'searched']) x[f2] += v[f2] ?? 0;
    }
    for (const [k, v] of Object.entries(o.timers ?? {})) for (const [n, r] of Object.entries(v)) (timers[k] ??= {})[n] = addArr((timers[k] ??= {})[n], r);
    for (const [k, v] of Object.entries(o.reps ?? {})) for (const [n, r] of Object.entries(v)) (reps[k] ??= {})[n] = addArr((reps[k] ??= {})[n], r);
    for (const [k, v] of Object.entries(o.B ?? {}))
      for (const [n, b] of Object.entries(v)) {
        const x = ((B[k] ??= {})[n] ??= { all: [0, 0], fresh: 0, same: [0, 0], other: [0, 0], eq: 0, diff: 0 });
        x.all = addArr(x.all, b.all);
        x.same = addArr(x.same, b.same);
        x.other = addArr(x.other, b.other);
        x.fresh += b.fresh;
        x.eq += b.eq;
        x.diff += b.diff;
      }
    for (const [k, v] of Object.entries(o.content ?? {}))
      for (const [n, c] of Object.entries(v)) {
        const x = ((content[k] ??= {})[n] ??= { asked: 0, same: [0, 0], other: [0, 0], inClock: 0, inClockSame: 0, verified: [0, 0], differ: {} });
        x.asked += c.asked;
        x.inClock += c.inClock;
        x.inClockSame += c.inClockSame;
        x.same = addArr(x.same, c.same);
        x.other = addArr(x.other, c.other);
        x.verified = addArr(x.verified, c.verified);
        x.sameObj = addArr(x.sameObj ?? [0, 0], c.sameObj ?? [0, 0]);
        for (const [p, m] of Object.entries(c.differ ?? {})) x.differ[p] = (x.differ[p] ?? 0) + m;
      }
    for (const [k, v] of Object.entries(o.makers ?? {}))
      for (const [n, sigs] of Object.entries(v))
        for (const [sig, m] of Object.entries(sigs)) {
          const x = (((makers[k] ??= {})[n] ??= {})[sig] ??= { n: 0, ms: 0, logEq: 0 });
          x.n += m.n;
          x.ms += m.ms;
          x.logEq += m.logEq;
        }
    for (const [k, e] of Object.entries(o.exec ?? {})) {
      const x = (exec[k] ??= { n: 0, ms: 0, dup: 0, dupMs: 0, sites: {} });
      for (const f2 of ['n', 'ms', 'dup', 'dupMs']) x[f2] += e[f2] ?? 0;
      for (const [sig, m] of Object.entries(e.sites ?? {})) x.sites[sig] = addArr(x.sites[sig], m);
    }
  }

const s1 = x => (x / 1000).toFixed(1);
const pct = (x, of) => (of ? `${((100 * x) / of).toFixed(1)}%` : '-');
const order = Object.keys(kinds).sort((a, b) => kinds[b].ms - kinds[a].ms);
const total = order.reduce((n, k) => n + kinds[k].ms, 0);
const per = calib.length ? calib.reduce((a, b) => a + b, 0) / calib.length : 0;
console.log(`deals ${deals}, errors ${errors.length}${errors.length ? `: ${errors.slice(0, 5).join('; ')}` : ''}; timer cost ${(per * 1e6).toFixed(0)} ns a call (mean of ${calib.length} shards); chainStats.used max ${chainUsedMax}`);
console.log(`decisions over 1 s: Corp ${over.corp.n} (${s1(over.corp.ms)} s), Runner ${over.runner.n} (${s1(over.runner.ms)} s)\n`);
console.log('| kind | decisions | s | share of all | hold asked / searched |\n|---|---|---|---|---|');
for (const k of order) console.log(`| ${k} | ${kinds[k].n} | ${s1(kinds[k].ms)} | ${pct(kinds[k].ms, total)} | ${kinds[k].asked} / ${kinds[k].searched} |`);
for (const k of order) {
  const t = timers[k] ?? {};
  const of = kinds[k].ms;
  if (of < 0.002 * total) continue;
  console.log(`\n### ${k} (${s1(of)} s)\nTimers (outermost; s, share of the kind, outermost calls, all calls; the timer's own cost about calls x ${(per * 1e6).toFixed(0)} ns):`);
  for (const n of Object.keys(t).filter(n => !n.includes('>') && !n.includes('@')).sort((a, b) => t[b][0] - t[a][0])) console.log(`  ${n}: ${s1(t[n][0])} s (${pct(t[n][0], of)}), ${t[n][1]} / ${t[n][2]}`);
  for (const p of ['tagLossPerTurn', 'arrivalTerms', 'creditsLessCost', 'rezBudget', 'evaluate']) {
    const rows = Object.keys(t).filter(n => n.startsWith(`${p}>`)).sort((a, b) => t[b][0] - t[a][0]);
    if (rows.length) console.log(`  inside ${p}: ${rows.slice(0, 10).map(n => `${n.slice(p.length + 1)} ${s1(t[n][0])} s (${t[n][1]})`).join(', ')}`);
  }
  for (const c of ['tagLossPerTurn', 'serverHold', 'rezMoney', 'arrivalTerms', 'sumKeep', 'evaluate']) {
    const rows = Object.keys(t).filter(n => n.endsWith(`@${c}`)).sort((a, b) => t[b][0] - t[a][0]);
    if (rows.length) console.log(`  who asks ${c} (innermost timed caller): ${rows.slice(0, 8).map(n => `${n.split('@')[0]} ${s1(t[n][0])} s (${t[n][1]})`).join(', ')}`);
  }
  const b = B[k] ?? {};
  const bn = Object.keys(b).sort((x, y) => b[y].all[1] - b[x].all[1]);
  if (bn.length) {
    console.log('  Lever B, memo misses on the tag clock\'s copies by name (n; s): all, same key on the home (lever B), other key only (eq/diff), fresh:');
    for (const n of bn) console.log(`    ${n}: all ${b[n].all[0]} ${s1(b[n].all[1])} s; same ${b[n].same[0]} ${s1(b[n].same[1])} s (${pct(b[n].same[1], of)}); other ${b[n].other[0]} ${s1(b[n].other[1])} s (${b[n].eq}/${b[n].diff}); fresh ${b[n].fresh}`);
  }
  const r = reps[k] ?? {};
  if (Object.keys(r).length) console.log(`  Lever D, repeats on the same board object and frame (n, s): ${Object.entries(r).map(([n, x]) => `${n} ${x[0]} ${s1(x[1])} s (${pct(x[1], of)})`).join(', ')}`);
  const c = content[k] ?? {};
  for (const [n, x] of Object.entries(c))
    console.log(`  content repeats ${n}: asked ${x.asked} (in the clock ${x.inClock}); same frame ${x.same[0]} ${s1(x.same[1])} s (in the clock ${x.inClockSame}; the same object again ${x.sameObj[0]} ${s1(x.sameObj[1])} s); other frame ${x.other[0]} ${s1(x.other[1])} s; verified whole state equal ${x.verified[1]} of ${x.verified[0]}${x.verified[0] - x.verified[1] ? `; differ ${Object.entries(x.differ).sort((p, q) => q[1] - p[1]).slice(0, 4).map(([p, m]) => `${p} ${m}`).join(', ')}` : ''}`);
  // Step 0b: the makers of the verified equal same-frame repeats, sampled (one repeat in VERIFY is checked); the scale
  // takes the sample to all repeats of the name on distinct objects (same + other frame, less the same object again)
  const mk = makers[k] ?? {};
  for (const [n, sigs] of Object.entries(mk)) {
    const x = c[n];
    const scale = x && x.verified[0] ? (x.same[0] + x.other[0] - x.sameObj[0]) / x.verified[0] : 0;
    const byHow = {};
    for (const [sig, m] of Object.entries(sigs)) {
      const how = sig.split(' | ')[0];
      const h = (byHow[how] ??= { n: 0, ms: 0 });
      h.n += m.n;
      h.ms += m.ms;
    }
    console.log(`  makers of ${n}'s equal repeats (sampled; x${scale.toFixed(1)} for all): ${Object.entries(byHow).sort((p, q) => q[1].ms - p[1].ms).map(([h, m]) => `${h} ${m.n} (${s1(m.ms)} s, est ${s1(m.ms * scale)} s = ${pct(m.ms * scale, of)})`).join('; ')}`);
    for (const [sig, m] of Object.entries(sigs).sort((p, q) => q[1].ms - p[1].ms).slice(0, 6)) console.log(`    ${m.n} (${s1(m.ms)} s, est ${pct(m.ms * scale, of)}; logs equal ${m.logEq}) ${sig}`);
  }
  const e = exec[k];
  if (e) {
    console.log(`  executeAction: ${e.n} (${s1(e.ms)} s, ${pct(e.ms, of)}); the same (board, action) again ${e.dup} (${s1(e.dupMs)} s, ${pct(e.dupMs, of)})`);
    for (const [sig, m] of Object.entries(e.sites).sort((p, q) => q[1][1] - p[1][1]).slice(0, 6)) console.log(`    ${m[0]} sampled (${s1(m[1])} s) ${sig}`);
  }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ deals, errors, kinds, timers, reps, B, content, makers, exec, over, calib: per }));
