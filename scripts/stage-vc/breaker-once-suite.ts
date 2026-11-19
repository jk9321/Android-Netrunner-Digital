/**
 * V-C item 1 count, the suite and the human agreement on each arm's tree (brief, B). Copies this checkout (src patched as
 * the arm by breaker-once-trees.ts makeTrees; tests, scripts, configs and fixtures as they are; node_modules linked) to a
 * folder per arm and runs there:
 *  - JOB=suite: vitest with the JSON reporter (SUITE: <arm>.json), so the summing step lists the tests and pins whose
 *    result changes against beta's patched tree;
 *  - JOB=agree: `npx vite-node scripts/human-agreement.ts -- --quiet --dump=<arm>-agree.json` (the human-agreement score
 *    and every compared decision). beta and control both run it: their spread is the noise reading (d) compares with.
 * On the ai-script workflow (SHARD=k/64): process 4i runs jobs i, i+16, ... of the list (one runner each, so suites never share a
 * runner: some tests are time-limited); the others exit. Output goes to OUT_DIR.
 *   JOBS=suite:beta,agree:beta npx vite-node scripts/stage-vc/breaker-once-suite.ts
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Arm, makeTrees } from './breaker-once-trees';

// KEY=value pairs in ARGS or the arguments (the ai-script workflow's args), e.g. JOBS=suite:beta,agree:control
for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const i = kv.indexOf('=');
  process.env[kv.slice(0, i).replace(/^-+/, '')] = kv.slice(i + 1);
}
const ARM_LIST = ['beta', 'iceOwnsBoth', 'iceOwnsCorp', 'rigOwnsBoth', 'rigOwnsCorp', 'readerOnce', 'orEndCorp', 'iceOrEndCorp'];
const all = (process.env.JOBS ?? [...ARM_LIST.map(a => `suite:${a}`), ...['control', ...ARM_LIST].map(a => `agree:${a}`)].join(',')).split(',');
const [k, n] = (process.env.SHARD ?? '').split('/').map(Number);
const jobs = Number.isFinite(n) ? all.filter((_, i) => 4 * (i % 16) === k) : all;
const outDir = resolve(process.env.OUT_DIR ?? 'node_modules/.cache/breaker-once-suite-out');
mkdirSync(outDir, { recursive: true });
for (const job of jobs) {
  const [kind, arm] = job.split(':') as ['suite' | 'agree', Arm];
  const trees = resolve('node_modules/.cache/breaker-once-suite-trees', job.replace(':', '-'));
  const dirs = makeTrees(trees, [arm]);
  const dir = resolve('node_modules/.cache/breaker-once-suite', job.replace(':', '-'));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync('.')) {
    if (['node_modules', '.git', 'src', 'dist'].includes(f)) continue;
    cpSync(f, join(dir, f), { recursive: true });
  }
  cpSync(join(dirs[arm], 'src'), join(dir, 'src'), { recursive: true });
  if (!existsSync(join(dir, 'node_modules'))) symlinkSync(resolve('node_modules'), join(dir, 'node_modules'));
  const t0 = Date.now();
  if (kind === 'suite') {
    const outFile = join(outDir, `${arm}.json`);
    try {
      execSync(`npx vitest run ${process.env.TESTS ?? ''} --reporter=json --outputFile=${outFile}`, { cwd: dir, stdio: 'ignore', timeout: 5_400_000 });
    } catch {
      // failing tests exit non-zero; the JSON holds them
    }
    console.log(`suite ${arm}: ${outFile} (${Math.round((Date.now() - t0) / 1000)} s)`);
  } else {
    const dump = join(outDir, `${arm}-agree.json`);
    let text: string;
    try {
      text = execSync(`npx vite-node scripts/human-agreement.ts -- --quiet --dump=${dump}`, { cwd: dir, encoding: 'utf8', timeout: 5_400_000, maxBuffer: 1 << 28 });
    } catch (e) {
      text = `error: ${(e as Error).message.slice(0, 300)}`;
    }
    writeFileSync(join(outDir, `${arm}-agree.txt`), text);
    console.log(`agree ${arm} (${Math.round((Date.now() - t0) / 1000)} s): ${text.split('\n').filter(l => l.startsWith('decisions')).join(' ')}`);
  }
}
