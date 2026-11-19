/**
 * Stage D found row 59 count, Part B "the suite on the arm's tree": copies this checkout (src patched as the arm, by
 * prompt-chain-trees.ts makeTrees; tests, configs and fixtures as they are; node_modules linked) to SUITE_ROOT/<arm> and
 * runs vitest there with the JSON reporter, so the summing step can list the tests and pins whose result changes.
 *   ARMS=beta,chainRun npx vite-node scripts/stage-d/prompt-chain-suite.ts
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Arm, makeTrees } from './prompt-chain-trees';

const arms = (process.env.ARMS ?? 'beta,chainRun,chainCorp,chainRunFb').split(',') as Arm[];
const root = resolve(process.env.SUITE_ROOT ?? 'node_modules/.cache/prompt-chain-suite');
for (const arm of arms) {
  const trees = resolve(root, '_trees');
  const dirs = makeTrees(trees, [arm]);
  const dir = join(root, arm);
  rmSync(dir, { recursive: true, force: true });
  for (const f of readdirSync('.')) {
    if (['node_modules', '.git', 'src', 'dist'].includes(f)) continue;
    cpSync(f, join(dir, f), { recursive: true });
  }
  cpSync(join(dirs[arm], 'src'), join(dir, 'src'), { recursive: true });
  if (!existsSync(join(dir, 'node_modules'))) symlinkSync(resolve('node_modules'), join(dir, 'node_modules'));
  const outFile = join(root, `${arm}.json`);
  const t0 = Date.now();
  try {
    execSync(`npx vitest run --reporter=json --outputFile=${outFile}`, { cwd: dir, stdio: 'ignore', timeout: 3_600_000 });
  } catch {
    // failing tests exit non-zero; the JSON holds them
  }
  console.log(`${arm}: ${outFile} (${Math.round((Date.now() - t0) / 1000)} s)`);
}
