/**
 * Bundle P build: the summing step of placement-wiring-build.ts (review-fixes-1119/placement-build/brief.md rev 3,
 * "Judged by"). Reads the JSON lines the run printed (the ai-script run's out/*.txt) and prints the readings (markdown).
 * With COUNT=<dir> (the count's run 44604936953 out/), compares the changed decisions with the count's lists.
 *
 *   COUNT=/path/count/out node scripts/review-fixes/placement-wiring-build-sum.mjs <out dir> > sum.md
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const load = paths => {
  const files = [];
  const walk = p => (statSync(p).isDirectory() ? readdirSync(p).forEach(f => walk(join(p, f))) : /\.(txt|jsonl)$/.test(p) && files.push(p));
  paths.forEach(walk);
  const rows = [];
  for (const f of files)
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      if (!l.startsWith('{')) continue;
      try {
        rows.push(JSON.parse(l));
      } catch {
        /* a cut line */
      }
    }
  return rows;
};
const rows = load(process.argv.slice(2));
const ASKED = ['beta', 'control', 'c1', 'c2', 'head', 'shortOnce', 'shortCoverWaiting'];
const KINDS = ['self', 'humanRunner', 'humanCorp'];
const KSETS = [['all', KINDS], ['self', ['self']], ['humanRunner', ['humanRunner']], ['humanCorp', ['humanCorp']]];
const D = rows.filter(r => r.kind === 'd');
const C = rows.filter(r => r.kind === 'c');
const games = rows.filter(r => r.kind === 'g');
const humans = rows.filter(r => r.kind === 'h');
const p = s => console.log(s);
const f2 = x => (x == null || Number.isNaN(x) ? '-' : (Math.round(x * 100) / 100).toString());
const f3 = x => (x == null || Number.isNaN(x) ? '-' : (Math.round(x * 1000) / 1000).toString());
const sum = a => a.reduce((x, y) => x + y, 0);
const mean = a => (a.length ? sum(a) / a.length : NaN);
const se = a => (a.length > 1 ? Math.sqrt(sum(a.map(x => (x - mean(a)) ** 2)) / (a.length - 1) / a.length) : NaN);
const pct = (a, q) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const nGames = k => (k === 'self' ? games.length : humans.filter(h => h.sk === k).length);
const id = r => `${r.src}|${r.i}`;
const changed = (r, step) => r.diff?.[step];
const STEPS = [
  ['c1/beta', 'fix 1 (c1 against the merge base)'],
  ['c2/c1', 'fix 2 (c2 against c1)'],
  ['head/c2', 'fixes 3 and 4 (head against c2)'],
];

// ---------------------------------------------------------------- sources and stops
p('## Sources and stops\n');
p(`Self-play games: ${games.length}, matching the batch's record (winner, cr, sc): ${games.filter(g => g.matchesBatch).length}. Human files: ${humans.length} (human Runner ${humans.filter(h => h.sk === 'humanRunner').length}, human Corp ${humans.filter(h => h.sk === 'humanCorp').length}; stopped replays: ${humans.filter(h => h.stopped).map(h => `${h.src} (${h.stopped})`).join(', ') || 'none'}).`);
const bad = games.filter(g => !g.matchesBatch).map(g => g.src);
if (bad.length) p(`\n**STOP: games not matching the batch:** ${bad.join(', ')}`);
p('\n| kind | Corp decisions | main | prompt | rez | control differs | errors | measure ask differs from head |');
p('|---|---|---|---|---|---|---|---|');
for (const k of KINDS) {
  const d = D.filter(r => r.sk === k);
  p(`| ${k} | ${d.length} | ${d.filter(r => r.c === 'corpMain').length} | ${d.filter(r => r.c === 'corpPrompt').length} | ${d.filter(r => r.c === 'corpRez').length} | ${d.filter(r => r.controlDiffers).length} | ${d.filter(r => r.errors).length} | ${d.filter(r => r.measureDiffers).length} |`);
}
for (const r of D.filter(r => r.errors).slice(0, 20)) p(`- error ${r.src} i${r.i}: ${JSON.stringify(r.errors)}`);
for (const r of D.filter(r => r.controlDiffers)) p(`- **STOP control differs** ${r.src} i${r.i} T${r.T} ${r.c}`);
const fire = k => sum(D.map(r => r.fire?.[ASKED.indexOf('head')]?.[k] ?? 0));
p(`\nWaiting-form candidates made by the head tree (fix 2's legalOr): ${fire('waitTop')} at the top level, ${fire('waitLookahead')} inside the look-ahead and nested orders; **refused by the engine: ${fire('waitRefused')}** (c2 tree: ${sum(D.map(r => r.fire?.[ASKED.indexOf('c2')]?.waitRefused ?? 0))}).`);

