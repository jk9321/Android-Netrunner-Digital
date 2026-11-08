#!/usr/bin/env node
// Read-only helper for the code-audit skill. Never writes into the repo.
//
//   node .claude/skills/code-audit/metrics.mjs snapshot [--out file.json]
//       Mechanical drift signals for the checked-out branch: sizes, largest files and
//       functions, escape hatches (any / ts-ignore / eslint-disable / empty catch),
//       card codes named outside card files, plan switches, beta-only leaks into main.
//       Save the JSON next to the audit report so the next audit can diff it.
//
//   node .claude/skills/code-audit/metrics.mjs diff old.json new.json
//       What moved between two snapshots.
//
//   node .claude/skills/code-audit/metrics.mjs verify report.md
//       Checks every `path:line` the report cites exists, and prints every card code it
//       names with its real title, so a wrong or invented code is caught before posting.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const read = p => readFileSync(path.join(ROOT, p), 'utf8');

function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = path.join(abs, name);
    if (statSync(p).isDirectory()) walk(rel(p), out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(rel(p));
  }
  return out;
}

function cardTitles() {
  const titles = {};
  for (const f of readdirSync(path.join(ROOT, 'src/data')).filter(f => f.endsWith('-cards.json'))) {
    for (const c of JSON.parse(read(`src/data/${f}`))) titles[c.code] = `${c.title} (${f.replace('-cards.json', '')})`;
  }
  return titles;
}

/** Top-level functions (incl. exported/async/arrow consts) and their line spans; assumes the repo's style of closing at column 0. */
function functionSpans(file, text) {
  const lines = text.split('\n');
  const spans = [];
  const start = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*(\w+)|const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>)/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(start);
    if (!m) continue;
    if (/;\s*$/.test(lines[i])) continue; // one-liner
    let j = i + 1;
    // The body ends at the first column-0 close; any other column-0 code means it was not a block body.
    while (j < lines.length && !/^[})]/.test(lines[j]) && !/^(?![*/\s])\S/.test(lines[j])) j++;
    if (j < lines.length && /^[})]/.test(lines[j])) spans.push({ fn: `${file}:${i + 1} ${m[1] ?? m[2]}`, lines: j - i + 1 });
  }
  return spans;
}

/** Source with comments blanked (line-based; good enough for counting identifiers). */
const codeOnly = text => text.replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');

function count(files, re) {
  const hits = [];
  for (const f of files) {
    read(f).split('\n').forEach((line, i) => { if (re.test(line)) hits.push(`${f}:${i + 1}`); });
  }
  return hits;
}

