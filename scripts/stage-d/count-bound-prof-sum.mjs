// The count bound item, step 2, Part E: the summary of count-bound-prof.ts output (one or more .txt/.jsonl files).
//   node scripts/stage-d/count-bound-prof-sum.mjs out/*.txt > prof.md
import { readFileSync } from 'node:fs';

const rows = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const P = rows.filter(r => r.kind === 'p').sort((a, b) => a.rank - b.rank);
const F = rows.filter(r => r.kind === 'fn');
const p = s => console.log(s);
const r1 = x => Math.round(x * 10) / 10;
const pc = (a, b) => `${r1((100 * a) / (b || 1))}%`;
const sum = (xs, f) => xs.reduce((n, x) => n + (f(x) ?? 0), 0);
const med = xs => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

p(`# Count bound, step 2, Part E: the slow Corp decisions profiled\n`);
const mem = rows.filter(r => r.kind === 'mem');
p(`Decisions profiled: ${P.length}; answers that differ (profiled or counting ask against the plain ask): ${P.filter(x => x.differs).length}; max RSS per process ${mem.length ? Math.max(...mem.map(m => m.maxRssMB)) : '?'} MB (${mem.length} processes); stopped replays: ${rows.filter(r => r.kind === 's' && r.stopped).length}.`);
const ctl = sum(P, x => x.ms.control);
const prof = sum(P, x => x.prof.total);
p(`Time: control (plain ask) ${r1(ctl / 1000)} s; profiled ask ${r1(sum(P, x => x.ms.prof) / 1000)} s (profiler overhead ${pc(sum(P, x => x.ms.prof) - ctl, ctl)}); samples ${r1(prof / 1000)} s; recorded base of the first count ${r1(sum(P, x => x.recorded) / 1000)} s.\n`);