// ---------------------------------------------------------------- the reproduction
p('\n## The built tree against the counted arms\n');
const vs = step => D.filter(r => changed(r, step));
p(`- c1 against the count's shortOnce (fix 1's memo against the arm's uncached form): ${vs('c1/shortOnce').length} changed decisions.`);
p(`- head against the count's shortCoverWaiting (the whole build, freeKey included): ${vs('head/shortCoverWaiting').length} changed decisions.`);
for (const step of ['c1/shortOnce', 'head/shortCoverWaiting']) for (const r of vs(step)) p(`  - ${step} ${r.src} i${r.i} T${r.T} ${r.c} (${r.sk}): ${r.diff[step].ref} | ${r.diff[step].arm}`);
p(`- On this run's sources (the merge base, after ai-hold-inputs): shortOnce changes ${vs('shortOnce/beta').length}, shortCoverWaiting ${vs('shortCoverWaiting/beta').length}.`);
if (process.env.COUNT) {
  // only the sources this run read (a partial run compares its own sources)
  const srcs = new Set(D.map(r => r.src.split('#')[0]));
  const cr = load([process.env.COUNT]).filter(r => r.kind === 'd' && srcs.has(r.src.split('#')[0]));
  const was = arm => new Map(cr.filter(r => r.changed?.[arm]).map(r => [id(r), r]));
  for (const [arm, step] of [['shortOnce', 'c1/beta'], ['shortCoverWaiting', 'head/beta']]) {
    const then = was(arm);
    const now = new Map(D.filter(r => r.picks && r.picks[step.split('/')[0]] !== '=').map(r => [id(r), r]));
    const lost = [...then.keys()].filter(k => !now.has(k));
    const gained = [...now.keys()].filter(k => !then.has(k));
    const other = [...now.keys()].filter(k => then.has(k) && then.get(k).changed[arm] !== now.get(k).picks[step.split('/')[0]]);
    p(`- The count's ${arm} list (run 44604936953): ${then.size} changed; ${step.split('/')[0]} against the merge base here: ${now.size}; there and not here ${lost.length}, here and not there ${gained.length}, both with a different pick ${other.length}.`);
    for (const k of lost) p(`  - there, not here: ${k} (count: beta ${then.get(k).beta} | ${then.get(k).changed[arm]}; here beta ${D.find(r => id(r) === k)?.beta ?? '?'})`);
    for (const k of gained) p(`  - here, not there: ${k} (beta ${now.get(k).beta} | ${now.get(k).picks[step.split('/')[0]]}; count's beta ${cr.find(r => id(r) === k)?.beta ?? '?'})`);
    for (const k of other) p(`  - other pick: ${k} (count ${then.get(k).changed[arm]} | here ${now.get(k).picks[step.split('/')[0]]})`);
  }
}

