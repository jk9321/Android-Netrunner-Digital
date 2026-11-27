#!/usr/bin/env node
// Quiet output (Jeff 2026-11-26, to cut token use): the full log goes to a file under .quiet/
// and the agent sees a short summary: failures, everything unusual, and the totals next to the
// last run's. Open the full log only when the summary points at something.
//
//   node scripts/quiet.mjs test [vitest args]                 unit tests (vitest run)
//   node scripts/quiet.mjs batch <run id|file> [--base <run id|file>] [--games N]
//                                                             an ai-batch summary (results/<id>.txt on
//                                                             ai-batch-results); an ai-script run id
//                                                             unpacks scripts/<id>.tar.gz instead
//   node scripts/quiet.mjs run <name> -- <command ...>        any long script or command
//
// Exit code: the wrapped command's (test, run); batch exits 0, or 2 when it could not read the run.
// History of the last run of each kind: .quiet/history.json (local to this container).
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '.quiet';
const SLOW_TEST_MS = 5000; // the same line fast-checks.mjs draws for a slow file
const SLOW_FILE_MS = 15000;
const BIG_CHANGE = 0.5; // run time or line count off the last run by more than half
mkdirSync(DIR, { recursive: true });

const historyFile = join(DIR, 'history.json');
const history = existsSync(historyFile) ? JSON.parse(readFileSync(historyFile, 'utf8')) : {};
const saveHistory = (key, value) => writeFileSync(historyFile, JSON.stringify({ ...history, [key]: { ...value, at: new Date().toISOString() } }, null, 1));

const out = [];
const say = (s = '') => out.push(s);
const flags = []; // anomalies, printed in their own block
const flag = s => flags.push(s);
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const secs = ms => `${(ms / 1000).toFixed(1)}s`;
/** "12 (last 10, +2)" or "12 (no earlier run)"; flags a change bigger than BIG_CHANGE when asked */
function vsLast(label, now, last, { fmt = String, flagIt = false, dropOnly = false } = {}) {
  if (last == null) return `${label} ${fmt(now)}`;
  const diff = now - last;
  const big = last > 0 ? Math.abs(diff) / last > BIG_CHANGE : diff !== 0;
  if (flagIt && (dropOnly ? diff < 0 : big)) flag(`${label} ${fmt(now)}, last run ${fmt(last)}`);
  return `${label} ${fmt(now)} (last ${fmt(last)})`;
}

function runToLog(cmd, args, logFile, env = {}) {
  return new Promise(resolve => {
    const t0 = Date.now();
    writeFileSync(logFile, '');
    const p = spawn(cmd, args, { env: { ...process.env, FORCE_COLOR: '0', ...env }, shell: false });
    const write = d => appendFileSync(logFile, d);
    p.stdout.on('data', write);
    p.stderr.on('data', write);
    p.on('error', e => { write(`\nquiet.mjs: could not start ${cmd}: ${e}\n`); resolve({ code: 127, ms: Date.now() - t0 }); });
    p.on('close', code => resolve({ code: code ?? 1, ms: Date.now() - t0 }));
  });
}

/** Lines that look like trouble, numbers blanked so repeats group, most frequent first. */
function oddLines(text, max = 12) {
  const re = /\b(fail(ed|ure)?|error|warn(ing)?|deprecat\w*|NaN|Infinity|undefined|timed? ?out|crash(ed)?|unhandled|abort(ed)?|killed|out of memory|ENOSPC|skipp?(ed)?)\b/i;
  const groups = new Map();
  for (const raw of strip(text).split('\n')) {
    const line = raw.trim();
    if (!line || !re.test(line)) continue;
    const key = line.replace(/\d+(\.\d+)?/g, '#').slice(0, 160);
    const g = groups.get(key) ?? { n: 0, first: line.slice(0, 200) };
    g.n++;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.n - a.n).slice(0, max).map(g => `${g.n > 1 ? `${g.n}x ` : ''}${g.first}`);
}

