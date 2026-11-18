// Stage D Madani's hosted programs: the sum of madani-hosted.ts's shard outputs (brief: netrunner-ai/stage-d/madani-hosted/brief.md).
//   node scripts/stage-d/madani-hosted-sum.mjs <g1 deals.json> out/*.txt > sum.md
// Sources apart everywhere: self-play (the local deals), human Runner (the AI Corp's games), human Corp (a person's).
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

// ---------------------------------------------------------------- identity
const g1 = existsSync(dealsFile) ? new Map(JSON.parse(readFileSync(dealsFile, 'utf8')).map(d => [`deal:${d.seed}`, d])) : new Map();
const ps = by('p');
const differ = ps.filter(x => {
  const d = g1.get(x.src);
  return !d || JSON.stringify(d.cr) !== JSON.stringify(x.cr) || JSON.stringify(d.sc) !== JSON.stringify(x.sc) || d.winner !== x.winner;
});
const ds = by('d');
const humans = new Set(ds.filter(x => !x.src.startsWith('deal:')).map(x => x.src));
p(`# Madani hosted programs: sums\n\nSources: ${ps.length} local deals, ${humans.size} human games with a Corp decision (${[...humans].filter(s => group(s) === 'human Runner').length} human Runner, ${[...humans].filter(s => group(s) === 'human Corp').length} human Corp).`);
p(`Identity: local deals whose Corp credits and score at each Corp turn start and winner differ from the g1 batch's deals.json: ${differ.length}${differ.length ? ` (${differ.map(x => x.src).join(', ')})` : ''}.\n`);

// ---------------------------------------------------------------- Q1 presence
p('## Q1. Where the class is on the board at a Corp decision\n');
p('| source | sources | decisions | Madani hosting any program: sources / decisions | hosting a walked program (breaker or trojan) | Madani install used this turn | Bling hosting | Muse hosted on Madani | Jeitinho in the heap at threat 3 |');
p('|---|---|---|---|---|---|---|---|---|');
for (const g of GROUPS) {
  const d = ds.filter(x => group(x.src) === g);
  const srcs = new Set(d.map(x => x.src));
  const f = pred => {
    const hit = d.filter(x => x.pres && pred(x.pres));
    return `${new Set(hit.map(x => x.src)).size} / ${hit.length}`;
  };
  p(`| ${g} | ${srcs.size} | ${d.length} | ${f(x => x.madani.length > 0)} | ${f(x => x.walked)} | ${f(x => x.used)} | ${f(x => x.bling > 0)} | ${f(x => x.muse)} | ${f(x => x.jeitinho)} |`);
}
const hostedSets = new Map();
for (const x of ds.filter(x => x.pres?.madani.length)) hostedSets.set(x.src, new Set([...(hostedSets.get(x.src) ?? []), ...x.pres.madani]));
p(`\nHosted on Madani, by source: ${[...hostedSets].map(([s, t]) => `${s} (${[...t].join(', ')})`).join('; ') || 'none'}.\n`);

// ---------------------------------------------------------------- fire
p('## Q3. Fire count (decisions where the copy differs from the beta copy)\n');
p('| tree | source | Corp decisions | changed | per game | changed with a walked hosted program on the board | changed WITHOUT (a stop) |');
p('|---|---|---|---|---|---|---|');
for (const t of ['control', 'hosted'])
  for (const g of GROUPS) {
    const d = ds.filter(x => group(x.src) === g);
    const ch = d.filter(x => x.changed.includes(t));
    const games = new Set(d.map(x => x.src)).size || 1;
    p(`| ${t} | ${g} | ${d.length} | ${ch.length} | ${(ch.length / games).toFixed(3)} | ${ch.filter(x => x.pres?.walked).length} | **${ch.filter(x => !x.pres?.walked).length}** |`);
  }
