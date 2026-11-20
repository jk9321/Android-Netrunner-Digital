// V-C item 4 (install prompts) count, (c): the suite on each arm's tree against beta's patched tree.
//   node scripts/stage-vc/install-prompt-suite-sum.mjs <dir with beta.json, chainCorp.json, ...>
// Lists every test whose result differs from beta's tree (turned to passing, broken), and the failures common to all.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const arms = ['beta', 'chainCorp', 'chainOut', 'chainInstall'].filter(a => existsSync(join(dir, `${a}.json`)));
const res = {};
for (const a of arms) {
  const j = JSON.parse(readFileSync(join(dir, `${a}.json`), 'utf8'));
  res[a] = new Map();
  // A known-failing pin (it.fails) whose inner test now passes reports 'failed' with "Expect test to fail": that is a pin turned to passing
  for (const f of j.testResults)
    for (const t of f.assertionResults)
      res[a].set(`${f.name.replace(/.*\/tests\//, 'tests/')} > ${t.fullName}`, t.status === 'failed' && (t.failureMessages ?? []).some(m => m.includes('Expect test to fail')) ? 'pinPasses' : t.status);
  console.log(`${a}: ${j.numTotalTests} tests, ${j.numPassedTests} passed, ${j.numFailedTests} failed, ${j.numPendingTests + (j.numTodoTests ?? 0)} skipped/todo`);
}
const failed = a => [...res[a]].filter(([, s]) => s === 'failed').map(([k]) => k);
console.log(`\nFailing on beta's tree (${failed('beta').length}):`);
for (const k of failed('beta')) console.log(`  ${k}`);
for (const a of arms.filter(x => x !== 'beta')) {
  const turned = [...res.beta].filter(([k, s]) => (s === 'failed' && res[a].get(k) === 'passed') || (s === 'passed' && res[a].get(k) === 'pinPasses')).map(([k]) => k);
  const broke = [...res.beta].filter(([k, s]) => s === 'passed' && res[a].get(k) === 'failed').map(([k]) => k);
  const gone = [...res.beta].filter(([k]) => !res[a].has(k)).map(([k]) => k);
  console.log(`\n### ${a}: known-failing pins turned to passing ${turned.length}, broken ${broke.length}, missing ${gone.length}`);
  for (const k of turned) console.log(`  PIN PASSES ${k}`);
  for (const k of broke) console.log(`  BROKEN ${k}`);
  for (const k of gone) console.log(`  MISSING ${k}`);
}