// ---------------------------------------------------------------- test
async function test(args) {
  const log = join(DIR, 'test.log');
  const json = join(DIR, 'vitest.json');
  const noAssert = join(DIR, 'no-assertions.txt');
  rmSync(json, { force: true });
  writeFileSync(noAssert, '');
  const bin = existsSync('node_modules/.bin/vitest') ? 'node_modules/.bin/vitest' : 'vitest';
  const { code, ms } = await runToLog(bin, ['run', '--reporter=dot', '--reporter=json', `--outputFile.json=${json}`, ...args], log, {
    CI: 'true',
    QUIET_NO_ASSERT_FILE: noAssert, // tests/setup.ts lists passed tests that made no expect() call
  });
  const text = readFileSync(log, 'utf8');
  if (!existsSync(json)) {
    say(`TESTS DID NOT REPORT (exit ${code}, ${secs(ms)}). Last lines of ${log}:`);
    strip(text).split('\n').filter(l => l.trim()).slice(-25).forEach(l => say(`  ${l}`));
    return finish(code);
  }
  const r = JSON.parse(readFileSync(json, 'utf8'));
  const tests = r.testResults.flatMap(f => f.assertionResults.map(t => ({ ...t, file: f.name.replace(process.cwd() + '/', '') })));
  const failed = tests.filter(t => t.status === 'failed');
  const skipped = tests.filter(t => t.status === 'skipped' || t.status === 'pending');
  const todo = tests.filter(t => t.status === 'todo');
  const brokenFiles = r.testResults.filter(f => f.status === 'failed' && f.message && !f.assertionResults.some(t => t.status === 'failed'));
  const slow = tests.filter(t => (t.duration ?? 0) > SLOW_TEST_MS).sort((a, b) => b.duration - a.duration);
  const slowFiles = r.testResults.map(f => ({ file: f.name.replace(process.cwd() + '/', ''), ms: (f.endTime ?? 0) - (f.startTime ?? 0) }))
    .filter(f => f.ms > SLOW_FILE_MS).sort((a, b) => b.ms - a.ms);
  const emptyFiles = r.testResults.filter(f => f.assertionResults.length === 0 && f.status !== 'failed');
  const noAsserts = [...new Set(readFileSync(noAssert, 'utf8').split('\n').filter(Boolean))];
  const stderrBlocks = (text.match(/^stderr \| .*/gm) ?? []);
  const warnLines = oddLines(strip(text).split('\n').filter(l => /warn|deprecat|\(!\)/i.test(l)).join('\n'), 8);
  const unhandled = /Unhandled (Errors?|Rejection)/i.test(text);

  const key = `test ${args.join(' ')}`.trim();
  const last = history[key];
  const ok = code === 0;
  say(`${ok ? 'PASS' : 'FAIL'} unit tests: ${r.numPassedTests}/${r.numTotalTests} passed, ${failed.length} failed, ${skipped.length} skipped, ${todo.length} todo, ${r.numTotalTestSuites != null ? `${r.testResults.length} files` : ''}`);
  say(`  ${vsLast('tests', r.numTotalTests, last?.tests, { flagIt: true, dropOnly: true })}; ${vsLast('time', ms, last?.ms, { fmt: secs, flagIt: true })}; full log ${log}`);
  if (failed.length) {
    say(`FAILED (${failed.length}):`);
    for (const t of failed.slice(0, 15)) {
      say(`  ${t.file} > ${t.fullName}`);
      const msg = strip(t.failureMessages?.[0] ?? '').split('\n').filter(l => l.trim()).slice(0, 4);
      msg.forEach(l => say(`      ${l.trim().slice(0, 220)}`));
    }
    if (failed.length > 15) say(`  ... ${failed.length - 15} more in ${log}`);
  }
  for (const f of brokenFiles) flag(`file failed to run: ${f.name.replace(process.cwd() + '/', '')}: ${strip(f.message).split('\n')[0].slice(0, 200)}`);
  if (unhandled) flag(`unhandled errors in the run (see ${log}, "Unhandled")`);
  if (code !== 0 && !failed.length && !brokenFiles.length) flag(`exit code ${code} with no failed test (see the end of ${log})`);
  if (skipped.length) flag(`${skipped.length} skipped: ${skipped.slice(0, 6).map(t => `${t.file} > ${t.title}`).join('; ')}${skipped.length > 6 ? '; ...' : ''}`);
  if (todo.length) flag(`${todo.length} todo (${[...new Set(todo.map(t => t.file))].slice(0, 4).join(', ')}${todo.length > 4 ? ', ...' : ''})`);
  // Slow ones are known and many (the AI games); flag the ones that were not slow last run, or the top 3 on a first run
  const slowNames = slow.map(t => `${t.file} > ${t.title}`);
  const newSlow = last?.slow ? slow.filter((t, i) => !last.slow.includes(slowNames[i])) : slow.slice(0, 3);
  if (newSlow.length) flag(`${slow.length} slow tests over ${secs(SLOW_TEST_MS)}${last?.slow ? `, ${newSlow.length} not slow last run` : ', slowest'}: ${newSlow.slice(0, 5).map(t => `${t.file} > ${t.title.slice(0, 80)} ${secs(t.duration)}`).join('; ')}${newSlow.length > 5 ? '; ...' : ''}`);
  else if (slow.length) say(`  ${slow.length} slow tests and ${slowFiles.length} slow files, the same as last run`);
  const newSlowFiles = last?.slowFiles ? slowFiles.filter(f => !last.slowFiles.includes(f.file)) : [];
  if (newSlowFiles.length) flag(`${newSlowFiles.length} files newly over ${secs(SLOW_FILE_MS)}: ${newSlowFiles.slice(0, 5).map(f => `${f.file} ${secs(f.ms)}`).join(', ')}`);
  if (emptyFiles.length) flag(`${emptyFiles.length} files with no tests: ${emptyFiles.slice(0, 5).map(f => f.name.replace(process.cwd() + '/', '')).join(', ')}`);
  if (noAsserts.length) {
    const newOnes = last?.noAsserts ? noAsserts.filter(t => !last.noAsserts.includes(t)) : noAsserts;
    flag(`${noAsserts.length} passed tests made no expect() call${last?.noAsserts ? ` (${newOnes.length} new since the last run)` : ''}; list in ${noAssert}${newOnes.length ? `: ${newOnes.slice(0, 4).join('; ')}${newOnes.length > 4 ? '; ...' : ''}` : ''}`);
  }
  if (stderrBlocks.length) flag(`${stderrBlocks.length} tests wrote to stderr (first: ${stderrBlocks[0].slice(9, 160)})`);
  for (const w of warnLines) flag(`warning: ${w}`);
  saveHistory(key, { tests: r.numTotalTests, ms, failed: failed.length, noAsserts, slow: slowNames, slowFiles: slowFiles.map(f => f.file) });
  return finish(code);
}