// ---------------------------------------------------------------- per commit
p('\n## Changed decisions per commit\n');
p('| commit | kind | changed | a game | main | prompt | rez | top level (the order differs) | through the look-ahead (the same order) |');
p('|---|---|---|---|---|---|---|---|---|');
for (const [step, name] of STEPS)
  for (const k of KINDS) {
    const d = D.filter(r => r.sk === k && changed(r, step));
    p(`| ${name} | ${k} | ${d.length} | ${f3(d.length / Math.max(1, nGames(k)))} | ${d.filter(r => r.c === 'corpMain').length} | ${d.filter(r => r.c === 'corpPrompt').length} | ${d.filter(r => r.c === 'corpRez').length} | ${d.filter(r => changed(r, step).how === 'direct').length} | ${d.filter(r => changed(r, step).how === 'lookahead').length} |`);
  }

// Fix 1: S's class at the decision board, else the first playout difference on a board in the class
p('\n### Fix 1: each changed decision and its class\n');
const inS = r => !!(r.m?.s && r.m.s.shortToday && !r.m.s.shortOnce);
for (const r of vs('c1/beta')) {
  const x = r.diff['c1/beta'];
  const f = x.log?.first;
  p(`- ${r.src} i${r.i} T${r.T} ${r.c} (${r.sk}, ${x.how}): beta ${x.ref} | c1 ${x.arm}; class at the board: ${inS(r)}${r.m?.s ? ` (floor ${r.m.s.floor} / once ${r.m.s.floorOnce}, end ${r.m.s.end})` : ''}; first playout difference: ${f ? `playout ${f.p} (depth ${f.d}) step ${f.step}: ${f.ref} | ${f.arm}, the board in the class: ${f.armS}` : 'none logged'}; class boards in c1's playouts ${x.log?.sBoards ?? '-'}`);
}
const s1 = vs('c1/beta');
p(`\nFix 1: ${s1.length} changed; in the class at the board ${s1.filter(inS).length}; outside it and traced to a playout board in the class ${s1.filter(r => !inS(r) && r.diff['c1/beta'].log?.first?.armS).length}; **neither (a stop): ${s1.filter(r => !inS(r) && !r.diff['c1/beta'].log?.first?.armS).length}**.`);

// Fix 2: the class (a waiting-form placement on the board) and M7
p('\n### Fix 2: the class and the first playout difference (red team M7)\n');
const isW = r => (r.m?.c ?? []).some(c => c.form === 'waiting');
const hasPair = r => (r.m?.c ?? []).some(c => c.form === 'pair');
const coverStep = f => !!f && (f.armW || f.refW || /^INSTALL_CARD asset:/.test(f.ref ?? '') || /^INSTALL_CARD asset:/.test(f.arm ?? ''));
const s2 = vs('c2/c1');
const m7 = { cover: [], other: [], none: [] };
for (const r of s2) {
  const f = r.diff['c2/c1'].log?.first;
  (f ? (coverStep(f) ? m7.cover : m7.other) : m7.none).push(r);
}
p(`Fix 2: ${s2.length} changed (self ${s2.filter(r => r.sk === 'self').length}, human Runner ${s2.filter(r => r.sk === 'humanRunner').length}, human Corp ${s2.filter(r => r.sk === 'humanCorp').length}); a waiting-form placement on the decision's board ${s2.filter(isW).length}; outside the class ${s2.filter(r => !isW(r)).length}; on a board with a pair-form placement ${s2.filter(hasPair).length}. Logs read the same pick as the timed asks at ${s2.filter(r => r.diff['c2/c1'].log?.same).length} of ${s2.length}.`);
p(`\nM7, the first step where c1's and c2's playouts differ: at a waiting-form cover's own install or an asset install (a later order pick of one) ${m7.cover.length}; **elsewhere (a stop) ${m7.other.length}**; no difference in the logs ${m7.none.length}.`);
for (const r of [...m7.other, ...m7.none]) {
  const x = r.diff['c2/c1'];
  p(`- ${m7.other.includes(r) ? 'ELSEWHERE' : 'NO LOG DIFF'} ${r.src} i${r.i} T${r.T} (${r.sk}, ${x.how}): c1 ${x.ref} | c2 ${x.arm}; ${JSON.stringify(x.log?.first ?? null)}`);
}
for (const r of s2.filter(r => !isW(r))) {
  const x = r.diff['c2/c1'];
  p(`- outside the class: ${r.src} i${r.i} T${r.T} ${r.c} (${r.sk}, ${x.how}): c1 ${x.ref} | c2 ${x.arm}; first difference ${JSON.stringify(x.log?.first ?? null)}; waiting-form steps in c2's playouts ${x.log?.waitingSteps ?? '-'}`);
}
p('\n<details><summary>Every fix 2 change</summary>\n');
for (const r of s2) {
  const x = r.diff['c2/c1'];
  const f = x.log?.first;
  p(`- ${r.src} i${r.i} T${r.T} ${r.c} (${r.sk}, ${x.how}, class ${isW(r)}): c1 ${x.ref} | c2 ${x.arm}; first: ${f ? `p${f.p} d${f.d} s${f.step} ${f.ref} | ${f.arm} (w ${f.refW ? 1 : 0}/${f.armW ? 1 : 0})` : '-'}`);
}
p('\n</details>\n');
for (const r of vs('head/c2')) p(`- head against c2: ${r.src} i${r.i} T${r.T} ${r.c} (${r.sk}): ${r.diff['head/c2'].ref} | ${r.diff['head/c2'].arm}`);

