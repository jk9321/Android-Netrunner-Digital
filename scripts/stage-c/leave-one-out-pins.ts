/**
 * Step 4 Stage C7: the pins under leave-one-out (spec section 5). Every test file that reads src/ai is run under the new
 * core (TEST_PLAN=+corpCore,+rolloutLines) with nothing left out, and again with each carried-over rule left out in turn
 * (LOO_OFF, tests/setup.ts). SHARD k of n takes configuration k % 20 (0 = nothing left out, then the arms of
 * leave-one-out.ts) and the file group floor(k / 20) of ceil(n / 20). One JSON line per configuration and group: the
 * failed tests. Sum with leave-one-out-pins-sum.mjs.
 *   SHARD=0/60 npx vite-node scripts/stage-c/leave-one-out-pins.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ARMS = [
  ...Array.from({ length: 9 }, (_, k) => `line${k + 1}`),
  'isPettyCash', 'tagsBeforeScore', 'overAdvance', 'tagFirst', 'trapAdvanceCap', 'assetAdvance', 'advancesAsIce', 'hqTrashCost', 'pettyCashFirst', 'tagFirstPick',
];
const CONFIGS = ['', ...ARMS];
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const groups = Math.max(1, Math.ceil(shards / CONFIGS.length));
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
    env: { ...process.env, TEST_PLAN: '+corpCore,+rolloutLines', LOO_OFF: config },
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
