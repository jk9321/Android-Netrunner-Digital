/**
 * Review fixes 2026-11-19, bundle R (rez), count step, part D (brief:
 * /mnt/project-files/netrunner-ai/review-fixes-1119/rez-count/brief.md): the 37 "rez not made" misses of the Runner
 * rework's count 3 (r0/count3-get-in/count-note.md section 4; run 44590458201). Reads that run's JSON lines and prints
 * the self-play B rows (the walk said the server holds and the Runner got in) whose causes are "rezNotMade" or
 * "grip+rezNotMade", with the same tests as scripts/runner-rework/get-in-sum.mjs (section G), one JSON line each:
 * the deal, the turn, the server and the index of the run that got in among the turn's runs (the `runs` of its turn
 * record). rez-count.ts tags each Corp rez window with the same (deal, turn, run index) so the summing step can say
 * which window's rez was not made and what said no.
 *
 *   node scripts/review-fixes/rez-d-list.mjs run-44590458201.jsonl > scripts/review-fixes/rez-d-list.json
 */
import { readFileSync } from 'node:fs';

const rows = process.argv
  .slice(2)
  .flatMap(f => readFileSync(f, 'utf8').split('\n'))
  .filter(l => l.startsWith('{'))
  .map(l => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);
const gameOf = src => src.replace(/#.*$/, '').replace(/(report-40)[bc]/, '$1');
const turnKey = (src, T) => `${gameOf(src)}|${src}|${T}`;
const turnBy = new Map(rows.filter(r => r.kind === 'turn').map(t => [turnKey(t.src, t.T), t]));
const out = [];
for (const v of rows.filter(r => r.kind === 'v' && r.src.startsWith('deal:'))) {
  const t = turnBy.get(turnKey(v.src, v.T));
  if (!t) continue;
  const from = (v.runs ?? []).length;
  const later = t.runs.slice(from);
  for (const sv of v.servers) {
    const mine = later.filter(r => r.server === sv.id);
    if (!(sv.hold?.holds && mine.some(r => r.ok))) continue;
    const r0 = mine.find(r => r.ok);
    const pre = t.acts.slice(0, Math.max(0, r0.at));
    const causes = [];
    if (r0.by !== 'click' || pre.some(a => /PLAY_OPERATION_OR_EVENT|INSTALL_CARD/.test(a.a))) causes.push('grip');
    if (pre.some(a => a.rc1 > a.rc0)) causes.push('money');
    if (r0.unrez > 0 && r0.rezzed.length < r0.unrez) causes.push('rezNotMade');
    if (v.cls?.length) causes.push('holdFault:' + v.cls.join('+'));
    const c = causes.join('+');
    if (c !== 'rezNotMade' && c !== 'grip+rezNotMade') continue;
    out.push({ src: v.src, T: v.T, where: v.where, server: sv.id, run: t.runs.indexOf(r0), cause: c, unrez: r0.unrez, rezzed: r0.rezzed, by: r0.by, cc0: r0.cc0, spent: r0.spent });
  }
}
console.log(JSON.stringify(out, null, 1));
console.error(`${out.length} rows (${out.filter(r => r.cause === 'rezNotMade').length} rezNotMade, ${out.filter(r => r.cause === 'grip+rezNotMade').length} grip+rezNotMade)`);
