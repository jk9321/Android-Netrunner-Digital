#!/usr/bin/env node
/**
 * Sums the build's reading (rez-build.ts, the count's driver on the built commits): node scripts/review-fixes/rez-build-sum.mjs <dir of
 * shard .txt files> [--md out.md]. Reads the count's row kinds (g, h, d, c, s; rez-count.ts). Reports, against the brief's "Judged
 * by": the sources and the stops (control unlike beta, errors, deals unlike the record); each built arm's changed decisions, each in
 * its class or listed outside it: A (builtA) a rez window at the approach to the server where LEO is legal and leoGain is not above
 * 0 (-Infinity, which JSON writes as null, counted apart); B (builtB, a decision builtA did not change the same way) a board with
 * agendasUnseen 0 (the beta tree's measure on the deciding Corp's view). The R&D fires (rdOut, the deciding call :top or a look-ahead
 * :look). Time against control (mean and p95 of the per-decision ms, all and by source kind; decisions over 2x control at 0.5 s or
 * more). The continuation pairs of the changed decisions (arm first against beta's).
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
const meta = rows.find(r => r.kind === 'meta');
const asked = meta?.asked ?? ['beta', 'control', 'builtA', 'builtB'];
const ix = Object.fromEntries(asked.map((a, i) => [a, i]));
const ARMS = asked.slice(2);
const out = [];
const say = (s = '') => out.push(s);

// ------------------------------------------------------------------------------------------------ sources, stops
const g = rows.filter(r => r.kind === 'g');
const h = rows.filter(r => r.kind === 'h');
const d = rows.filter(r => r.kind === 'd');
const kinds = ['self', 'humanRunner', 'humanCorp'];
say(`# Bundle R build reading`);
say();
say(`Rows from ${files.length} files. Asked: ${asked.join(', ')}.`);
say();
say(`| | count |`);
say(`|---|---|`);
say(`| deals (match the record) | ${g.filter(x => x.matchesBatch).length} of ${g.length} |`);
say(`| human files | ${h.length} (${h.filter(x => x.sk === 'humanRunner').length} human Runner, ${h.filter(x => x.sk === 'humanCorp').length} human Corp; stopped early ${h.filter(x => x.stopped).length}) |`);
say(`| Corp decisions asked | ${d.length} (${kinds.map(k => `${k} ${d.filter(x => x.sk === k).length}`).join(', ')}) |`);
say(`| control unlike beta / measure unlike beta / errors | ${d.filter(x => x.controlDiffers).length} / ${d.filter(x => x.measureDiffers).length} / ${d.filter(x => x.errors).length} |`);
say(`| fresh beta unlike the source game's move (self) | ${d.filter(x => x.sk === 'self' && x.fresh === false).length} |`);
say();

// ------------------------------------------------------------------------------------------------ the classes
const leoWin = x => x.c === 'corpRez' && x.m?.phase === 'approach_server' && x.m?.leo;
const leoNo = x => leoWin(x) && (x.m.leoGain === null || x.m.leoGain <= 0);
const leoInf = x => leoWin(x) && x.m.leoGain === null;
const unseen = x => (x.c === 'corpRez' ? x.m?.unseen : x.bb?.unseen);
say(`## Windows`);
say();
say(`| | ${kinds.join(' | ')} |`);
say(`|---|${kinds.map(() => '---').join('|')}|`);
const per = f => kinds.map(k => d.filter(x => x.sk === k && f(x)).length).join(' | ');
say(`| approach-server windows | ${per(x => x.c === 'corpRez' && x.m?.phase === 'approach_server')} |`);
say(`| LEO legal | ${per(leoWin)} |`);
say(`| LEO legal, leoGain not above 0 (class A) | ${per(leoNo)} |`);
say(`| of them leoGain -Infinity | ${per(leoInf)} |`);
say(`| ... and another stopper legal | ${per(x => leoNo(x) && (x.m.stoppers ?? []).length > 0)} |`);
say(`| decisions with agendasUnseen 0 (class B) | ${per(x => unseen(x) === 0)} |`);
say(`| ... with R&D's money kept above 0 (beta) | ${per(x => unseen(x) === 0 && ((x.c === 'corpRez' ? x.m?.b?.rd : x.bb?.rd) ?? 0) > 0)} |`);
say();

say(`## Changed decisions`);
say();
const outside = [];
for (const arm of ARMS) {
  const ch = d.filter(x => x.changed?.[arm] !== undefined);
  const inA = ch.filter(leoNo);
  let inB = [];
  let viaA = [];
  if (arm === 'builtB') {
    viaA = ch.filter(x => x.changed?.builtA === x.changed.builtB);
    inB = ch.filter(x => !viaA.includes(x) && unseen(x) === 0);
  }
  const rest = ch.filter(x => !inA.includes(x) && !inB.includes(x) && !viaA.includes(x));
  for (const x of rest) outside.push({ arm, x });
  say(`**${arm}**: ${ch.length} changed (${kinds.map(k => `${k} ${ch.filter(x => x.sk === k).length}`).join(', ')}); class A ${inA.length} (leoGain -Infinity ${inA.filter(leoInf).length})${arm === 'builtB' ? `; the same as builtA's ${viaA.length}; class B ${inB.length}` : ''}; outside every class ${rest.length}.`);
  say();
  for (const x of ch)
    say(`- ${x.src} T${x.T} ${x.c}${x.run !== undefined && x.run !== null ? ` run ${x.run}` : ''}: beta ${x.beta}, ${arm} ${x.changed[arm]}; ${leoNo(x) ? `A (LEO legal, leoGain ${x.m.leoGain ?? '-Infinity'})` : unseen(x) === 0 ? `B (unseen 0; R&D kept ${x.c === 'corpRez' ? x.m?.b?.rd : x.bb?.rd} -> ${x.bbArm?.rd ?? null}, keep ${x.c === 'corpRez' ? x.m?.b?.keep : x.bb?.keep} -> ${x.bbArm?.keep ?? '?'})` : `unseen ${unseen(x)}`}`);
  if (ch.length) say();
}
say(`**Outside every class (a stop by the brief): ${outside.length}.**`);
for (const { arm, x } of outside) say(`- ${arm} ${x.src} T${x.T} ${x.c}: ${JSON.stringify({ beta: x.beta, arm: x.changed[arm], m: x.m ?? null, bb: x.bb ?? null })}`);
say();

// ------------------------------------------------------------------------------------------------ fires
say(`## Fires (sum over the asks of each arm)`);
say();
const fires = {};
for (const x of d)
  for (const [i, f] of (x.fire ?? []).entries())
    for (const [k, n] of Object.entries(f)) {
      if (!/^(rdOut|leoFall)/.test(k)) continue;
      const key = `${asked[i]} ${k}`;
      fires[key] = (fires[key] ?? 0) + n;
    }
for (const [k, n] of Object.entries(fires).sort()) say(`- ${k}: ${n}`);
say(`- decisions with an rdOut fire in builtB: ${d.filter(x => Object.keys(x.fire?.[ix.builtB] ?? {}).some(k => k.startsWith('rdOut'))).length} (top ${d.filter(x => (x.fire?.[ix.builtB] ?? {})['rdOut:top']).length})`);
say();

// ------------------------------------------------------------------------------------------------ time
say(`## Time against control`);
say();
const q = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
const mean = a => a.reduce((n, v) => n + v, 0) / (a.length || 1);
say(`| arm, sources | n | mean arm / control | p95 arm / control | over 2x control at >= 0.5 s |`);
say(`|---|---|---|---|---|`);
for (const arm of ['beta', ...ARMS])
  for (const k of ['all', ...kinds]) {
    const xs = d.filter(x => (k === 'all' || x.sk === k) && Array.isArray(x.ms));
    const c = xs.map(x => x.ms[ix.control]);
    const a = xs.map(x => x.ms[ix[arm]]);
    const over = xs.filter(x => x.ms[ix[arm]] >= 500 && x.ms[ix[arm]] > 2 * x.ms[ix.control]);
    say(`| ${arm}, ${k} | ${xs.length} | ${(mean(a) / mean(c)).toFixed(3)} | ${(q(a, 0.95) / q(c, 0.95)).toFixed(3)} | ${over.length}${over.length ? ` (${over.slice(0, 5).map(x => `${x.src} T${x.T} ${x.c} ${x.ms[ix[arm]]} v ${x.ms[ix.control]}`).join('; ')})` : ''} |`);
  }
say();

// ------------------------------------------------------------------------------------------------ pairs
say(`## Continuation pairs (arm's action first, against beta's; beta's agents both sides to the end)`);
say();
const c = rows.filter(r => r.kind === 'c');
for (const arm of ARMS) {
  const xs = c.filter(x => x.arm === arm);
  for (const x of xs) say(`- ${arm} ${x.src} T${x.T}: arm ${x.a} -> ${x.ca.winner} ${x.ca.cs}-${x.ca.rs} T${x.ca.T}; beta ${x.b} -> ${x.cb.winner} ${x.cb.cs}-${x.cb.rs} T${x.cb.T}${x.ca.err || x.cb.err ? ` (err ${x.ca.err ?? ''} ${x.cb.err ?? ''})` : ''}`);
  if (!xs.length) say(`- ${arm}: none`);
}
const text = out.join('\n') + '\n';
if (mdAt >= 0) writeFileSync(args[mdAt + 1], text);
process.stdout.write(text);
