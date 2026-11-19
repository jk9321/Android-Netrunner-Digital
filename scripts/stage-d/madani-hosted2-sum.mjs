// Stage D Madani's hosted programs, count 2: the sum of madani-hosted2.ts's shard outputs (brief-count2.md).
//   node scripts/stage-d/madani-hosted2-sum.mjs <g1 deals.json> out/*.txt > sum.md
// The lines' `hosted` field is the arm `onboard`; `hostedC1` is count 1's arm on the same generated server (saved).
// The oracle is the extended one (oracleX: installs over full memory, rule 8.5.6c), saved from count 1 or asked again.
import { existsSync, readFileSync } from 'node:fs';

const [dealsFile, ...files] = process.argv.slice(2);
const lines = files.flatMap(f => readFileSync(f, 'utf8').split('\n')).filter(l => l.startsWith('{')).map(l => JSON.parse(l));
const by = k => lines.filter(x => x.kind === k);
const aiOf = new Map();
const group = src => {
  if (src.startsWith('deal:')) return 'self-play';
  if (!aiOf.has(src)) {
    const f = `tests/fixtures/human-games/${src.slice(6)}`;
    aiOf.set(src, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).config.ai : '?');
  }
  return aiOf.get(src) === 'corp' ? 'human Runner' : 'human Corp';
};
const GROUPS = ['self-play', 'human Runner', 'human Corp'];
const out = [];
const p = s => out.push(s);
const med = xs => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const r1 = x => Math.round(x * 10) / 10;
const known = x => x.oracleX === 'holds' || x.oracleX === 'getsIn';
const memTag = x => (x.mem ? `${x.mem.used}/${x.mem.limit}${x.mem.over ? ' over' : ''}` : '-');
const h = x => (x && typeof x === 'object' ? `${x.holds ? 'holds' : 'in'} need ${x.need} budget ${x.budget}${x.rez ? ` rez ${x.rez}` : ''}` : String(x));
const count = (xs, f) => {
  const m = {};
  for (const x of xs) m[f(x)] = (m[f(x)] ?? 0) + 1;
  return Object.entries(m).map(([k, v]) => `${k} ${v}`).join(', ') || '-';
};
// report-40 rows from original move 161 on (T9 and later) are on the old engine (make-room split): marked apart
const late40 = x => x.src === 'human:report-40.json' && x.T >= 9;

// ---------------------------------------------------------------- identity
const g1 = existsSync(dealsFile) ? new Map(JSON.parse(readFileSync(dealsFile, 'utf8')).map(d => [`deal:${d.seed}`, d])) : new Map();
const ps = by('p');
const differ = ps.filter(x => {
  const d = g1.get(x.src);
  return !d || JSON.stringify(d.cr) !== JSON.stringify(x.cr) || JSON.stringify(d.sc) !== JSON.stringify(x.sc) || d.winner !== x.winner;
});
const ds = by('d');
p(`# Madani hosted programs, count 2 (arm onboard): sums\n\nSources: ${ps.length} local deals, ${new Set(ds.filter(x => !x.src.startsWith('deal:')).map(x => x.src)).size} human games with a Corp decision. Identity: local deals that differ from the g1 deals.json: ${differ.length}${differ.length ? ` (${differ.map(x => x.src).join(', ')})` : ''}. Errors: ${lines.filter(x => x.error).length}.\n`);

