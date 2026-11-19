/**
 * R0 count 1, part D: sums the JSON lines of scripts/runner-rework/map-hidden.ts (one or more files or a directory).
 *   node scripts/runner-rework/map-hidden-sum.mjs out/          (every *.jsonl / *.txt under it)
 * Kinds kept apart: self (the 221 deals), humanCorp (a person as Corp against our Runner; `hard` games apart),
 * humanRunner (a person as Runner; the shadow Runner's memory only).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
for (const a of process.argv.slice(2)) {
  if (statSync(a).isDirectory()) for (const f of readdirSync(a, { recursive: true })) {
    if (/\.(jsonl|txt)$/.test(String(f))) files.push(join(a, String(f)));
  } else files.push(a);
}
const rows = [];
for (const f of files)
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    if (!l.startsWith('{')) continue;
    try {
      rows.push(JSON.parse(l));
    } catch {
      /* a cut line */
    }
  }
const kindOf = r => (r.sk === 'humanCorp' ? (r.hard ? 'humanCorp:hard' : 'humanCorp:normal') : r.sk);
const inc = (o, k, n = 1) => (o[k] = (o[k] ?? 0) + n);

// ---- sources
const games = rows.filter(r => r.kind === 'g');
const summaries = rows.filter(r => r.kind === 's');
const byKind = {};
for (const s of summaries) {
  const k = kindOf(s);
  const o = (byKind[k] ??= { sources: 0, decisions: 0, prompts: 0, realPath: 0, asks: 0, honestFlips: 0, stops: 0, withUnexplained: {}, ids: {} });
  o.sources++;
  o.decisions += s.decisions;
  o.prompts += s.prompts;
  o.realPath += s.realPath;
  o.asks += s.asks;
  o.honestFlips += s.honestFlips;
  o.stops += s.stops;
  for (const [l, n] of Object.entries(s.withUnexplained)) inc(o.withUnexplained, l, n);
  for (const [l, n] of Object.entries(s.ids)) inc(o.ids, l, n);
}
console.log('## Sources');
console.log(`deals played: ${games.length}, matching the g1 base record: ${games.filter(g => g.matchesBatch).length}`);
for (const g of games.filter(g => !g.matchesBatch)) console.log(`  NOT MATCHING: ${g.src}`);
console.log('\n## D1/D3: Runner decisions whose memory holds a card the state does not mark known (by class), and distinct cards');
for (const [k, o] of Object.entries(byKind)) {
  const perGame = n => (n / o.sources).toFixed(3);
  console.log(`\n### ${k}: ${o.sources} sources, ${o.decisions} Runner decisions`);
  for (const [l, n] of Object.entries(o.withUnexplained).sort((a, b) => b[1] - a[1])) console.log(`  ${l}: ${n} decisions (${perGame(n)} a game), ${o.ids[l] ?? 0} distinct cards (${perGame(o.ids[l] ?? 0)} a game)`);
  console.log(`  honest-memory asks: ${o.asks}, changed: ${o.honestFlips}${k === 'self' ? `, control stops: ${o.stops}` : `, control unlike the recorded move: ${o.stops} (recorded on an older beta or by the Hard Runner or a person; not a stop)`}`);
}
// ---- honest flips, listed
console.log('\n## Honest-memory changes (the decision with the unexplained installed entries taken out of memory)');
for (const r of rows.filter(r => r.kind === 'u' && r.honest && r.honest !== 'same'))
  console.log(`  ${kindOf(r)} ${r.src} T${r.T} ${r.cls}: ${r.unexplained.map(u => `${u.label} ${u.title} (${u.zone} ${u.server ?? ''})`).join('; ')} -> ${String(r.honest).slice(0, 140)}`);
for (const r of rows.filter(r => r.kind === 'u' && r.stop)) console.log(`  STOP-OR-RECORDED ${kindOf(r)} ${r.src} T${r.T}: ${JSON.stringify(r.stop).slice(0, 200)}`);
// ---- distinct unexplained cards, by class
console.log('\n## Distinct unexplained cards by class (first sighting)');
const seen = new Set();
const byClass = {};
for (const r of rows.filter(r => r.kind === 'u'))
  for (const u of r.unexplained) {
    const key = `${r.src}|${u.id}|${u.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (byClass[`${kindOf(r)} ${u.label}`] ??= []).push(`${r.src.replace('human:', '')} T${r.T} ${u.title} (${u.zone}${u.server ? ' ' + u.server : ''})`);
  }
for (const [k, v] of Object.entries(byClass).sort()) console.log(`  ${k} (${v.length}): ${v.slice(0, 12).join('; ')}${v.length > 12 ? ' ...' : ''}`);
// ---- D2
console.log('\n## D2: Runner prompts answered on the real state (promptAnswer real path), by kind, card, step and what the prompt names');
const d2 = {};
for (const r of rows.filter(r => r.kind === 'p')) {
  const k = kindOf(r);
  const o = (d2[k] ??= { prompts: 0, real: 0, rows: {} });
  o.prompts++;
  if (!r.real) continue;
  o.real++;
  const key = `${r.pk} ${r.title ?? r.code} [${r.step}] names ${r.named.join('+')}`;
  const x = (o.rows[key] ??= { n: 0, p1: 0, p2: 0, p3: 0, p3asked: 0, stop: 0 });
  x.n++;
  if ((r.p1 ?? []).some(v => v !== 'same')) x.p1++;
  if ((r.p2 ?? []).some(v => v !== 'same')) x.p2++;
  if ((r.p3 ?? []).some(v => v !== 'n/a')) x.p3asked++;
  if ((r.p3 ?? []).some(v => v !== 'same' && v !== 'n/a')) x.p3++;
  if (r.stop) x.stop++;
}
const nSources = k => byKind[k]?.sources ?? 1;
for (const [k, o] of Object.entries(d2)) {
  console.log(`\n### ${k}: ${o.prompts} Runner prompts, ${o.real} on the real path (${(o.real / nSources(k)).toFixed(3)} a game)`);
  for (const [key, x] of Object.entries(o.rows).sort((a, b) => b[1].n - a[1].n))
    console.log(`  ${x.n} (${(x.n / nSources(k)).toFixed(3)} a game) ${key}: answer changed by P1 (stack order) ${x.p1}, P2 (unnamed Corp cards) ${x.p2}, P3 (named facedown cards) ${x.p3} of ${x.p3asked}${x.stop ? `, control unlike played ${x.stop}` : ''}`);
}
console.log('\n## D2 changed answers, listed');
for (const r of rows.filter(r => r.kind === 'p' && r.real && [...(r.p1 ?? []), ...(r.p2 ?? []), ...(r.p3 ?? [])].some(v => v !== 'same' && v !== 'n/a')))
  console.log(`  ${kindOf(r)} ${r.src} T${r.T} ${r.title} [${r.step}] names ${r.named.join('+')}: control ${String(r.control).slice(0, 150)} | p1 ${JSON.stringify(r.p1).slice(0, 120)} | p2 ${JSON.stringify(r.p2).slice(0, 120)} | p3 ${JSON.stringify(r.p3).slice(0, 200)}`);
