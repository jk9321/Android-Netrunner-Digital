// ai-hr-install-steps count (spec-ruling.md sections 5, 7, 7b): sums the shards of scripts/hr-install-steps/hq-count.ts.
//   node scripts/hr-install-steps/hq-sum.mjs <dir with the shards' .txt files> [--list <file for the changed-decision list>]
// Lines in the bar's order: (0) control and sources, (1) fires by card and part, (2) outside the class, (3) pairs on all
// changed answers and by part (P = hqP vs beta, S = hqPS vs hqP at the same decisions, O = hqO vs beta), Mercia alone,
// (4) time against control, (5) steals (bar (e) widened, H1), (f) credits under keep at the Runner's turn.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const li = process.argv.indexOf('--list');
const LIST = li > 0 ? process.argv[li + 1] : null;
const files = d => readdirSync(d).flatMap(f => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : f.endsWith('.txt') ? [join(d, f)] : []));
const rows = [];
for (const f of files(dir))
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* a cut line */
    }
  }
const ASKED = ['beta', 'control', 'hq', 'hqPS', 'hqP', 'hqO'];
const ARMS = ['hq', 'hqPS', 'hqP', 'hqO'];
const KINDS = ['self', 'humanRunner', 'humanCorp'];
const ix = t => ASKED.indexOf(t);
const by = (xs, f) => xs.reduce((m, x) => ((m[f(x)] ??= []).push(x), m), {});
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const se = xs => (xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean(xs)) ** 2, 0) / (xs.length - 1) / xs.length) : NaN);
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '-');
const f3 = x => (Number.isFinite(x) ? x.toFixed(3) : '-');
const ms = xs => `${f2(mean(xs))} ± ${f2(se(xs))} (${f2(mean(xs) / se(xs))} SE)`;
const pct = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};
const pkey = q => (q ? `${q.card ?? q.kind}:${q.step ?? ''}` : '-');
const p = (...a) => console.log(...a);

const g = rows.filter(r => r.kind === 'g');
const h = rows.filter(r => r.kind === 'h');
const d = rows.filter(r => r.kind === 'd');
const c = rows.filter(r => r.kind === 'c');
const games = { self: g.length, humanRunner: h.filter(x => x.sk === 'humanRunner').length, humanCorp: h.filter(x => x.sk === 'humanCorp').length };
const deckOf = Object.fromEntries(g.map(x => [x.src, x.decks.split(' v ')[0]]));
const deck = x => x.deck ?? deckOf[x.src] ?? '?';
const MERCIA = q => /Mercia/.test(q?.card ?? '');

p('## (0) Control and sources');
p(`deals ${g.length}, matching the g1 record ${g.filter(x => x.matchesBatch).length}; human files ${h.length} (humanRunner ${games.humanRunner}, humanCorp ${games.humanCorp}), stopped ${h.filter(x => x.stopped).length}`);
for (const x of g.filter(x => !x.matchesBatch)) p(`  NO MATCH ${x.src}`);
for (const x of h.filter(x => x.stopped)) p(`  stopped ${x.src}: ${x.stopped}`);
p(`decisions ${d.length}: ${KINDS.map(k => `${k} ${d.filter(x => x.sk === k).length}`).join(', ')}`);
p(`control unlike beta: ${d.filter(x => x.controlDiffers).length}; ask errors: ${d.filter(x => x.errors).length}${d.filter(x => x.errors).length ? ` (${[...new Set(d.filter(x => x.errors).flatMap(x => Object.entries(x.errors).map(([a, e]) => `${a}: ${e.slice(0, 60)}`)))].slice(0, 5).join('; ')})` : ''}`);
p(`continuation errors: ${c.filter(x => x.ca.err || x.cb.err).length}${c.some(x => x.ca.err || x.cb.err) ? ` (${Object.entries(by(c.filter(x => x.ca.err || x.cb.err), x => `${x.arm}: ${(x.ca.err ?? x.cb.err).slice(0, 40)}`)).map(([k, v]) => `${k} ${v.length}`).join('; ')})` : ''}`);

