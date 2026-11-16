// Sums scripts/corp-rd-memory/fire-count.ts output: node scripts/corp-rd-memory/fire-count-sum.mjs <dir or files...>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).flatMap(f => walk(join(p, f))) : p.endsWith('.txt') ? [p] : []);
const all = process.argv.slice(2).flatMap(walk).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const runner = all.filter(r => r.mode === 'runner');
const rows = all.filter(r => r.mode !== 'runner');
const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
const count = (xs, f) => { const m = new Map(); for (const x of xs) for (const k of [].concat(f(x))) m.set(k, (m.get(k) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };
if (rows.length) {
  const games = new Set(rows.map(r => r.src)).size;
  const per = n => (n / Math.max(1, games)).toFixed(2);
  const changed = rows.filter(r => r.changed);
  console.log(`Corp decisions ${rows.length} in ${games} games; changed ${changed.length} (${per(changed.length)} a game)`);
  for (const kind of ['main', 'prompt', 'rez']) { const rs = rows.filter(r => r.kind === kind); console.log(`  ${kind}: ${rs.length}, changed ${rs.filter(r => r.changed).length}`); }
  for (const pre of ['deal:', 'human:']) { const rs = rows.filter(r => r.src.startsWith(pre)); console.log(`  ${pre} ${rs.length} decisions, ${rs.filter(r => r.changed).length} changed (${new Set(rs.map(r => r.src)).size} games)`); }
  console.log(`decisions with a Corp memory ${rows.filter(r => r.corpMem).length}, with a Runner exact place ${rows.filter(r => r.runnerExact).length}, with a Runner range entry ${rows.filter(r => r.rangeEntries).length}`);
  console.log('by cause (mem = the Corp memory added; leak = the Runner places dropped; both can reproduce):');
  for (const c of ['mem', 'leak']) console.log(`  ${c}: ${changed.filter(r => r.causes.includes(c)).length} (only ${changed.filter(r => r.causes.length === 1 && r.causes[0] === c).length}; ${per(changed.filter(r => r.causes.includes(c)).length)} a game)`);
  console.log(`  none: ${changed.filter(r => !r.causes.length).length}`);
  console.log(`STOPS (a change with nothing in either memory): ${rows.filter(r => r.stop).length}`);
  console.log('changes by the effects that filled the Corp memory:');
  for (const [k, n] of count(changed.filter(r => r.corpMem), r => r.effects)) console.log(`  ${k}: ${n}`);
  console.log(`changes with no Corp memory (the leak fix only): ${changed.filter(r => !r.corpMem).length}`);
  console.log('Corp memory size at a decision: mean ' + mean(rows.map(r => r.corpMem)).toFixed(2) + ', p95 ' + q(rows.map(r => r.corpMem), 0.95) + ', max ' + Math.max(0, ...rows.map(r => r.corpMem)));
  for (const kind of ['main', 'prompt', 'rez']) {
    const rs = rows.filter(r => r.kind === kind);
    const b = rs.map(r => r.msBase), v = rs.map(r => r.msBranch);
    console.log(`time ${kind}: mean base ${mean(b).toFixed(0)} ms, branch ${mean(v).toFixed(0)} (x${(mean(v) / Math.max(1e-9, mean(b))).toFixed(3)})`);
  }
  console.log('changed decisions:');
  for (const r of changed) console.log(`- ${r.src} #${r.i} T${r.T} ${r.kind} [${r.causes.join('+') || 'none'}] mem ${r.corpMem} runner ${r.runnerExact}/${r.rangeEntries} {${r.effects.join(', ')}} ${r.base} -> ${r.branch}`);
}
if (runner.length) {
  const diff = runner.filter(r => !r.identical);
  console.log(`Runner check: ${runner.length} deals, ${runner.reduce((a, r) => a + r.runnerDecisions, 0)} Runner decisions (${runner.reduce((a, r) => a + r.withCorpMemory, 0)} with a Corp memory on the board); games that differ with the memory hidden from the Runner: ${diff.length}`);
  for (const r of diff) console.log(`  DIFFERS ${r.src} ${r.kept.hash} vs ${r.stripped.hash}`);
}
