// V-C item 1 build, the summing step of run-term-once.ts (JSON lines from every shard): "Judged by" 2, 3 and 5.
//   node scripts/stage-vc/run-term-once-sum.mjs <dir or files...> > sum.md
// Reads every *.txt / *.jsonl under the given paths. Kinds kept apart: self, humanRunner, humanCorp.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ASKED = ['beta', 'control', 'branch', 'topOnly'];
const KINDS = ['self', 'humanRunner', 'humanCorp'];
const files = [];
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).forEach(f => walk(join(p, f))) : /\.(txt|jsonl)$/.test(p) && files.push(p));
process.argv.slice(2).forEach(walk);
const rows = [];
for (const f of files) for (const l of readFileSync(f, 'utf8').split('\n')) if (l.startsWith('{')) try { rows.push(JSON.parse(l)); } catch { /* a cut line */ }
const r2 = x => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const se = xs => (xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1) / xs.length) : NaN);
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const pm = xs => `${r2(mean(xs))} ± ${r2(se(xs))} (n ${xs.length})`;
const P = s => console.log(s);

const games = rows.filter(r => r.kind === 'g');
const humans = rows.filter(r => r.kind === 'h');
const decs = rows.filter(r => r.kind === 'd');
const conts = rows.filter(r => r.kind === 'c');
const nGames = { self: games.length, humanRunner: new Set(humans.filter(h => h.sk === 'humanRunner').map(h => h.src)).size, humanCorp: new Set(humans.filter(h => h.sk === 'humanCorp').map(h => h.src)).size };
const stops = [];