p('\n## (1) Fires: changed Corp answers through Q0a, by card and step');
p('| arm | kind | games | changed | a game | by card/step |');
p('| --- | --- | --- | --- | --- | --- |');
for (const arm of ARMS)
  for (const kind of KINDS) {
    const xs = d.filter(x => x.sk === kind && x.changed?.[arm] && x.hq?.includes(arm));
    if (!games[kind]) continue;
    p(`| ${arm} | ${kind} | ${games[kind]} | ${xs.length} | ${f3(xs.length / games[kind])} | ${Object.entries(by(xs, x => pkey(x.p))).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k} ${v.length}`).join(', ') || '-'} |`);
  }
p('\nQ0a answers equal to beta\'s (fired, not changed), hq arm: ' + (d.filter(x => x.hq?.includes('hq') && !x.changed?.hq).length));

p('\n## (2) Outside the class (a changed decision with no Q0a answer): must be 0');
for (const arm of ARMS) {
  const xs = d.filter(x => x.outside?.includes(arm));
  p(`- ${arm}: ${xs.length}`);
  for (const x of xs.slice(0, 20)) p(`    ${x.src} #${x.i} T${x.T} [${x.sk}] ${x.side} ${x.c} ${pkey(x.p)}: ${x.beta} -> ${x.changed?.[arm]}`);
}
p(`Runner decisions changed: ${ARMS.map(a => `${a} ${d.filter(x => x.side === 'runner' && x.changed?.[a]).length}`).join(', ')}`);

p('\n## (3) Pairs (a = the arm\'s answer, its line on its own tree; b = beta\'s)');
const adj = r => (r.winner === 'corp' ? Math.max(r.cs, 7) : r.cs);
const ok = x => !x.ca.err && !x.cb.err;
const diffs = xs => xs.map(x => ({ win: (x.ca.winner === 'corp' ? 1 : 0) - (x.cb.winner === 'corp' ? 1 : 0), adj: adj(x.ca) - adj(x.cb), st2: x.ca.rs2 - x.cb.rs2 }));
const head = () => {
  p('| set | pairs | Corp wins a / b | win a-b ± SE | win-adjusted Corp points a-b ± SE | stolen within two turn pairs a-b ± SE |');
  p('| --- | --- | --- | --- | --- | --- |');
};
const pairRow = (name, xs) => {
  const v = diffs(xs);
  p(`| ${name}${xs.length < 30 ? ' (under 30: not shown either way)' : ''} | ${xs.length} | ${xs.filter(x => x.ca.winner === 'corp').length} / ${xs.filter(x => x.cb.winner === 'corp').length} | ${ms(v.map(y => y.win))} | ${ms(v.map(y => y.adj))} | ${ms(v.map(y => y.st2))} |`);
};
const pairsOf = arm => c.filter(x => x.arm === arm && x.side === 'corp' && ok(x));
head();
for (const arm of ARMS) {
  const xs = pairsOf(arm);
  pairRow(`${arm} vs beta, all`, xs);
  for (const kind of KINDS) if (xs.some(x => x.sk === kind)) pairRow(`${arm} vs beta, ${kind}`, xs.filter(x => x.sk === kind));
  const m = xs.filter(x => MERCIA(x.p));
  if (m.length) pairRow(`${arm} vs beta, Mercia`, m);
}
// Part S: hqPS against hqP at the same decisions (the same pick; S's server against the fallback's)
const keyOf = x => `${x.src}#${x.i}`;
const hqP = new Map(pairsOf('hqP').map(x => [keyOf(x), x]));
const sPairs = pairsOf('hqPS')
  .filter(x => hqP.has(keyOf(x)) && hqP.get(keyOf(x)).a === x.a)
  .map(x => ({ ...x, cb: hqP.get(keyOf(x)).ca }));
p('\nPart S (hqPS against hqP at the same pick; spec-ruling.md 7b), read first:');
head();
pairRow('S: hqPS vs hqP', sPairs);
pairRow('S: hqPS vs hqP, lines that differ', sPairs.filter(x => x.ca.cs !== x.cb.cs || x.ca.rs !== x.cb.rs || x.ca.winner !== x.cb.winner || x.ca.T !== x.cb.T));
p('Part P: hqP vs beta and part O: hqO vs beta are the rows above.');
p('\nBy Corp deck (hq vs beta):');
head();
for (const [k, xs] of Object.entries(by(pairsOf('hq'), deck)).sort()) pairRow(k, xs);

p('\n## (4) Time against control (self-play: sum of the tree over sum of control; p95 of the per-decision ratio)');
p('| tree | kind | decisions | mean | p95 | over 2x at control >= 0.5 s |');
p('| --- | --- | --- | --- | --- | --- |');
for (const arm of ['beta', ...ARMS])
  for (const kind of KINDS) {
    const xs = d.filter(x => x.sk === kind);
    if (!xs.length) continue;
    const a = xs.reduce((s, x) => s + x.ms[ix(arm)], 0);
    const k = xs.reduce((s, x) => s + x.ms[ix('control')], 0);
    const per = xs.filter(x => x.ms[ix('control')] > 0).map(x => x.ms[ix(arm)] / x.ms[ix('control')]);
    p(`| ${arm} | ${kind} | ${xs.length} | ${f3(a / k)} | ${f3(pct(per, 0.95))} | ${xs.filter(x => x.ms[ix('control')] >= 500 && x.ms[ix(arm)] > 2 * x.ms[ix('control')]).length} |`);
  }
