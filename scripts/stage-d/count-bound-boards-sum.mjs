// The count bound item, step 1: the built boards' table (count-bound-boards.ts output, one or more .jsonl files).
//   node scripts/stage-d/count-bound-boards-sum.mjs boards.jsonl [mem-*.jsonl] > boards.md
import { readFileSync } from 'node:fs';

const rows = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const B = new Map();
for (const r of rows) if (r.kind === 'b' && r.instr) B.set(r.board, r);
const Q = {};
for (const r of rows) if (r.kind === 'q') (Q[r.board] ??= new Map()).set(r.qid, r);
const r1 = x => Math.round(x * 10) / 10;
const p = s => console.log(s);
const G = { gather: ['gather', 'key'], searchHolds: ['searchHolds'], searchOpen: ['searchOpen'], entries: ['entries'], other: ['thisRun', 'runStands', 'reach'], outside: ['outside'] };
p('| board | decision base / control / arm (ms) | arm / control | serverHold base / arm | split: gather, searchHolds, searchOpen, entries, thisRun+runStands+reach, outside (ms, instr) | asked / searched | questions (hold) | arm same as beta / tie fill same / B1 violations | nodes beta / arm (questions searched once) |');
p('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [name, b] of B) {
  const s = b.instr.split;
  const g = Object.values(G).map(ks => r1(ks.reduce((n, k) => n + (s[k] ?? 0), 0))).join(', ');
  const qs = [...(Q[name]?.values() ?? [])];
  const same = qs.filter(q => q.same).length;
  const tie = qs.filter(q => q.tieSame).length;
  const viol = qs.filter(q => q.v1 || q.v2).length;
  const nb = qs.reduce((n, q) => n + q.beta.nodes + q.beta.entriesNodes, 0);
  const na = qs.reduce((n, q) => n + q.arm.nodes + q.arm.entriesNodes, 0);
  p(`| ${name} | ${b.decision.base} / ${b.decision.control} / ${b.decision.arm} | ${r1(b.decision.arm / b.decision.control)}x | ${b.serverHold.base} / ${b.serverHold.arm} | ${g} | ${b.instr.asked} / ${b.instr.searched} | ${qs.length} (${qs.filter(q => q.beta.holds).length}) | ${same} / ${tie} / ${viol} | ${nb} / ${na} |`);
}
const mem = rows.filter(r => r.kind === 'mem');
if (mem.length) p(`\nMax RSS per process (MB): ${mem.map(m => m.maxRssMB).join(', ')}`);