// ---------------------------------------------------------------- A generated
const gs = by('g').filter(x => !x.error);
const gk = gs.filter(known);
p(`## A. Generated servers (${gs.length}; oracle known on ${gk.length}: holds ${gk.filter(x => x.oracleX === 'holds').length}, gets in ${gk.filter(x => x.oracleX === 'getsIn').length})\n`);
p('| tree | holds, oracle in | of which the hosted programs are the cause (bare server holds) | in, oracle holds | beta\'s wrong holds removed |');
p('|---|---|---|---|---|');
const betaWrong = gk.filter(x => x.beta.holds && x.oracleX === 'getsIn');
for (const [name, f] of [['beta', x => x.beta.holds], ['hosted (count 1)', x => x.hostedC1?.holds], ['onboard', x => x.hosted.holds]]) {
  const hw = gk.filter(x => f(x) === true && x.oracleX === 'getsIn');
  const iw = gk.filter(x => f(x) === false && x.oracleX === 'holds');
  p(`| ${name} | ${hw.length} | ${hw.filter(x => x.oracleBare === 'holds').length} | ${iw.length} | ${name === 'beta' ? '-' : betaWrong.filter(x => !f(x)).length} |`);
}
const gHw = gk.filter(x => x.hosted.holds && x.oracleX === 'getsIn');
const gIw = gk.filter(x => !x.hosted.holds && x.oracleX === 'holds');
p(`\nOnboard's wrong "gets in" by bound (the first rung of the ladder at which it holds; none = the walk's own debt): ${count(gIw, x => x.ladder ?? 'not laddered')}.`);
p(`Saved answers: beta's answer the same as count 1's on ${gs.filter(x => x.savedBetaSame === true).length} of ${gs.filter(x => x.savedBetaSame !== null).length}.`);
p(`Time, serverHold median: beta ${med(gs.map(x => x.beta.ms))} ms, onboard ${med(gs.map(x => x.hosted.ms))} ms; worst onboard ${Math.max(...gs.map(x => x.hosted.ms))} ms.\n`);
const show = x => `#${x.k}: ice ${x.board.ice.join(', ')}; rig ${x.board.rig.join(', ') || '-'}; hosted ${x.board.hosted.join(', ')}; runner $${x.board.runner} clicks ${x.board.clicks} tags ${x.board.tags} grip ${x.board.grip}; corp $${x.board.corp}; memory ${memTag(x)}; beta ${h(x.beta)}; onboard ${h(x.hosted)}; count 1 ${x.hostedC1?.holds ? 'holds' : 'in'}; oracle ${x.oracleX}, bare ${x.oracleBare}${x.ladder ? `; ladder ${x.ladder}` : ''}`;
p(`Onboard says holds, the oracle gets in (${gHw.length}):\n`);
for (const x of gHw) p(`- ${show(x)}`);
p(`\nOnboard says gets in, the oracle holds (${gIw.length}):\n`);
for (const x of gIw) p(`- ${show(x)}`);

// ---------------------------------------------------------------- B sources Q2
const qs = by('q').filter(x => typeof x.hosted === 'object');
p(`\n## B. Sources: hold questions on boards with a walked hosted program (${qs.length}; oracle saved ${qs.filter(x => x.oracleFrom === 'saved').length}, asked again ${qs.filter(x => x.oracleFrom === 'asked').length}; known ${qs.filter(known).length})\n`);
p('| source | rows | known | beta holds, oracle in | onboard holds, oracle in | onboard in, oracle holds | beta\'s wrong holds removed | onboard wrong in by bound |');
p('|---|---|---|---|---|---|---|---|');
for (const g of GROUPS)
  for (const [lab, f] of [['', x => !late40(x)], [' (report-40 T9+, old engine)', late40]]) {
    const d = qs.filter(x => group(x.src) === g && f(x));
    if (!d.length) continue;
    const k = d.filter(known);
    const bw = k.filter(x => x.beta.holds && x.oracleX === 'getsIn');
    const iw = k.filter(x => !x.hosted.holds && x.oracleX === 'holds');
    p(`| ${g}${lab} | ${d.length} | ${k.length} | ${bw.length} | ${k.filter(x => x.hosted.holds && x.oracleX === 'getsIn').length} | ${iw.length} | ${bw.filter(x => !x.hosted.holds).length} | ${count(iw, x => x.ladder ?? 'not laddered')} |`);
  }
p('\nBy source kind (server kind), all groups:\n');
p('| server kind | known | beta holds, oracle in | onboard holds, oracle in | onboard in, oracle holds |');
p('|---|---|---|---|---|');
for (const sk of [...new Set(qs.map(x => x.sk))].sort()) {
  const k = qs.filter(x => x.sk === sk && known(x));
  p(`| ${sk} | ${k.length} | ${k.filter(x => x.beta.holds && x.oracleX === 'getsIn').length} | ${k.filter(x => x.hosted.holds && x.oracleX === 'getsIn').length} | ${k.filter(x => !x.hosted.holds && x.oracleX === 'holds').length} |`);
}
const qWrong = qs.filter(x => known(x) && x.hosted.holds !== (x.oracleX === 'holds'));
p(`\nEvery source question where onboard disagrees with the oracle (${qWrong.length}):\n`);
p('| source | # | k | T | server | when | memory | beta | onboard | oracle | ladder |');
p('|---|---|---|---|---|---|---|---|---|---|---|');
for (const x of qWrong.slice(0, 200)) p(`| ${x.src} | ${x.i} | ${x.k} | ${x.T}${late40(x) ? ' (old engine)' : ''} | ${x.server} (${x.sk}) | ${x.opts.when} | ${memTag(x)} | ${h(x.beta)} | ${h(x.hosted)} | ${x.oracleX} (${x.oracleFrom}) | ${x.ladder ?? '-'} |`);