p('\nBy Corp deck (self-play; mean ratio to control):');
p(`| Corp deck | decisions | ${['beta', ...ARMS].join(' | ')} |`);
p(`| --- | --- | ${['beta', ...ARMS].map(() => '---').join(' | ')} |`);
for (const [k, xs] of Object.entries(by(d.filter(x => x.sk === 'self'), deck)).sort()) {
  const ctl = xs.reduce((s, x) => s + x.ms[ix('control')], 0);
  p(`| ${k} | ${xs.length} | ${['beta', ...ARMS].map(a => f3(xs.reduce((s, x) => s + x.ms[ix(a)], 0) / ctl)).join(' | ')} |`);
}

p('\n## (5) Steals (bar (e), widened: any agenda stolen within two turn pairs on the arm\'s line and not on beta\'s)');
for (const arm of ARMS) {
  const xs = pairsOf(arm).filter(x => x.ca.rs2 > x.cb.rs2);
  p(`- ${arm}: ${xs.length} (against ${pairsOf(arm).filter(x => x.ca.rs2 < x.cb.rs2).length} the other way)`);
  for (const x of xs) p(`    ${x.src} #${x.i} T${x.T} [${x.sk}, ${deck(x)}] ${pkey(x.p)}: a ${x.a} (Runner +${x.ca.rs2 - x.rs0} by T+2) | b ${x.b} (+${x.cb.rs2 - x.rs0})`);
}
p('S (hqPS vs hqP):');
for (const x of sPairs.filter(x => x.ca.rs2 > x.cb.rs2)) p(`    ${x.src} #${x.i} T${x.T} [${x.sk}, ${deck(x)}] ${pkey(x.p)}: Runner +${x.ca.rs2 - x.rs0} by T+2 against +${x.cb.rs2 - x.rs0}`);

p('\n## (f) The Corp under rezMoney.keep at the Runner\'s turn after the answer, on the arm\'s line and not on beta\'s: must be 0');
const under = r => !!r.runnerStart && r.runnerStart.cr < r.runnerStart.keep;
for (const arm of ARMS) {
  const xs = pairsOf(arm).filter(x => under(x.ca) && !under(x.cb));
  const seen = pairsOf(arm).filter(x => x.ca.runnerStart).length;
  p(`- ${arm}: ${xs.length} of ${seen} pairs with a Runner's turn read`);
  for (const x of xs) p(`    ${x.src} #${x.i} T${x.T} [${x.sk}, ${deck(x)}] ${pkey(x.p)}: a ${x.ca.runnerStart.cr} cr, keep ${x.ca.runnerStart.keep} | b ${x.cb.runnerStart?.cr} cr, keep ${x.cb.runnerStart?.keep}`);
}
{
  const xs = sPairs.filter(x => under(x.ca) && !under(x.cb));
  p(`- S (hqPS vs hqP): ${xs.length}`);
}

if (LIST) {
  const out = ['# Every changed decision (a = the arm, b = beta)\n'];
  const pairs = new Map(c.map(x => [`${x.src}#${x.i}:${x.arm}`, x]));
  for (const arm of ARMS) {
    out.push(`\n## ${arm}\n`);
    for (const x of d.filter(y => y.changed?.[arm])) {
      const q = pairs.get(`${x.src}#${x.i}:${arm}`);
      const pair = q ? ` | a ${q.ca.winner ?? '-'} ${q.ca.cs}-${q.ca.rs} (T+2 ${q.ca.cs2}-${q.ca.rs2}${q.ca.runnerStart ? `; Runner's turn ${q.ca.runnerStart.cr} cr keep ${q.ca.runnerStart.keep}` : ''}) b ${q.cb.winner ?? '-'} ${q.cb.cs}-${q.cb.rs} (T+2 ${q.cb.cs2}-${q.cb.rs2})${q.ca.err || q.cb.err ? ` ERR ${q.ca.err ?? q.cb.err}` : ''}` : '';
      out.push(`- ${x.src} #${x.i} T${x.T} [${x.sk}, ${deck(x)}] ${x.c} ${pkey(x.p)}${x.hq?.includes(arm) ? '' : ' (NO Q0a)'}: b ${x.beta} -> a ${x.changed[arm]}${pair}`);
    }
  }
  writeFileSync(LIST, out.join('\n') + '\n');
}
