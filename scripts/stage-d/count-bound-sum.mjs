// The count bound item, step 1: the sum of scripts/stage-d/count-bound.ts's shard outputs (parts A, B and C on the 92
// sources) and, with GEN, of count-bound-gen.ts's output.
//   node scripts/stage-d/count-bound-sum.mjs <dir of shard .txt files> [gen.jsonl] > sum.md
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [dir, genFile] = process.argv.slice(2);
const files = statSync(dir).isDirectory() ? readdirSync(dir).filter(f => f.endsWith('.txt')).map(f => join(dir, f)) : [dir];
const D = [];
const Q = new Map();
const S = [];
let units = null;
const mem = [];
for (const f of files)
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    const r = JSON.parse(line);
    if (r.kind === 'd') D.push(r);
    else if (r.kind === 'q') {
      if (!Q.has(r.qid)) Q.set(r.qid, r);
    } else if (r.kind === 's') S.push(r);
    else if (r.kind === 'units') units = r;
    else if (r.kind === 'mem') mem.push(r.maxRssMB);
  }
const kindOf = src => (src.startsWith('deal:') ? 'self-play' : 'human');
const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const sum = xs => xs.reduce((a, b) => a + b, 0);
const mx = xs => xs.reduce((a, b) => (b > a ? b : a), 0);
const r1 = x => Math.round(x * 10) / 10;
const p = s => console.log(s);
const stop = (x, c) => (x >= 500 && x > 2 * c) || x > c + 3000;
const GROUPS = { gather: ['gather', 'key', 'g.runTarget', 'g.walkBoard', 'g.walkStart', 'g.turnIce', 'g.picks'], searchHolds: ['searchHolds'], searchOpen: ['searchOpen'], entries: ['entries'], 'thisRun, runStands, reach': ['thisRun', 'runStands', 'reach'], outside: ['outside'] };
const grouped = split => Object.fromEntries(Object.entries(GROUPS).map(([g, ks]) => [g, sum(ks.map(k => split[k] ?? 0))]));

p(`# Count bound, step 1: the sources (${files.length} shard files)\n`);
p(`Units ${units ? `${units.n} (deals ${units.deals})` : '?'}, units finished ${S.length}; decisions ${D.length}; unique questions ${Q.size}; max RSS per process ${mx(mem)} MB (${mem.length} processes).`);
const sources = new Set(D.map(d => d.src));
p(`Sources with decisions: ${sources.size} (self-play ${[...sources].filter(s => kindOf(s) === 'self-play').length}, human ${[...sources].filter(s => kindOf(s) === 'human').length}). Stopped replays: ${S.filter(s => s.stopped).map(s => `${s.src} ${s.stopped}`).join('; ') || 'none'}.\n`);