const stops = ds.filter(x => x.changed.includes('hosted') && !x.pres?.walked);
if (stops.length) p(`\nSTOP, changed without a walked hosted program: ${stops.map(x => `${x.src} #${x.i} T${x.T} ${x.dk}`).join('; ')}`);
const changed = ds.filter(x => x.changed.includes('hosted'));
if (changed.length) {
  p('\nChanged decisions (hosted), with the continuations (the copy\'s Corp v the beta copy\'s Runner by GameRunner to the end):\n');
  p('| source | # | T | kind | beta | hosted | beta line: winner, end score | hosted line: winner, end score |');
  p('|---|---|---|---|---|---|---|---|');
  for (const x of changed) {
    const c = x.cont ?? {};
    const line = v => (v ? `${v.winner} ${v.end.corp}-${v.end.runner} T${v.end.T}` : '-');
    p(`| ${x.src} | ${x.i} | ${x.T} | ${x.dk} | \`${x.picks.beta}\` | \`${x.picks.hosted}\` | ${line(c.beta)} | ${line(c.hosted)} |`);
  }
}

// ---------------------------------------------------------------- time
p('\n## Q3. Time against the control arm\n');
p('| source | decisions | median ms control / hosted | decisions over a stop (2x at 0.5 s or more, or 3 s slower; medians of 3) | on Madani boards: decisions, median control / hosted, worst |');
p('|---|---|---|---|---|');
const over = x => (x.ms.hosted >= 500 && x.ms.hosted > 2 * x.ms.control) || x.ms.hosted > x.ms.control + 3000;
for (const g of GROUPS) {
  const d = ds.filter(x => group(x.src) === g);
  const m = d.filter(x => x.pres?.walked);
  const worst = m.reduce((a, x) => (!a || x.ms.hosted - x.ms.control > a.ms.hosted - a.ms.control ? x : a), null);
  p(`| ${g} | ${d.length} | ${r1(med(d.map(x => x.ms.control)))} / ${r1(med(d.map(x => x.ms.hosted)))} | ${d.filter(over).length} | ${m.length}, ${r1(med(m.map(x => x.ms.control)))} / ${r1(med(m.map(x => x.ms.hosted)))}${worst ? `, ${worst.src} #${worst.i}: ${worst.ms.control} / ${worst.ms.hosted}` : ''} |`);
}
const overs = ds.filter(over);
if (overs.length) p(`\nOver a stop: ${overs.map(x => `${x.src} #${x.i} T${x.T} ${x.dk} control ${x.ms.control} hosted ${x.ms.hosted}${x.retimed ? ` (${x.retimed.join(' ')})` : ''}${x.pres?.walked ? ' [Madani board]' : ''}`).join('; ')}`);
const w = by('w')[0];
if (w) {
  p(`\nThe worst board (${w.board.ice.join(', ')} on remote1, an agenda in it; rig ${w.board.rig.join(', ')}; on Madani ${w.board.hosted.join(', ')}): serverHold 'runnerTurn' median of 3, control ${r1(w.control.hold)} ms, hosted ${r1(w.hosted.hold)} ms; a Normal Corp's decision, control ${r1(w.control.decision)} ms, hosted ${r1(w.hosted.decision)} ms. Answers: control ${JSON.stringify(w.answers.control)}, hosted ${JSON.stringify(w.answers.hosted)}. Picks: control \`${w.picks.control}\`, hosted \`${w.picks.hosted}\`.${w.installed ? ` The same board with the four programs installed in the rig (control reading them): hold ${r1(w.installed.hold)} ms, decision ${r1(w.installed.decision)} ms, answer ${JSON.stringify(w.installed.answer)}.` : ''}`);
}

// ---------------------------------------------------------------- Q2
const qs = by('q');
const qd = by('qd');
p('\n## Q2. Hold questions on boards with a walked hosted program (beta, the arm, the engine oracle on the same board)\n');
p(`Decisions probed: ${qd.length}; questions asked ${qd.reduce((n, x) => n + x.asked, 0)}, unique by board, server and options ${qd.reduce((n, x) => n + x.unique, 0)}.\n`);
const callerOf = x => x.callers.map(c => c.replace(/^ai\//, '').replace(/ .*/, '')).join('+');
p('| source | caller | when | unique questions | oracle asked | beta holds, oracle gets in | beta gets in, oracle holds | hosted holds, oracle gets in | hosted gets in, oracle holds | oracle unknown or capped |');
p('|---|---|---|---|---|---|---|---|---|---|');
for (const g of GROUPS) {
  const d = qs.filter(x => group(x.src) === g);
  const keys = [...new Set(d.map(x => `${callerOf(x)}|${x.opts.when}`))].sort();
  for (const k of keys) {
    const e = d.filter(x => `${callerOf(x)}|${x.opts.when}` === k);
    const asked = e.filter(x => x.oracle === 'holds' || x.oracle === 'getsIn');
    const hh = x => (typeof x.hosted === 'object' ? x.hosted.holds : null);
    p(`| ${g} | ${k.split('|')[0]} | ${k.split('|')[1]} | ${e.length} | ${asked.length} | ${asked.filter(x => x.beta.holds && x.oracle === 'getsIn').length} | ${asked.filter(x => !x.beta.holds && x.oracle === 'holds').length} | ${asked.filter(x => hh(x) === true && x.oracle === 'getsIn').length} | ${asked.filter(x => hh(x) === false && x.oracle === 'holds').length} | ${e.length - asked.length} |`);
  }
}
const wrong = qs.filter(x => (x.beta.holds && x.oracle === 'getsIn') || (!x.beta.holds && x.oracle === 'holds') || (typeof x.hosted === 'object' && x.hosted.holds !== (x.oracle === 'holds') && (x.oracle === 'holds' || x.oracle === 'getsIn')));
p(`\nEvery question where beta or the arm disagrees with the oracle (${wrong.length}):\n`);
p('| source | # | T | caller | server | when | beta | hosted | oracle | oracle sets |');
p('|---|---|---|---|---|---|---|---|---|---|');
const h = x => (typeof x === 'object' ? `${x.holds ? 'holds' : 'in'} need ${x.need} budget ${x.budget}${x.rez ? ` rez ${x.rez}` : ''}` : x);
for (const x of wrong.slice(0, 150)) p(`| ${x.src} | ${x.i} | ${x.T} | ${callerOf(x)} | ${x.server} (${x.sk}) | ${x.opts.when} | ${h(x.beta)} | ${h(x.hosted)} | ${x.oracle} | ${x.oracleSets.join(' ')} |`);

// ---------------------------------------------------------------- commits and exposures
const cs = by('c');
const runs = by('run');
p('\n## Q3. Commits on boards with a walked hosted program\n');
p('| source | # | T | commit | server | beta after | hosted after | oracle after | beta Corp picks | hosted Corp picks | the Runner\'s next turn on that server (source game) |');
p('|---|---|---|---|---|---|---|---|---|---|---|');
for (const x of cs) {
  const next = runs.filter(r => r.src === x.src && r.server === x.server && (r.T === x.T || r.T === x.T + 1));
  p(`| ${x.src} | ${x.i} | ${x.T} | \`${x.action}\` | ${x.server} | ${h(x.beta)} | ${h(x.hosted)} | ${x.oracle} | \`${x.betaPick}\` | \`${x.hostedPick}\` | ${next.map(r => `T${r.T} ${r.ok ? 'in' : 'out'}${r.stolen ? `, stolen ${r.stolen}` : ''}`).join('; ') || 'no run'} |`);
}

// ---------------------------------------------------------------- generated servers
const gs = by('g').filter(x => !x.error);
p('\n## Q3. Generated servers with Madani and 1 to 4 hosted programs (tests/holdWalkReference.test.ts randomBoard, extended)\n');
const known = gs.filter(x => x.oracle === 'holds' || x.oracle === 'getsIn');
const tab = (name, f) => {
  const a = known.filter(x => f(x) === true && x.oracle === 'getsIn');
  const b = known.filter(x => f(x) === false && x.oracle === 'holds');
  return { name, holdsWrong: a, inWrong: b };
};
const tb = tab('beta', x => x.beta.holds);
const th = tab('hosted', x => x.hosted.holds);
p(`Servers ${gs.length} (errors ${by('g').length - gs.length}); oracle known on ${known.length} (holds ${known.filter(x => x.oracle === 'holds').length}, gets in ${known.filter(x => x.oracle === 'getsIn').length}); unknown or capped ${gs.length - known.length}.\n`);
p('| tree | says holds, oracle gets in | says gets in, oracle holds | of the first, oracle on the bare server (nothing hosted) holds too (the hosted programs are the cause) |');
p('|---|---|---|---|');
for (const t of [tb, th]) p(`| ${t.name} | ${t.holdsWrong.length} | ${t.inWrong.length} | ${t.holdsWrong.filter(x => x.oracleBare === 'holds').length} |`);
const removed = tb.holdsWrong.filter(x => !x.hosted.holds).length;
p(`\nBeta's wrong "holds" the arm removes: ${removed} of ${tb.holdsWrong.length}. The arm's wrong "gets in": ${th.inWrong.length} (criterion 1 asks fewer than ${removed}).`);
p(`Time on these servers, serverHold median: beta ${med(gs.map(x => x.beta.ms))} ms, hosted ${med(gs.map(x => x.hosted.ms))} ms; worst hosted ${Math.max(...gs.map(x => x.hosted.ms))} ms.\n`);
const show = x => `#${x.k}: ice ${x.board.ice.join(', ')}; rig ${x.board.rig.join(', ') || '-'}; hosted ${x.board.hosted.join(', ')}; runner $${x.board.runner} clicks ${x.board.clicks} tags ${x.board.tags} grip ${x.board.grip}; corp $${x.board.corp}; beta ${h(x.beta)}; hosted ${h(x.hosted)}; oracle ${x.oracle} (${x.oracleSets.join(' ')}), bare ${x.oracleBare}`;
p(`The arm says holds, the oracle gets in (${th.holdsWrong.length}):\n`);
for (const x of th.holdsWrong) p(`- ${show(x)}`);
p(`\nThe arm says gets in, the oracle holds (${th.inWrong.length}):\n`);
for (const x of th.inWrong) p(`- ${show(x)}`);
p(`\nBeta says gets in, the oracle holds (${tb.inWrong.length}; the walk's own debts, nothing hosted needed):\n`);
for (const x of tb.inWrong.slice(0, 40)) p(`- ${show(x)}`);

console.log(out.join('\n'));