// ---------------------------------------------------------------- batch
function gitShow(path) {
  try {
    return execFileSync('git', ['show', `origin/ai-batch-results:${path}`], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}
let fetched = false;
function readRun(ref) {
  if (existsSync(ref) && statSync(ref).isFile()) return { text: readFileSync(ref, 'utf8'), name: ref };
  if (!/^\d+$/.test(ref)) return null;
  if (!fetched) {
    try { execFileSync('git', ['fetch', '-q', '--depth=1', 'origin', 'ai-batch-results'], { stdio: 'ignore' }); } catch { /* offline: use what is there */ }
    fetched = true;
  }
  const text = gitShow(`results/${ref}.txt`);
  return text == null ? null : { text, name: `results/${ref}.txt on ai-batch-results` };
}

/** The numbers a corp-losses / head-to-head summary prints; null fields when the summary has none. */
function parseBatch(text) {
  const t = strip(text);
  const header = t.match(/^Batch: .*$/m)?.[0] ?? null;
  const range = header?.match(/\| games (\d*)-(\d+) \|/);
  const overall = t.match(/^(\d+) games: Corp ([\d.]+)%, Runner ([\d.]+)%/m);
  const endsBlock = t.match(/^How games end:\n((?: {2}.*\n?)+)/m)?.[1] ?? '';
  const ends = [...endsBlock.matchAll(/^ {2}(\S+) (.+?): (\d+) \(([\d.]+)%\)/gm)].map(m => ({ winner: m[1], reason: m[2], n: +m[3], pct: +m[4] }));
  const paired = t.match(/Paired Corp win diff: ([+-]?[\d.]+) pts ± ([\d.]+) SE over (\d+) games/);
  const counted = t.match(/PAIRED vs base batch \(same deals\): (\d+) games counted \(this batch (\d+), base (\d+)\)/);
  const corpWin = t.match(/^ {2}Corp win: ([\d.]+)% this vs ([\d.]+)% base/m);
  const changed = t.match(/deals that changed winner: .*$/m)?.[0] ?? null;
  const alarmPairs = [...(t.match(/alarms per 100 games \(this \/ base, paired diff ± SE\):\n((?: {4}.*\n?)+)/)?.[1] ?? '').matchAll(/^ {4}(.+?): ([\d.]+) \/ ([\d.]+), ([+-]?[\d.]+) ± ([\d.]+)/gm)]
    .map(m => ({ name: m[1], now: +m[2], base: +m[3], diff: +m[4], se: +m[5] }));
  const perGame = [...t.matchAll(/^ {4}(.+?): ([\d.]+) \/ ([\d.]+), ([+-]?[\d.]+) ± ([\d.]+) \(([+-]?[\d.]+) SE\)/gm)].map(m => ({ name: m[1], z: +m[6], line: `${m[1]}: ${m[2]} / ${m[3]}` }));
  const alarms = [...(t.match(/^ALARMS \(per 100 games[^\n]*\n((?: {2}.*\n?)+)/m)?.[1] ?? '').matchAll(/^ {2}(\S[^:]*): ([\d.]+) \((\d+) in (\d+) games\)/gm)].map(m => `${m[1]} ${m[2]}`);
  const crashed = +(t.match(/^CRASHED GAMES: (\d+)/m)?.[1] ?? 0);
  const crashLines = (t.match(/^CRASHED GAMES: \d+\n((?: {2}.*\n?)+)/m)?.[1] ?? '').split('\n').filter(Boolean).slice(0, 3);
  const loops = +(t.match(/^VALUE LOOPS \(games played on with flat values\): (\d+) games/m)?.[1] ?? 0);
  const fallbacks = t.match(/^DEAL FALLBACKS \([^)]*\): (\d+) in (\d+) games/m);
  return { header, units: range ? +range[2] - +(range[1] || 0) : null, n: overall ? +overall[1] : null, corp: overall ? +overall[2] : null, ends, paired: paired && { diff: +paired[1], se: +paired[2], n: +paired[3] }, counted: counted && { n: +counted[1], here: +counted[2], base: +counted[3] }, corpWin: corpWin && { now: +corpWin[1], base: +corpWin[2] }, changed, alarmPairs, perGame, alarms, crashed, crashLines, loops, fallbacks: fallbacks && { n: +fallbacks[1], games: +fallbacks[2] } };
}

function scriptRun(id) {
  const tgz = join(DIR, `script-${id}.tar.gz`);
  try {
    execFileSync('git', ['fetch', '-q', '--depth=1', 'origin', 'ai-batch-results'], { stdio: 'ignore' });
    writeFileSync(tgz, execFileSync('git', ['show', `origin/ai-batch-results:scripts/${id}.tar.gz`], { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return false;
  }
  const dest = join(DIR, `script-${id}`);
  mkdirSync(dest, { recursive: true });
  execFileSync('tar', ['-xzf', tgz, '-C', dest]);
  const files = [];
  const walk = d => readdirSync(d, { withFileTypes: true }).forEach(e => (e.isDirectory() ? walk(join(d, e.name)) : files.push(join(d, e.name))));
  walk(dest);
  const sizes = files.map(f => statSync(f).size);
  const errs = files.filter((f, i) => f.endsWith('.err') && sizes[i] > 0);
  const empty = files.filter((f, i) => !f.endsWith('.err') && sizes[i] === 0);
  // Shards are named <runner>-<process>.<ext> by ai-script.yml; count them by name, not by file
  const shards = new Set(files.map(f => f.split('/').pop().match(/^(\d+-\d+)\./)?.[1]).filter(Boolean)).size;
  const odd = oddLines(files.filter(f => statSync(f).size < 5e6).map(f => readFileSync(f, 'utf8')).join('\n'), 8);
  say(`ai-script run ${id}: ${shards} shards, ${files.length} output files, ${(sizes.reduce((a, b) => a + b, 0) / 1024).toFixed(0)} KB, unpacked in ${dest}/`);
  say("  Read it with the script's own summing script, wrapped: node scripts/quiet.mjs run <name> -- node scripts/<x>-sum.mjs " + `${dest}/out/*.json`);
  const last = history['script-shards'];
  if (shards && shards < 64) flag(`${shards} shards; a full run has 64 (16 runners x 4): missing or timed out?`);
  if (errs.length) flag(`${errs.length} shards wrote to stderr (.err files): ${errs.slice(0, 3).join(', ')}`);
  if (empty.length) flag(`${empty.length} empty output files (a shard that crashed or timed out?): ${empty.slice(0, 3).join(', ')}`);
  for (const l of odd) flag(`in the output: ${l}`);
  if (last != null) say(`  (last script read here had ${last} shards)`);
  saveHistory('script-shards', shards);
  return true;
}

function batch(args) {
  const ref = args[0];
  const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  if (!ref) { console.log('usage: node scripts/quiet.mjs batch <run id|file> [--base <run id|file>] [--games N]'); return 2; }
  const run = readRun(ref);
  if (!run) {
    if (/^\d+$/.test(ref) && scriptRun(ref)) return finish(0);
    console.log(`No summary for ${ref}: not a file, and no results/${ref}.txt or scripts/${ref}.tar.gz on ai-batch-results (still running, or failed before its summary job?).`);
    return 2;
  }
  const full = join(DIR, `batch-${String(ref).replace(/[^\w.-]/g, '_')}.txt`);
  writeFileSync(full, run.text);
  const b = parseBatch(run.text);
  const baseRef = opt('--base');
  const baseRun = baseRef ? readRun(baseRef) : null;
  if (baseRef && !baseRun) flag(`could not read the base ${baseRef}`);
  const base = baseRun ? parseBatch(baseRun.text) : null;
  say(b.header ? b.header.slice(0, 300) : `(no "Batch:" header) ${run.name}`);
  if (b.n == null) {
    // Not a corp-losses style summary (an h2h, pace or other -sum script): the start and the odd lines
    say(`Not a corp-losses summary; first lines (full text ${full}):`);
    strip(run.text).split('\n').slice(0, 20).forEach(l => say(`  ${l.slice(0, 200)}`));
    for (const l of oddLines(run.text, 10)) flag(l);
    const n = +(strip(run.text).match(/^(\d+) games\b/m)?.[1] ?? NaN);
    const key = `batch-other ${b.units ?? '?'} ${b.header?.match(/\| (\S+) [^|]*\| added run/)?.[1] ?? ''}`;
    const planned = opt('--games') ? +opt('--games') : history[key]?.n;
    if (Number.isFinite(n)) {
      if (planned != null && n < planned) flag(`${n} games, expected ${planned} (shards timed out or crashed?)`);
      saveHistory(key, { n });
    }
    return finish(0);
  }
  // Games played against the plan: an explicit --games, the base it is paired with, or the last run of the same size
  const sizeKey = `batch-n ${b.units ?? '?'} ${(b.header?.match(/\| decks ([^|]*)\|/)?.[1] ?? '').trim()}`;
  const planned = opt('--games') ? +opt('--games') : b.counted?.base ?? base?.n ?? history[sizeKey]?.n ?? null;
  say(`${b.n} games${planned != null ? ` (expected ${planned})` : ''}: Corp ${b.corp}%${base ? ` (base ${base.corp}% over ${base.n})` : ''}; full text ${full}`);
  if (planned != null && b.n < planned) flag(`${b.n} games, expected ${planned}: ${planned - b.n} missing (shards timed out or crashed?)`);
  if (b.counted && b.counted.n < Math.max(b.counted.here, b.counted.base)) flag(`paired on ${b.counted.n} games, but this batch has ${b.counted.here} and the base ${b.counted.base}`);
  if (b.paired) {
    const z = b.paired.diff / b.paired.se;
    say(`  paired Corp win diff ${b.paired.diff > 0 ? '+' : ''}${b.paired.diff} pts ± ${b.paired.se} SE (${z.toFixed(1)} SE) over ${b.paired.n}${b.corpWin ? `; ${b.corpWin.now}% vs ${b.corpWin.base}%` : ''}`);
    if (b.changed) say(`  ${b.changed.trim()}`);
    if (Math.abs(z) >= 2) flag(`Corp win rate moved ${b.paired.diff} pts against the base, ${z.toFixed(1)} SE (outside noise)`);
  } else if (base?.corp != null) {
    const p = (b.corp + base.corp) / 200;
    const se = 100 * Math.sqrt(p * (1 - p) * (1 / b.n + 1 / base.n));
    const d = b.corp - base.corp;
    say(`  unpaired vs base: ${d > 0 ? '+' : ''}${d.toFixed(1)} pts ± ${se.toFixed(1)} SE`);
    if (Math.abs(d) >= 2 * se) flag(`Corp win rate ${d.toFixed(1)} pts from the base, ${(d / se).toFixed(1)} SE (unpaired)`);
  }
  if (b.corp < 40 || b.corp > 60) flag(`Corp win ${b.corp}% is far from the 50 ± 5% goal`);
  say(`  ends: ${b.ends.map(e => `${e.winner} ${e.reason} ${e.pct}%`).join(', ')}`);
  const noWinner = b.ends.filter(e => e.winner !== 'corp' && e.winner !== 'runner');
  if (noWinner.length) flag(`${noWinner.reduce((a, e) => a + e.n, 0)} games with no winner: ${noWinner.map(e => `${e.winner} ${e.reason} ${e.n}`).join(', ')}`);
  if (base) {
    for (const e of b.ends) {
      const was = base.ends.find(x => x.winner === e.winner && x.reason === e.reason);
      if (!was) flag(`new way games end: ${e.winner} ${e.reason} ${e.n}`);
      else if (Math.abs(e.pct - was.pct) >= 5) flag(`${e.winner} ${e.reason} ${was.pct}% -> ${e.pct}%`);
    }
  }
  if (b.crashed) flag(`${b.crashed} CRASHED games: ${b.crashLines.map(l => l.trim()).join(' | ')}`);
  if (b.loops) flag(`${b.loops} games hit a value loop (see VALUE LOOPS in ${full})`);
  if (b.fallbacks?.n) flag(`${b.fallbacks.n} Runner deal fallbacks in ${b.fallbacks.games} games: a knowledge bug played on (see DEAL FALLBACKS in ${full})`);
  if (b.alarmPairs.length) {
    say(`  alarms per 100 (this / base): ${b.alarmPairs.map(a => `${a.name} ${a.now}/${a.base}`).join(', ')}`);
    for (const a of b.alarmPairs) if (a.se > 0 && Math.abs(a.diff) >= 2 * a.se) flag(`alarm "${a.name}" ${a.base} -> ${a.now} per 100, ${(a.diff / a.se).toFixed(1)} SE`);
  } else if (b.alarms.length) say(`  alarms per 100: ${b.alarms.join(', ')}`);
  for (const g of b.perGame) if (Math.abs(g.z) >= 2) flag(`per game ${g.line}, ${g.z} SE`);
  const timeouts = oddLines(run.text.split('\n').filter(l => /timed? ?out|timeout|cancel+ed|out of memory/i.test(l)).join('\n'), 4);
  for (const l of timeouts) flag(`in the summary: ${l}`);
  saveHistory(sizeKey, { n: b.n, corp: b.corp });
  return finish(0);
}

// ---------------------------------------------------------------- run
async function runCmd(args) {
  const dash = args.indexOf('--');
  const name = (dash > 0 ? args[0] : 'run').replace(/[^\w.-]/g, '_');
  const cmd = dash >= 0 ? args.slice(dash + 1) : args.slice(1);
  if (!cmd.length) { console.log('usage: node scripts/quiet.mjs run <name> -- <command ...>'); return 2; }
  const log = join(DIR, `${name}.log`);
  const { code, ms } = await runToLog(cmd[0], cmd.slice(1), log);
  const text = readFileSync(log, 'utf8');
  const lines = strip(text).split('\n');
  const key = `run ${name}`;
  const last = history[key];
  say(`${code === 0 ? 'OK' : `FAILED (exit ${code})`} ${name}: ${vsLast('time', ms, last?.ms, { fmt: secs, flagIt: true })}, ${vsLast('lines', lines.length, last?.lines, { flagIt: true })}; full log ${log}`);
  if (last && last.code === 0 && code !== 0) flag(`exit ${code}; the last run of ${name} exited 0`);
  for (const l of oddLines(text)) flag(l);
  say('Last lines:');
  lines.filter(l => l.trim()).slice(-12).forEach(l => say(`  ${l.slice(0, 220)}`));
  saveHistory(key, { ms, lines: lines.length, code });
  return finish(code);
}

function finish(code) {
  console.log(out.join('\n'));
  if (flags.length) {
    console.log(`UNUSUAL (${flags.length}):`);
    for (const f of flags.slice(0, 25)) console.log(`  - ${f}`);
    if (flags.length > 25) console.log(`  - ... ${flags.length - 25} more`);
  } else console.log('Nothing unusual.');
  return code;
}

const [mode, ...rest] = process.argv.slice(2);
const modes = { test, batch, run: runCmd };
if (!modes[mode]) {
  console.log('usage: node scripts/quiet.mjs test [vitest args] | batch <run id|file> [--base <run id|file>] [--games N] | run <name> -- <command ...>');
  process.exit(2);
}
process.exit(await modes[mode](rest));