p('## A. Decision time (ms, medians of 3 per decision) and its split (instr tree, one ask)\n');
p('| kind | decisions | base mean | control mean | arm mean | base p50 / p90 / max | decisions >= 0.5 s (base) | control answer differs | arm answer differs (fire) | arm trips a stop vs control |');
p('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const k of ['self-play', 'human', 'all']) {
  const ds = D.filter(d => k === 'all' || kindOf(d.src) === k);
  const m = t => r1(sum(ds.map(d => d.ms[t])) / Math.max(1, ds.length));
  const b = ds.map(d => d.ms.base);
  p(`| ${k} | ${ds.length} | ${m('base')} | ${m('control')} | ${m('arm')} | ${r1(pct(b, 0.5))} / ${r1(pct(b, 0.9))} / ${r1(mx(b))} | ${ds.filter(d => d.ms.base >= 500).length} | ${ds.filter(d => d.controlDiffers).length} | ${ds.filter(d => d.changed).length} | ${ds.filter(d => stop(d.ms.arm, d.ms.control)).length} |`);
}
p('');
p('Base against control (the noise of the method, row 69a): decisions where base trips a stop against control: ' + D.filter(d => stop(d.ms.base, d.ms.control)).length + '.\n');
const share = ds => {
  const g = {};
  for (const d of ds) for (const [k, v] of Object.entries(grouped(d.split))) g[k] = (g[k] ?? 0) + v;
  const tot = sum(Object.values(g));
  return Object.entries(g).map(([k, v]) => `${k} ${r1(v / 1000)} s (${r1((100 * v) / tot)}%)`).join(', ');
};
p(`Split, every decision: ${share(D)}.`);
const slow = D.filter(d => d.ms.base >= 500);
p(`Split, the ${slow.length} decisions of 0.5 s or more: ${share(slow)}.\n`);
p('### Every decision of 0.5 s or more and the 50 slowest (by base)\n');
p('| src | # | T | fn | base | control | arm | instr | gather | searchHolds | searchOpen | entries | thisRun/runStands/reach | outside | asked / searched | nodes (open) | entries nodes |');
p('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
const list = [...D].sort((a, b) => b.ms.base - a.ms.base);
const shown = list.filter((d, i) => i < 50 || d.ms.base >= 500);
for (const d of shown) {
  const g = grouped(d.split);
  p(`| ${d.src} | ${d.i} | ${d.T} | ${d.fn} | ${d.ms.base} | ${d.ms.control} | ${d.ms.arm} | ${d.instr} | ${r1(g.gather)} | ${r1(g.searchHolds)} | ${r1(g.searchOpen)} | ${r1(g.entries)} | ${r1(g['thisRun, runStands, reach'])} | ${r1(g.outside)} | ${d.asked} / ${d.searched} | ${d.nodes} (${d.nodesOpen}) | ${d.entriesNodes} |`);
}
p('');
const changed = D.filter(d => d.changed);
if (changed.length) {
  p('### Decisions the arm changes\n');
  for (const d of changed) p(`- ${d.src} #${d.i} T${d.T} ${d.fn}: base ${d.base} / arm ${d.arm}`);
  p('');
}
const ctl = D.filter(d => d.controlDiffers || d.instrDiffers);
if (ctl.length) {
  p('### Decisions where control or instr differs from base (a stop)\n');
  for (const d of ctl) p(`- ${d.src} #${d.i} T${d.T}: control ${d.controlDiffers ? d.control : 'same'}; instr ${d.instrDiffers ? d.instrA : 'same'}`);
  p('');
}

// ------------------------------------------------------------------------------------------------ questions
const qsum = (label, qs) => {
  const F = i => qs.map(q => q.f[i]);
  const bN = qs.map(q => q.b[6]);
  const aN = qs.map(q => q.a[6]);
  const bms = qs.map(q => q.b[4]);
  return `| ${label} | ${qs.length} | ${qs.filter(q => q.b[0]).length} | ${r1(pct(F(2), 0.5))} / ${mx(F(2))} | ${r1(pct(F(4), 0.5))} / ${mx(F(4))} | ${r1(pct(F(6), 0.5))} / ${mx(F(6))} | ${pct(bN, 0.5)} / ${pct(bN, 0.99)} / ${mx(bN)} | ${pct(aN, 0.5)} / ${pct(aN, 0.99)} / ${mx(aN)} | ${r1(sum(bms))} | ${r1(sum(qs.map(q => q.a[4])))} |`;
};
const all = [...Q.values()];
p('## Unique questions (by key, across all shards)\n');
p('| set | questions | hold (beta) | unrezzed p50 / max | affordable sets p50 / max | rig p50 / max | beta nodes p50 / p99 / max | arm nodes p50 / p99 / max | beta search ms (sum) | arm search ms (sum) |');
p('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const k of ['self-play', 'human']) p(qsum(k, all.filter(q => kindOf(q.src) === k)));
p(qsum('all', all));
p(qsum('holds (beta)', all.filter(q => q.b[0])));
p(qsum('does not hold (beta)', all.filter(q => !q.b[0])));
p('');

const b1 = (qs, label) => {
  p(`### B1 and B2 on ${label} (${qs.length} unique questions)\n`);
  p(`- brute force agrees with beta's search (holds, set, need): ${qs.filter(q => (q.br ? q.br[3] : q.brute.agrees)).length}`);
  const v1 = qs.filter(q => q.v1);
  const v2 = qs.filter(q => q.v2);
  p(`- a set that holds with a superset that does not (V1): ${v1.length} questions; a set whose need is above a superset's (V2): ${v2.length} questions; either: ${qs.filter(q => q.v1 || q.v2).length}`);
  const causes = {};
  for (const q of qs) for (const [c, n] of Object.entries(q.causes ?? {})) causes[c] = (causes[c] ?? 0) + 1;
  p(`- causes (questions with a violating pair that shows the fact): ${Object.entries(causes).map(([c, n]) => `${c} ${n}`).join('; ') || 'none'}`);
  const cls = q => q.cls ?? [];
  const viol = qs.filter(q => q.v1 || q.v2);
  p(`- violating questions in the class (an unrezzed ice with a Saci on it, or a Corp-credit condition on the server's ice or its lenders): ${viol.filter(q => cls(q).length).length} of ${viol.length}; questions in the class: ${qs.filter(q => cls(q).length).length} (saci ${qs.filter(q => cls(q).includes('saci')).length}, corpCredits ${qs.filter(q => cls(q).includes('corpCredits')).length})`);
  const ans = q => (q.b ? { b: q.b, a: q.a, t: q.t } : { b: [q.beta.holds ? 1 : 0, q.beta.mask, q.beta.need, q.beta.entries], a: [q.arm.holds ? 1 : 0, q.arm.mask, q.arm.need, q.arm.entries], t: [q.armTie.holds ? 1 : 0, q.armTie.mask, q.armTie.need, q.armTie.entries] });
  const diffKind = (x, y) => [x[0] !== y[0] ? 'holds' : '', x[0] && x[1] !== y[1] ? 'rez' : '', x[2] !== y[2] ? 'need' : '', x[3] !== y[3] ? 'entries' : ''].filter(Boolean).join('+') || (x[1] !== y[1] ? 'set only (unread)' : 'same');
  for (const [arm, name] of [['a', 'largestFirst'], ['t', 'largestFirst with beta\'s tie fill']]) {
    const c = {};
    const cNot = {};
    for (const q of qs) {
      const A = ans(q);
      const k = diffKind(A.b, A[arm]);
      c[k] = (c[k] ?? 0) + 1;
      if (!cls(q).length) cNot[k] = (cNot[k] ?? 0) + 1;
    }
    p(`- ${name} against beta: ${Object.entries(c).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join('; ')}`);
    p(`  - outside the class: ${Object.entries(cNot).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join('; ')}`);
  }
  p('');
};
b1(all, 'the sources');
const viol = all.filter(q => q.v1 || q.v2);
if (viol.length) {
  p('Violating source questions (first 30):\n');
  for (const q of viol.slice(0, 30)) p(`- ${q.src} #${q.i} ${q.qid}: V1 ${q.v1} V2 ${q.v2}; ${Object.keys(q.causes).join(', ')}; beta ${q.b.slice(0, 4)} arm ${q.a.slice(0, 4)}; pairs ${JSON.stringify(q.v1pairs)} ${JSON.stringify(q.v2pairs)}`);
  p('');
}

// ------------------------------------------------------------------------------------------------ C
p('## C. Work (walk nodes: memo entries) per question and per decision\n');
p('| kind | per question beta p50 / p99 / max | per question arm p50 / p99 / max | per decision beta (searches) p50 / p99 / max | per decision + entries max |');
p('| --- | --- | --- | --- | --- |');
for (const k of ['self-play', 'human', 'all']) {
  const qs = all.filter(q => k === 'all' || kindOf(q.src) === k);
  const ds = D.filter(d => k === 'all' || kindOf(d.src) === k);
  const bN = qs.map(q => q.b[6] + q.b[7]);
  const aN = qs.map(q => q.a[6] + q.a[7]);
  const dn = ds.map(d => d.nodes);
  p(`| ${k} | ${pct(bN, 0.5)} / ${pct(bN, 0.99)} / ${mx(bN)} | ${pct(aN, 0.5)} / ${pct(aN, 0.99)} / ${mx(aN)} | ${pct(dn, 0.5)} / ${pct(dn, 0.99)} / ${mx(dn)} | ${mx(ds.map(d => d.nodes + d.entriesNodes))} |`);
}
p('');
// Arm per decision: the sum of its search nodes over the decision's questions (from the q lines)
const byQ = Q;
const armDec = D.map(d => sum(d.questions.map(id => byQ.get(id)?.a[6] ?? 0)));
const betaDec = D.map(d => sum(d.questions.map(id => byQ.get(id)?.b[6] ?? 0)));
p(`Per decision, every gathered question searched once (q lines, no cache): beta p50 / p99 / max ${pct(betaDec, 0.5)} / ${pct(betaDec, 0.99)} / ${mx(betaDec)}; arm ${pct(armDec, 0.5)} / ${pct(armDec, 0.99)} / ${mx(armDec)}.\n`);
const top = [...all].sort((a, b) => b.b[6] - a.b[6]).slice(0, 15);
p('The 15 questions with the most beta nodes: ' + top.map(q => `${q.src}#${q.i} ${q.f[0]} unrezzed ${q.f[2]} sets ${q.f[4]} rig ${q.f[6]} clicks ${q.f[8]}: beta ${q.b[6]} (${q.b[0] ? 'holds' : 'open'}) arm ${q.a[6]}`).join('; ') + '\n');

if (genFile) {
  const G = readFileSync(genFile, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
  for (const set of ['random', 'probe', 'saci']) b1(G.filter(q => q.src.split(':')[1] === set), `the generated servers, ${set} (both asks)`);
}
