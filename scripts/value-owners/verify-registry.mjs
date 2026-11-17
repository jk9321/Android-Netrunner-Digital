// Valuation V-A (brief-stage-va-owners.md rev 2, ruling 9): the registry's verify script. Every location written in the
// valuation table of docs/ai-priced-quantities.md as `NAME` (`src/...ts:LINE`) must resolve: the file exists and its
// line LINE contains NAME. Exit code 1 lists the ones that don't.
//   node scripts/value-owners/verify-registry.mjs          check
//   node scripts/value-owners/verify-registry.mjs --fix    for each stale location print the old line and every line that holds NAME (with its text);
//                                                          rewrite a location ONLY when exactly one candidate's text equals the text the old line
//                                                          had at the merge base with origin/beta (the line the registry meant). Anything else is
//                                                          left stale and said so: a guess that makes the check pass on a wrong line is worse than none.
//   node scripts/value-owners/verify-registry.mjs --all    check every such pair in the whole file, not only the valuation section
// tests/codeHealth.test.ts runs the --all check, so a moved owner line fails the fast checks.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const FILE = 'docs/ai-priced-quantities.md';
const START = '<!-- valuation:start -->';
const END = '<!-- valuation:end -->';
const fix = process.argv.includes('--fix');
const all = process.argv.includes('--all');
const text = readFileSync(FILE, 'utf8');
const from = all ? 0 : text.indexOf(START);
const to = all ? text.length : text.indexOf(END);
if (from < 0 || to < 0) {
  console.error(`${FILE}: no ${START} ... ${END} section`);
  process.exit(1);
}
// V-B B1 (recount VA-VERIFY-ALL-BLIND): the Corp and Runner tables write `name` (path:line) with the path unquoted, often
// without src/ai/, and sometimes followed by more (", plus ...", "-477"); a bare file name is read under src/ai/.
const PAIR = /`([^`\n]+)` \((`?)((?:src|scripts|tests)\/[\w./-]+\.(?:ts|mjs)|[\w/-]+\.ts):(\d+)/g;
const resolve = path => (/^(src|scripts|tests)\//.test(path) ? path : `src/ai/${path}`);
const cache = new Map();
const lines = path => {
  if (!cache.has(path)) cache.set(path, existsSync(path) ? readFileSync(path, 'utf8').split('\n') : null);
  return cache.get(path);
};
// the text line N of PATH had at the merge base with origin/beta (null when there is no such base or line)
let base;
const textAtBase = (path, n) => {
  try {
    base ??= execFileSync('git', ['merge-base', 'HEAD', 'origin/beta'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return execFileSync('git', ['show', `${base}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')[n - 1] ?? null;
  } catch {
    return null;
  }
};
let checked = 0;
let moved = 0;
const bad = [];
const section = text.slice(from, to).replace(PAIR, (whole, name, tick, written, line) => {
  checked++;
  const path = resolve(written);
  const src = lines(path);
  const n = Number(line);
  if (src && src[n - 1]?.includes(name)) return whole;
  const candidates = [];
  if (src) src.forEach((l, i) => { if (l.includes(name)) candidates.push(i + 1); });
  let target = -1;
  let note = src ? (candidates.length ? '' : ' (not in the file)') : ' (no such file)';
  if (fix && src && candidates.length) {
    const was = textAtBase(path, n);
    const same = was == null ? [] : candidates.filter(c => src[c - 1].trim() === was.trim());
    if (same.length === 1) target = same[0];
    note += was == null ? ' [no old text at the merge base: left stale]' : same.length === 1 ? '' : ` [${same.length} candidates match the old text: left stale]`;
  }
  bad.push(`${path}:${line} does not hold \`${name}\`${note}${fix && candidates.length ? '\n' + [`      old text: ${textAtBase(path, n)?.trim() ?? '(unknown)'}`, ...candidates.map(c => `      ${c}: ${src[c - 1].trim().slice(0, 120)}`)].join('\n') : ''}${target >= 0 ? `\n      -> moved to line ${target}` : ''}`);
  if (target >= 0) moved++;
  return target >= 0 ? `\`${name}\` (${tick}${written}:${target}` : whole;
});
if (fix && bad.length) writeFileSync(FILE, text.slice(0, from) + section + text.slice(to));
console.log(`${checked} locations checked in ${all ? 'the whole registry' : 'the valuation section'}; ${bad.length} stale${fix && bad.length ? ` (${moved} moved, ${bad.length - moved} left stale)` : ''}`);
for (const b of bad) console.log('  ' + b);
process.exit(bad.length - moved > 0 ? 1 : 0);
