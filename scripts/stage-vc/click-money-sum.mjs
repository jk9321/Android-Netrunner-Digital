#!/usr/bin/env node
/**
 * Sums the count's reading of Friend of a Friend's click money (click-money.ts): node scripts/stage-vc/click-money-sum.mjs
 * <dir of shard .txt files> [--md out.md]. Reports, against the brief's "Measurement" (stage-vc/checkpoint/foaf-fix/
 * brief.md rev 1): the sources and the stops (control unlike beta, errors, deals unlike the record); the class size first
 * (decisions with Friend of a Friend installed, by source kind and side; decisions where the branch read the card);
 * every changed decision with its class (board, look) and the ones outside it (a stop); the tagged boards (9 against 5:
 * each server's hold answer split by direction, keep and reservedForAgenda beside it, the exact arm's pick); time
 * against control; the pairs (Corp wins, win-adjusted Corp points, raw Corp points, points stolen; branch − beta).
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dir = args[0];
const mdAt = args.indexOf('--md');
const files = [];
const walk = d => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(txt|jsonl)$/.test(f)) files.push(p);
  }
};
walk(dir);
const rows = [];
for (const f of files)
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* not a row */
    }
  }
const out = [];
const p = (s = '') => out.push(s);
const g = rows.filter(r => r.kind === 'g');
const h = rows.filter(r => r.kind === 'h');
const d = rows.filter(r => r.kind === 'd');
const c = rows.filter(r => r.kind === 'c');
const kinds = ['self', 'foafExtra', 'humanRunner', 'humanCorp'];
const per = f => kinds.map(k => d.filter(x => x.sk === k && f(x)).length).join(' | ');

p('# Friend of a Friend click money: the count\'s reading on the built tree');
p();
p(`Rows from ${files.length} files.`);
p();
p('| | count |');
p('|---|---|');
p(`| deals of the g1 base (match the record 44680798149) | ${g.filter(x => x.sk === 'self' && x.matchesRecord).length} of ${g.filter(x => x.sk === 'self').length} |`);
p(`| foafExtra games | ${g.filter(x => x.sk === 'foafExtra').length} (Friend of a Friend installed in ${g.filter(x => x.sk === 'foafExtra' && x.installedFoaf > 0).length}) |`);
p(`| human files | ${h.length} (${h.filter(x => x.sk === 'humanRunner').length} human Runner, ${h.filter(x => x.sk === 'humanCorp').length} human Corp; stopped early ${h.filter(x => x.stopped).length}; a Friend of a Friend deck ${h.filter(x => x.foafDeck).length}, installed in ${h.filter(x => x.installedFoaf > 0).length}) |`);
p(`| decisions asked | ${d.length} (${kinds.map(k => `${k} ${d.filter(x => x.sk === k).length}`).join(', ')}) |`);
p(`| control unlike beta / errors | ${d.filter(x => x.controlDiffers).length} / ${d.filter(x => x.errors).length} |`);
p();
p('## The class size (stated first, red team M7)');
p();
p(`| | ${kinds.join(' | ')} |`);
p(`|---|${kinds.map(() => '---').join('|')}|`);
p(`| Corp decisions | ${per(x => x.side === 'corp')} |`);
p(`| Corp decisions, Friend of a Friend installed | ${per(x => x.side === 'corp' && x.foaf > 0)} |`);
p(`| ... and the Runner tagged | ${per(x => x.side === 'corp' && x.foaf > 0 && x.tags > 0)} |`);
p(`| Corp decisions, the branch read the card (fire) | ${per(x => x.side === 'corp' && x.fire > 0)} |`);
p(`| ... read only in the look-ahead (not installed on the board) | ${per(x => x.side === 'corp' && x.fire > 0 && !x.foaf)} |`);
p(`| Runner decisions, the branch read the card | ${per(x => x.side === 'runner' && x.fire > 0)} |`);
p();