const groups = {
  'before the look-ahead': k => k.startsWith('before.'),
  'look-ahead: setup (views, intake)': k => k === 'look.setup',
  "look-ahead: the playouts' own Corp": k => k.startsWith('look.corp.'),
  'look-ahead: the leaf (leafValue)': k => k === 'look.leaf',
  "look-ahead: the Runner's reply (all of it)": k => k.startsWith('reply.'),
  'after the pick (moneyPick, keepsScore, scoreInTwoPick)': k => k === 'after',
  'prompt answers': k => k === 'prompt',
  'rez windows': k => k === 'rez',
  'other (GC, the agent shell)': k => k === 'other',
};
const phaseT = {};
const kindT = {};
const pkT = {};
for (const x of P) {
  for (const [k, v] of Object.entries(x.prof.phase)) phaseT[k] = (phaseT[k] ?? 0) + v;
  for (const [k, v] of Object.entries(x.prof.kind)) kindT[k] = (kindT[k] ?? 0) + v;
  for (const [k, v] of Object.entries(x.prof.pk)) pkT[k] = (pkT[k] ?? 0) + v;
}
p(`## The split (share of profiled time, all ${P.length} decisions)\n`);
p('| part | s | share | of it in the hold count |');
p('| --- | --- | --- | --- |');
for (const [g, f] of Object.entries(groups)) {
  const ks = Object.keys(phaseT).filter(f);
  const t = sum(ks, k => phaseT[k]);
  const h = sum(Object.keys(pkT).filter(k => f(k.split('/')[0]) && k.endsWith('/hold')), k => pkT[k]);
  p(`| ${g} | ${r1(t / 1000)} | ${pc(t, prof)} | ${pc(h, t)} |`);
}
p('\nFiner phases:\n');
p('| phase | s | share | hold | engine | valuation | clone | other |');
p('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [k, v] of Object.entries(phaseT).sort((a, b) => b[1] - a[1])) p(`| ${k} | ${r1(v / 1000)} | ${pc(v, prof)} | ${['hold', 'engine', 'valuation', 'clone', 'other'].map(kk => pc(pkT[`${k}/${kk}`] ?? 0, v)).join(' | ')} |`);
p('\nBy kind of work (self time), every phase:\n');
p('| kind | s | share |');
p('| --- | --- | --- |');
for (const [k, v] of Object.entries(kindT).sort((a, b) => b[1] - a[1])) p(`| ${k} | ${r1(v / 1000)} | ${pc(v, prof)} |`);
const incl = k => sum(P, x => x.prof.incl[k]);
p(`\nInclusive: under executeAction ${pc(incl('exec'), prof)}; under getLegalActions or isLegalAction ${pc(incl('legal'), prof)} (isLegalAction plays the action in the engine: a trial run); under the decision views and the hidden deal (corpDecisionView, runnerDecisionView, guessHidden) ${pc(incl('view'), prof)}.`);

// The slow decisions only by the first count's own cut and its 50 slowest
const fifty = P.filter(x => x.rank < 50);
const sh = (xs, f) => {
  const t = sum(xs, x => x.prof.total);
  return pc(sum(xs, x => sum(Object.keys(x.prof.phase).filter(f), k => x.prof.phase[k])), t);
};
p(`\nThe 50 slowest alone: before ${sh(fifty, k => k.startsWith('before.'))}, playouts' Corp ${sh(fifty, k => k.startsWith('look.corp.'))}, leaf ${sh(fifty, k => k === 'look.leaf')}, reply ${sh(fifty, k => k.startsWith('reply.'))}, after ${sh(fifty, k => k === 'after')}.`);

p(`\n## Top 15 functions by exclusive (self) time\n`);
const self = new Map();
for (const f of F) for (const [n, ms] of f.self) self.set(n, (self.get(n) ?? 0) + ms);
p('| function (file:line in the copy of src) | s | share |');
p('| --- | --- | --- |');
for (const [n, ms] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) p(`| ${n.replace(/\|/g, '\\|')} | ${r1(ms / 1000)} | ${pc(ms, prof)} |`);
const byFile = new Map();
for (const [n, ms] of self) {
  const f = n.split(' ').slice(1).join(' ').replace(/:\d+$/, '') || '(native)';
  byFile.set(f, (byFile.get(f) ?? 0) + ms);
}
p('\nBy file (self time), top 15:\n');
p('| file | s | share |');
p('| --- | --- | --- |');
for (const [n, ms] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) p(`| ${n} | ${r1(ms / 1000)} | ${pc(ms, prof)} |`);

p(`\n## Work repeated within one decision (the counting ask; a repeat = the same content fingerprint of the board, and the same action, side or held line, seen before in the same decision)\n`);
const cntMs = sum(P, x => x.ms.cnt);
p(`Counting ask time ${r1(cntMs / 1000)} s (fingerprints outside the timed calls).\n`);
p('| work | calls | repeats | repeat share of calls | ms in it (top-level) | ms in repeats | repeats as share of decision time |');
p('| --- | --- | --- | --- | --- | --- | --- |');
for (const k of ['exec', 'leaf', 'rank', 'runner', 'playout', 'reply']) {
  const c = sum(P, x => x.repeats[k].calls);
  const rp = sum(P, x => x.repeats[k].repeats);
  const ms = sum(P, x => x.repeats[k].ms);
  const rms = sum(P, x => x.repeats[k].repeatMs);
  p(`| ${k} | ${c} | ${rp} | ${pc(rp, c)} | ${r1(ms / 1000)} s | ${r1(rms / 1000)} s | ${pc(rms, cntMs)} |`);
}
const C = k => sum(P, x => x.counts[k]);
p(`\nLegality: getLegalActions ${C('legalCalls')} calls, ${C('legalMiss')} computed (cache misses), of them ${C('legalMissSeen')} on a board already computed in the decision (another object, same content); isLegalAction ${C('isLegalCalls')} calls, ${C('isLegalMiss')} computed, ${C('isLegalMissSeen')} on a board and action already computed.`);
p(`Notes: exec repeats include an action executed after isLegalAction trial-ran it on the same board (the same state object or an equal one). 'rank' is the Corp's order (rankMainActions) on a board and held line already ranked; 'runner' is the Runner agent's chooseAction on a board already decided (its memory may differ, so not every repeat is exact).`);

p(`\n## Scaling (control ms, medians per bucket)\n`);
const bucket = (name, f, edges) => {
  p(`\n${name}:\n`);
  p('| bucket | decisions | median ms | mean ms |');
  p('| --- | --- | --- | --- |');
  for (let j = 0; j < edges.length; j++) {
    const lo = edges[j];
    const hi = edges[j + 1] ?? Infinity;
    const xs = P.filter(x => f(x) >= lo && f(x) < hi);
    if (xs.length) p(`| ${hi === Infinity ? `${lo}+` : lo === hi - 1 ? lo : `${lo}-${hi - 1}`} | ${xs.length} | ${r1(med(xs.map(x => x.ms.control)))} | ${r1(sum(xs, x => x.ms.control) / xs.length)} |`);
  }
};
bucket('Candidates compared (planTurn, all calls of the decision)', x => x.counts.candidates, [0, 1, 4, 6, 8, 10, 15, 20]);
bucket('Playouts run', x => x.counts.playouts, [0, 1, 4, 6, 8, 12, 20, 40]);
bucket('Actions per playout (steps / playouts)', x => (x.counts.playouts ? Math.round(x.counts.psteps / x.counts.playouts) : 0), [0, 1, 2, 3, 4, 5, 6, 8]);
bucket('Reply samples', x => x.counts.replies, [0, 1, 5, 10, 15, 20, 30]);
bucket('Reply steps (GameRunner steps in the replies)', x => x.counts.rsteps, [0, 1, 100, 200, 300, 500, 800]);
bucket('Turn number', x => x.T, [0, 3, 6, 9, 12, 15, 20]);
bucket('Runner rig size', x => x.facts.rig, [0, 2, 4, 6, 8, 10, 12]);
bucket('Corp HQ size', x => x.facts.hq, [0, 2, 4, 6, 8, 10]);
// A least-squares fit of control ms on reply steps and playout steps
const xs = P.map(x => [x.counts.rsteps, x.counts.psteps, x.ms.control]);
const corr = (i, j) => {
  const a = xs.map(x => x[i]);
  const b = xs.map(x => x[j]);
  const ma = sum(a, v => v) / a.length;
  const mb = sum(b, v => v) / b.length;
  const cov = sum(a.map((v, k) => (v - ma) * (b[k] - mb)), v => v);
  return cov / Math.sqrt(sum(a, v => (v - ma) ** 2) * sum(b, v => (v - mb) ** 2));
};
p(`\nCorrelation of control ms with reply steps ${r1(corr(0, 2) * 100) / 100}, with playout steps ${r1(corr(1, 2) * 100) / 100}; ms per reply step (sum) ${r1(sum(P, x => x.ms.control) / (C('rsteps') || 1))}.`);

p(`\n## The 50 slowest (by the first count's base)\n`);
p('| # | src | dec | T | recorded / control (ms) | candidates / playouts / steps / replies / reply steps | before | playouts Corp | leaf | reply (runner / corp / engine) | after | hold (any) | exec repeats ms |');
p('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const x of fifty) {
  const ph = x.prof.phase;
  const g = f => r1(sum(Object.keys(ph).filter(f), k => ph[k]));
  p(`| ${x.rank} | ${x.src} | ${x.i} | ${x.T} | ${x.recorded} / ${x.ms.control} | ${x.counts.candidates} / ${x.counts.playouts} / ${x.counts.psteps} / ${x.counts.replies} / ${x.counts.rsteps} | ${g(k => k.startsWith('before.'))} | ${g(k => k.startsWith('look.corp.'))} | ${g(k => k === 'look.leaf')} | ${g(k => k.startsWith('reply.'))} (${r1(ph['reply.runner'] ?? 0)} / ${r1(ph['reply.corp'] ?? 0)} / ${r1(ph['reply.engine'] ?? 0)}) | ${r1(ph.after ?? 0)} | ${r1(x.prof.kind.hold ?? 0)} | ${x.repeats.exec.repeatMs} |`);
}
const diff = P.filter(x => x.differs);
if (diff.length) {
  p('\n## Answers that differ\n');
  for (const x of diff) p(`- ${x.src} #${x.i}: control ${x.control} / cnt ${x.cnt} (the profiled answer is not kept in the row)`);
}