function snapshot() {
  const git = args => { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
  const areas = ['src/core', 'src/ai', 'src/ui', 'src/data', 'src/beta', 'worker', 'scripts', 'tests', 'e2e'];
  const files = areas.flatMap(a => walk(a));
  const src = files.filter(f => f.startsWith('src/') || f.startsWith('worker/'));
  const lineCount = f => read(f).split('\n').length;
  const titles = cardTitles();

  const byArea = Object.fromEntries(areas.map(a => {
    const fs = files.filter(f => f.startsWith(a + '/'));
    return [a, { files: fs.length, lines: fs.reduce((s, f) => s + lineCount(f), 0) }];
  }));

  const spans = src.flatMap(f => functionSpans(f, read(f))).sort((a, b) => b.lines - a.lines);

  // Card codes named in code. Engine and shared AI files should be generic: card logic lives in
  // src/core/scripts/* (engine) and src/ai/cards/* (AI), so codes elsewhere are special cases.
  const codeHits = {};
  const unknownCodes = [];
  for (const f of src) {
    for (const m of read(f).matchAll(/['"`](3\d{4})['"`]/g)) {
      (codeHits[f] ??= new Set()).add(m[1]);
      if (!titles[m[1]]) unknownCodes.push(`${f}: ${m[1]}`);
    }
  }
  const generic = f => !/^src\/(core\/scripts|ai\/cards|data)\//.test(f);
  const specialCases = Object.entries(codeHits)
    .filter(([f]) => generic(f))
    .map(([f, s]) => ({ file: f, codes: s.size }))
    .sort((a, b) => b.codes - a.codes);

  // Plan switches (beta): every plan.<name> read in src/ai, and folded names still read.
  let plan = null;
  if (existsSync(path.join(ROOT, 'src/ai/synergy.ts'))) {
    const syn = read('src/ai/synergy.ts');
    const folded = [...(syn.match(/FOLDED[^=]*=\s*\[([\s\S]*?)\];/)?.[1] ?? '').matchAll(/'(\w+)'/g)].map(m => m[1]);
    const reads = {};
    for (const f of walk('src/ai')) for (const m of codeOnly(read(f)).matchAll(/\bplan(?:\(\))?\??\.(\w+)/g)) reads[m[1]] = (reads[m[1]] ?? 0) + 1;
    // Some switches are read by name (plan()[piece]); count quoted names outside synergy.ts's own lists too.
    const quoted = walk('src/ai').filter(f => f !== 'src/ai/synergy.ts').map(f => codeOnly(read(f))).join('\n');
    // Keys of the `plan: {` block in tuning (one indent deeper than `plan:`).
    const block = syn.match(/^(\s*)plan: \{\n([\s\S]*?)^\1\},/m);
    const defined = block ? [...block[2].matchAll(new RegExp(`^${block[1]}  (\\w+):`, 'gm'))].map(m => m[1]) : [];
    plan = {
      defined: defined.length,
      definedNeverRead: defined.filter(n => !reads[n] && !quoted.includes(`'${n}'`)),
      switchesRead: Object.keys(reads).length,
      foldedCount: folded.length,
      foldedStillRead: folded.filter(n => reads[n]),
      readOnce: Object.entries(reads).filter(([, n]) => n === 1).map(([k]) => k),
    };
  }

  // Beta-only code reachable from main: test decks and src/beta must only load behind the build flags.
  const betaImports = count(src.filter(f => !f.startsWith('src/data/testDecks/') && !f.startsWith('src/beta/')), /from ['"][^'"]*(testDecks|\/beta\/)/)
    .filter(hit => !hit.startsWith('src/data/decks.ts') && !hit.startsWith('src/ui/components/DeckPicker.tsx'));

  return {
    taken: new Date().toISOString(),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit: git(['rev-parse', 'HEAD']),
    byArea,
    largestFiles: src.map(f => ({ file: f, lines: lineCount(f) })).sort((a, b) => b.lines - a.lines).slice(0, 15),
    largestFunctions: spans.slice(0, 20),
    functionsOver150: spans.filter(s => s.lines > 150).length,
    escapeHatches: {
      any: count(src, /(:\s*any\b|as any\b|<any>)/).length,
      tsIgnore: count(src, /@ts-(ignore|expect-error|nocheck)/),
      eslintDisable: count(src, /eslint-disable/),
      emptyCatch: count(src, /catch\s*(\([^)]*\))?\s*\{\s*\}/),
      todo: count(src, /\b(TODO|FIXME|HACK|XXX)\b/),
    },
    cardCodeSpecialCases: specialCases,
    unknownCardCodes: unknownCodes,
    plan,
    betaImportsOutsideFlags: betaImports,
    tests: { files: walk('tests').filter(f => /\.test\.tsx?$/.test(f)).length, skipped: count(walk('tests'), /\b(it|describe|test)\.(skip|todo)\b|\bxit\(/) },
  };
}

function diff(a, b) {
  const out = [`${a.branch}@${a.commit.slice(0, 7)} (${a.taken.slice(0, 10)}) -> ${b.branch}@${b.commit.slice(0, 7)} (${b.taken.slice(0, 10)})`];
  for (const k of Object.keys(b.byArea)) {
    const o = a.byArea[k] ?? { lines: 0 }, n = b.byArea[k];
    if (o.lines !== n.lines) out.push(`lines ${k}: ${o.lines} -> ${n.lines} (${n.lines - o.lines >= 0 ? '+' : ''}${n.lines - o.lines})`);
  }
  const num = (label, x, y) => { if (x !== y) out.push(`${label}: ${x} -> ${y}`); };
  num('functions over 150 lines', a.functionsOver150, b.functionsOver150);
  num('any', a.escapeHatches.any, b.escapeHatches.any);
  for (const k of ['tsIgnore', 'eslintDisable', 'emptyCatch', 'todo']) num(k, a.escapeHatches[k].length, b.escapeHatches[k].length);
  const codes = s => Object.fromEntries(s.cardCodeSpecialCases.map(x => [x.file, x.codes]));
  const ca = codes(a), cb = codes(b);
  for (const f of new Set([...Object.keys(ca), ...Object.keys(cb)])) num(`card codes in ${f}`, ca[f] ?? 0, cb[f] ?? 0);
  if (a.plan && b.plan) num('plan switches read', a.plan.switchesRead, b.plan.switchesRead);
  num('skipped tests', a.tests.skipped.length, b.tests.skipped.length);
  return out.join('\n');
}

function verify(reportPath) {
  const text = readFileSync(reportPath, 'utf8');
  const titles = cardTitles();
  const problems = [];
  const refs = new Set(text.match(/\b(?:src|tests|scripts|worker|e2e|\.github|\.claude)\/[\w./-]+\.\w+:\d+(?:-\d+)?/g) ?? []);
  for (const ref of refs) {
    const [file, range] = ref.split(':');
    const last = Number(range.split('-').pop());
    const abs = path.join(ROOT, file);
    if (!existsSync(abs)) problems.push(`missing file: ${ref}`);
    else if (last > readFileSync(abs, 'utf8').split('\n').length) problems.push(`line past end of file: ${ref}`);
  }
  console.log(`${refs.size} file:line references checked`);
  const codes = [...new Set(text.match(/\b3\d{4}\b/g) ?? [])].sort();
  for (const c of codes) {
    if (titles[c]) console.log(`  ${c} = ${titles[c]}`);
    else problems.push(`card code not in src/data/*-cards.json: ${c}`);
  }
  console.log(problems.length ? `PROBLEMS:\n  ${problems.join('\n  ')}` : 'all references resolve; check each code above names the card the report means');
  process.exitCode = problems.length ? 1 : 0;
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'snapshot') {
  const json = JSON.stringify(snapshot(), null, 2);
  const out = rest[rest.indexOf('--out') + 1];
  if (rest.includes('--out') && out) writeFileSync(out, json + '\n');
  console.log(json);
} else if (cmd === 'diff' && rest.length === 2) {
  console.log(diff(JSON.parse(readFileSync(rest[0], 'utf8')), JSON.parse(readFileSync(rest[1], 'utf8'))));
} else if (cmd === 'verify' && rest.length === 1) {
  verify(rest[0]);
} else {
  console.error('usage: metrics.mjs snapshot [--out f.json] | diff old.json new.json | verify report.md');
  process.exitCode = 2;
}
