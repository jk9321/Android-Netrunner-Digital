// V-C item 1 count: compares each arm's suite (vitest JSON from breaker-once-suite.ts) with beta's patched tree, and
// prints the human-agreement lines (beta and control: their spread is the noise reading (d) compares with).
//   node scripts/stage-vc/breaker-once-suite-sum.mjs <out dir>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const files = [];
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).forEach(f => walk(join(p, f))) : files.push(p));
walk(process.argv[2]);
const suites = {};
for (const f of files.filter(f => f.endsWith('.json') && !f.endsWith('-agree.json'))) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  const res = new Map();
  for (const file of j.testResults ?? []) for (const t of file.assertionResults ?? []) res.set(`${basename(file.name)} > ${t.fullName}`, t.status);
  suites[basename(f, '.json')] = { res, failed: j.numFailedTests, passed: j.numPassedTests, total: j.numTotalTests };
}
const beta = suites.beta;
console.log(`## Suite on each tree (vitest; against beta's patched tree)\n`);
console.log(`beta: ${beta.passed} passed, ${beta.failed} failed of ${beta.total}. Failing on beta's patched tree (the code-health guards a patched copy fails, and anything else):`);
for (const [k, v] of beta.res) if (v === 'failed') console.log(`- ${k}`);
for (const [arm, s] of Object.entries(suites)) {
  if (arm === 'beta') continue;
  const diff = [...new Set([...s.res.keys(), ...beta.res.keys()])].filter(k => s.res.get(k) !== beta.res.get(k));
  console.log(`\n### ${arm}: ${s.passed} passed, ${s.failed} failed of ${s.total}; ${diff.length} change against beta`);
  for (const k of diff) console.log(`- ${k}: beta ${beta.res.get(k) ?? 'absent'} -> ${s.res.get(k) ?? 'absent'}`);
}
console.log(`\n## Human agreement (scripts/human-agreement.ts on each tree)\n`);
for (const f of files.filter(f => f.endsWith('.txt')).sort()) {
  for (const l of readFileSync(f, 'utf8').split('\n')) if (/^agree /.test(l)) console.log(`- ${l}`);
}
