// ai-prompt-time: compare scripts/prompt-route.ts output on the base and the branch.
//   node scripts/prompt-route-sum.mjs base-*.jsonl -- head-*.jsonl
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const cut = args.indexOf('--');
const read = files => {
  const m = new Map();
  for (const f of files) for (const line of readFileSync(f, 'utf8').split('\n')) if (line.startsWith('{')) { const r = JSON.parse(line); m.set(r.key, r); }
  return m;
};
const base = read(args.slice(0, cut));
const head = read(args.slice(cut + 1));
const byCode = {};
for (const [k, b] of base) {
  const h = head.get(k);
  const row = (byCode[b.code] ??= { prompts: 0, matched: 0, differ: 0, baseMs: 0, headMs: 0, examples: [] });
  row.prompts++;
  if (!h) continue;
  row.matched++;
  row.baseMs += b.ms;
  row.headMs += h.ms;
  if (b.answer.join() !== h.answer.join()) {
    row.differ++;
    if (row.examples.length < 5) row.examples.push(`${k.split('|').slice(0, 3).join(' ')}: base [${b.answer}] head [${h.answer}]`);
  }
}
for (const [code, r] of Object.entries(byCode)) console.log(`${code}: ${r.prompts} on the base, ${r.matched} matched, ${r.differ} answers differ; Corp decision ms on the matched: base ${r.baseMs}, head ${r.headMs}${r.examples.length ? '\n  ' + r.examples.join('\n  ') : ''}`);
console.log(`head-only prompts: ${[...head.keys()].filter(k => !base.has(k)).length}`);
