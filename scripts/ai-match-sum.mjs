// Adds up the shard counts from scripts/ai-match.ts (see ai-match.sh).
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2).filter(f => f.endsWith('.json'));
const args = process.argv.slice(2).filter(f => !f.endsWith('.json'));
const total = { base: {}, newCorp: {}, newRunner: {} };
const corp = new Map();
const runner = new Map();
for (const f of files) {
  const lines = readFileSync(f, 'utf8').trim().split('\n');
  const data = JSON.parse(lines[lines.length - 1]);
  for (const k of Object.keys(total)) for (const [w, n] of Object.entries(data.results[k])) total[k][w] = (total[k][w] ?? 0) + n;
  for (const [name, d] of data.byCorpDeck) {
    const t = corp.get(name) ?? { base: 0, newCorp: 0, n: 0 };
    corp.set(name, { base: t.base + d.base, newCorp: t.newCorp + d.newCorp, n: t.n + d.n });
  }
  for (const [name, d] of data.byRunnerDeck) {
    const t = runner.get(name) ?? { base: 0, newRunner: 0, n: 0 };
    runner.set(name, { base: t.base + d.base, newRunner: t.newRunner + d.newRunner, n: t.n + d.n });
  }
}
const n = Object.values(total.base).reduce((a, b) => a + b, 0);
const pct = x => `${((100 * (x ?? 0)) / n).toFixed(1)}%`;
console.log(`${args.join(' ') || '1 normal'}: ${n} deals`);
console.log(`old vs old:        Corp ${pct(total.base.corp)}  Runner ${pct(total.base.runner)}  unfinished ${pct(total.base.draw)}`);
console.log(`NEW Corp vs old:   Corp ${pct(total.newCorp.corp)}  (${(total.newCorp.corp ?? 0) - (total.base.corp ?? 0)} games)`);
console.log(`old vs NEW Runner: Runner ${pct(total.newRunner.runner)}  (${(total.newRunner.runner ?? 0) - (total.base.runner ?? 0)} games)`);
if (process.env.DETAIL) {
  for (const [name, d] of corp) console.log(`  corp ${name}: ${d.base}/${d.n} -> ${d.newCorp}/${d.n}`);
  for (const [name, d] of runner) console.log(`  runner ${name}: ${d.base}/${d.n} -> ${d.newRunner}/${d.n}`);
}