// ---------------------------------------------------------------- pairs
p('\n## Pairs (continuations by GameRunner, the merge base\'s agents both sides; the commit\'s move against the merge base\'s)\n');
p('Columns: Corp wins diff = arm − base in Corp wins (0/1) per pair; win-adjusted Corp points = a winner\'s score read as at least 7; raw Corp points; points stolen. A continuation drops the held line the decision begins, on both sides alike (red team M8).\n');
p('| commit | sources | pairs | errors | Corp wins arm / base | Corp wins diff | win-adjusted Corp points | raw Corp points | points stolen |');
p('|---|---|---|---|---|---|---|---|---|');
const wadj = o => (o.winner === 'corp' ? Math.max(7, o.cs) : o.cs);
const pm = v => `${f2(mean(v))} ± ${f2(se(v))}`;
const cols = c => [c.map(x => (x.ca.winner === 'corp') - (x.cb.winner === 'corp')), c.map(x => wadj(x.ca) - wadj(x.cb)), c.map(x => x.ca.cs - x.cb.cs), c.map(x => x.ca.rs - x.cb.rs)].map(pm).join(' | ');
const contsOf = (arm, kinds) => C.filter(c => c.arm === arm && kinds.includes(c.sk) && !c.ca.err && !c.cb.err);
for (const arm of ['c1', 'c2', 'head'])
  for (const [name, kinds] of KSETS) {
    const c = contsOf(arm, kinds);
    const errsN = C.filter(x => x.arm === arm && kinds.includes(x.sk) && (x.ca.err || x.cb.err)).length;
    if (!c.length && !errsN) continue;
    p(`| ${arm} | ${name} | ${c.length} | ${errsN} | ${c.filter(x => x.ca.winner === 'corp').length} / ${c.filter(x => x.cb.winner === 'corp').length} | ${cols(c)} |`);
  }
const capped = D.filter(r => r.picks?.head !== '=').length - C.filter(c => c.arm === 'head').length;
p(`\nhead: ${D.filter(r => r.picks?.head !== '=').length} changed decisions, ${C.filter(c => c.arm === 'head').length} continued (${capped} past the cap of 8 a source and arm, or with no move).`);
for (const x of C.filter(c => c.ca.err || c.cb.err).slice(0, 10)) p(`- continuation error ${x.src} i${x.i} ${x.arm}: ${x.ca.err ?? ''} / ${x.cb.err ?? ''}`);

