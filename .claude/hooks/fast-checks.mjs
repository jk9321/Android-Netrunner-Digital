#!/usr/bin/env node
// Fast checks for the main/beta gate (gate-main-beta.mjs) and the hand-off skill:
// typecheck, lint and the unit tests minus the slow AI/self-play files, run in parallel.
// The slow files and the browser (e2e) tests still run in CI on every push to main and beta.
//
//   node .claude/hooks/fast-checks.mjs          exit 0 = all passed, 1 = something failed
//
// SLOW_TESTS: files that take more than ~5 s each (measured 2026-11-08 on a 4-core runner:
// main: ai 200 s, brokeCorp 39 s, lethalHq 23 s, savedGame 12 s; beta adds hqNoSafer 15 s; the rest is ~25 s).
// A listed file that doesn't exist on a branch is simply not excluded.
// If a new test file takes longer than that, add it here rather than making every commit slow.
import { spawn } from 'node:child_process';

const SLOW_TESTS = [
  'tests/ai.test.ts', // main
  'tests/aiGames.part*.test.ts', // beta: the AI games, split in four
  'tests/brokeCorp.test.ts',
  'tests/lethalHq.test.ts',
  'tests/savedGame.test.ts',
  'tests/hqNoSafer.test.ts', // beta
  'tests/roomFuzz.test.ts', // ~15 s: the game server's room fuzzer (multiplayer chunk 2b)
  'tests/hiddenDraws.test.ts', // beta, about 8 s
  'tests/onlineClient.test.ts', // about 6 s: whole online games through the browser's table (multiplayer chunk 2c)
];

const bin = (name) => `node_modules/.bin/${name}`;
const jobs = [
  { label: 'typecheck', cmd: bin('tsc'), args: ['--noEmit'] },
  { label: 'lint', cmd: bin('eslint'), args: ['.'] },
  {
    label: 'fast unit tests',
    cmd: bin('vitest'),
    args: ['run', '--reporter=dot', ...SLOW_TESTS.flatMap((f) => ['--exclude', f])],
  },
];

function run(job) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(job.cmd, job.args, { env: { ...process.env, CI: 'true', FORCE_COLOR: '0' } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('error', (e) => resolve({ ...job, ok: false, out: String(e), secs: 0 }));
    p.on('close', (code) => resolve({ ...job, ok: code === 0, out, secs: ((Date.now() - t0) / 1000).toFixed(0) }));
  });
}

const results = await Promise.all(jobs.map(run));
let ok = true;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.label} (${r.secs}s)`);
  if (!r.ok) {
    ok = false;
    const lines = r.out.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((l) => l.trim());
    console.log(lines.slice(-40).map((l) => `  ${l}`).join('\n'));
  }
}
if (ok) console.log(`Fast checks passed. Not run here (CI runs them): ${SLOW_TESTS.join(', ')}, e2e.`);
process.exit(ok ? 0 : 1);
