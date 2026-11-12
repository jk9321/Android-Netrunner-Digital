// Sums scripts/corp-card-usage.ts output by card title: node scripts/corp-card-usage-sum.mjs usage*.jsonl [--min=5]
// Columns per side (ai, and jeff where his games have the card): copies seen, share used (played or installed), Corp
// turns held in HQ while playable per copy, turns from seen to used, share rezzed of installed (not agendas or
// operations), rez delay, credits made per used copy against the entry's claim, runs ended per rezzed ice, share of
// installed trashed. Sorted by the gap between the claim and what the card made, then by turns held.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const min = Number(args.find(a => a.startsWith('--min='))?.split('=')[1] ?? 5);
const rows = args.filter(a => !a.startsWith('--')).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const pct = (k, n) => (n ? `${Math.round((100 * k) / n)}%` : '-');
const by = {};
for (const r of rows) for (const c of r.copies) ((by[c.title] ??= { type: c.type, claim: c.claim, ai: [], jeff: [] })[r.who] ??= []).push(c);
const stat = cs => {
  const used = cs.filter(c => c.used !== undefined);
  const inst = used.filter(c => c.type !== 'operation' && c.type !== 'agenda');
  const rez = inst.filter(c => c.rezzed !== undefined);
  const ice = rez.filter(c => c.type === 'ice');
  return {
    n: cs.length,
    used: pct(used.length, cs.length),
    held: mean(cs.map(c => c.heldPlayable)),
    wait: mean(used.map(c => c.used - c.seen)),
    rezzed: pct(rez.length, inst.length),
    delay: mean(rez.map(c => c.rezzed - c.used)),
    credits: mean(used.map(c => c.credits)),
    stops: mean(ice.map(c => c.stops)),
    trashed: pct(inst.filter(c => c.trashed).length, inst.length),
  };
};
const games = { ai: rows.filter(r => r.who === 'ai').length, jeff: rows.filter(r => r.who === 'jeff').length };
console.log(`games: AI ${games.ai}, Jeff ${games.jeff}; cards with at least ${min} AI copies`);
const table = Object.entries(by)
  .filter(([, v]) => v.ai.length >= min)
  .map(([title, v]) => ({ title, v, ai: stat(v.ai), jeff: v.jeff.length ? stat(v.jeff) : null }))
  .sort((a, b) => (b.v.claim ?? 0) - b.ai.credits - ((a.v.claim ?? 0) - a.ai.credits) || b.ai.held - a.ai.held);
const line = s => (s ? `${String(s.n).padStart(4)} used ${s.used.padStart(4)} held ${f(s.held)} wait ${f(s.wait)} rez ${s.rezzed.padStart(4)} delay ${f(s.delay)} cr ${f(s.credits)} stops ${f(s.stops)} trashed ${s.trashed.padStart(4)}` : '');
for (const { title, v, ai, jeff } of table) {
  console.log(`${title.slice(0, 28).padEnd(28)} ${v.type.slice(0, 9).padEnd(9)} claim ${v.claim ?? '-'}`.padEnd(52) + ` AI ${line(ai)}`);
  if (jeff) console.log(''.padEnd(52) + ` J  ${line(jeff)}`);
}