p('## Changed decisions (branch unlike beta)');
p();
const ch = d.filter(x => x.class);
const outside = ch.filter(x => x.class === 'other');
p(`${ch.length} changed (${kinds.map(k => `${k} ${ch.filter(x => x.sk === k).length}`).join(', ')}): board ${ch.filter(x => x.class === 'board').length}, look ${ch.filter(x => x.class === 'look').length}, outside the class ${outside.length}${outside.length ? ' (A STOP)' : ''}.`);
p();
for (const x of ch) p(`- ${x.src} i${x.i} T${x.T} ${x.side} ${x.c} [${x.class}; installed ${x.foaf}, tags ${x.tags}, fire ${x.fire}]: beta ${x.beta} | branch ${x.branch}`);
if (ch.length) p();

p('## The input on the boards with Friend of a Friend installed (beta 1 a click, branch 9)');
p();
{
  const ins = d.filter(x => x.inputs && !x.inputs.beta.err && !x.inputs.branch.err);
  let sv = 0;
  let unholds = 0;
  let holdsNow = 0;
  const moved = [];
  for (const x of ins) {
    const a = x.inputs.beta;
    const b = x.inputs.branch;
    let m = false;
    for (const id of Object.keys(a.holds)) {
      sv++;
      if (a.holds[id] && !b.holds[id]) (unholds++, (m = true));
      if (!a.holds[id] && b.holds[id]) (holdsNow++, (m = true));
    }
    if (m || a.keep !== b.keep || a.reserved !== b.reserved) moved.push(x);
  }
  p(`${ins.length} Corp decisions measured (errors ${d.filter(x => x.inputs && (x.inputs.beta.err || x.inputs.branch.err)).length}); ${sv} server answers.`);
  p();
  p('| | count |');
  p('|---|---|');
  p(`| a server held on beta, not on the branch | ${unholds} |`);
  p(`| a server held on the branch, not on beta | ${holdsNow} |`);
  p(`| decisions where keep changes | ${ins.filter(x => x.inputs.beta.keep !== x.inputs.branch.keep).length} |`);
  p(`| decisions where reservedForAgenda changes | ${ins.filter(x => x.inputs.beta.reserved !== x.inputs.branch.reserved).length} |`);
  p(`| decisions where any of these moved | ${moved.length} (the pick moved on ${moved.filter(x => x.class).length}) |`);
  p();
  for (const x of moved) {
    const a = x.inputs.beta;
    const b = x.inputs.branch;
    const flips = Object.keys(a.holds).filter(id => a.holds[id] !== b.holds[id]).map(id => `${id} ${a.holds[id] ? 'holds' : 'open'}->${b.holds[id] ? 'holds' : 'open'}`);
    p(`- ${x.src} i${x.i} T${x.T} ${x.c}: ${flips.join(', ') || 'no hold flip'}; keep ${a.keep}->${b.keep}; reserved ${a.reserved}->${b.reserved}; pick ${x.class ? `${x.beta} -> ${x.branch}` : 'same'}`);
  }
  p();
}

p('## Tagged boards (Friend of a Friend installed, Runner tagged, at a Corp decision): 9 against 5');
p();
const tg = d.filter(x => x.tagged);
p(`${tg.length} decisions (${kinds.map(k => `${k} ${tg.filter(x => x.sk === k).length}`).join(', ')}).`);
let at5not9 = 0;
let at9not5 = 0;
let servers = 0;
const keepCh = [];
const resCh = [];
const pick = [];
const errs = [];
for (const x of tg) {
  const a = x.tagged.branch;
  const e = x.tagged.exactM;
  if (a.err || e.err) {
    errs.push(x);
    continue;
  }
  for (const id of Object.keys(a.holds)) {
    servers++;
    if (e.holds[id] && !a.holds[id]) at5not9++;
    if (!e.holds[id] && a.holds[id]) at9not5++;
  }
  if (a.keep !== e.keep || JSON.stringify(a.unholdable) !== JSON.stringify(e.unholdable)) keepCh.push(x);
  if (a.reserved !== e.reserved) resCh.push(x);
  if (x.tagged.exactDiffers) pick.push(x);
}
p();
p('| | count |');
p('|---|---|');
p(`| server answers asked (both ways) | ${servers} |`);
p(`| holds at 5, not at 9 (the flat 9 reads "does not hold") | ${at5not9} |`);
p(`| holds at 9, not at 5 | ${at9not5} |`);
p(`| decisions where keep or the unholdable list changes | ${keepCh.length} |`);
p(`| decisions where reservedForAgenda changes | ${resCh.length} |`);
p(`| decisions where the exact arm's pick differs (the case for an exact number) | ${pick.length} |`);
p(`| measure errors | ${errs.length} |`);
p();
for (const x of [...new Set([...keepCh, ...resCh, ...pick])])
  p(`- ${x.src} i${x.i} T${x.T} ${x.c}: keep ${x.tagged.branch.keep} -> ${x.tagged.exactM.keep}, unholdable ${JSON.stringify(x.tagged.branch.unholdable)} -> ${JSON.stringify(x.tagged.exactM.unholdable)}, reserved ${x.tagged.branch.reserved} -> ${x.tagged.exactM.reserved}; pick branch ${x.branch ?? '(as beta)'} | exact ${x.tagged.exact}`);
