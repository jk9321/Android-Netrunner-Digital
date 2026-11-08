#!/usr/bin/env node
// Hand-off evidence for a branch, as Markdown to paste into the hand-off (and for the reviewer to re-run).
// Read-only: never writes into the repo, never pushes.
//
//   node .claude/skills/handoff/evidence.mjs --base origin/beta [--allow 'src/core/view.ts,src/ui/**,tests/**']
//        [--deny 'src/ai/**'] [--checks full|fast|none] [--out file.md]
//
//   --base    the branch the work merges into (origin/beta for AI, MP and new-set work; origin/main otherwise).
//             The diff is base...HEAD (from the merge base), so a stale base does not show other people's work.
//   --allow   comma-separated globs from the spec's "allowed files". Every touched file outside them is listed.
//   --deny    comma-separated globs the spec forbids. Any touched file inside them is listed.
//   --checks  full (default): typecheck + lint + `npm test`. fast: typecheck + lint + fast tests only
//             (.claude/hooks/fast-checks.mjs). none: diff signals only (reviewer re-reading a hand-off).
//
// Exit code is 0 even when checks fail: the report says so. Globs: ** = any depth, * = within one segment.
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const base = opt('base', null);
if (!base) {
  console.error('Usage: evidence.mjs --base origin/beta [--allow globs] [--deny globs] [--checks full|fast|none] [--out file]');
  process.exit(1);
}
const allow = (opt('allow', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const deny = (opt('deny', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const checks = opt('checks', 'full');
const outFile = opt('out', null);

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
const ROOT = git('rev-parse', '--show-toplevel');
process.chdir(ROOT);

function globRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
const matches = (globs, f) => globs.some((g) => globRe(g).test(f));

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const head = git('rev-parse', 'HEAD');
const mergeBase = git('merge-base', base, 'HEAD');
const baseSha = git('rev-parse', base);
const range = `${mergeBase}..HEAD`;
const stat = execFileSync('git', ['diff', '--stat=120', range], { encoding: 'utf8' }).trimEnd();
const files = git('diff', '--name-status', range).split('\n').filter(Boolean).map((l) => {
  const [status, ...p] = l.split('\t');
  return { status: status[0], file: p[p.length - 1] };
});
const commits = git('log', '--format=%h %s', range).split('\n').filter(Boolean);
const dirty = git('status', '--porcelain');
let upstream = null;
try {
  upstream = git('rev-parse', `origin/${branch}`);
} catch {
  /* not pushed */
}
const behind = Number(git('rev-list', '--count', `HEAD..${base}`));

// ---- diff signals: lines the branch ADDS that a reviewer must look at ----
const diff = git('diff', '-U0', range);
const signals = {
  'Escape hatches (any / ts-ignore / ts-expect-error / eslint-disable / as unknown as)': /(:\s*any\b|<any>|as any\b|@ts-ignore|@ts-expect-error|eslint-disable|as unknown as)/,
  'Skipped or focused tests (.skip / .only / .todo / xit)': /\b(it|test|describe)\.(skip|only|todo)\b|\bx(it|describe)\(/,
  'Empty catch blocks': /catch\s*(\([^)]*\))?\s*\{\s*\}/,
  'Randomness or clock in code (Math.random / Date.now / new Date)': /Math\.random|Date\.now|new Date\(/,
  'Card codes in code (5-digit quoted strings)': /['"`]\d{5}['"`]/,
  'New plan switches (keys added in src/ai/synergy.ts)': /^\+\s{4}\w+\s*:\s*(true|false|\{)/,
  'Raw state reads that may be hidden (hand / deck / facedown)': /\.(corp|runner)\.(hand|deck)\b|faceDown|facedown/,
};
const hits = Object.fromEntries(Object.keys(signals).map((k) => [k, []]));
let cur = null;
let line = 0;
for (const l of diff.split('\n')) {
  if (l.startsWith('+++ ')) {
    cur = l.slice(6);
    continue;
  }
  const h = l.match(/^@@ -\S+ \+(\d+)/);
  if (h) {
    line = Number(h[1]);
    continue;
  }
  if (l.startsWith('+') && cur && /\.(ts|tsx|js|mjs|cjs)$/.test(cur) && !cur.startsWith('.claude/')) {
    const isTest = /^tests\/|\.test\.tsx?$|e2e\//.test(cur);
    for (const [k, re] of Object.entries(signals)) {
      if (k.startsWith('Randomness') && isTest) continue;
      if (k.startsWith('Card codes') && (isTest || /^src\/(core\/scripts|ai\/cards|data)\//.test(cur))) continue;
      if (k.startsWith('Raw state') && (isTest || !/^src\/ai\//.test(cur))) continue;
      if (k.startsWith('New plan') && cur !== 'src/ai/synergy.ts') continue;
      if (re.test(k.startsWith('New plan') ? l : l.slice(1))) hits[k].push(`${cur}:${line} ${l.slice(1).trim().slice(0, 110)}`);
    }
    line++;
  }
}
const deletedTests = files.filter((f) => f.status === 'D' && /^tests\/|\.test\.tsx?$/.test(f.file)).map((f) => f.file);
const testFilesTouched = files.filter((f) => /^tests\/|\.test\.tsx?$|e2e\//.test(f.file)).length;

// ---- checks ----
function runCheck(label, cmd, cmdArgs) {
  const t0 = Date.now();
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, CI: 'true' } });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const outText = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '').trim();
  const tail = outText.split('\n').filter((l) => l.trim()).slice(-12).join('\n');
  return { label, ok: r.status === 0, secs, tail, cmd: [cmd, ...cmdArgs].join(' ') };
}
const results = [];
if (checks === 'full') {
  results.push(runCheck('typecheck', 'npm', ['run', 'typecheck']));
  results.push(runCheck('lint', 'npm', ['run', 'lint']));
  results.push(runCheck('test (full unit suite)', 'npm', ['test']));
} else if (checks === 'fast') {
  results.push(runCheck('typecheck + lint + fast tests', 'node', ['.claude/hooks/fast-checks.mjs']));
}

// ---- report ----
const o = [];
o.push(`## Hand-off evidence: \`${branch}\``);
o.push('');
o.push(`- Head: \`${head}\`${upstream === head ? ' (pushed)' : upstream ? ` (**origin/${branch} is ${upstream.slice(0, 7)}: not the same, push first**)` : ' (**not pushed**)'}`);
o.push(`- Base: \`${base}\` = \`${baseSha.slice(0, 10)}\`, merge base \`${mergeBase.slice(0, 10)}\`${behind ? `, branch is **${behind} commits behind** base (merge base in before review)` : ''}`);
o.push(`- Working tree: ${dirty ? `**dirty** (${dirty.split('\n').length} files not committed; evidence below is for the committed head only)` : 'clean'}`);
o.push(`- Commits (${commits.length}):`);
for (const c of commits.slice(0, 30)) o.push(`  - ${c}`);
if (commits.length > 30) o.push(`  - ... ${commits.length - 30} more`);
o.push('');
o.push('### Diff stat');
o.push('```');
o.push(stat || '(no changes)');
o.push('```');
o.push('');
o.push('### Files vs the spec');
if (!allow.length && !deny.length) {
  o.push('No --allow/--deny given: **the spec\'s allowed files were not checked.** Pass them from the spec.');
} else {
  const outside = allow.length ? files.filter((f) => !matches(allow, f.file)) : [];
  const denied = files.filter((f) => matches(deny, f.file));
  if (allow.length) o.push(`Allowed: \`${allow.join('`, `')}\``);
  if (deny.length) o.push(`Forbidden: \`${deny.join('`, `')}\``);
  if (!outside.length && !denied.length) o.push(`All ${files.length} touched files are inside the allowed list.`);
  for (const f of outside) o.push(`- **OUTSIDE ALLOWED** ${f.status} \`${f.file}\` (explain under Deviations)`);
  for (const f of denied) o.push(`- **FORBIDDEN** ${f.status} \`${f.file}\` (explain under Deviations)`);
}
o.push('');
o.push('### Diff signals (added lines in code files only; each needs a reason or a fix)');
let anySignal = false;
for (const [k, list] of Object.entries(hits)) {
  if (!list.length) continue;
  anySignal = true;
  o.push(`- ${k}: ${list.length}`);
  for (const h of list.slice(0, 15)) o.push(`  - \`${h.replace(/`/g, "'")}\``);
  if (list.length > 15) o.push(`  - ... ${list.length - 15} more`);
}
if (deletedTests.length) {
  anySignal = true;
  o.push(`- **Deleted test files**: ${deletedTests.map((f) => `\`${f}\``).join(', ')}`);
}
if (!anySignal) o.push('None.');
o.push(`- Test files touched: ${testFilesTouched}${testFilesTouched === 0 ? ' (**no tests added or changed**)' : ''}`);
o.push('');
o.push('### Checks (run on this checkout)');
if (!results.length) o.push(`Not run (--checks ${checks}).`);
for (const r of results) {
  o.push(`- ${r.ok ? 'PASS' : '**FAIL**'} ${r.label} (\`${r.cmd}\`, ${r.secs}s)`);
  o.push('```');
  o.push(r.tail || '(no output)');
  o.push('```');
}
const text = o.join('\n') + '\n';
if (outFile) writeFileSync(outFile, text);
process.stdout.write(text);