P(`# run-term-once: identity, changed decisions, time\n`);
P(`Sources: ${games.length} deals (${games.filter(g => g.matchesRecord).length} match the g1 record 44381468776; reported only), human files ${humans.length} (${humans.filter(h => h.stopped).length} stopped early). Decisions ${decs.length} (Corp ${decs.filter(d => d.side === 'corp').length}, Runner ${decs.filter(d => d.side === 'runner').length}).`);
const ctl = decs.filter(d => d.controlDiffers);
if (ctl.length) stops.push(`control differs from beta on ${ctl.length} decisions`);
const errs = decs.filter(d => d.errors);
if (errs.length) stops.push(`${errs.length} decisions with errors`);
P(`Control: ${ctl.length} decisions differ from beta${ctl.length ? ': ' + ctl.slice(0, 5).map(d => `${d.src} #${d.i}`).join(', ') : ''}. Errors: ${errs.length}${errs.slice(0, 3).map(d => ` ${d.src}#${d.i} ${JSON.stringify(d.errors).slice(0, 160)}`).join('')}.\n`);

// ------------------------------------------------------------------------------------------------ 2. identity
P(`## 2. Identity where the correction cannot reach\n`);
const ch = decs.filter(d => d.class);
const by = c => ch.filter(d => d.class === c);
P(`| class | changed | self | humanRunner | humanCorp |`);
P(`|---|---|---|---|---|`);
for (const [c, name] of [['i', '(i) top-level run-term prompt, a program gone'], ['ii', '(ii) beta\'s on topOnly'], ['other', 'other (STOP)'], ['topOnlyOnly', 'topOnly differs, branch is beta\'s']]) {
  const xs = by(c);
  P(`| ${name} | ${xs.length} | ${KINDS.map(k => xs.filter(d => d.sk === k).length).join(' | ')} |`);
}
P('');
if (by('other').length) stops.push(`${by('other').length} changed decisions outside classes (i) and (ii)`);
const line = d => `${d.src} #${d.i} T${d.T} ${d.sk}/${d.who} ${d.side} ${d.c} ${d.sv}${d.p?.card ? ` ${d.p.card}` : ''}${d.root ? ` root ${d.root}` : ''}: beta ${d.beta}; branch ${d.branch}; topOnly ${d.topOnly}`;
for (const c of ['i', 'ii', 'other', 'topOnlyOnly']) {
  if (!by(c).length) continue;
  P(`### ${c}\n`);
  for (const d of by(c)) {
    P(`- ${line(d)}`);
    if (d.gone?.length) P(`  - program gone: ${d.gone.map(g => `${g.a} (${g.gone})`).join('; ')}`);
    if (d.prices) for (const [t, p] of Object.entries(d.prices)) P(`  - ${t} (${p.by}${p.loss !== undefined ? ` loss ${r2(p.loss)}` : ''}): ${(p.opts ?? []).map(o => `${o.a} ${o.p}${o.v ? ` ${o.v}` : ''}`).join('; ')}`);
    for (const c2 of conts.filter(x => x.src === d.src && x.i === d.i)) P(`  - pair: a (branch) ${c2.ca.winner} ${c2.ca.cs}-${c2.ca.rs}${c2.ca.run ? ` run stolen ${c2.ca.run.stolen}` : ''}${c2.ca.err ? ` ERR ${c2.ca.err}` : ''} / b (beta) ${c2.cb.winner} ${c2.cb.cs}-${c2.cb.rs}${c2.cb.run ? ` run stolen ${c2.cb.run.stolen}` : ''}${c2.cb.err ? ` ERR ${c2.cb.err}` : ''}`);
  }
  P('');
}
P(`Deals with a changed decision of class (i) or (ii): ${[...new Set(ch.filter(d => d.class === 'i' || d.class === 'ii').filter(d => d.src.startsWith('deal:')).map(d => d.src.slice(5)))].sort().join(', ') || 'none'}.\n`);

// ------------------------------------------------------------------------------------------------ 3. pairs
P(`## 3. Paired continuations (the branch's decision first against beta's; beta's agents both sides to the end)\n`);
P(`Corp points a-b and agenda points stolen (the Runner's final score) a-b, mean ± SE.\n`);
P(`| group | pairs | Corp wins a / b | Corp points a-b | stolen a-b | run stolen a-b |`);
P(`|---|---|---|---|---|---|`);
const good = c => !c.ca.err && !c.cb.err;
const corpPairs = conts.filter(c => c.side === 'corp' && good(c));
const groups = [
  ['(i)', corpPairs.filter(c => c.class === 'i')],
  ['(ii)', corpPairs.filter(c => c.class === 'ii')],
  ['(i) and (ii)', corpPairs.filter(c => c.class === 'i' || c.class === 'ii')],
  ...['remote', 'HQ', 'R&D', 'Archives', 'none'].map(k => [`all, run on ${k}`, corpPairs.filter(c => c.sv === k)]),
  ['other (Corp)', corpPairs.filter(c => c.class === 'other')],
  ['Runner decisions', conts.filter(c => c.side === 'runner' && good(c))],
];
for (const [g, ys] of groups) {
  if (!ys.length) continue;
  const runs = ys.filter(c => c.ca.run && c.cb.run).map(c => c.ca.run.stolen - c.cb.run.stolen);
  P(`| ${g} | ${ys.length} | ${ys.filter(c => c.ca.winner === 'corp').length} / ${ys.filter(c => c.cb.winner === 'corp').length} | ${pm(ys.map(c => c.ca.cs - c.cb.cs))} | ${pm(ys.map(c => c.ca.rs - c.cb.rs))} | ${runs.length ? pm(runs) : ''} |`);
}
P(`\nContinuation errors: ${conts.filter(c => !good(c)).length}.\n`);
const both = corpPairs.filter(c => c.class === 'i' || c.class === 'ii');
if (both.length) {
  const st = mean(both.map(c => c.ca.rs - c.cb.rs));
  const cp = both.map(c => c.ca.cs - c.cb.cs);
  P(`Marks (all changed decisions together): stolen a-b ${r2(st)} (mark: not above 0) ${st > 0 ? 'MISSED' : 'met'}; Corp points a-b ${r2(mean(cp))} ± ${r2(se(cp))} (mark: not below -1 SE) ${mean(cp) < -(se(cp) || 0) ? 'MISSED' : 'met'}.`);
  const ball = corpPairs.filter(c => c.class === 'i' && /Ballista/.test(decs.find(d => d.src === c.src && d.i === c.i)?.p?.card ?? '') && c.a === 'prompt:end');
  P(`Ballista end-or-trash changes to "end": ${ball.length}; with the run ended and nothing stolen in it: ${ball.filter(c => c.ca.run && c.ca.run.stolen === 0).length}.`);
  const ii = corpPairs.filter(c => c.class === 'ii');
  if (ii.length) {
    const iic = ii.map(c => c.ca.cs - c.cb.cs), iis = ii.map(c => c.ca.rs - c.cb.rs);
    const worse = mean(iic) < -(se(iic) || 0) || mean(iis) > (se(iis) || 0);
    P(`Class (ii) alone: Corp points ${pm(iic)}, stolen ${pm(iis)}: ${worse ? 'WORSE than beta by more than 1 SE (report to the AI Coordinator before the hand-off)' : 'not worse by more than 1 SE'}.`);
  }
}
P('');

// ------------------------------------------------------------------------------------------------ 5. time
P(`## 5. Time against control (mean / p95 ratios; decisions over 2x control at 0.5 s or more)\n`);
P(`corpMain is the planner's decision (the look-ahead and the Runner reply run inside it).\n`);
P(`| tree | kind | mean | p95 | corpMain mean | corpMain p95 | over 2x |`);
P(`|---|---|---|---|---|---|---|`);
for (const t of ['beta', 'branch', 'topOnly']) {
  const i = ASKED.indexOf(t);
  for (const sk of KINDS) {
    const xs = decs.filter(d => d.sk === sk && d.ms);
    if (!xs.length) continue;
    const m = (ys, j) => mean(ys.map(d => d.ms[j]));
    const p = (ys, j) => q(ys.map(d => d.ms[j]), 0.95);
    const cm = xs.filter(d => d.c === 'corpMain');
    const over = xs.filter(d => d.ms[i] >= 500 && d.ms[i] > 2 * d.ms[1]).length;
    const mr = m(xs, i) / m(xs, 1), pr = p(xs, i) / p(xs, 1);
    if (t === 'branch' && (mr > 1.05 || pr > 1.15 || over)) stops.push(`time ${sk}: mean ${r2(mr)} p95 ${r2(pr)} over2x ${over}`);
    P(`| ${t} | ${sk} | ${r2(mr)}${t === 'branch' && mr > 1.05 ? ' STOP' : ''} | ${r2(pr)}${t === 'branch' && pr > 1.15 ? ' STOP' : ''} | ${r2(m(cm, i) / m(cm, 1))} | ${r2(p(cm, i) / p(cm, 1))} | ${over}${t === 'branch' && over ? ' STOP' : ''} |`);
  }
}
P('');
P(`Fire counts (the correction moved a price, per decision, mean; inside the look-ahead too): branch ${r2(mean(decs.map(d => d.fire?.[2] ?? 0)))}, topOnly ${r2(mean(decs.map(d => d.fire?.[3] ?? 0)))}; decisions where it fired: branch ${decs.filter(d => d.fire?.[2]).length}, topOnly ${decs.filter(d => d.fire?.[3]).length}.\n`);

P(`## Stops\n`);
P(stops.length ? stops.map(s => `- ${s}`).join('\n') : 'None.');
