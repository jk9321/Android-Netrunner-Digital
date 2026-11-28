/**
 * R-C1 Part 0, R-26: do the scratch trees of the four R-0/R-B measurement scripts still patch this checkout's src?
 * (rank-cost-trees.ts, get-in-trees.ts, decided-twice-trees.ts, decided-twice-pins.ts; tracker R-26.) Each tree's patches
 * are applied in order to an in-memory copy of the files they touch, as the scripts' own makeTrees do; every patch that
 * does not match exactly once is listed (the scripts stop at the first). Nothing is written.
 *
 *   PATCH_CHECK=1 npx vite-node scripts/runner-rework/rc1-part0/patch-check.ts
 *
 * Exit 1 when any patch misses. Re-run after B4d and after the speed pass merge (plan r-c1 section 8b).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { C_ARMS, D_ARMS, patches as rankPatches } from '../rank-cost-trees';
import { ARMS, patches as getInPatches } from '../get-in-trees';
import { EVAL, HOOKED } from '../decided-twice-trees';
import { TREES as PIN_TREES } from '../decided-twice-pins';

type Patch = [file: string, at: string, to: string];

/** Applies the patches in order on copies of the files; returns one line per patch that does not match once. */
function check(name: string, list: Patch[]): string[] {
  const files = new Map<string, string>();
  const misses: string[] = [];
  for (const [f, at, to] of list) {
    if (!files.has(f)) files.set(f, readFileSync(join('src', f), 'utf8'));
    const text = files.get(f)!;
    const n = text.split(at).length - 1;
    if (n !== 1) {
      misses.push(`${name}: ${n} matches in ${f}: ${JSON.stringify(at.slice(0, 100))}`);
      continue;
    }
    files.set(f, text.replace(at, () => to));
  }
  return misses;
}

const trees: [string, Patch[]][] = [
  ...['control', 'instr', 'deckRootA', ...C_ARMS, ...D_ARMS].map(a => [`rank-cost-trees ${a}`, rankPatches(a)] as [string, Patch[]]),
  ...ARMS.map(a => [`get-in-trees ${a}`, getInPatches(a)] as [string, Patch[]]),
  ['decided-twice-trees hooked', [...HOOKED, ...EVAL]],
  ['decided-twice-trees eval', EVAL],
  ...Object.entries(PIN_TREES).map(([t, p]) => [`decided-twice-pins ${t}`, p] as [string, Patch[]]),
];

let bad = 0;
for (const [name, list] of trees) {
  const misses = check(name, list);
  bad += misses.length;
  console.log(misses.length === 0 ? `ok   ${name} (${list.length} patches)` : misses.map(m => `MISS ${m}`).join('\n'));
}
console.log(bad === 0 ? 'every patch matches once' : `${bad} patches miss`);
if (bad > 0) process.exit(1);