// ---------------------------------------------------------------- C fire
p('\n## C. Fire: decisions where the copy differs from the beta copy\n');
p('| tree | source | Corp decisions | changed | per game | with a walked hosted program | WITHOUT (a stop) |');
p('|---|---|---|---|---|---|---|');
for (const t of ['control', 'onboard'])
  for (const g of GROUPS) {
    const d = ds.filter(x => group(x.src) === g);
    const ch = d.filter(x => x.changed.includes(t));
    const games = new Set(d.map(x => x.src)).size || 1;
    p(`| ${t} | ${g} | ${d.length} | ${ch.length} | ${(ch.length / games).toFixed(3)} | ${ch.filter(x => x.pres?.walked).length} | **${ch.filter(x => !x.pres?.walked).length}** |`);
  }
const changed = ds.filter(x => x.changed.includes('onboard'));
p(`\nPer game: ${count(changed, x => x.src)}.`);
const stops = changed.filter(x => !x.pres?.walked);
if (stops.length) p(`\nSTOP, changed without a walked hosted program: ${stops.map(x => `${x.src} #${x.i} T${x.T} ${x.dk}`).join('; ')}`);
const kind = x => {
  const b = x.kindOf?.beta;
  const a = x.kindOf?.arm;
  if (['agenda install', 'agenda advance', 'score'].includes(b) && b !== a) return `${b} given up`;
  if (a === 'ice install' || a === 'rez') return `${a} added`;
  return 'other';
};
p(`\nBy kind: ${count(changed, kind)}.\n`);
p('| source | # | T | kind | beta | onboard | declined commit: oracle on the board after beta\'s | beta line | onboard line |');
p('|---|---|---|---|---|---|---|---|---|');
const line = v => (v ? `${v.winner} ${v.end.corp}-${v.end.runner} T${v.end.T}` : '-');
for (const x of changed) p(`| ${x.src} | ${x.i} | ${x.T}${late40(x) ? ' (old engine)' : ''} | ${kind(x)} | \`${x.picks.beta}\` | \`${x.picks.onboard}\` | ${x.declined ? `${x.declined.what} ${x.declined.server}: ${x.declined.oracleX}; onboard there ${h(x.declined.arm)}${x.declined.ladder ? `, ladder ${x.declined.ladder}` : ''}` : '-'} | ${line(x.cont?.beta)} | ${line(x.cont?.hosted)} |`);

// ---------------------------------------------------------------- D1, D2
const para = by('para');
const declines = [...changed.filter(x => x.declined && !x.declined.error).map(x => ({ src: x.src, T: x.T, where: 'source', ...x.declined })), ...para.filter(x => x.tree === 'onboard').flatMap(x => (x.declines ?? []).filter(d => d.what).map(d => ({ src: `${x.src} from T${x.T}`, where: 'continuation', ...d })))];
p(`\n## D1. Declined commits (beta commits an agenda to a remote, onboard does not): ${declines.length}\n`);
p(`Oracle on the board after beta's commit: gets in (an open commit removed) ${declines.filter(d => d.oracleX === 'getsIn').length}; holds (a paralysis case) ${declines.filter(d => d.oracleX === 'holds').length}; unknown ${declines.filter(d => !known(d)).length}.`);
p(`Paralysis cases by bound: ${count(declines.filter(d => d.oracleX === 'holds'), d => d.ladder ?? 'none')}.\n`);
p('| where | source | T | commit | server | memory | oracle | onboard there | ladder |');
p('|---|---|---|---|---|---|---|---|---|');
for (const d of declines) p(`| ${d.where} | ${d.src} | ${d.T} | ${d.what} | ${d.server} | ${memTag(d)} | ${d.oracleX} | ${h(d.arm)} | ${d.ladder ?? '-'} |`);
const starts = by('ps')[0]?.starts ?? [];
p(`\n## D2. GameRunner continuations from every Corp turn start on a hosted board (${starts.length} starts)\n`);
p('| start | tree | next three Corp turns: agenda installs / advances / scores | idle-agenda turns (three / all) | stolen (T, from) | result |');
p('|---|---|---|---|---|---|');
const tot = {};
for (const x of para) {
  const t = (tot[x.tree] ??= { installs: 0, advances: 0, scores: 0, idle: 0, idleAll: 0, stolen: 0, corp: 0, n: 0 });
  t.installs += x.three.installs;
  t.advances += x.three.advances;
  t.scores += x.three.scores;
  t.idle += x.three.idle;
  t.idleAll += x.idleAll;
  t.stolen += x.stolen.length;
  t.corp += x.winner === 'corp' ? 1 : 0;
  t.n++;
  p(`| ${x.src} T${x.T} | ${x.tree} | ${x.three.installs} / ${x.three.advances} / ${x.three.scores} | ${x.three.idle} / ${x.idleAll} | ${x.stolen.map(s => `T${s.T} ${s.from}`).join(', ') || '-'} | ${x.winner} ${x.end.corp}-${x.end.runner} T${x.end.T} |`);
}
p('\n| tree | starts | installs | advances | scores | idle (three) | idle (all) | stolen | Corp wins |');
p('|---|---|---|---|---|---|---|---|---|');
for (const [t, v] of Object.entries(tot)) p(`| ${t} | ${v.n} | ${v.installs} | ${v.advances} | ${v.scores} | ${v.idle} | ${v.idleAll} | ${v.stolen} | ${v.corp} |`);

// ---------------------------------------------------------------- E time
p('\n## E. Time against the control arm (medians of 3)\n');
p('| source | decisions | median ms control / onboard | over a stop | on Madani boards: decisions, median control / onboard, worst |');
p('|---|---|---|---|---|');
const over = x => (x.ms.onboard >= 500 && x.ms.onboard > 2 * x.ms.control) || x.ms.onboard > x.ms.control + 3000;
for (const g of GROUPS) {
  const d = ds.filter(x => group(x.src) === g && x.ms);
  const m = d.filter(x => x.pres?.walked);
  const worst = m.reduce((a, x) => (!a || x.ms.onboard - x.ms.control > a.ms.onboard - a.ms.control ? x : a), null);
  p(`| ${g} | ${d.length} | ${r1(med(d.map(x => x.ms.control)))} / ${r1(med(d.map(x => x.ms.onboard)))} | ${d.filter(over).length} | ${m.length}, ${r1(med(m.map(x => x.ms.control)))} / ${r1(med(m.map(x => x.ms.onboard)))}${worst ? `, ${worst.src} #${worst.i}: ${worst.ms.control} / ${worst.ms.onboard}` : ''} |`);
}
const overs = ds.filter(x => x.ms && over(x));
if (overs.length) p(`\nOver a stop: ${overs.map(x => `${x.src} #${x.i} T${x.T} ${x.dk} control ${x.ms.control} onboard ${x.ms.onboard}${x.pres?.walked ? ' [Madani board]' : ''}`).join('; ')}`);
const r28 = ds.find(x => x.src === 'human:report-40.json' && x.i === 28);
if (r28) p(`\nreport-40 #28: control ${r28.ms.control} ms, onboard ${r28.ms.onboard} ms.`);
const w = by('w')[0];
if (w) p(`\nThe worst board (${w.board.ice.join(', ')}; rig ${w.board.rig.join(', ')}; on Madani ${w.board.hosted.join(', ')}): serverHold control ${r1(w.control.hold)} ms, onboard ${r1(w.hosted.hold)} ms; decision control ${r1(w.control.decision)} ms, onboard ${r1(w.hosted.decision)} ms${w.installed ? `; installed reference (control, programs in the rig): hold ${r1(w.installed.hold)} ms, decision ${r1(w.installed.decision)} ms, so onboard / installed = ${(w.hosted.decision / w.installed.decision).toFixed(2)}x` : ''}. Answers: control ${JSON.stringify(w.answers.control)}, onboard ${JSON.stringify(w.answers.hosted)}.`);

console.log(out.join('\n'));