// ---------------------------------------------------------------- the class "beta covers, the branch does not"
const decOf = new Map(D.map(r => [id(r), r]));
p('\n## head by red team S1\'s classes (reported apart, not deciding)\n');
p('| class | sources | pairs | Corp wins arm / base | Corp wins diff | win-adjusted Corp points | raw Corp points | points stolen |');
p('|---|---|---|---|---|---|---|---|');
const CLS = [
  ['branch covers, base not', cv => cv?.head === 'waiting' && cv?.beta !== 'waiting'],
  ['base covers, branch not', cv => cv?.beta === 'waiting' && cv?.head !== 'waiting'],
  ['both cover', cv => cv?.beta === 'waiting' && cv?.head === 'waiting'],
  ['neither', cv => cv?.beta !== 'waiting' && cv?.head !== 'waiting'],
];
for (const [label, sel] of CLS)
  for (const [name, kinds] of [['all', KINDS], ['self', ['self']], ['human', ['humanRunner', 'humanCorp']]]) {
    const c = contsOf('head', kinds).filter(x => sel(decOf.get(id(x))?.covers));
    if (!c.length) continue;
    p(`| ${label} | ${name} | ${c.length} | ${c.filter(x => x.ca.winner === 'corp').length} / ${c.filter(x => x.cb.winner === 'corp').length} | ${cols(c)} |`);
  }
{
  const c = contsOf('head', KINDS).filter(x => CLS[1][1](decOf.get(id(x))?.covers));
  const what = {};
  for (const x of c) {
    const k = /^INSTALL_CARD asset/.test(x.a) ? 'another asset' : /^INSTALL_CARD agenda/.test(x.a) ? 'an agenda' : /^INSTALL_CARD ice/.test(x.a) ? 'ice' : /^INSTALL_CARD upgrade/.test(x.a) ? 'an upgrade' : x.a.split(' ')[0];
    what[k] = (what[k] ?? 0) + 1;
  }
  p(`\n"Base covers, branch not": ${c.length} pairs; what the branch played instead: ${Object.entries(what).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  p('\nThe five largest losses (win-adjusted Corp points, branch − base):\n');
  for (const x of [...c].sort((a, b) => wadj(a.ca) - wadj(a.cb) - (wadj(b.ca) - wadj(b.cb))).slice(0, 5)) {
    const r = decOf.get(id(x));
    const assets = (r?.m?.c ?? []).filter(cv => cv.form === 'waiting').map(cv => `${cv.title} (installed T${x.ca.installed?.[cv.card] ?? '-'} on the branch, T${x.cb.installed?.[cv.card] ?? '-'} on the base)`);
    p(`- ${x.src} i${x.i} T${x.T} (${x.sk}): base ${x.b} | branch ${x.a}; Corp ${x.ca.cs}-${x.ca.rs} (${x.ca.winner}) against ${x.cb.cs}-${x.cb.rs} (${x.cb.winner}); win-adjusted ${wadj(x.ca) - wadj(x.cb)}; the cover asset: ${assets.join('; ') || '-'}`);
  }
}

// ---------------------------------------------------------------- time
p('\n## Time against control (the decision\'s whole ask, ms)\n');
p('| arm | kind | mean ratio | p95 ratio | decisions over 2x control at 0.5 s or more |');
p('|---|---|---|---|---|');
for (const arm of ['c1', 'c2', 'head', 'beta'])
  for (const [name, kinds] of [['self', ['self']], ['human', ['humanRunner', 'humanCorp']]]) {
    const d = D.filter(r => kinds.includes(r.sk) && r.ms);
    const a = d.map(r => r.ms[ASKED.indexOf(arm)]);
    const c = d.map(r => r.ms[ASKED.indexOf('control')]);
    const over = d.filter(r => r.ms[ASKED.indexOf(arm)] >= 500 && r.ms[ASKED.indexOf(arm)] > 2 * r.ms[ASKED.indexOf('control')]);
    p(`| ${arm} | ${name} | ${f3(sum(a) / sum(c))} | ${f3(pct(a, 0.95) / pct(c, 0.95))} | ${over.length} |`);
  }
