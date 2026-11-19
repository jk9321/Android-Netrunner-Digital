// Stage D item 7: sums scripts/stage-d/agenda-discard.ts output (jsonl files, one per shard).
//   node scripts/stage-d/agenda-discard-sum.mjs out/*.jsonl [> summary.json]
// Q1 per source kind (self, humanRunner, humanCorp): discard prompts, mixed HQs, class cases (recorded and today's), forced
// (agendas only); every class case's row; the batch check (every deal's winner, cr and sc against the g1 record); Q4.
import { readFileSync } from 'node:fs';

const rows = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const by = (k) => rows.filter(r => r.kind === k);
const games = by('g');
const humans = by('h');
const prompts = by('p');
const q4 = by('q4');
const kinds = ['self', 'humanRunner', 'humanCorp'];
const t = {};
for (const k of kinds) {
  const ps = prompts.filter(p => p.who === k);
  t[k] = {
    prompts: ps.length,
    mixed: ps.filter(p => p.mixed).length,
    classRecorded: ps.filter(p => p.recClass).length,
    classToday: ps.filter(p => p.todayClass).length,
    forced: ps.filter(p => p.forced).length,
    nonOnly: ps.filter(p => p.nAg === 0).length,
    agreeToday: ps.filter(p => p.agree).length,
    errors: ps.filter(p => p.error).length,
    synergyOff: ps.filter(p => !p.synergy).length,
  };
}
const matched = games.filter(g => g.matchesBatch).length;
const q4sum = {};
for (const r of q4) {
  const k = `${r.who} | ${r.via.replace(/inst-\d+/g, '')}`;
  const s = (q4sum[k] ??= { n: 0, agendaLost: 0, cls: 0 });
  s.n++;
  if (r.agendaLost) s.agendaLost++;
  if (r.cls) s.cls++;
}
const cases = prompts.filter(p => p.recClass || p.todayClass);
console.log(
  JSON.stringify(
    {
      deals: games.length,
      dealsMatchBatch: matched,
      dealMismatch: games.filter(g => !g.matchesBatch).map(g => g.src),
      humanFiles: humans.length,
      humanStopped: humans.filter(h => h.stopped).map(h => `${h.src}: ${h.stopped}`),
      q1: t,
      cases,
      q4: q4sum,
      q4cls: q4.filter(r => r.cls),
    },
    null,
    1
  )
);
