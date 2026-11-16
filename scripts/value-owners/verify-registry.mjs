// Valuation V-A (brief-stage-va-owners.md rev 2, ruling 9): the registry's verify script. Every location written in the
// valuation table of docs/ai-priced-quantities.md as `NAME` (`src/...ts:LINE`) must resolve: the file exists and its
// line LINE contains NAME. Exit code 1 lists the ones that don't.
//   node scripts/value-owners/verify-registry.mjs          check
//   node scripts/value-owners/verify-registry.mjs --fix    move each stale LINE to the nearest line holding NAME (then re-read the diff)
//   node scripts/value-owners/verify-registry.mjs --all    check every such pair in the whole file, not only the valuation section
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
const PAIR = /`([^`\n]+)` \(`((?:src|scripts|tests)\/[\w./-]+\.(?:ts|mjs)):(\d+)`\)/g;
const cache = new Map();
const lines = path => {
  if (!cache.has(path)) cache.set(path, existsSync(path) ? readFileSync(path, 'utf8').split('\n') : null);
  return cache.get(path);
};
let checked = 0;
const bad = [];
const section = text.slice(from, to).replace(PAIR, (whole, name, path, line) => {
  checked++;
  const src = lines(path);
  const n = Number(line);
  if (src && src[n - 1]?.includes(name)) return whole;
  let best = -1;
  if (src) for (let i = 0; i < src.length; i++) if (src[i].includes(name) && (best < 0 || Math.abs(i + 1 - n) < Math.abs(best + 1 - n))) best = i;
  bad.push(`${path}:${line} does not hold \`${name}\`${src ? (best >= 0 ? ` (nearest: line ${best + 1})` : ' (not in the file)') : ' (no such file)'}`);
  return fix && best >= 0 ? `\`${name}\` (\`${path}:${best + 1}\`)` : whole;
});
if (fix && bad.length) writeFileSync(FILE, text.slice(0, from) + section + text.slice(to));
console.log(`${checked} locations checked in ${all ? 'the whole registry' : 'the valuation section'}; ${bad.length} stale${fix && bad.length ? ' (fixed where the name was found)' : ''}`);
for (const b of bad) console.log('  ' + b);
process.exit(bad.length && !fix ? 1 : 0);
