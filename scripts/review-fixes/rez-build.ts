/**
 * Bundle R, the build's reading (rez-build brief rev 1, "Judged by"): the count's driver (rez-count.ts) run again,
 * unchanged but for two words, on the built commits as arms against the merge base (rez-build-trees.ts): its trees
 * module is rez-build-trees.ts instead of rez-count-trees.ts, and its one arm-named line (the B board of an arm that
 * changed a decision, `rdStakeUnseen`) reads `builtB`. Everything else is the count's: the 259 sources (the 221 deals
 * of the g1 base checked against their record, and the human files), every Corp decision asked of beta, control,
 * builtA and builtB, the measures on the beta tree, the continuations, the timing. Summed by rez-build-sum.mjs.
 *
 *   SHARD=0/64 npx vite-node scripts/review-fixes/rez-build.ts
 *   ARGS="DEALS=1021 HUMAN=none" npx vite-node scripts/review-fixes/rez-build.ts
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
let text = readFileSync(join(here, 'rez-count.ts'), 'utf8');
const swap = (at: string, to: string, n: number) => {
  const parts = text.split(at);
  if (parts.length !== n + 1) throw new Error(`rez-build: ${at} found ${parts.length - 1} times in rez-count.ts, expected ${n}`);
  text = parts.join(to);
};
swap(`from './rez-count-trees'`, `from './rez-build-trees'`, 1);
swap(`'rdStakeUnseen'`, `'builtB'`, 2);
swap(`trees.rdStakeUnseen`, `trees.builtB`, 1);
swap(`'node_modules/.cache/rez-count'`, `'node_modules/.cache/rez-build'`, 1);
const driver = join(here, `.rez-build-driver-${process.pid}.gen.ts`);
writeFileSync(driver, text);
process.on('exit', () => rmSync(driver, { force: true }));
await import(/* @vite-ignore */ driver);
