/**
 * Step S-1: which pins fail with each valuation family ablated (brief-step-s.md step 3). Every test file that reads src/ai
 * is run with nothing ablated, and again with each family ablated for one side (TEST_ABLATE, tests/setup.ts). SHARD k of
 * n takes configuration k % configs and the file group floor(k / configs) of floor(n / configs). One JSON line per
 * configuration and group: the failed tests. Sum with scripts/stage-c/leave-one-out-pins-sum.mjs (same line format).
 * (After scripts/stage-c/leave-one-out-pins.ts.)
 *   SHARD=0/64 npx vite-node scripts/step-s/pins.ts -- corp
 */
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ABLATE_FAMILIES } from '../../src/ai/pricing';

// ARGS: `corp` or `runner` (the side the families are ablated for; default corp), then optionally a comma list of families
const args = (process.env.ARGS ?? process.argv.slice(2).join(' ')).split(/\s+/).filter(Boolean);
const side = args[0] === 'runner' ? 'runner' : 'corp';
const only = (args[1] ?? '').split(',').filter(Boolean);
const CONFIGS = ['', ...ABLATE_FAMILIES.filter(f => !only.length || only.includes(f)).map(f => `${side}:${f}`)];
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const groups = Math.max(1, Math.floor(shards / CONFIGS.length));
const config = CONFIGS[shard % CONFIGS.length];
const group = Math.floor(shard / CONFIGS.length);
const files = readdirSync('tests')
  .filter(f => f.endsWith('.test.ts') && readFileSync(join('tests', f), 'utf8').includes('src/ai'))
  .sort()
  .filter((_, i) => i % groups === group)
  .map(f => join('tests', f));
if (group < groups && files.length) {
  const out = join(process.env.OUT_DIR ?? tmpdir(), `vitest-${shard}.json`);
  const r = spawnSync('npx', ['vitest', 'run', '--pool=forks', '--maxWorkers=1', '--reporter=json', `--outputFile=${out}`, ...files], {
    env: { ...process.env, TEST_ABLATE: config },
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  let failed: string[];
  let total = 0;
  try {
    const j = JSON.parse(readFileSync(out, 'utf8'));
    total = j.numTotalTests;
    failed = j.testResults.flatMap((f: { name: string; assertionResults: { status: string; fullName: string }[] }) =>
      f.assertionResults.filter(a => a.status === 'failed').map(a => `${f.name.replace(/^.*tests\//, '')}: ${a.fullName}`),
    );
  } catch {
    failed = [`no report (exit ${r.status}): ${(r.stderr ?? '').slice(-500)}`];
  }
  console.log(JSON.stringify({ config: config || 'none', group, files: files.length, total, failed }));
}
