/**
 * Runner rework R0 count 3: deck-level marks for the hold-inputs fixes 1, 2 and 6 on the self-play deals (coordinator
 * 18:42Z): a deal is marked when its Runner deck holds Saci, Knickknack or Audrey v2, or its Corp deck Lionsmane or a
 * borrowing ice (Mycoweb, the only card whose text resolves a subroutine of another rezzed ice). Coarser than a board mark
 * (every board of the deal): read as "the walk's answer may be touched".
 *   OUT=marks.json npx vite-node scripts/runner-rework/get-in-deckmarks.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dealState } from '../stage-a/harness';
const rec = JSON.parse(readFileSync('scripts/stage-d/post-pick-deals.json', 'utf8'));
const out: Record<string, string[]> = {};
for (const r of rec) {
  const s = dealState(r.seed);
  const runner = [...s.runner.stack, ...s.runner.grip].map(c => c.cardCode);
  const corp = [...s.corp.rd, ...s.corp.hq].map(c => c.cardCode);
  const m: string[] = [];
  if (runner.includes('34017')) m.push('saci');
  if (corp.includes('36041')) m.push('lionsmane');
  if (corp.includes('35053')) m.push('borrow');
  if (runner.includes('35033')) m.push('knickknack');
  if (runner.includes('34004')) m.push('audrey');
  if (m.length) out[`deal:${r.seed}`] = m;
}
writeFileSync(process.env.OUT ?? 'get-in-deckmarks.json', JSON.stringify(out));
console.log(Object.keys(out).length, JSON.stringify(Object.values(out).reduce((a: any, m) => { for (const x of m) a[x] = (a[x] ?? 0) + 1; return a; }, {})));
