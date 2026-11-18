// Stage D exploit F2 (grip money), the bar's line 4 ("no exploit pin and no passing pin reads worse"): the unit tests
// run in a copy of this checkout per arm of grip-money-arms.json (its patches applied to the copy's src/; tests,
// fixtures and config as they are), and in beta's own copy (`beta`), each test's state read from vitest's JSON report.
// Prints, per arm, every test whose state differs from beta's (a known-failing pin that now passes counts too).
//   node scripts/stage-d/grip-money-suite.mjs [arm,...] [-- extra vitest args]
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const file = JSON.parse(readFileSync('scripts/stage-d/grip-money-arms.json', 'utf8'));
const want = (process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2].split(',') : ['beta', ...Object.keys(file._arms)]).filter(a => a === 'beta' || file._arms[a]);
const extra = process.argv.includes('--') ? process.argv.slice(process.argv.indexOf('--') + 1) : [];
const root = resolve('.gm-suite');
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
// e2e (browser) and the multiplayer server's suites read nothing of the AI
const EXCLUDE = ['tests/e2e/**', 'e2e/**', 'tests/roomFuzz.test.ts', 'tests/onlineClient.test.ts'];

function copy(arm) {
  const dir = join(root, arm);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of tracked) if (!f.startsWith('.github/') && existsSync(f)) cpSync(f, join(dir, f), { recursive: true });
  symlinkSync(resolve('node_modules'), join(dir, 'node_modules'));
  for (const g of arm === 'beta' ? [] : file._arms[arm])
    for (const [f, from, to] of file[g]) {
      const p = join(dir, 'src', f);
      const text = readFileSync(p, 'utf8');
      if (text.split(from).length !== 2) throw new Error(`${arm}: a patch does not match once in ${f}`);
      writeFileSync(p, text.replace(from, to));
    }
  return dir;
}

const run = (arm, dir) =>
  new Promise(done => {
    const out = join(root, `${arm}.json`);
    const p = spawn('node_modules/.bin/vitest', ['run', '--reporter=json', `--outputFile=${out}`, ...EXCLUDE.flatMap(e => ['--exclude', e]), ...extra], { cwd: dir, stdio: 'ignore' });
    p.on('exit', () => done(out));
  });

mkdirSync(root, { recursive: true });
const results = {};
const PAR = Number(process.env.PAR ?? 2);
const queue = [...want];
await Promise.all(
  Array.from({ length: PAR }, async () => {
    while (queue.length) {
      const arm = queue.shift();
      const t = Date.now();
      const out = await run(arm, copy(arm));
      const j = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { testResults: [] };
      results[arm] = Object.fromEntries(j.testResults.flatMap(f => f.assertionResults.map(a => [`${f.name.replace(/^.*\/\.gm-suite\/[^/]+\//, '')} > ${a.fullName}`, a.status])));
      console.error(`${arm}: ${Object.keys(results[arm]).length} tests, ${Object.values(results[arm]).filter(s => s === 'failed').length} failed, ${((Date.now() - t) / 1000).toFixed(0)} s`);
    }
  })
);
const base = results.beta ?? {};
for (const arm of want.filter(a => a !== 'beta')) {
  const r = results[arm];
  const diff = Object.keys({ ...base, ...r }).filter(k => base[k] !== r[k]);
  console.log(`## ${arm}: ${Object.keys(r).length} tests, ${Object.values(r).filter(s => s === 'failed').length} failed (beta ${Object.values(base).filter(s => s === 'failed').length}); differ from beta: ${diff.length}`);
  for (const k of diff) console.log(`- ${base[k] ?? 'absent'} -> ${r[k] ?? 'absent'}: ${k}`);
}
if (!process.env.KEEP) rmSync(root, { recursive: true, force: true });