for (const x of errs) p(`- ERROR ${x.src} i${x.i}: ${x.tagged.branch.err ?? ''} ${x.tagged.exactM.err ?? ''}`);
p();

p('## Time against control');
p();
const q = (a, f) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : 0;
};
const mean = a => a.reduce((n, v) => n + v, 0) / (a.length || 1);
p('| arm, sources | n | mean arm / control | p95 arm / control |');
p('|---|---|---|---|');
for (const [arm, i] of [['beta', 0], ['branch', 2]])
  for (const k of ['all', ...kinds]) {
    const xs = d.filter(x => (k === 'all' || x.sk === k) && Array.isArray(x.ms));
    if (!xs.length) continue;
    const ctl = xs.map(x => x.ms[1]);
    const a = xs.map(x => x.ms[i]);
    p(`| ${arm}, ${k} | ${xs.length} | ${(mean(a) / mean(ctl)).toFixed(3)} | ${(q(a, 0.95) / q(ctl, 0.95)).toFixed(3)} |`);
  }
p();

p('## Pairs (the branch\'s action first, against beta\'s; beta\'s agents both sides to the end)');
p();
const wadj = x => (x.winner === 'corp' ? Math.max(7, x.cs) : x.cs);
const col = f => {
  const v = c.map(f);
  const m = mean(v);
  const sd = Math.sqrt(v.reduce((n, y) => n + (y - m) ** 2, 0) / Math.max(1, v.length - 1));
  return `${m >= 0 ? '+' : ''}${m.toFixed(3)} ± ${(sd / Math.sqrt(v.length || 1)).toFixed(3)}`;
};
p(`${c.length} pairs (errors ${c.filter(x => x.ca.err || x.cb.err).length}). ${c.length >= 30 ? 'Read against the bar (not worse than beta by more than 2 SE).' : 'Fewer than 30: a sign check only, not a pass (brief M7).'}`);
p();
if (c.length) {
  p('| Corp wins diff | win-adjusted Corp points | raw Corp points | points stolen |');
  p('|---|---|---|---|');
  p(`| ${col(x => (x.ca.winner === 'corp') - (x.cb.winner === 'corp'))} | ${col(x => wadj(x.ca) - wadj(x.cb))} | ${col(x => x.ca.cs - x.cb.cs)} | ${col(x => x.ca.rs - x.cb.rs)} |`);
  p();
  for (const x of c) p(`- ${x.src} i${x.i} T${x.T} [${x.class}] branch ${x.a} -> ${x.ca.winner} ${x.ca.cs}-${x.ca.rs} T${x.ca.T}; beta ${x.b} -> ${x.cb.winner} ${x.cb.cs}-${x.cb.rs} T${x.cb.T}${x.ca.cs < x.cb.cs ? ' (CORP POINTS LOST)' : ''}${x.ca.err || x.cb.err ? ` (err ${x.ca.err ?? ''} ${x.cb.err ?? ''})` : ''}`);
}
const text = out.join('\n') + '\n';
if (mdAt >= 0) writeFileSync(args[mdAt + 1], text);
process.stdout.write(text);
