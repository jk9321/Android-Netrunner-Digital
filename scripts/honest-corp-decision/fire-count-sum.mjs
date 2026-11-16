// Sums scripts/honest-corp-decision/fire-count.ts output: node scripts/honest-corp-decision/fire-count-sum.mjs <dir or files...>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).flatMap(f => walk(join(p, f))) : p.endsWith('.txt') ? [p] : []);
const rows = process.argv.slice(2).flatMap(walk).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const games = new Set(rows.map(r => r.src)).size;
const changed = rows.filter(r => r.changed);
const per = n => (n / Math.max(1, games)).toFixed(2);
const count = (xs, f) => { const m = new Map(); for (const x of xs) { const k = f(x); m.set(k, (m.get(k) ?? 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
console.log(`decisions ${rows.length} in ${games} games; changed ${changed.length} (${per(changed.length)} a game)`);
for (const kind of ['main', 'prompt', 'rez']) {
  const rs = rows.filter(r => r.kind === kind), ch = rs.filter(r => r.changed);
  console.log(`  ${kind}: ${rs.length} decisions, ${ch.length} changed (${per(ch.length)} a game)`);
}
for (const pre of ['deal:', 'human:']) { const rs = rows.filter(r => r.src.startsWith(pre)); console.log(`  ${pre} ${rs.length} decisions, ${rs.filter(r => r.changed).length} changed (${new Set(rs.map(r => r.src)).size} games)`); }
console.log('by question:');
for (const [k, n] of count(changed, r => r.q)) console.log(`  ${k}: ${n} (${per(n)} a game)`);
console.log('by cause (a change can be reproduced by more than one):');
for (const c of ['rd', 'grip', 'rng', 'ctx']) console.log(`  ${c}: ${changed.filter(r => r.causes.includes(c)).length} (only ${changed.filter(r => r.causes.length === 1 && r.causes[0] === c).length})`);
const none = changed.filter(r => !r.causes.length);
console.log(`  none: ${none.length}`);
for (const r of none.slice(0, 20)) console.log('    NONE', r.src, '#' + r.i, 'T' + r.T, r.q, r.base, '->', r.branch);
console.log('question x cause:');
for (const [k, n] of count(changed, r => `${r.q} [${r.causes.join('+') || 'none'}]`)) console.log(`  ${k}: ${n}`);
for (const kind of ['main', 'prompt', 'rez']) {
  const rs = rows.filter(r => r.kind === kind && r.onView !== undefined && r.onView !== null);
  console.log(`on the view (${kind}): the agent's pick is the pick on corpDecisionView at ${rs.filter(r => r.onView).length} of ${rs.length} checked`);
}
const fell = rows.flatMap(r => r.fell);
console.log(`real-state fallbacks: ${fell.length}`);
for (const [k, n] of count(fell, x => x)) console.log(`  ${k}: ${n}`);
const audit = rows.reduce((a, r) => ({ click: a.click + (r.auditMismatch?.click ?? 0), draw: a.draw + (r.auditMismatch?.draw ?? 0) }), { click: 0, draw: 0 });
console.log(`cache audit mismatches: click ${audit.click}, draw ${audit.draw}`);
for (const kind of ['main', 'prompt', 'rez']) {
  const rs = rows.filter(r => r.kind === kind);
  const b = rs.map(r => r.msBase), v = rs.map(r => r.msBranch);
  console.log(`time ${kind}: mean base ${mean(b).toFixed(0)} ms, branch ${mean(v).toFixed(0)} (x${(mean(v) / Math.max(1e-9, mean(b))).toFixed(3)}); p95 ${q(b, 0.95)} vs ${q(v, 0.95)} (x${(q(v, 0.95) / Math.max(1e-9, q(b, 0.95))).toFixed(3)})`);
}
console.log('Corp prompt kinds seen (decisions; how many named hidden cards held in place: R&D / grip / stack; changed):');
const kinds = new Map();
for (const r of rows.filter(r => r.prompt)) {
  const k = kinds.get(r.prompt.kind) ?? { n: 0, rd: 0, grip: 0, stack: 0, changed: 0 };
  k.n++; k.rd += r.prompt.rd ? 1 : 0; k.grip += r.prompt.grip ? 1 : 0; k.stack += r.prompt.stack ? 1 : 0; k.changed += r.changed ? 1 : 0;
  kinds.set(r.prompt.kind, k);
}
for (const [k, v] of [...kinds].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k}: ${v.n}; ${v.rd} / ${v.grip} / ${v.stack}; changed ${v.changed}`);
console.log('changed decisions:');
for (const r of changed) console.log(`- ${r.src} #${r.i} T${r.T} ${r.q} [${r.causes.join('+') || 'none'}] ${r.base} -> ${r.branch}`);
