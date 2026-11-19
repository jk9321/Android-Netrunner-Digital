/**
 * Count 2 (brief-count2.md): the oracle answers count 1 saved, kept for reuse.
 *   node scripts/stage-d/madani-hosted2-saved.mjs <count 1 merged q/c lines> <count 1 generated g lines>
 * Writes scripts/stage-d/madani-hosted2-saved.json:
 *  - q: by `${src}|${i}|${k}` (k is the question's place in its decision's list, the order count 1 printed it), the
 *    server, the horizon, beta's answer and the extended oracle's, for every question it asked;
 *  - g: by generated server k, the plain and extended oracle's answers, the bare server's, and count 1's arm.
 * Count 2 asks the oracle again only where no saved answer has the same key.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [qFile, gFile] = process.argv.slice(2);
const lines = f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
const q = {};
const at = new Map();
for (const x of lines(qFile).filter(x => x.kind === 'q')) {
  const d = `${x.src}|${x.i}`;
  const k = at.get(d) ?? 0;
  at.set(d, k + 1);
  if (x.oracleX !== 'holds' && x.oracleX !== 'getsIn') continue;
  q[`${d}|${k}`] = { server: x.server, when: x.opts.when, beta: x.beta.holds, oracleX: x.oracleX, oracle: x.oracle, hosted: typeof x.hosted === 'object' ? x.hosted.holds : null };
}
const g = {};
for (const x of lines(gFile).filter(x => x.kind === 'g' && !x.error)) g[x.k] = { oracle: x.oracle, oracleX: x.oracleX, bare: x.oracleBare, hosted: x.hosted.holds, hostedNeed: x.hosted.need, beta: x.beta.holds };
writeFileSync('scripts/stage-d/madani-hosted2-saved.json', JSON.stringify({ q, g }) + '\n');
console.log(`${Object.keys(q).length} questions, ${Object.keys(g).length} servers`);
