// Valuation V-B (brief rev 2, ruling 6): a step's log against its base, from `sum.mjs <dir> --json <file>` on each.
//   (a) per site, p50, p99 and max: flagged when p99 or max moves by more than 2x or by more than 10 credits (a stop
//       unless a copy of the step explains it; the hand-off says which);
//   (b) values served by a loop guard, per guard key: flagged when a count rises;
//   (c) not-finite values outside the named sentinels: flagged when any appear.
//   node scripts/value-owners/compare-sites.mjs base.json head.json
import { readFileSync } from 'node:fs';

const [base, head] = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, 'utf8')));
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const moved = (a, b) => Number.isFinite(a) && Number.isFinite(b) && (Math.abs(b - a) > 10 || (Math.abs(a) > 1e-9 && Math.abs(b) > 1e-9 && Math.max(Math.abs(a), Math.abs(b)) / Math.min(Math.abs(a), Math.abs(b)) > 2) || Math.sign(a) !== Math.sign(b) && Math.abs(b - a) > 1);
let flags = 0;
console.log('| site | values base / head | p50 base / head | p99 base / head | max base / head | not finite | flag |');
console.log('|---|---|---|---|---|---|---|');
for (const site of [...new Set([...Object.keys(base.sites), ...Object.keys(head.sites)])].sort()) {
  const a = base.sites[site] ?? {};
  const b = head.sites[site] ?? {};
  const flag = [];
  if (!a.n) flag.push('new site');
  if (!b.n) flag.push('gone');
  if (moved(a.p99, b.p99)) flag.push('p99 moved');
  if (moved(a.max, b.max)) flag.push('max moved');
  if ((b.notFinite ?? 0) > 0) flag.push('not finite');
  if (flag.some(f => f !== 'gone')) flags++;
  console.log(`| ${site} | ${a.n ?? 0} / ${b.n ?? 0} | ${f2(a.p50)} / ${f2(b.p50)} | ${f2(a.p99)} / ${f2(b.p99)} | ${f2(a.max)} / ${f2(b.max)} | ${a.notFinite ?? 0} / ${b.notFinite ?? 0} | ${flag.join(', ')} |`);
}
console.log('');
console.log('| guard key | served base / head | flag |');
console.log('|---|---|---|');
for (const key of [...new Set([...Object.keys(base.guards), ...Object.keys(head.guards)])].sort()) {
  const a = base.guards[key] ?? 0;
  const b = head.guards[key] ?? 0;
  if (b > a) flags++;
  console.log(`| ${key} | ${a} / ${b} | ${b > a ? 'rose' : ''} |`);
}
const kn = o => Object.values(o.known).reduce((s, k) => [s[0] + k.n, s[1] + k.equal], [0, 0]);
console.log(`\nknown-answer check 1: base ${kn(base).join(' of ').split(' of ').reverse().join(' of ')}, head ${kn(head).reverse().join(' of ')}`);
console.log(`${flags} flag(s)`);
